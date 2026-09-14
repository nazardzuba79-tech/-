import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { assertOwner } from '../access';
import { OwnerSession, PrivateTradingError } from '../serviceTypes';
import { emptyDemoState, DemoState } from './engine';
import { NativeInstruction } from './replay';

export interface NativeAccount {
  revision:number; deposit:string; commands:NativeInstruction[]; snapshot:DemoState;
  createdAt:number; source:'DEMO_BALANCE'|'PREVIEW_FIXTURE';
}
const json=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
export const commandHash=(v:unknown):string=>createHash('sha256').update(JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x)).digest('hex');
export interface NativeRepository {
  read(actor:OwnerSession):Promise<NativeAccount|null>;
  available(actor:OwnerSession):Promise<string|null>;
  revision(actor:OwnerSession,revision:number):Promise<NativeAccount|null>;
  initialize(actor:OwnerSession,key:string):Promise<NativeAccount>;
  prior(actor:OwnerSession,key:string,hash:string):Promise<NativeAccount|null>;
  commit(actor:OwnerSession,expected:number,next:NativeAccount,key:string,hash:string):Promise<NativeAccount>;
}
/** Only DemoBalance + NativeDemo* writes exist here. Real wallets/orders are not dependencies. */
export class PrismaNativeRepository implements NativeRepository {
  constructor(private readonly db:PrismaClient){}
  async read(actor:OwnerSession){await assertOwner(this.db,actor);const row=await this.db.nativeDemoAccount.findUnique({where:{userId:actor.userId}});await assertOwner(this.db,actor);return row?row.payload as unknown as NativeAccount:null;}
  async available(actor:OwnerSession){await assertOwner(this.db,actor);const b=await this.db.demoBalance.findUnique({where:{userId_asset:{userId:actor.userId,asset:'USDT'}}});await assertOwner(this.db,actor);return b?b.available.toString():null;}
  async revision(actor:OwnerSession,revision:number){await assertOwner(this.db,actor);const row=await this.db.nativeDemoRevision.findUnique({where:{userId_revision:{userId:actor.userId,revision}}});await assertOwner(this.db,actor);return row?row.payload as unknown as NativeAccount:null;}
  async prior(actor:OwnerSession,key:string,hash:string){
    await assertOwner(this.db,actor);const row=await this.db.nativeDemoRevision.findUnique({where:{userId_requestKey:{userId:actor.userId,requestKey:key}}});
    if(!row)return null;if(row.requestHash!==hash)throw new PrivateTradingError('idempotency_conflict','Запрос с этим ключом уже содержит другие параметры',409);
    await assertOwner(this.db,actor);return row.payload as unknown as NativeAccount;
  }
  async initialize(actor:OwnerSession,key:string){
    await assertOwner(this.db,actor);
    return this.db.$transaction(async tx=>{
      // The same owner row serializes first-time initialization, including two tabs.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} FOR UPDATE`;
      await assertOwner(tx,actor);
      const existing=await tx.nativeDemoAccount.findUnique({where:{userId:actor.userId}});if(existing)return existing.payload as unknown as NativeAccount;
      const balance=await tx.demoBalance.findUnique({where:{userId_asset:{userId:actor.userId,asset:'USDT'}}});
      if(!balance||!balance.available.gt(0))throw new PrivateTradingError('no_demo_funds','Нет доступного демо-баланса USDT для перевода',409);
      const value=balance.available.toString(),taken=await tx.demoBalance.updateMany({where:{userId:actor.userId,asset:'USDT',available:{gte:value}},data:{available:{decrement:value}}});
      if(taken.count!==1)throw new PrivateTradingError('balance_changed','Демо-баланс изменился. Повторите запрос',409);
      const now=Date.now(),next:NativeAccount={revision:1,deposit:value,commands:[],snapshot:emptyDemoState(value,now),createdAt:now,source:'DEMO_BALANCE'};
      await tx.nativeDemoAccount.create({data:{userId:actor.userId,revision:1,payload:json(next)}});
      await tx.nativeDemoRevision.create({data:{userId:actor.userId,revision:1,requestKey:key,requestHash:commandHash({kind:'INITIALIZE'}),payload:json(next)}});
      await assertOwner(tx,actor);return next;
    },{timeout:10000});
  }
  async commit(actor:OwnerSession,expected:number,next:NativeAccount,key:string,hash:string){
    await assertOwner(this.db,actor);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "userId" FROM "NativeDemoAccount" WHERE "userId" = ${actor.userId} FOR UPDATE`;
      await assertOwner(tx,actor);
      const prior=await tx.nativeDemoRevision.findUnique({where:{userId_requestKey:{userId:actor.userId,requestKey:key}}});
      if(prior){if(prior.requestHash!==hash)throw new PrivateTradingError('idempotency_conflict','Параметры запроса изменились',409);return prior.payload as unknown as NativeAccount;}
      const changed=await tx.nativeDemoAccount.updateMany({where:{userId:actor.userId,revision:expected},data:{revision:expected+1,payload:json({...next,revision:expected+1})}});
      if(changed.count!==1)throw new PrivateTradingError('account_changed','Счёт изменился в другой вкладке. Обновите расчёт',409);
      const result={...next,revision:expected+1};
      await tx.nativeDemoRevision.create({data:{userId:actor.userId,revision:result.revision,requestKey:key,requestHash:hash,payload:json(result)}});
      await assertOwner(tx,actor);return result;
    },{timeout:10000});
  }
}
