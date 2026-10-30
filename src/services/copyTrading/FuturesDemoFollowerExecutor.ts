import { createHash } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import type { NativeDemoService, NativeCommand } from '../../private-trading/native/service';
import { inflate, type NativeAccount } from '../../private-trading/native/store';
import { isNativeTestAccount } from '../../private-trading/native/testAccounts';
import { futuresCopyCommitGuard, FuturesCopyGuardError } from './FuturesCopyCommitGuard';
import { futuresDemoObserverEnabled, approvedFuturesDemoLeader } from './FuturesDemoObserverService';
import { DemoEngineError } from '../../private-trading/native/engine';

type Tx = Prisma.TransactionClient;
const n=(s:{toString():string}|string)=>new BigNumber(s.toString());
const positive=(s:string)=>/^(0|[1-9][0-9]{0,11})([.][0-9]{1,8})?$/.test(s)&&n(s).gt(0);
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
    private readonly enabled:()=>boolean=()=>process.env.COPY_FUTURES_DEMO_EXECUTION_ENABLED==='true'
      && futuresDemoObserverEnabled(),
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
      const row=await tx.copyFuturesDemoConsent.upsert({
        where:{userId},
        create:{userId,subscriptionId:sub.id,startedAfterRevision:currentRevision,...limits,status:'ACTIVE'},
        update:{startedAfterRevision:currentRevision,...limits,status:'ACTIVE'},
      });
      return {execution:'ISOLATED_TEST_ONLY' as const,automaticProductionCopying:false,consentId:row.id,startedAfterRevision:currentRevision};
    },{timeout:20000});
  }
  async stop(userId:string,sessionId:string){
    this.on();
    return this.db.$transaction(async tx=>{
      const rows=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "CopyFuturesDemoConsent" WHERE "userId"=${userId} FOR UPDATE`;
      await this.authorized(tx,userId,sessionId);
      if(rows.length)await tx.copyFuturesDemoConsent.update({where:{userId},data:{status:'STOPPED'}});
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
      // Never use source events present before explicit execution consent.
      const candidates=await tx.copyFuturesDemoEvent.findMany({
        where:{subscriptionId:consent.subscriptionId,sourceRevision:{gt:consent.startedAfterRevision}},
        orderBy:[{sourceRevision:'asc'},{sourceEventIndex:'asc'},{id:'asc'}],take:50,
      });
      let source=undefined as (typeof candidates)[number]|undefined;
      for(const item of candidates) {
        if(!await tx.copyFuturesDemoMirror.findUnique({where:{consentId_sourceEventId:{consentId:consent.id,sourceEventId:item.sourceEventId}},select:{id:true}})){
          source=item;break;
        }
      }
      if(!source)return {status:'EMPTY' as const,automaticProductionCopying:false};
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
      if(!sourceQuantity.gt(0))return reject('COPY_QUANTITY_TOO_SMALL');
      if(n(source.leverage).gt(consent.maxLeverage.toString())||n(source.price).times(sourceQuantity).gt(consent.maxFillUsdt.toString()))
        return reject('COPY_SOURCE_RISK_LIMIT');
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
      if(source.kind==='OPEN'){
        const existing=await tx.copyFuturesDemoMirror.count({where:{consentId:consent.id,
          sourcePositionId:source.sourcePositionId,kind:'OPEN',status:'APPLIED'}});
        if(existing)return reject('SOURCE_POSITION_ADDON_UNSUPPORTED');
        command={kind:'OPEN',symbol:source.symbol,side:source.side as 'LONG'|'SHORT',
          type:'MARKET',quantity:sourceQuantity.toFixed(),leverage:source.leverage.toString(),
          marginType:'ISOLATED',executionMode:'LIVE_EXECUTION',idempotencyKey:key};
      }else{
        const opens=await tx.copyFuturesDemoMirror.findMany({where:{consentId:consent.id,
          sourcePositionId:source.sourcePositionId,kind:'OPEN',status:'APPLIED'}});
        if(opens.length!==1||!opens[0].followerPositionId||!opens[0].filledQuantity)
          return reject('NO_COPY_ATTRIBUTED_POSITION');
        const prior=await tx.copyFuturesDemoMirror.findMany({where:{consentId:consent.id,
          sourcePositionId:source.sourcePositionId,kind:'CLOSE',status:'APPLIED'}});
        const available=n(opens[0].filledQuantity).minus(prior.reduce((sum,v)=>sum.plus(v.filledQuantity?.toString()??'0'),n('0')));
        if(!available.gt(0))return reject('COPY_POSITION_ALREADY_CLOSED');
        const ownOpen=followerState?.snapshot.positions.filter(p=>p.status==='OPEN')??[];
        if(ownOpen.length!==1||ownOpen[0].id!==opens[0].followerPositionId
          ||!n(ownOpen[0].quantity).eq(available)
          ||followerState!.snapshot.orders.some(o=>o.status==='OPEN'||o.status==='PARTIALLY_FILLED'))
          return reject('FOLLOWER_POSITION_MIXED_WITH_OTHER_ACTIVITY');
        const quantity=BigNumber.minimum(sourceQuantity,available);
        existingPositionId=opens[0].followerPositionId;
        // CLOSE is modeled on follower's own book; the leader's price is only
        // a slippage reference, never a settlement price.
        command={kind:'CLOSE',positionId:existingPositionId,quantity:quantity.toFixed(),
          executionMode:'LIVE_EXECUTION',idempotencyKey:key};
      }
      const positionId=existingPositionId;
      const guard=futuresCopyCommitGuard({
        action:source.kind as 'OPEN'|'CLOSE',symbol:source.symbol,
        ...(positionId?{positionId}:{}),requestedQuantity:command.kind==='OPEN'?command.quantity!:command.quantity!,
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
      const previous=await tx.nativeDemoRevision.findUnique({where:{userId_revision:{userId,revision:applied.revision-1}}});
      if(!previous)throw new FuturesCopyExecutionError('COPY_NATIVE_PREVIOUS_REVISION_MISSING',503);
      const before=inflate(previous.payload as unknown as NativeAccount);
      const after=inflate(applied.payload as unknown as NativeAccount);
      const old=new Set(before.snapshot.events.map(e=>e.id));
      const added=after.snapshot.events.filter(e=>!old.has(e.id)&&e.kind===source.kind);
      // Defense in depth: the internal commitGuard already validated the
      // new events in the same simulated financial CAS transaction.
      if(!added.length||new Set(added.map(e=>e.positionId)).size!==1)
        throw new FuturesCopyExecutionError('COPY_NATIVE_RECEIPT_UNRECONCILED',503);
      const qty=added.reduce((sum,e)=>sum.plus(e.quantity),n('0'));
      const followerPositionId=added[0].positionId;
      if(!followerPositionId)throw new FuturesCopyExecutionError('COPY_NATIVE_RECEIPT_UNRECONCILED',503);
      await receipt('APPLIED',null,followerPositionId,qty.toFixed());
      return {status:'APPLIED' as const,sourceEventId:source.sourceEventId,
        followerPositionId,filledQuantity:qty.toFixed(),automaticProductionCopying:false};
    },{timeout:60000,maxWait:10000});
  }
}
