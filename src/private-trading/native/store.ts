import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { privateTradingConfig, PrivateTradingConfig } from '../access';
import { assertNativeTrader } from './testAccess';
import { OwnerSession, PrivateTradingError } from '../serviceTypes';
import { emptyDemoState, DemoInstrument, DemoState, migrateDemoState } from './engine';
import { NativeCheckpoint, NativeInstruction } from './replay';
import { CollateralHolding } from './collateral';

export interface NativeAccount {
  revision:number; deposit:string; commands:NativeInstruction[]; snapshot:DemoState;
  createdAt:number; source:'DEMO_BALANCE'|'PREVIEW_FIXTURE';
  /** Non-settle wallet assets the owner chose NOT to use as Cross collateral. */
  disabledCollateralAssets?:string[];
  /** Canonical replay state (live row only). Revisions keep the projected snapshot for cards/idempotency. */
  checkpoint?:NativeCheckpoint;
}
/** Immutable revision evidence: everything except the re-derivable canonical checkpoint. */
export const revisionPayload=(account:NativeAccount):NativeAccount=>{const{checkpoint:_checkpoint,...rest}=account;return rest;};
/**
 * THE STORED SHAPE: one instrument per (contract, parameters), referenced by key.
 *
 * Every OPEN instruction carries the instrument it was placed under (rules
 * and a risk-tier ladder — a few KB), and a journal of hundreds of opens
 * repeated the same few instruments hundreds of times in EVERY account
 * payload and EVERY immutable revision. The engine still receives the full
 * instruction: `inflate` restores it on read, so nothing downstream knows.
 */
export interface StoredNativeAccount extends Omit<NativeAccount,'commands'>{commands:unknown[];instrumentTable?:Record<string,DemoInstrument>}
const instrumentKey=(i:DemoInstrument)=>`${i.rules.symbol}#${createHash('sha256').update(JSON.stringify(i)).digest('hex').slice(0,16)}`;
export function compact(account:NativeAccount):StoredNativeAccount{
  const table:Record<string,DemoInstrument>={};
  const commands=account.commands.map(c=>{
    if(c.kind!=='OPEN')return c;
    const key=instrumentKey(c.instrument);table[key]??=c.instrument;
    const{instrument:_instrument,...rest}=c;return{...rest,instrumentRef:key};
  });
  return{...account,commands,...(Object.keys(table).length?{instrumentTable:table}:{})};
}
export function inflate(stored:StoredNativeAccount|NativeAccount):NativeAccount{
  const table=(stored as StoredNativeAccount).instrumentTable;
  if(!table)return stored as NativeAccount;
  const{instrumentTable:_table,...rest}=stored as StoredNativeAccount;
  const commands=(stored.commands as Array<Record<string,unknown>>).map(c=>{
    if(c.kind!=='OPEN'||typeof c.instrumentRef!=='string')return c as unknown as NativeInstruction;
    const instrument=table[c.instrumentRef];if(!instrument)throw new PrivateTradingError('journal_corrupt','Журнал счёта повреждён',500);
    const{instrumentRef:_ref,...restOfCommand}=c;return{...restOfCommand,instrument} as unknown as NativeInstruction;
  });
  return{...rest,commands} as NativeAccount;
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
  commit(actor:OwnerSession,expected:number,next:NativeAccount,key:string,hash:string):Promise<NativeAccount>;
}
/** Only DemoBalance + NativeDemo* writes exist here. Real wallets/orders are not dependencies. */
export class PrismaNativeRepository implements NativeRepository {
  constructor(private readonly db:PrismaClient,private readonly config:()=>PrivateTradingConfig=privateTradingConfig){}
  private owner(db:PrismaClient|Prisma.TransactionClient,actor:OwnerSession){return assertNativeTrader(db,actor,this.config);}
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
      await this.owner(tx,actor);return next;
    },{timeout:10000});
  }
  async commit(actor:OwnerSession,expected:number,next:NativeAccount,key:string,hash:string){
    await this.owner(this.db,actor);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "userId" FROM "NativeDemoAccount" WHERE "userId" = ${actor.userId} FOR UPDATE`;
      await this.owner(tx,actor);
      const prior=await tx.nativeDemoRevision.findUnique({where:{userId_requestKey:{userId:actor.userId,requestKey:key}}});
      if(prior){if(prior.requestHash!==hash)throw new PrivateTradingError('idempotency_conflict','Параметры запроса изменились',409);return forward(prior.payload as unknown as NativeAccount);}
      const changed=await tx.nativeDemoAccount.updateMany({where:{userId:actor.userId,revision:expected},data:{revision:expected+1,payload:json({...next,revision:expected+1})}});
      if(changed.count!==1)throw new PrivateTradingError('account_changed','Счёт изменился в другой вкладке. Обновите расчёт',409);
      const result={...next,revision:expected+1};
      await tx.nativeDemoRevision.create({data:{userId:actor.userId,revision:result.revision,requestKey:key,requestHash:hash,payload:json(revisionPayload(result))}});
      await this.owner(tx,actor);return result;
    },{timeout:10000});
  }
}
