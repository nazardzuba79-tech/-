import { createHash } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import type { NativeDemoService, NativeCommand } from '../../private-trading/native/service';
import { inflate, type NativeAccount } from '../../private-trading/native/store';
import { isNativeTestAccount } from '../../private-trading/native/testAccounts';
import { futuresCopyCommitGuard, FuturesCopyGuardError } from './FuturesCopyCommitGuard';
import { futuresDemoSourceExits, futuresDemoSourceFills } from './FuturesDemoSource';
import { futuresDemoObserverEnabled, approvedFuturesDemoLeader } from './FuturesDemoObserverService';
import { DemoEngineError } from '../../private-trading/native/engine';

type Tx = Prisma.TransactionClient;
const n=(s:{toString():string}|string)=>new BigNumber(s.toString());
const positive=(s:string)=>/^(0|[1-9][0-9]{0,11})([.][0-9]{1,8})?$/.test(s)&&n(s).gt(0);
/** Hard-OFF unless explicitly enabled on top of the disposable loopback review gate. */
export const futuresDemoExecutionEnabled=(env:NodeJS.ProcessEnv=process.env)=>
  env.COPY_FUTURES_DEMO_EXECUTION_ENABLED==='true'&&futuresDemoObserverEnabled(env);
/** Automatic copying additionally needs this flag; without it copy runs only on the follower's request. */
export const futuresDemoAutomaticEnabled=(env:NodeJS.ProcessEnv=process.env)=>
  env.COPY_FUTURES_DEMO_AUTOMATIC==='true'&&futuresDemoExecutionEnabled(env);
/** How long one consent lets the server act for the follower without the follower returning. */
export const COPY_DELEGATION_MS=7*24*3600_000;
export class FuturesCopyExecutionError extends Error {
  constructor(readonly code:string,readonly status=409){super(code);}
}
export interface FuturesDemoExecutionLimits {
  ratio:string; maxLeverage:string; maxFillUsdt:string;
  maxTotalExposureUsdt:string; maxDeviationBps:string;
}
/** An explicit isolated second consent. OBSERVING is never consent to trade.
 * In this first slice one follower may hold only ONE copied position, and
 * source OPEN add-ons to that same position are refused (never merged).
 */
