import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { privateTradingConfig, PrivateTradingConfig } from '../access';
import type { OwnerSession } from '../serviceTypes';
import type { PrivateTradingMarketData } from '../marketData';
import { NativeDemoService } from './service';
import { PrismaNativeRepository } from './store';
import { nativeTestAccountIds } from './testAccounts';
import { IdleBackoffScheduler, type IdleSleepOptions, type SweepOutcome } from '../../services/IdleBackoffScheduler';
import { IDLE_SWEEP_MAX_MS } from '../../config/limits';

export const NATIVE_LIMIT_PASS_MS=10_000;
export const NATIVE_LIMIT_PASS_MAX_MS=300_000;

/** Production may deliberately sample less often to stay inside a hosting
 * bandwidth budget. Invalid values fail closed to the established 10s
 * cadence; nobody can accidentally disable execution or create a hot loop. */
export function nativeLimitPassIntervalMs(raw=process.env.NATIVE_LIMIT_PASS_MS):number{
  if(raw===undefined||raw.trim()==='')return NATIVE_LIMIT_PASS_MS;
  const value=Number(raw);
  return Number.isInteger(value)&&value>=NATIVE_LIMIT_PASS_MS&&value<=NATIVE_LIMIT_PASS_MAX_MS?value:NATIVE_LIMIT_PASS_MS;
}
/** Sampled server pass, independent of browser polling. No invented worker
 * identity: reuse the persisted, unexpired submitting session and reauthorize
 * it through the ordinary repository on every read/commit. CAS handles replicas.
 *
 * With `sleep` (production), a pass that finds no account with an open
 * position or a working order holds no timer: the native routes nudge it
 * after any command that leaves such work, and after a session admission. */
export class NativeLimitPass {
  private scheduler:IdleBackoffScheduler|null=null;
  private running:Promise<void>|null=null;
  /** Whether the last pass found any account to refresh — never how many
   *  orders it filled: a resting order nowhere near its price fills none. */
  private lastOutcome:SweepOutcome='found-work';
  failures=0;
  constructor(private service:Pick<NativeDemoService,'command'|'queued'>,private targets:()=>Promise<OwnerSession[]>,private now=Date.now,readonly intervalMs=nativeLimitPassIntervalMs()){}
  start(options:{sleep?:IdleSleepOptions}={}){if(!this.scheduler){
    console.info(`[native-limit-pass] interval_ms=${this.intervalMs}`);
    this.scheduler=new IdleBackoffScheduler({baseMs:this.intervalMs,maxIdleMs:Math.max(IDLE_SWEEP_MAX_MS,this.intervalMs),
      // A failed pass is not evidence of an empty table: rethrown, the
      // scheduler retries at the base cadence instead of sleeping on it.
      sweep:async()=>{try{await this.tick();}catch(e){this.failures++;throw e;}return this.lastOutcome;},sleep:options.sleep});
    this.scheduler.start();
  }}
  async stop(){this.scheduler?.stop();this.scheduler=null;await this.running;}
  /** New work may exist (a command left an open position or working order,
   *  or a session was admitted): run now unless already at base cadence. */
  nudge(){this.scheduler?.nudge();}
  get asleep(){return this.scheduler?.isAsleep??false;}
  tick():Promise<void>{
    if(this.running)return this.running;
    const work=(async()=>{
      const targets=await this.targets();
      this.lastOutcome=targets.length>0?'found-work':'idle';
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
  return new NativeLimitPass(service,()=>nativeLimitTargets(db,config));
}
/** The configured accounts that have an open position or a working order and
 *  an unexpired persisted session — the pass's whole scan, one query. */
export async function nativeLimitTargets(db:PrismaClient,config:()=>PrivateTradingConfig=privateTradingConfig):Promise<OwnerSession[]>{
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
}
