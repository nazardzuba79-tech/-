import { commandRead, commandScope } from './commandScope';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { privateTradingConfig, PrivateTradingConfig } from '../access';
import { assertNativeTrader } from './testAccess';
import { OwnerSession, PrivateTradingError } from '../serviceTypes';
import { emptyDemoState, DemoInstrument, DemoState, migrateDemoState } from './engine';
import { NativeCheckpoint, NativeInstruction } from './replay';
import { CollateralHolding } from './collateral';
import { deriveNativeLiveProjection, projectionDigest, verifiedProjection, type NativeLiveProjection } from './liveProjection';
import { nativeHistoryPage, type HistoryQuery } from './historyPage';

export interface NativeAccount {
  executionMode?:'LIVE_EXECUTION'|'HISTORICAL_DEMO';
  revision:number; deposit:string; commands:NativeInstruction[]; snapshot:DemoState;
  createdAt:number; source:'DEMO_BALANCE'|'PREVIEW_FIXTURE';
  /** Non-settle wallet assets the owner chose NOT to use as Cross collateral. */
  disabledCollateralAssets?:string[];
  /** Canonical replay state (live row only). Revisions keep the projected snapshot for cards/idempotency. */
  checkpoint?:NativeCheckpoint;
  /** Private scheduler admission, never sent in the terminal response or card revision. */
  executionSession?:OwnerSession;
  executionPending?:boolean;
}
/** Immutable revision evidence: everything except the re-derivable canonical checkpoint. */
export const revisionPayload=(account:NativeAccount):NativeAccount=>{const{checkpoint:_checkpoint,executionSession:_session,executionPending:_pending,...rest}=account;return rest;};
/**
 * THE STORED SHAPE: one instrument per (contract, parameters), referenced by key.
 *
 * Every OPEN instruction carries the instrument it was placed under (rules
 * and a risk-tier ladder — a few KB), and a journal of hundreds of opens
 * repeated the same few instruments hundreds of times in EVERY account
 * payload and EVERY immutable revision. The engine still receives the full
 * instruction: `inflate` restores it on read, so nothing downstream knows.
 */
export interface StoredNativeAccount extends Omit<NativeAccount,'commands'|'checkpoint'>{commands:unknown[];instrumentTable?:Record<string,DemoInstrument>;
  checkpoint?:Omit<NativeCheckpoint,'state'>&{state?:DemoState};checkpointSnapshot?:true}
const instrumentKey=(i:DemoInstrument)=>`${i.rules.symbol}#${createHash('sha256').update(JSON.stringify(i)).digest('hex').slice(0,16)}`;
export function compact(account:NativeAccount):StoredNativeAccount{
  const table:Record<string,DemoInstrument>={};
  const commands=account.commands.map(c=>{
    if(c.kind!=='OPEN')return c;
    const key=instrumentKey(c.instrument);table[key]??=c.instrument;
    const{instrument:_instrument,...rest}=c;return{...rest,instrumentRef:key};
  });
  const same=account.checkpoint&&JSON.stringify(account.checkpoint.state)===JSON.stringify(account.snapshot);
  const checkpoint=account.checkpoint&&same?{time:account.checkpoint.time,digest:account.checkpoint.digest,commandCount:account.checkpoint.commandCount}:account.checkpoint;
  return{...account,commands,checkpoint,...(same?{checkpointSnapshot:true as const}:{}),...(Object.keys(table).length?{instrumentTable:table}:{})};
}
export function inflate(stored:StoredNativeAccount|NativeAccount):NativeAccount{
  const table=(stored as StoredNativeAccount).instrumentTable;
  if(!table&&!(stored as StoredNativeAccount).checkpointSnapshot)return stored as NativeAccount;
  const{instrumentTable:_table,checkpointSnapshot,...rest}=stored as StoredNativeAccount;
  const checkpoint=checkpointSnapshot&&rest.checkpoint?{...rest.checkpoint,state:structuredClone(stored.snapshot)}:rest.checkpoint;
  const commands=(stored.commands as Array<Record<string,unknown>>).map(c=>{
    if(c.kind!=='OPEN'||typeof c.instrumentRef!=='string')return c as unknown as NativeInstruction;
    const instrument=table?.[c.instrumentRef];if(!instrument)throw new PrivateTradingError('journal_corrupt','Журнал счёта повреждён',500);
    const{instrumentRef:_ref,...restOfCommand}=c;return{...restOfCommand,instrument} as unknown as NativeInstruction;
  });
  if(checkpoint&&!checkpoint.state)throw new PrivateTradingError('journal_corrupt','Журнал счёта повреждён',500);
  return{...rest,commands,checkpoint} as NativeAccount;
}
const json=(v:NativeAccount):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(compact(v)));
/**
 * EVERY stored account comes back through here.
 *
 * A row written before margin mode existed carries a version-1 snapshot,
 * and so does the canonical checkpoint inside it. Both are read forward in
 * one place, so nothing downstream — the engine, the replay, the account
 * model — has to know that two shapes were ever on disk.
 */