export class FuturesDemoFollowerExecutor {
  constructor(private readonly db:PrismaClient,private readonly native:Pick<NativeDemoService,'command'>,
    private readonly enabled:()=>boolean=futuresDemoExecutionEnabled,
    private readonly leaderApproved:(userId:string)=>boolean=approvedFuturesDemoLeader) {}
  private on(){if(!this.enabled())throw new FuturesCopyExecutionError('FUTURES_COPY_EXECUTOR_OFF',403);}
  private limits(l:FuturesDemoExecutionLimits){
    if(!positive(l.ratio)||n(l.ratio).gt(1)||!positive(l.maxLeverage)||n(l.maxLeverage).gt(100)
      ||!positive(l.maxFillUsdt)||!positive(l.maxTotalExposureUsdt)||n(l.maxTotalExposureUsdt).lt(l.maxFillUsdt)
      ||!/^(0|[1-9][0-9]{0,3})([.][0-9]{1,2})?$/.test(l.maxDeviationBps)
      ||n(l.maxDeviationBps).gt(500))throw new FuturesCopyExecutionError('INVALID_COPY_EXECUTION_LIMITS',400);
  }
  private async authorized(tx:Tx,userId:string,sessionId:string){
    const [user,session]=await Promise.all([
      tx.user.findUnique({where:{id:userId},select:{blockedAt:true}}),
      tx.session.findUnique({where:{id:sessionId},select:{userId:true,revokedAt:true}}),
    ]);
    if(!user||user.blockedAt||!session||session.revokedAt||session.userId!==userId||!isNativeTestAccount(userId))
      throw new FuturesCopyExecutionError('FUTURES_COPY_ACCESS_DENIED',403);
  }
  private async source(tx:Tx,sub:{traderId:string;ownerUserId:string}){
    const strategy=await tx.copyStrategyOwner.findUnique({where:{traderId:sub.traderId},select:{ownerUserId:true}});
    if(strategy?.ownerUserId!==sub.ownerUserId)throw new FuturesCopyExecutionError('SOURCE_OWNER_CHANGED',403);
    if(!this.leaderApproved(sub.ownerUserId))throw new FuturesCopyExecutionError('SOURCE_CONSENT_REVOKED',403);
    const owner=await tx.user.findUnique({where:{id:sub.ownerUserId},select:{blockedAt:true}});
    if(!owner||owner.blockedAt)throw new FuturesCopyExecutionError('SOURCE_UNAVAILABLE',403);
    const leader=await tx.nativeDemoAccount.findUnique({where:{userId:sub.ownerUserId},select:{revision:true,payload:true}});
    if(!leader||!leader.revision||((leader.payload as Record<string,unknown>).executionMode==='HISTORICAL_DEMO'))
      throw new FuturesCopyExecutionError('SOURCE_DEMO_UNAVAILABLE',403);
    return leader.revision;
  }
  /** Explicit test-only consent; begins at CURRENT source revision. Never
   * converts historical OBSERVED_ONLY rows into automatically copied trades.
   */
  async begin(userId:string,sessionId:string,limits:FuturesDemoExecutionLimits){
    this.on();this.limits(limits);
    return this.db.$transaction(async tx=>{
      this.on();await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
      await this.authorized(tx,userId,sessionId);
      const sub=await tx.copyFuturesDemoSubscription.findUnique({where:{userId}});
      if(!sub||sub.status!=='OBSERVING')throw new FuturesCopyExecutionError('OBSERVATION_REQUIRED',403);
      const currentRevision=await this.source(tx,sub);
      const account=await tx.nativeDemoAccount.findUnique({where:{userId},select:{revision:true,payload:true}});
      if(!account||account.revision<1)throw new FuturesCopyExecutionError('FOLLOWER_DEMO_MISSING',403);
      const state=inflate(account.payload as unknown as NativeAccount);
      if(state.executionMode==='HISTORICAL_DEMO'||state.snapshot.positions.some(p=>p.status==='OPEN')
        ||state.snapshot.orders.some(o=>o.status==='OPEN'||o.status==='PARTIALLY_FILLED'))
        throw new FuturesCopyExecutionError('FOLLOWER_MUST_START_FLAT',403);
      const current=await tx.copyFuturesDemoConsent.findUnique({where:{userId}});
      if(current?.status==='ACTIVE')throw new FuturesCopyExecutionError('ALREADY_CONSENTED');
      if(current&&await tx.copyFuturesDemoMirror.count({where:{consentId:current.id,kind:'OPEN',status:'APPLIED'}}))
        throw new FuturesCopyExecutionError('EXISTING_COPY_HISTORY_RECONCILIATION_REQUIRED');
      // The delegation is an ordinary revocable Session of this follower, visible in
      // their session list. No token is ever issued for it; only this service uses it.
      if(current?.delegatedSessionId)await tx.session.updateMany({where:{id:current.delegatedSessionId,revokedAt:null},data:{revokedAt:new Date()}});
      const delegated=await tx.session.create({data:{userId,userAgent:'VOLTEX copy trading (automatic)'}});
      const delegation={delegatedSessionId:delegated.id,delegationExpiresAt:new Date(Date.now()+COPY_DELEGATION_MS)};
      const row=await tx.copyFuturesDemoConsent.upsert({
        where:{userId},
        create:{userId,subscriptionId:sub.id,startedAfterRevision:currentRevision,...limits,status:'ACTIVE',...delegation},
        update:{startedAfterRevision:currentRevision,...limits,status:'ACTIVE',...delegation},
      });
      return {execution:'ISOLATED_TEST_ONLY' as const,automaticProductionCopying:false,consentId:row.id,startedAfterRevision:currentRevision};
    },{timeout:20000});
  }
  async stop(userId:string,sessionId:string){
    this.on();
    return this.db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "CopyFuturesDemoConsent" WHERE "userId"=${userId} FOR UPDATE`;
      await this.authorized(tx,userId,sessionId);
      if(rows.length){
        const c=await tx.copyFuturesDemoConsent.update({where:{userId},data:{status:'STOPPED',delegationExpiresAt:null}});
        // Withdrawing consent revokes the server's delegation at once.
        if(c.delegatedSessionId)await tx.session.updateMany({where:{id:c.delegatedSessionId,revokedAt:null},data:{revokedAt:new Date()}});
      }
      // Existing opened positions remain as modeled demo assets; stop
      // authorizes no automatic liquidation or new order.
      return {status:'STOPPED' as const,existingPositionsRetained:true};
    },{timeout:45000});
  }
  /** Manually run ONE bounded delivery under the same subscription row lock
   * used by stop(). A returned unknown outcome keeps the deterministic native
   * command key, allowing retry/reconcile after a transport failure.
   *
   * There is deliberately no background worker and no HTTP write route.
   */
  async drainOne(userId:string,sessionId:string){
    this.on();
    return this.db.$transaction(async tx=>{
      const locked=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "CopyFuturesDemoConsent" WHERE "userId"=${userId} FOR UPDATE`;
      if(!locked.length)throw new FuturesCopyExecutionError('COPY_EXECUTION_CONSENT_REQUIRED',403);
      await this.authorized(tx,userId,sessionId);
      const consent=await tx.copyFuturesDemoConsent.findUniqueOrThrow({where:{userId},include:{subscription:true}});
      if(consent.status!=='ACTIVE'||consent.subscription.status!=='OBSERVING')
        throw new FuturesCopyExecutionError('COPY_EXECUTION_STOPPED',403);
      await this.source(tx,consent.subscription);
      // A fixed first-page scan would starve at 50 processed receipts.
      // Find the earliest unprocessed event in indexed PostgreSQL order,
      // without unbounded application-side fetching or journal replays.
      const pending=await tx.$queryRaw<{id:string}[]>`
        SELECT e."id" FROM "CopyFuturesDemoEvent" e
        WHERE e."subscriptionId"=${consent.subscriptionId}
          AND e."sourceRevision" > ${consent.startedAfterRevision}
          AND NOT EXISTS (
            SELECT 1 FROM "CopyFuturesDemoMirror" m
            WHERE m."consentId"=${consent.id}
              AND m."sourceEventId"=e."sourceEventId"
          )
        ORDER BY e."sourceRevision", e."sourceEventIndex", e."id"
        LIMIT 1`;
      if (!pending.length) return {status:'EMPTY' as const,automaticProductionCopying:false};
      const source=await tx.copyFuturesDemoEvent.findUniqueOrThrow({where:{id:pending[0].id}});
      const key='copy-futures-'+createHash('sha256').update(consent.id+':'+source.sourceEventId).digest('hex').slice(0,58);
      const sourceQuantity=n(source.quantity).times(n(consent.ratio)).decimalPlaces(8,BigNumber.ROUND_DOWN);
      const receipt=(status:'APPLIED'|'REJECTED',reason:string|null,positionId:string|null,quantity:string|null)=>
        tx.copyFuturesDemoMirror.create({data:{consentId:consent.id,sourceEventId:source.sourceEventId,
          sourcePositionId:source.sourcePositionId,sourceRevision:source.sourceRevision,kind:source.kind,
          requestKey:key,status,reason,followerPositionId:positionId,filledQuantity:quantity}});
      const reject=async(reason:string)=>{
        await receipt('REJECTED',reason,null,null);
        return {status:'REJECTED' as const,reason,sourceEventId:source.sourceEventId};
      };
      const reconcile=(applied:{revision:number;payload:Prisma.JsonValue})=>
        this.reconcileReceipt(tx,userId,source.kind==='OPEN'?'OPEN':'CLOSE',source.sourceEventId,applied,receipt);
      // A previous attempt may have committed this exact command and lost its
      // response (transport reset, restart, transaction timeout). Its receipt is
      // the answer: re-running the pre-checks against the CHANGED position would
      // refuse a CLOSE that really happened, or re-send an OPEN.
      const committed=await tx.nativeDemoRevision.findUnique({where:{userId_requestKey:{userId,requestKey:key}}});
      if(committed)return reconcile(committed);
      // Source take-profit, stop-loss and liquidation exits close the copied position
      // (proportionally, or fully when the source position is gone). They only reduce risk.
      const exit=source.kind==='TAKE_PROFIT'||source.kind==='STOP_LOSS'||source.kind==='LIQUIDATION';
      if(!exit&&source.kind!=='OPEN'&&source.kind!=='CLOSE')return reject('SOURCE_EXIT_NOT_MIRRORED');
      if(!sourceQuantity.gt(0))return reject('COPY_QUANTITY_TOO_SMALL');
      // The observer table is only a receipt index, not an execution oracle.
      // Re-verify the exact source fill against the immutable NativeDemo
      // revision and its native instruction/position provenance.
      const revision=await tx.nativeDemoRevision.findUnique({
        where:{userId_revision:{userId:consent.subscription.ownerUserId,revision:source.sourceRevision}},
        select:{payload:true},
      });
      if(!revision)return reject('SOURCE_PROVENANCE_MISMATCH');
      const sourceAccount=inflate(revision.payload as unknown as NativeAccount);
      const eventIndex=sourceAccount.snapshot.events.findIndex(e=>e.id===source.sourceEventId);
      if(exit){
        const verifiedExit=futuresDemoSourceExits(sourceAccount).find(f=>f.sourceEventId===source.sourceEventId);
        if(!verifiedExit||eventIndex!==source.sourceEventIndex||verifiedExit.sourcePositionId!==source.sourcePositionId
          ||verifiedExit.symbol!==source.symbol||verifiedExit.kind!==source.kind||verifiedExit.side!==source.side
          ||!n(verifiedExit.quantity).eq(source.quantity.toString()))
          return reject('SOURCE_PROVENANCE_MISMATCH');
      }else{
        const verified=futuresDemoSourceFills(sourceAccount).accepted.find(f=>f.sourceEventId===source.sourceEventId);
        if(!verified || eventIndex!==source.sourceEventIndex || verified.sourceActionId!==source.sourceActionId
          || verified.sourcePositionId!==source.sourcePositionId || verified.symbol!==source.symbol
          || verified.kind!==source.kind || verified.side!==source.side
          || verified.marginType!==source.marginType || verified.pricing!==source.pricing
          || !n(verified.quantity).eq(source.quantity.toString()) || !n(verified.price).eq(source.price.toString())
          || !n(verified.leverage).eq(source.leverage.toString()))
          return reject('SOURCE_PROVENANCE_MISMATCH');
        if(n(source.leverage).gt(consent.maxLeverage.toString())||n(source.price).times(sourceQuantity).gt(consent.maxFillUsdt.toString()))
          return reject('COPY_SOURCE_RISK_LIMIT');
      }
      // Is the source position still open after this event? An exit or close that
      // ends it must end the copied position too, never leave rounding dust.
      const sourceStillOpen=sourceAccount.snapshot.positions.some(p=>p.id===source.sourcePositionId&&p.status==='OPEN');
      const follower=await tx.nativeDemoAccount.findUnique({where:{userId},select:{payload:true}});
      const followerState=follower?inflate(follower.payload as unknown as NativeAccount):null;
      const admitted=follower ? (follower.payload as Record<string,unknown>).executionSession as
        {userId?:string;sessionId?:string;expiresAt?:number}|undefined : undefined;
      // Never invent a worker identity or extend an expired native session.
      // The follower must have explicitly admitted their current live session
      // to NativeDemoService, and the real repository checks it again at commit.
      if(admitted?.userId!==userId||admitted.sessionId!==sessionId
        ||!Number.isFinite(admitted.expiresAt)||admitted.expiresAt!<=Date.now())
        throw new FuturesCopyExecutionError('FOLLOWER_NATIVE_SESSION_NOT_ADMITTED',403);
      const actor={userId,sessionId,expiresAt:admitted.expiresAt!};
      // Actual issuer is the signed-in existing account. The native service
      // rechecks User/Session authorization before its financial CAS commit.
      let command:NativeCommand,existingPositionId:string|undefined;
      // Positions this consent opened and still holds: the only positions copy may touch.
      const heldMirrors=await tx.copyFuturesDemoMirror.findMany({where:{consentId:consent.id,status:'APPLIED'}});
      const held=new Map<string,BigNumber>();
      for(const m of heldMirrors){
        if(!m.followerPositionId||!m.filledQuantity)continue;
        const q=held.get(m.followerPositionId)??n('0');
        held.set(m.followerPositionId,m.kind==='OPEN'?q.plus(m.filledQuantity.toString()):q.minus(m.filledQuantity.toString()));
      }
      const attributed=heldMirrors.find(m=>m.sourcePositionId===source.sourcePositionId&&m.kind==='OPEN'&&m.followerPositionId)?.followerPositionId??null;
      const openPositions=followerState?.snapshot.positions.filter(p=>p.status==='OPEN')??[];
      const copiedIds=[...held].filter(([,q])=>q.gt(0)).map(([id])=>id);
      // The follower's own trades and copied trades never mix: every open position must
      // be one this consent holds, at exactly the quantity it holds; no own resting orders.
      if(openPositions.some(p=>!held.has(p.id)||!n(p.quantity).eq(held.get(p.id)!))
        ||followerState?.snapshot.orders.some(o=>o.status==='OPEN'||o.status==='PARTIALLY_FILLED'))
        return reject('FOLLOWER_POSITION_MIXED_WITH_OTHER_ACTIVITY');
      if(source.kind==='OPEN'){
        if(attributed&&!(held.get(attributed)?.gt(0)))return reject('COPY_POSITION_ALREADY_CLOSED');
        existingPositionId=attributed??undefined;
        command={kind:'OPEN',symbol:source.symbol,side:source.side as 'LONG'|'SHORT',
          type:'MARKET',quantity:sourceQuantity.toFixed(),leverage:source.leverage.toString(),
          marginType:'ISOLATED',executionMode:'LIVE_EXECUTION',idempotencyKey:key};
      }else{
        if(!attributed)return reject('NO_COPY_ATTRIBUTED_POSITION');
        const available=held.get(attributed)??n('0');
        if(!available.gt(0))return reject('COPY_POSITION_ALREADY_CLOSED');
        if(!openPositions.some(p=>p.id===attributed))return reject('FOLLOWER_POSITION_MIXED_WITH_OTHER_ACTIVITY');
        const quantity=sourceStillOpen?BigNumber.minimum(sourceQuantity,available):available;
        if(!quantity.gt(0))return reject('COPY_QUANTITY_TOO_SMALL');
        existingPositionId=attributed;
        // CLOSE is modeled on follower's own book; the leader's price is only
        // a slippage reference, never a settlement price.
        command={kind:'CLOSE',positionId:existingPositionId,quantity:quantity.toFixed(),
          executionMode:'LIVE_EXECUTION',idempotencyKey:key};
      }
      const positionId=existingPositionId;
      const guard=futuresCopyCommitGuard({
        action:source.kind==='OPEN'?'OPEN':'CLOSE',symbol:source.symbol,
        ...(positionId?{positionId}:{}),requestedQuantity:command.quantity!,
        copiedPositionIds:copiedIds,riskReducingExit:exit,
        sourcePrice:source.price.toString(),maxDeviationBps:consent.maxDeviationBps.toString(),
        maxFillUsdt:consent.maxFillUsdt.toString(),maxTotalExposureUsdt:consent.maxTotalExposureUsdt.toString(),
        maxLeverage:consent.maxLeverage.toString(),stillEnabled:this.enabled,
      });
      try {
        await this.native.command(actor,command,{commitGuard:guard});
      }catch(error){
        if(error instanceof FuturesCopyGuardError||error instanceof DemoEngineError)
          return reject(error.code);
        // Infrastructure/session uncertainty is not a definitive rejection:
        // the NativeDemoRevision may already have been committed. Retry with
        // this SAME requestKey to retrieve the authoritative single receipt.
        throw error;
      }
      const applied=await tx.nativeDemoRevision.findUnique({where:{userId_requestKey:{userId,requestKey:key}}});
      if(!applied)throw new FuturesCopyExecutionError('COPY_NATIVE_CONFIRMATION_UNKNOWN',503);
      return reconcile(applied);
    },{timeout:60000,maxWait:10000});
  }
  /** Authenticated read of this follower's own consent and copy receipts.
   * Every APPLIED row names the follower position its NativeDemoRevision opened
   * or reduced; REJECTED rows carry the exact refusal code. Nothing is derived
   * from the leader's balances, and no other account's rows are reachable.
   */
  async snapshot(userId:string,sessionId:string){
    this.on();
    return this.db.$transaction(async tx=>{
      await this.authorized(tx,userId,sessionId);
      const consent=await tx.copyFuturesDemoConsent.findUnique({where:{userId}});
      if(!consent)return{automatic:false,consent:null,mirrors:[] as never[]};
      const mirrors=await tx.copyFuturesDemoMirror.findMany({where:{consentId:consent.id},
        orderBy:[{sourceRevision:'desc'},{createdAt:'desc'}],take:50});
      const events=await tx.copyFuturesDemoEvent.findMany({where:{subscriptionId:consent.subscriptionId,
        sourceEventId:{in:mirrors.map(m=>m.sourceEventId)}},select:{sourceEventId:true,symbol:true,side:true,price:true}});
      const byEvent=new Map(events.map(e=>[e.sourceEventId,e]));
      return{automatic:consent.status==='ACTIVE'&&!!consent.delegatedSessionId&&futuresDemoAutomaticEnabled()
          &&!!consent.delegationExpiresAt&&consent.delegationExpiresAt.getTime()>Date.now(),
        consent:{status:consent.status as 'ACTIVE'|'STOPPED',ratio:consent.ratio.toString(),
          maxLeverage:consent.maxLeverage.toString(),maxFillUsdt:consent.maxFillUsdt.toString(),
          maxTotalExposureUsdt:consent.maxTotalExposureUsdt.toString(),maxDeviationBps:consent.maxDeviationBps.toString(),
          startedAfterRevision:consent.startedAfterRevision},
        mirrors:mirrors.map(m=>({sourceEventId:m.sourceEventId,kind:m.kind,status:m.status as 'APPLIED'|'REJECTED',
          reason:m.reason,symbol:byEvent.get(m.sourceEventId)?.symbol??null,side:byEvent.get(m.sourceEventId)?.side??null,
          sourcePrice:byEvent.get(m.sourceEventId)?.price.toString()??null,
          followerPositionId:m.followerPositionId,filledQuantity:m.filledQuantity?.toString()??null,createdAt:m.createdAt}))};
    });
  }
  /** Deliver up to `max` pending source events, one serialized drainOne at a
   * time, stopping at the first EMPTY. An unknown outcome propagates unchanged
   * so the caller retries with the SAME deterministic request keys.
   */
  async run(userId:string,sessionId:string,max=10){
    this.on();
    const results:Array<{status:string;reason?:string;sourceEventId?:string}>=[];
    for(let i=0;i<max;i++){
      const r=await this.drainOne(userId,sessionId);
      if(r.status==='EMPTY')return{results,hasMore:false};
      results.push(r);
    }
    return{results,hasMore:true};
  }
  /** Journal a committed follower command from its own NativeDemo receipt. */
  private async reconcileReceipt(tx:Tx,userId:string,kind:string,sourceEventId:string,
    applied:{revision:number;payload:Prisma.JsonValue},
    receipt:(status:'APPLIED',reason:null,positionId:string,quantity:string)=>Promise<unknown>){
    const previous=await tx.nativeDemoRevision.findUnique({where:{userId_revision:{userId,revision:applied.revision-1}}});
    if(!previous)throw new FuturesCopyExecutionError('COPY_NATIVE_PREVIOUS_REVISION_MISSING',503);
    const before=inflate(previous.payload as unknown as NativeAccount);
    const after=inflate(applied.payload as unknown as NativeAccount);
    const old=new Set(before.snapshot.events.map(e=>e.id));
    const added=after.snapshot.events.filter(e=>!old.has(e.id)&&e.kind===kind);
    // Defense in depth: the internal commitGuard already validated the
    // new events in the same simulated financial CAS transaction.
    if(!added.length||new Set(added.map(e=>e.positionId)).size!==1)
      throw new FuturesCopyExecutionError('COPY_NATIVE_RECEIPT_UNRECONCILED',503);
    const qty=added.reduce((sum,e)=>sum.plus(e.quantity),n('0'));
    const followerPositionId=added[0].positionId;
    if(!followerPositionId)throw new FuturesCopyExecutionError('COPY_NATIVE_RECEIPT_UNRECONCILED',503);
    await receipt('APPLIED',null,followerPositionId,qty.toFixed());
    return {status:'APPLIED' as const,sourceEventId,
      followerPositionId,filledQuantity:qty.toFixed(),automaticProductionCopying:false};
  }
}
