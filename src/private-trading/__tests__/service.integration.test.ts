/** Explicitly opted-in, real transactions on the dedicated private-replay TEST DB. */
import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { randomUUID } from 'crypto';
import { PrivateTradingService } from '../service';
import { AccountTx, PrivateTradingStore } from '../store';
import { OwnerSession, TradeRequest } from '../serviceTypes';
import { PrivateFreshQuote, PrivateHistoricalData, PrivateInstrument, PrivateTradingMarketData } from '../marketData';
import { applyPrivateFunding } from '../liveEngine';

const enabled = process.env.PRIVATE_TRADING_DB_TESTS === '1';
if (enabled) {
  require('dotenv').config();
  const hostname = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost','127.0.0.1'].includes(hostname) && !/^ep-damp-sky-axh52ggd(?:-pooler)?\.c-4\.us-east-2\.aws\.neon\.tech$/.test(hostname)) {
    throw new Error('PRIVATE_TRADING_DB_TESTS requires the dedicated approved TEST database; refusing other hosts');
  }
}
const dbDescribe = enabled ? describe : describe.skip;
const instrument = ():PrivateInstrument => ({provider:'bybit',symbol:'XYZUSDT',baseAsset:'XYZ',quoteAsset:'USDT',settleAsset:'USDT',contractType:'LinearPerpetual',status:'Trading',launchTime:1_600_000_000_000,fetchedAt:Date.now(),fundingIntervalMinutes:480,filters:{tickSize:'0.01',minPrice:'0.01',maxPrice:'1000000',qtyStep:'0.1',minOrderQty:'0.1',maxOrderQty:'10000',maxMarketOrderQty:'1000',minNotionalValue:'1'},leverage:{min:'1',max:'50',step:'0.1'},riskTiers:[{riskLimitValue:'1000000000',maintenanceMarginRate:'0.005',initialMarginRate:'0.02',maintenanceDeduction:'0',maxLeverage:'50'}],parameterModel:'CURRENT_INSTRUMENT_PARAMETERS',parameterVersion:'TEST_FIXTURE_V1'});
class FixtureMarket {
  bid='99';ask='100';quantity='100';historyIncomplete=false;
  instrument=jest.fn(async()=>instrument());
  freshQuote=jest.fn(async():Promise<PrivateFreshQuote>=>{const t=Date.now();return {provider:'bybit',symbol:'XYZUSDT',bids:[{price:this.bid,quantity:this.quantity}],asks:[{price:this.ask,quantity:this.quantity}],markPrice:this.ask,lastPrice:this.ask,fundingRate:'0',nextFundingTime:Math.ceil((t+1)/28_800_000)*28_800_000,providerTimestamp:t,bookGeneratedAt:t,markProviderTimestamp:t,fetchedAt:t};});
  funding=jest.fn(async()=>({events:[],complete:true,issues:[]}));
  history=jest.fn(async(request:any):Promise<PrivateHistoricalData>=>{
    const intervalMs=request.intervalMinutes*60_000;
    const candles=[];for(let t=request.startTime;t<request.endTime;t+=intervalMs){const price=t<request.startTime+2*intervalMs?'100':'120';candles.push({timestamp:t,open:price,high:price,low:price,close:price});}
    // A complete fixture must include settlement boundaries even when the
    // requested tail crosses 08:00/16:00 UTC. Zero is this fixture's actual
    // configured rate; omitting the event correctly makes advance incomplete.
    const fundingInterval=instrument().fundingIntervalMinutes*60_000;
    const fundingEvents=[];
    for(let t=Math.ceil(request.startTime/fundingInterval)*fundingInterval;t<request.endTime;t+=fundingInterval){
      fundingEvents.push({timestamp:t,rate:'0',markPrice:candles.find(c=>c.timestamp===t)?.close??'100'});
    }
    return {symbol:'XYZUSDT',tradeCandles:candles,markCandles: [...candles],fundingEvents,expectedFundingTimestamps:fundingEvents.map(event=>event.timestamp),intervalMs,complete:!this.historyIncomplete,issues:this.historyIncomplete?['FIXTURE_MISSING_FUNDING']:[],fetchedAt:Date.now(),fundingScheduleModel:'CURRENT_INTERVAL_GRID_V1',instrument:instrument()};
  });
}