const forward=(stored:NativeAccount):NativeAccount=>{
  const account=inflate(stored);
  return{
    ...account,
    disabledCollateralAssets:[...new Set((Array.isArray(account.disabledCollateralAssets)?account.disabledCollateralAssets:[])
      .filter((asset):asset is string=>typeof asset==='string'&&/^[A-Z0-9]{2,16}$/.test(asset)&&asset!=='USDT'))].sort(),
    snapshot:migrateDemoState(account.snapshot),
    ...(account.checkpoint?{checkpoint:{...account.checkpoint,state:migrateDemoState(account.checkpoint.state)}}:{}),
  };
};
export const commandHash=(v:unknown):string=>createHash('sha256').update(JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x)).digest('hex');
export interface NativeRepository {
  live?(actor:OwnerSession):Promise<NativeLiveProjection|null>;
  history?(actor:OwnerSession,query:HistoryQuery):ReturnType<typeof nativeHistoryPage>;
  activate?(actor:OwnerSession):Promise<void>;
  /** One authorization envelope for the three command reads; commit still rechecks access and CAS. */
  commandContext?(actor:OwnerSession,key:string,hash:string):Promise<{prior:NativeAccount|null;row:NativeAccount|null;holdings:CollateralHolding[]}>;
  read(actor:OwnerSession):Promise<NativeAccount|null>;
  available(actor:OwnerSession):Promise<string|null>;
  /**
   * EVERY asset the owner holds, not the settle row alone — Cross margin is
   * backed by the whole wallet, so the whole wallet has to be readable.
   */
  holdings(actor:OwnerSession):Promise<CollateralHolding[]>;
  revision(actor:OwnerSession,revision:number):Promise<NativeAccount|null>;
  initialize(actor:OwnerSession,key:string):Promise<NativeAccount>;
  prior(actor:OwnerSession,key:string,hash:string):Promise<NativeAccount|null>;
  commit(actor:OwnerSession,expected:number,next:NativeAccount,key:string,hash:string,beforeWrite?:()=>void):Promise<NativeAccount>;
}
/** Only DemoBalance + NativeDemo* writes exist here. Real wallets/orders are not dependencies. */
export class PrismaNativeRepository implements NativeRepository {
  // Executor-only cache; every use rechecks DB revision and authorization.
  // A clone protects the cached authoritative transcript from replay mutation.
  private readonly executionCache=new Map<string,NativeAccount>();
  constructor(private readonly db:PrismaClient,private readonly config:()=>PrivateTradingConfig=privateTradingConfig,private readonly cacheExecution=false){}
  private remember(userId:string,row:NativeAccount){
    if(!this.cacheExecution)return;
    this.executionCache.delete(userId);
    if(Buffer.byteLength(JSON.stringify(row))>8*1024*1024)return;
    if(this.executionCache.size>=4)this.executionCache.delete(this.executionCache.keys().next().value!);
    this.executionCache.set(userId,structuredClone(row));
  }
  private async commandRow(userId:string){
    if(this.cacheExecution){
      const head=await this.db.nativeDemoAccount.findUnique({where:{userId},select:{revision:true}});
      const cached=this.executionCache.get(userId);
      if(head&&cached?.revision===head.revision)return structuredClone(cached);
      if(!head){this.executionCache.delete(userId);return null;}
    }
    const row=await this.db.nativeDemoAccount.findUnique({where:{userId}});
    if(!row)return null;
    const account=forward(row.payload as unknown as NativeAccount);this.remember(userId,account);return account;
  }
  private owner(db:PrismaClient|Prisma.TransactionClient,actor:OwnerSession){return assertNativeTrader(db,actor,this.config);}
  async activate(actor:OwnerSession){
    if(!await this.live(actor))return;
    await this.db.$transaction(async tx=>{
      await this.owner(tx,actor);
      await tx.nativeDemoLiveProjection.updateMany({where:{userId:actor.userId},data:{executionSession:JSON.parse(JSON.stringify(actor))}});
      await this.owner(tx,actor);
    });
  }
  async history(actor:OwnerSession,query:HistoryQuery){
    await this.owner(this.db,actor);
    const result=await nativeHistoryPage(this.db,actor.userId,query);
    await this.owner(this.db,actor);return result;
  }
  private projectionData(account:NativeAccount){
    const projection=deriveNativeLiveProjection(account);
    return {revision:account.revision,payload:JSON.parse(JSON.stringify(projection)) as Prisma.InputJsonValue,digest:projectionDigest(projection)};
  }
  private async writeProjection(tx:Prisma.TransactionClient,actor:OwnerSession,account:NativeAccount,data=this.projectionData(account)){
    await tx.nativeDemoLiveProjection.upsert({where:{userId:actor.userId},create:{userId:actor.userId,...data},update:data,select:{userId:true}});
  }
  async live(actor:OwnerSession):Promise<NativeLiveProjection|null>{
    await this.owner(this.db,actor);
    // One MVCC statement observes the authoritative revision and its derived
    // row together. Never select a.payload or immutable revision payloads.
    const rows=await this.db.$queryRaw<{revision:number;projectionRevision:number|null;payload:unknown;digest:string|null}[]>`
      SELECT a."revision", p."revision" AS "projectionRevision", p."payload", p."digest"
      FROM "NativeDemoAccount" a LEFT JOIN "NativeDemoLiveProjection" p ON p."userId"=a."userId"
      WHERE a."userId"=${actor.userId}`;
    await this.owner(this.db,actor);
    if(!rows.length)return null;
    const ready=rows[0].projectionRevision===rows[0].revision&&verifiedProjection(rows[0].payload,rows[0].digest,rows[0].revision);
    if(ready)return ready;
    // Exceptional recovery only. Lock the same row as command commit, so a
    // rebuild cannot overwrite a concurrently committed newer projection.
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "userId" FROM "NativeDemoAccount" WHERE "userId"=${actor.userId} FOR UPDATE`;
      await this.owner(tx,actor);
      const row=await tx.nativeDemoAccount.findUnique({where:{userId:actor.userId}});
      if(!row)return null;
      const account=forward(row.payload as unknown as NativeAccount);
      if(account.revision!==row.revision)throw new PrivateTradingError('journal_corrupt','Счёт временно недоступен',503);
      const existing=await tx.nativeDemoLiveProjection.findUnique({where:{userId:actor.userId}});
      const concurrent=existing&&existing.revision===row.revision&&verifiedProjection(existing.payload,existing.digest,row.revision);
      if(concurrent){await this.owner(tx,actor);return concurrent;}
      await this.writeProjection(tx,actor,account);
      await this.owner(tx,actor);
      return deriveNativeLiveProjection(account);
    },{timeout:10000});
  }
  async commandContext(actor:OwnerSession,key:string,hash:string){
    await this.owner(this.db,actor);
    const [prior,row,holdings]=await Promise.all([
      this.db.nativeDemoRevision.findUnique({where:{userId_requestKey:{userId:actor.userId,requestKey:key}}}),
      this.commandRow(actor.userId),
      this.db.demoBalance.findMany({where:{userId:actor.userId},orderBy:{asset:'asc'}}),
    ]);
    await this.owner(this.db,actor);
    if(prior&&prior.requestHash!==hash)throw new PrivateTradingError('idempotency_conflict','Запрос с этим ключом уже содержит другие параметры',409);
    return{prior:prior?forward(prior.payload as unknown as NativeAccount):null,row,
      holdings:holdings.map(r=>({asset:r.asset,available:r.available.toString(),locked:r.locked.toString()}))};
  }
  async read(actor:OwnerSession){await this.owner(this.db,actor);const row=await this.db.nativeDemoAccount.findUnique({where:{userId:actor.userId}});await this.owner(this.db,actor);return row?forward(row.payload as unknown as NativeAccount):null;}
  async available(actor:OwnerSession){await this.owner(this.db,actor);const b=await this.db.demoBalance.findUnique({where:{userId_asset:{userId:actor.userId,asset:'USDT'}}});await this.owner(this.db,actor);return b?b.available.toString():null;}
  async holdings(actor:OwnerSession){
    await this.owner(this.db,actor);
    const rows=await this.db.demoBalance.findMany({where:{userId:actor.userId},orderBy:{asset:'asc'}});
    await this.owner(this.db,actor);
    // Both columns travel: locked quantity still backs this account and
    // leaving it out would understate the collateral.
    return rows.map(r=>({asset:r.asset,available:r.available.toString(),locked:r.locked.toString()}));
  }
  async revision(actor:OwnerSession,revision:number){await this.owner(this.db,actor);const row=await this.db.nativeDemoRevision.findUnique({where:{userId_revision:{userId:actor.userId,revision}}});await this.owner(this.db,actor);return row?forward(row.payload as unknown as NativeAccount):null;}
  async prior(actor:OwnerSession,key:string,hash:string){
    await this.owner(this.db,actor);const row=await this.db.nativeDemoRevision.findUnique({where:{userId_requestKey:{userId:actor.userId,requestKey:key}}});
    if(!row)return null;if(row.requestHash!==hash)throw new PrivateTradingError('idempotency_conflict','Запрос с этим ключом уже содержит другие параметры',409);
    await this.owner(this.db,actor);return forward(row.payload as unknown as NativeAccount);
  }
  async initialize(actor:OwnerSession,key:string){
    await this.owner(this.db,actor);
    return this.db.$transaction(async tx=>{
      // The same owner row serializes first-time initialization, including two tabs.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} FOR UPDATE`;
      await this.owner(tx,actor);
      const existing=await tx.nativeDemoAccount.findUnique({where:{userId:actor.userId}});if(existing)return forward(existing.payload as unknown as NativeAccount);
      const balance=await tx.demoBalance.findUnique({where:{userId_asset:{userId:actor.userId,asset:'USDT'}}});
      if(!balance||!balance.available.gt(0))throw new PrivateTradingError('no_demo_funds','Нет доступного демо-баланса USDT для перевода',409);
      const value=balance.available.toString(),taken=await tx.demoBalance.updateMany({where:{userId:actor.userId,asset:'USDT',available:{gte:value}},data:{available:{decrement:value}}});
      if(taken.count!==1)throw new PrivateTradingError('balance_changed','Демо-баланс изменился. Повторите запрос',409);
      const now=Date.now(),next:NativeAccount={revision:1,deposit:value,commands:[],snapshot:emptyDemoState(value,now),createdAt:now,source:'DEMO_BALANCE',disabledCollateralAssets:[]};
      await tx.nativeDemoAccount.create({data:{userId:actor.userId,revision:1,payload:json(next)}});
      await tx.nativeDemoRevision.create({data:{userId:actor.userId,revision:1,requestKey:key,requestHash:commandHash({kind:'INITIALIZE'}),payload:json(revisionPayload(next))}});
      await this.writeProjection(tx,actor,next);
      await this.owner(tx,actor);return next;
    },{timeout:10000});
  }
  async commit(actor:OwnerSession,expected:number,next:NativeAccount,key:string,hash:string,beforeWrite?:()=>void){
    // Prepare immutable JSON before taking the account lock. Never download
    // the entire revision we just inserted: the caller already owns it.
    const result={...next,revision:expected+1};
    const accountPayload=json(result),receiptPayload=json(revisionPayload(result));
    const projectionData=this.projectionData(result);
    const trace=commandScope();
    const timed=async<T>(stage:string,run:()=>Promise<T>):Promise<T>=>{
      const started=Date.now();trace?.trace(stage);
      try{return await run();}finally{trace?.trace(stage+'.end',{durationMs:Date.now()-started});}
    };
    await commandRead('repository.commit_authorization',()=>this.owner(this.db,actor));
    beforeWrite?.();
    return this.db.$transaction(async tx=>{
      trace?.trace('transaction.enter');
      await timed('transaction.lock',()=>tx.$queryRaw`SELECT "userId" FROM "NativeDemoAccount" WHERE "userId" = ${actor.userId} FOR UPDATE`);
      await timed('transaction.authorization',()=>this.owner(tx,actor));
      const prior=await timed('transaction.receipt',()=>tx.nativeDemoRevision.findUnique({where:{userId_requestKey:{userId:actor.userId,requestKey:key}}}));
      if(prior){if(prior.requestHash!==hash)throw new PrivateTradingError('idempotency_conflict','Параметры запроса изменились',409);return forward(prior.payload as unknown as NativeAccount);}
      beforeWrite?.();
      const changed=await timed('transaction.account_write',()=>tx.nativeDemoAccount.updateMany({where:{userId:actor.userId,revision:expected},data:{revision:expected+1,payload:accountPayload}}));
      if(changed.count!==1)throw new PrivateTradingError('account_changed','Счёт изменился в другой вкладке. Обновите расчёт',409);
      await timed('transaction.receipt_write',()=>tx.nativeDemoRevision.create({data:{userId:actor.userId,revision:result.revision,requestKey:key,requestHash:hash,payload:receiptPayload},select:{revision:true}}));
      await timed('transaction.projection_write',()=>this.writeProjection(tx,actor,result,projectionData));
      await timed('transaction.final_authorization',()=>this.owner(tx,actor));beforeWrite?.();return result;
    },{timeout:10000,maxWait:2000});
  }
}
