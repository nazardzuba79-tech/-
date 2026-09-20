import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { privateTradingConfig, PrivateTradingConfig } from '../access';
import type { OwnerSession } from '../serviceTypes';
import type { PrivateTradingMarketData } from '../marketData';
import { NativeDemoService } from './service';
import { PrismaNativeRepository } from './store';
import { nativeTestAccountIds } from './testAccounts';

export const NATIVE_LIMIT_PASS_MS=10_000;
/** Sampled server pass, independent of browser polling. No invented worker
 * identity: reuse the persisted, unexpired submitting session and reauthorize
 * it through the ordinary repository on every read/commit. CAS handles replicas. */
export class NativeLimitPass {
  private timer:ReturnType<typeof setInterval>|null=null;
  private running:Promise<void>|null=null;
  failures=0;
  constructor(private service:Pick<NativeDemoService,'command'|'queued'>,private targets:()=>Promise<OwnerSession[]>,private now=Date.now){}
  start(){if(!this.timer){this.timer=setInterval(()=>{void this.tick().catch(()=>{this.failures++;});},NATIVE_LIMIT_PASS_MS);this.timer.unref();}}
  async stop(){if(this.timer)clearInterval(this.timer);this.timer=null;await this.running;}
  tick():Promise<void>{
    if(this.running)return this.running;
    const work=(async()=>{
      const targets=await this.targets();
      // Four in flight, but visit every configured account each pass. A
      // four-account round-robin cannot preserve a 30s UI budget at scale.
      for(let i=0;i<targets.length;i+=4)await Promise.all(targets.slice(i,i+4).map(async actor=>{
        if(actor.expiresAt<=this.now()||this.service.queued(actor.userId)>0)return;
        try{await this.service.command(actor,{kind:'REFRESH',idempotencyKey:`limit-pass-${randomUUID()}`});}
        catch{this.failures++;} // Fail closed; the next sample can retry a new observation.
      }));
    })();
    this.running=work;
    void work.then(()=>{this.running=null;},()=>{this.running=null;});
    return work;
  }
}
export function createNativeLimitPass(db:PrismaClient,market:PrivateTradingMarketData,config:()=>PrivateTradingConfig=privateTradingConfig){
  const service=new NativeDemoService(new PrismaNativeRepository(db,config,true),market);
  return new NativeLimitPass(service,async()=>{
    const c=config();if(!c.enabled||!c.ownerId)return[];
    const ids=[c.ownerId,...nativeTestAccountIds()];
    // Fetch only scheduler metadata of configured accounts, not full histories.
    // The configured owner + at most 100 explicit testers bound the scan.
    const rows=await db.$queryRaw<{userId:string;actor:OwnerSession}[]>(Prisma.sql`
      SELECT a."userId", CASE WHEN COALESCE((p."executionSession"->>'expiresAt')::numeric,0)
        >= COALESCE((a."payload"->'executionSession'->>'expiresAt')::numeric,0)
        THEN p."executionSession" ELSE a."payload"->'executionSession' END AS actor
      FROM "NativeDemoAccount" a LEFT JOIN "NativeDemoLiveProjection" p ON p."userId"=a."userId"
      WHERE a."userId" IN (${Prisma.join(ids)})
        AND (EXISTS (SELECT 1 FROM jsonb_array_elements(a."payload"->'snapshot'->'positions') v WHERE v->>'status'='OPEN')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(a."payload"->'snapshot'->'orders') v WHERE v->>'status' IN ('OPEN','PARTIALLY_FILLED')))
      ORDER BY a."userId" LIMIT 101`);
    return rows.filter(r=>r.actor&&r.actor.userId===r.userId&&typeof r.actor.sessionId==='string'
      &&Number.isSafeInteger(r.actor.expiresAt)&&r.actor.expiresAt>Date.now()).map(r=>r.actor);
  });
}