describe('complete historical fixture funding',()=>{
  test.each(['2026-09-23T08:00:00Z','2026-09-23T16:00:00Z'])('includes the %s settlement in an advance tail',async(boundaryIso)=>{
    const boundary=Date.parse(boundaryIso);
    const data=await new FixtureMarket().history({startTime:boundary-60_000,endTime:boundary+60_000,intervalMinutes:1});
    expect(data.complete).toBe(true);
    expect(data.expectedFundingTimestamps).toEqual([boundary]);
    expect(data.fundingEvents).toEqual([{timestamp:boundary,rate:'0',markPrice:'100'}]);
    const before=await new FixtureMarket().history({startTime:boundary-60_000,endTime:boundary,intervalMinutes:1});
    expect(before.fundingEvents).toEqual([]);
  });
});
class CommitExpiryStore extends PrivateTradingStore {
  expireAtCommit=false;
  afterFirstFinalCheck:(()=>void)|undefined;
  override transact<T>(actor:OwnerSession,key:string|null,input:unknown,run:(tx:AccountTx)=>Promise<T>,finalCheck?:()=>void):Promise<T>{
    return super.transact(actor,key,input,run,()=>{
      if(!this.expireAtCommit){finalCheck?.();const hook=this.afterFirstFinalCheck;this.afterFirstFinalCheck=undefined;hook?.();return;}
      const now=Date.now();const spy=jest.spyOn(Date,'now').mockReturnValue(now+10_000);
      try{finalCheck?.();}finally{spy.mockRestore();}
    });
  }
}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const serialized=(value:unknown)=>JSON.parse(JSON.stringify(value));
dbDescribe('private trading real TEST PostgreSQL transactions',()=>{
  let db:PrismaClient;
  const services:PrivateTradingService[]=[];
  beforeAll(async()=>{db=new PrismaClient();await db.$connect();},20000);
  beforeEach(()=>{process.stdout.write(`TEST DB: ${expect.getState().currentTestName}\n`);});
  afterAll(async()=>{for(const service of services)service.stop();await db?.$disconnect();});
  async function fixture() {
    const tag=randomUUID().replace(/-/g,'');
    const user=await db.user.create({data:{email:`qa-private-${tag}@example.test`,passwordHash:'TEST_FIXTURE_NO_LOGIN',referralCode:`pt${tag}`,role:'ADMIN'}});
    const session=await db.session.create({data:{userId:user.id,userAgent:'PRIVATE_TRADING_DB_TESTS_ONLY'}});
    await db.demoBalance.create({data:{userId:user.id,asset:'USDT',available:'10000'}});
    const actor:OwnerSession={userId:user.id,sessionId:session.id,expiresAt:Date.now()+3600000};
    const config={enabled:true,ownerId:user.id};const store=new CommitExpiryStore(db,()=>config);const market=new FixtureMarket();const service=new PrivateTradingService(store,market as unknown as PrivateTradingMarketData);services.push(service);
    return {actor,store,service,market,config};
  }
  const request=(extra:Partial<TradeRequest>={}):TradeRequest=>({mode:'DEMO_LIVE',symbol:'XYZUSDT',side:'LONG',type:'MARKET',leverage:'10',quantity:'10',idempotencyKey:randomUUID(),...extra});
  async function waitReady(service:PrivateTradingService,actor:OwnerSession,id:string){
    for(let attempt=0;attempt<80;attempt++){const preview=await service.getPreview(actor,id);if(preview.status!=='RUNNING')return preview;await delay(50);}
    throw new Error('Historical fixture preview exceeded bounded 4-second polling');
  }
  async function open(f:Awaited<ReturnType<typeof fixture>>,extra:Partial<TradeRequest>={}) {
    const preview=await f.service.preview(f.actor,request(extra));expect(preview.status).toBe('READY');
    await f.service.confirm(f.actor,preview.id,randomUUID());return (await f.service.state(f.actor)).positions[0];
  }
  async function privateSnapshot(userId:string){return serialized({account:await db.privateTradingAccount.findUnique({where:{userId}}),ledger:await db.privateTradingLedger.findMany({where:{userId},orderBy:{createdAt:'asc'}}),commands:await db.privateTradingCommand.findMany({where:{userId},orderBy:{createdAt:'asc'}})});}
  test('deposit allocation -> order -> partial/full close -> PnL -> private history -> immutable card persists across restart',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');const p=await open(f);
    process.stdout.write('TEST DB lifecycle: allocation and opening confirmed\n');
    expect(p.quantity).toBe('10');expect((await f.service.state(f.actor)).orders).toHaveLength(0);
    f.market.bid='110';f.market.ask='111';await f.service.close(f.actor,p.id,'4','half');
    let state=await f.service.state(f.actor);expect(state.positions[0].quantity).toBe('6');expect(state.positions[0].realizedGross).toBe('40.000000000000000000');
    f.market.bid='120';f.market.ask='121';await f.service.close(f.actor,p.id,undefined,'rest');
    process.stdout.write('TEST DB lifecycle: partial and full closes confirmed\n');
    state=await f.service.state(f.actor);expect(state.positions).toHaveLength(0);expect(state.history).toHaveLength(1);expect(state.copyHistory).toHaveLength(1);
    const expected=new BigNumber(160).minus('0.55').minus(new BigNumber(4).times(110).times('0.00055')).minus(new BigNumber(6).times(120).times('0.00055'));
    expect(new BigNumber(state.history[0].netPnl).eq(expected)).toBe(true);expect(new BigNumber(state.wallet.realizedPnl).eq(expected)).toBe(true);
    const card=await f.service.card(f.actor,p.id);expect(card.label).toBe('Симуляция');expect(card.usdPnl).toBeNull();
    process.stdout.write('TEST DB lifecycle: immutable PnL card persisted\n');
    const restarted=new PrivateTradingService(new PrivateTradingStore(db,()=>f.config),f.market as unknown as PrivateTradingMarketData);services.push(restarted);
    expect(await restarted.getCard(f.actor,card.id)).toEqual(serialized(card));expect((await restarted.state(f.actor)).history).toEqual(state.history);
    expect(await db.order.count({where:{userId:f.actor.userId}})).toBe(0);expect(await db.futuresOrder.count({where:{userId:f.actor.userId}})).toBe(0);expect(await db.futuresPosition.count({where:{userId:f.actor.userId}})).toBe(0);
  },45000);
  test('repeated commands are idempotent and changed parameters do not spend twice',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');await f.store.allocate(f.actor,'1000','capital');
    await expect(f.store.allocate(f.actor,'2000','capital')).rejects.toMatchObject({code:'idempotency_conflict'});
    expect((await db.demoBalance.findUniqueOrThrow({where:{userId_asset:{userId:f.actor.userId,asset:'USDT'}}})).available.toString()).toBe('9000');
    const preview=await f.service.preview(f.actor,request());const confirmed=await f.service.confirm(f.actor,preview.id,'same');expect(await f.service.confirm(f.actor,preview.id,'same')).toEqual(serialized(confirmed));
    expect((await f.service.state(f.actor)).positions).toHaveLength(1);expect(await db.privateTradingLedger.count({where:{userId:f.actor.userId,kind:'OPEN_FEE'}})).toBe(1);
  },30000);
  test('insufficient balance leaves preview, ledger and orders unchanged',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1','capital');const preview=await f.service.preview(f.actor,request());const before=await privateSnapshot(f.actor.userId);
    await expect(f.service.confirm(f.actor,preview.id,'overdraw')).rejects.toMatchObject({code:'insufficient_margin'});
    expect(await privateSnapshot(f.actor.userId)).toEqual(before);expect((await db.privateTradingPreview.findUniqueOrThrow({where:{id:preview.id}})).status).toBe('READY');
  },30000);
  test('quote expiration AFTER fill/journal work rolls back the whole financial transaction',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');const preview=await f.service.preview(f.actor,request());const before=await privateSnapshot(f.actor.userId);f.store.expireAtCommit=true;
    await expect(f.service.confirm(f.actor,preview.id,'expires-inside')).rejects.toThrow('quote_stale');f.store.expireAtCommit=false;
    expect(await privateSnapshot(f.actor.userId)).toEqual(before);expect((await db.privateTradingPreview.findUniqueOrThrow({where:{id:preview.id}})).status).toBe('READY');
  },30000);
  test('concurrent full closes serialize; only one closes and credits PnL',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');const p=await open(f);f.market.bid='110';f.market.ask='111';
    const results=await Promise.allSettled([f.service.close(f.actor,p.id,undefined,'close-a'),f.service.close(f.actor,p.id,undefined,'close-b')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    expect(await db.privateTradingLedger.count({where:{userId:f.actor.userId,kind:'REALIZED_PNL'}})).toBe(1);expect((await f.service.state(f.actor)).history).toHaveLength(1);
  },30000);
  test('concurrent remaining entry fill and full close never reopen the private position',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');f.market.quantity='3';const p=await open(f,{type:'LIMIT',limitPrice:'100'});
    expect(p.quantity).toBe('3');expect((await f.service.state(f.actor)).orders[0].remainingQuantity).toBe('7');
    f.market.quantity='100';
    const results=await Promise.allSettled([f.service.tick(),f.service.close(f.actor,p.id,undefined,'concurrent-close')]);
    // A newer book may win the row lock. Retrying an explicitly rejected stale/out-of-order close is safe.
    if(results[1].status==='rejected'){
      expect(String(results[1].reason)).toMatch(/quote_stale|Котировка обновляется/);
      await f.service.close(f.actor,p.id,undefined,'concurrent-close-retry');
    }
    await f.service.tick();const state=await f.service.state(f.actor);expect(state.positions).toHaveLength(0);expect(state.orders).toHaveLength(0);expect(state.history).toHaveLength(1);
    expect(state.history[0].status).toBe('CLOSED');expect(new BigNumber(state.wallet.reserved).isZero()).toBe(true);
    expect(await db.privateTradingLedger.count({where:{userId:f.actor.userId,kind:'REALIZED_PNL'}})).toBe(1);
  },40000);
  test('owner revocation after precommit check rolls back account, ledger and confirmation writes',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');const preview=await f.service.preview(f.actor,request());const before=await privateSnapshot(f.actor.userId);
    // Trigger after the first final owner check, immediately before account/command persistence.
    f.store.afterFirstFinalCheck=()=>{f.config.enabled=false;};
    await expect(f.service.confirm(f.actor,preview.id,'revoked-at-commit')).rejects.toMatchObject({code:'private_access_denied'});f.config.enabled=true;
    expect(await privateSnapshot(f.actor.userId)).toEqual(before);expect((await db.privateTradingPreview.findUniqueOrThrow({where:{id:preview.id}})).status).toBe('READY');
  },30000);
  test('historical capital/result remain outside live PnL and production wallets',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');
    await db.balance.create({data:{userId:f.actor.userId,asset:'USDT',available:'7',locked:'2'}});await db.futuresBalance.create({data:{userId:f.actor.userId,asset:'USDT',available:'9',locked:'3'}});
    const before={spot:serialized(await db.balance.findMany({where:{userId:f.actor.userId}})),futures:serialized(await db.futuresBalance.findMany({where:{userId:f.actor.userId}}))};
    const start=Math.floor((Date.now()-3600000)/60000)*60000;
    const preview=await f.service.preview(f.actor,request({mode:'HISTORICAL_REPLAY',capital:'200',effectiveOpenedAt:new Date(start+1).toISOString(),effectiveClosedAt:new Date(start+120001).toISOString(),asOf:new Date(start+300000).toISOString()}));
    const ready=await waitReady(f.service,f.actor,preview.id);expect(ready.status).toBe('READY');await f.service.confirm(f.actor,preview.id,'history');
    const state=await f.service.state(f.actor);expect(state.scenarios).toHaveLength(1);expect(state.copyHistory).toHaveLength(1);expect(state.wallet.realizedPnl).toBe('0');expect(new BigNumber(state.wallet.available).eq('800')).toBe(true);
    expect(new BigNumber(state.scenarios[0].netPnl).gt(0)).toBe(true);expect(Date.parse(state.scenarios[0].effectiveOpenedAt)).toBe(start+60000);
    const card=await f.service.card(f.actor,state.scenarios[0].id);expect(card.label).toBe('Исторический тест');
    expect({spot:serialized(await db.balance.findMany({where:{userId:f.actor.userId}})),futures:serialized(await db.futuresBalance.findMany({where:{userId:f.actor.userId}}))}).toEqual(before);
    expect(await db.order.count({where:{userId:f.actor.userId}})).toBe(0);expect(await db.demoOrder.count({where:{userId:f.actor.userId}})).toBe(0);
  },30000);
  test('incomplete replay cannot confirm or appear in confirmed private history',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');f.market.historyIncomplete=true;const start=Math.floor((Date.now()-3600000)/60000)*60000;
    const preview=await f.service.preview(f.actor,request({mode:'HISTORICAL_REPLAY',capital:'200',effectiveOpenedAt:new Date(start+1).toISOString(),asOf:new Date(start+300000).toISOString()}));
    const result=await waitReady(f.service,f.actor,preview.id);expect(result.status).toBe('INCOMPLETE');await expect(f.service.confirm(f.actor,preview.id,'bad-history')).rejects.toMatchObject({code:'preview_not_ready'});
    expect((await f.service.state(f.actor)).copyHistory).toHaveLength(0);
  },30000);
  test.each(['2026-09-23T06:00:00Z','2026-09-23T07:54:00Z'])('advance from %s replaces one scenario version without reallocating capital or duplicating earlier journal entries',async(startIso)=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');const start=Date.parse(startIso);
    const preview=await f.service.preview(f.actor,request({mode:'HISTORICAL_REPLAY',capital:'200',effectiveOpenedAt:new Date(start+1).toISOString(),asOf:new Date(start+300000).toISOString()}));
    expect((await waitReady(f.service,f.actor,preview.id)).status).toBe('READY');await f.service.confirm(f.actor,preview.id,'initial-history');
    const first=(await f.service.state(f.actor)).scenarios[0];const before=await f.store.read(f.actor);const oldScenario=before.state.scenarios[0];
    const next=await f.service.advance(f.actor,first.id,new Date(start+420000).toISOString(),'advance');expect((await waitReady(f.service,f.actor,next.id)).status).toBe('READY');await f.service.confirm(f.actor,next.id,'advanced-history');
    const after=await f.store.read(f.actor);expect(after.state.scenarios).toHaveLength(1);expect(after.state.scenarios[0].version).toBe(2);expect(after.available.toString()).toBe(before.available.toString());expect(after.reserved.toString()).toBe(before.reserved.toString());expect(after.realized.toString()).toBe('0');
    expect(after.state.scenarios[0].result.createdAt).toBe(oldScenario.result.createdAt);expect(after.state.scenarios[0].profile).toEqual(oldScenario.profile);expect(after.state.scenarios[0].allocatedCapital).toBe('200');
    expect(await db.privateTradingLedger.count({where:{userId:f.actor.userId,kind:'SCENARIO_ALLOCATION'}})).toBe(1);expect(await db.privateTradingLedger.count({where:{userId:f.actor.userId,kind:'OPEN_FEE'}})).toBe(1);expect((await f.service.state(f.actor)).copyHistory).toHaveLength(1);
  },40000);
  test('pinned owner access applies to positions, history and cards; revoked flag/session blocks continued writes',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');const p=await open(f);const card=await f.service.card(f.actor,p.id);const other=await fixture();
    await expect(f.service.state(other.actor)).rejects.toMatchObject({code:'private_access_denied'});await expect(f.service.getCard(other.actor,card.id)).rejects.toMatchObject({code:'private_access_denied'});
    await expect(f.service.getCard({...f.actor,sessionId:other.actor.sessionId},card.id)).rejects.toMatchObject({code:'private_access_denied'});
    f.config.enabled=false;await expect(f.service.close(f.actor,p.id,undefined,'disabled')).rejects.toMatchObject({code:'private_access_denied'});f.config.enabled=true;
    await db.session.update({where:{id:f.actor.sessionId},data:{revokedAt:new Date()}});await expect(f.service.getCard(f.actor,card.id)).rejects.toMatchObject({code:'private_access_denied'});
  },30000);
  test('funding both signs and repeated settlement persist once without a second debit after restart',async()=>{
    const f=await fixture();await f.store.allocate(f.actor,'1000','capital');const p=await open(f);const first=Date.parse(p.effectiveOpenedAt)+1;await delay(5);
    await f.store.transact(f.actor,'funding-one',{},async tx=>{await applyPrivateFunding(tx,tx.state.positions[0],{timestamp:first,rate:'0.001',markPrice:'100'});return{};});
    const second=first+1;await f.store.transact(f.actor,'funding-two',{},async tx=>{await applyPrivateFunding(tx,tx.state.positions[0],{timestamp:second,rate:'-0.002',markPrice:'100'});return{};});
    const before=await privateSnapshot(f.actor.userId);
    await f.store.transact(f.actor,'funding-two',{},async tx=>{await applyPrivateFunding(tx,tx.state.positions[0],{timestamp:second,rate:'-0.002',markPrice:'100'});return{};});
    expect(await privateSnapshot(f.actor.userId)).toEqual(before);expect(await db.privateTradingLedger.count({where:{userId:f.actor.userId,kind:'FUNDING'}})).toBe(2);
    expect(new BigNumber((await f.service.state(f.actor)).positions[0].fundingNet).eq('1')).toBe(true);
  },30000);
});
