import BigNumber from 'bignumber.js';
import { NativeDemoService, NATIVE_REFRESH_PERSIST_MS } from '../native/service';
import { NativeAccount, NativeRepository, revisionPayload, commandHash } from '../native/store';
import { emptyDemoState } from '../native/engine';
import type { OwnerSession } from '../serviceTypes';
import { PrivateTradingError } from '../serviceTypes';
import type { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateHistoryRequest, PrivateCandleSelection } from '../marketData';

const M=60_000, H=3_600_000;
const H0=Date.UTC(2026,8,15,0,0,0);
const actor:OwnerSession={userId:'owner',sessionId:'s',expiresAt:Number.MAX_SAFE_INTEGER};
class Clock{constructor(public t:number){}now=()=>this.t;}
class MemoryRepository implements NativeRepository{
  row:NativeAccount|null=null;revisions=new Map<number,NativeAccount>();keys=new Map<string,{hash:string;row:NativeAccount}>();commits=0;
  constructor(private clock:Clock){}
  async read(){return this.row?structuredClone(this.row):null;}
  async available(){return this.row?null:'10000000';}
  /** A multi-asset wallet: the settle row, one asset with a quote, one without. */
  wallet=[{asset:'USDT',available:'10000000',locked:'0'},{asset:'BTC',available:'2',locked:'0'},{asset:'XYZ',available:'7',locked:'0'}];
  async holdings(){return this.wallet;}
  async revision(_a:OwnerSession,r:number){const v=this.revisions.get(r);return v?structuredClone(v):null;}
  async prior(_a:OwnerSession,key:string,hash:string){const v=this.keys.get(key);if(!v)return null;if(v.hash!==hash)throw new PrivateTradingError('idempotency_conflict','conflict',409);return structuredClone(v.row);}
  async initialize(_a:OwnerSession,key:string){
    if(this.row)return structuredClone(this.row);const t=this.clock.now();
    this.row={revision:1,deposit:'10000000',commands:[],snapshot:emptyDemoState('10000000',t),createdAt:t,source:'DEMO_BALANCE'};
    this.revisions.set(1,revisionPayload(this.row));this.keys.set(key,{hash:commandHash({kind:'INITIALIZE'}),row:revisionPayload(this.row)});return structuredClone(this.row);
  }
  async commit(_a:OwnerSession,expected:number,next:NativeAccount,key:string,hash:string){
    const prior=await this.prior(_a,key,hash);if(prior)return prior;
    if(this.row?.revision!==expected)throw new PrivateTradingError('account_changed','changed',409);
    const row=structuredClone({...next,revision:expected+1});this.row=row;this.commits++;
    this.revisions.set(row.revision,revisionPayload(row));this.keys.set(key,{hash,row:revisionPayload(row)});return structuredClone(row);
  }
}
const instrument=(symbol:string):PrivateInstrument=>({provider:'bybit',symbol,baseAsset:symbol.replace(/USDT$/,''),quoteAsset:'USDT',settleAsset:'USDT',contractType:'LinearPerpetual',status:'Trading',launchTime:Date.UTC(2020,0,1),fetchedAt:H0,fundingIntervalMinutes:480,
  filters:{tickSize:'0.1',minPrice:'0.1',maxPrice:'10000000',qtyStep:'0.001',minOrderQty:'0.001',maxOrderQty:'1000',maxMarketOrderQty:'1000',minNotionalValue:'5'},leverage:{min:'1',max:'100',step:'1'},
  riskTiers:[{riskLimitValue:'1000000000',maintenanceMarginRate:'0.005',initialMarginRate:'0.01',maintenanceDeduction:'0',maxLeverage:'100'}],parameterModel:'CURRENT_INSTRUMENT_PARAMETERS',parameterVersion:'TEST_FIXTURE'});
class FakeMarket{
  price:(t:number)=>string=()=>'50000';
  quote={bid:'49999.9',ask:'50000.1',last:'50000',mark:'50000',depth:'10',age:0};
  candles=new Map<number,{open:string;high:string;low:string;close:string}>();
  historyRequests:PrivateHistoryRequest[]=[];
  constructor(private clock:Clock){}
  async instrument(symbol:string){return instrument(symbol);}
  async freshQuote(symbol:string):Promise<PrivateFreshQuote>{
    const t=this.clock.now()-this.quote.age;
    return{provider:'bybit',symbol,bids:[{price:this.quote.bid,quantity:this.quote.depth},{price:new BigNumber(this.quote.bid).minus(1000).toFixed(),quantity:'1000'}],asks:[{price:this.quote.ask,quantity:this.quote.depth},{price:new BigNumber(this.quote.ask).plus(1000).toFixed(),quantity:'1000'}],
      markPrice:this.quote.mark,lastPrice:this.quote.last,fundingRate:'0.0001',nextFundingTime:t+H,providerTimestamp:t,bookGeneratedAt:t,markProviderTimestamp:t,fetchedAt:t};
  }
  async history(r:PrivateHistoryRequest){
    if(r.endTime>this.clock.now())throw new Error('FUTURE_HISTORY_REQUESTED');
    this.historyRequests.push(r);const step=(r.intervalMinutes??1)*M,candles=[];
    for(let t=r.startTime;t<r.endTime;t+=step){const p=this.price(t);candles.push({timestamp:t,open:p,high:p,low:p,close:p});}
    return{symbol:r.symbol,tradeCandles:candles,markCandles:structuredClone(candles),fundingEvents:[],expectedFundingTimestamps:[],intervalMs:step,complete:true,issues:[],fetchedAt:this.clock.now(),fundingScheduleModel:'NATIVE_DEMO_FIXED_FUNDING_V1' as const,instrument:instrument(r.symbol)};
  }
  async resolveCandle(s:PrivateCandleSelection){
    const intervalMs=s.interval==='1h'?H:M,closeTime=s.openTime+intervalMs;if(closeTime>this.clock.now())throw new Error('candle_not_closed');
    const c=this.candles.get(s.openTime)??{open:this.price(s.openTime),high:this.price(s.openTime),low:this.price(s.openTime),close:this.price(closeTime-1)};
    return{symbol:s.symbol,source:'BYBIT_LINEAR' as const,interval:s.interval,intervalMs,openTime:s.openTime,closeTime,effectiveAt:s.pricePoint==='OPEN'?s.openTime:closeTime,
      price:s.pricePoint==='OPEN'?c.open:c.close,pricePoint:s.pricePoint,candle:{timestamp:s.openTime,...c,volume:'1'},fetchedAt:this.clock.now(),verification:'VERIFIED' as const};
  }
}
function setup(start=H0+5*H+30_000){
  const clock=new Clock(start),repo=new MemoryRepository(clock),market=new FakeMarket(clock);
  const service=new NativeDemoService(repo,market as unknown as PrivateTradingMarketData,clock.now);
  return{clock,repo,market,service};
}
let seq=0;const key=()=>`test-key-${++seq}`;
const long=(extra:object={})=>({kind:'OPEN' as const,symbol:'BTCUSDT',side:'LONG' as const,type:'MARKET' as const,margin:'5000',leverage:'20',idempotencyKey:key(),...extra});

describe('native demo service (fixture market, in-memory persistence)',()=>{
  test('live market order: server sizes 5,000 x 20, stores only the consumed depth, refresh is cheap and not persisted',async()=>{
    const f=setup();await f.service.initialize(actor,'init-key-1');
    let v=await f.service.command(actor,long());
    expect(v.revision).toBe(2);expect(v.positions).toHaveLength(1);
    expect(v.positions[0]).toMatchObject({quantity:'2',entryPrice:'50000.1',historical:false,marginMode:'CROSS',liquidationPrice:null});
    const stored=f.repo.row!.commands[0];if(stored.kind!=='OPEN')throw new Error('open expected');
    expect(stored.book).toEqual({bids:[],asks:[{price:'50000.1',quantity:'10'}],timestamp:f.clock.t});
    f.clock.t+=30_000;f.market.quote={...f.market.quote,mark:'50100',last:'50100',bid:'50099.9',ask:'50100.1'};
    const commits=f.repo.commits;
    v=await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(v.revision).toBe(2);expect(f.repo.commits).toBe(commits);
    expect(v.positions[0]).toMatchObject({markPrice:'50100'});
    expect(v.positions[0].unrealizedPnl).toBe('199.8');
    f.clock.t+=NATIVE_REFRESH_PERSIST_MS+M;
    v=await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(v.revision).toBe(3);
    expect(f.market.historyRequests.every(r=>r.endTime<=f.clock.t&&r.intervalMinutes===1)).toBe(true);
  });
  test('idempotency: the same key returns the same result, a changed payload under that key is rejected',async()=>{
    const f=setup();await f.service.initialize(actor,'init-key-2');
    const request=long();
    const a=await f.service.command(actor,request);const b=await f.service.command(actor,request);
    expect(b.revision).toBe(a.revision);expect(b.positions).toHaveLength(1);
    await expect(f.service.command(actor,{...request,margin:'6000'})).rejects.toMatchObject({status:409});
    expect(f.repo.row!.snapshot.positions).toHaveLength(1);
  });
  test('historical market entry at a selected 1h candle close immediately shows P&L through to the live price',async()=>{
    const f=setup();await f.service.initialize(actor,'init-key-3');
    f.market.price=t=>t<H0+2*H?'40000':'42000';f.market.quote={...f.market.quote,mark:'42000',last:'42000',bid:'41999.9',ask:'42000.1'};
    const v=await f.service.command(actor,long({leverage:'10',candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:H0,pricePoint:'CLOSE'}}));
    expect(v.positions).toHaveLength(1);
    expect(v.positions[0]).toMatchObject({historical:true,entryPrice:'40000',quantity:'1.25',openedAt:H0+H,markPrice:'42000',unrealizedPnl:'2500',roiPercent:'50'});
    expect(v.events[0]).toMatchObject({kind:'OPEN',time:H0+H,pricing:'SELECTED_POINT',fee:'27.5'});
    expect(v.entries).toEqual([{positionId:v.positions[0].id,candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:H0,pricePoint:'CLOSE'}}]);
    // Funding is the custom model at 8h boundaries only; none elapsed between 01:00 and 05:00 UTC.
    expect(v.events.some(e=>e.kind==='FUNDING')).toBe(false);
  });
  test('historical buy limit: wick touch fills at the limit as maker; no touch rests and fills later on the path',async()=>{
    const f=setup();await f.service.initialize(actor,'init-key-4');
    f.market.price=()=>'40000';f.market.quote={...f.market.quote,mark:'40000',last:'40000',bid:'39999.9',ask:'40000.1'};
    f.market.candles.set(H0,{open:'40000',high:'40500',low:'39000',close:'40200'});
    let v=await f.service.command(actor,long({type:'LIMIT',price:'39500',leverage:'10',candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:H0,pricePoint:'CLOSE'}}));
    expect(v.positions[0]).toMatchObject({entryPrice:'39500',quantity:'1.265',openedAt:H0+600_000,openingFees:'9.9935'});
    const f2=setup();await f2.service.initialize(actor,'init-key-5');
    f2.market.price=t=>t<H0+3*H?'40000':'37000';f2.market.quote={...f2.market.quote,mark:'37000',last:'37000',bid:'36999.9',ask:'37000.1'};
    f2.market.candles.set(H0,{open:'40000',high:'40500',low:'39000',close:'40200'});
    v=await f2.service.command(actor,long({type:'LIMIT',price:'38000',leverage:'10',candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:H0,pricePoint:'OPEN'}}));
    expect(v.orders[0]).toMatchObject({status:'FILLED',createdAt:H0+H,price:'38000'});
    expect(v.positions[0]).toMatchObject({entryPrice:'37000',openedAt:H0+3*H});
    expect(v.events.find(e=>e.kind==='OPEN')).toMatchObject({pricing:'OHLC_PATH_MODEL'});
  });
  test('a backdated historical trade re-simulates the account but keeps live positions, their TP/SL and later closes intact',async()=>{
    const f=setup();await f.service.initialize(actor,'init-key-6');
    let v=await f.service.command(actor,long());const liveId=v.positions[0].id;
    f.clock.t+=5_000;
    v=await f.service.command(actor,{kind:'PROTECTION',positionId:liveId,protection:{takeProfit:'60000',stopLoss:'40000'},idempotencyKey:key()});
    f.clock.t+=2*M;
    v=await f.service.command(actor,long({leverage:'10',candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:H0+H,pricePoint:'OPEN'}}));
    expect(v.positions.map(p=>[p.id===liveId,p.historical,p.quantity])).toEqual([[false,true,'1'],[true,false,'2']]);
    expect(v.positions.find(p=>p.id===liveId)!.protection).toMatchObject({takeProfit:'60000',stopLoss:'40000'});
    f.clock.t+=5_000;
    v=await f.service.command(actor,{kind:'CLOSE',positionId:liveId,quantity:'1',idempotencyKey:key()});
    expect(v.positions.find(p=>p.id===liveId)).toMatchObject({quantity:'1'});
    expect(v.history).toHaveLength(0);
    await expect(f.service.command(actor,{kind:'CLOSE',positionId:v.positions.find(p=>p.historical)!.id,candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:H0,pricePoint:'CLOSE'},idempotencyKey:key()}))
      .rejects.toMatchObject({code:'EXIT_BEFORE_ENTRY'});
    v=await f.service.command(actor,{kind:'CLOSE',positionId:v.positions.find(p=>p.historical)!.id,candle:{source:'BYBIT_LINEAR',interval:'1h',openTime:H0+3*H,pricePoint:'CLOSE'},idempotencyKey:key()});
    expect(v.history).toHaveLength(1);expect(v.history[0]).toMatchObject({historical:true,status:'CLOSED',closedAt:H0+4*H});
  });
  test('a live TP hit is journaled (OBSERVE) and stays closed when the quote returns below the target',async()=>{
    const f=setup();await f.service.initialize(actor,'init-key-7');
    let v=await f.service.command(actor,long({protection:{takeProfit:'50500',triggerBy:'LAST'}}));
    f.clock.t+=30_000;f.market.quote={...f.market.quote,last:'50600'};
    v=await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(v.revision).toBe(3);expect(v.positions).toHaveLength(0);
    expect(v.history[0]).toMatchObject({status:'CLOSED'});
    expect(f.repo.row!.commands.map(c=>c.kind)).toEqual(['OPEN','OBSERVE']);
    f.clock.t+=40_000;f.market.quote={...f.market.quote,last:'50000'};
    v=await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(v.positions).toHaveLength(0);expect(v.history[0].status).toBe('CLOSED');
    expect(v.events.filter(e=>e.kind==='TAKE_PROFIT')).toHaveLength(1);
  });
  test('P&L card is frozen from one persisted revision and reloads identically by revision',async()=>{
    const f=setup();await f.service.initialize(actor,'init-key-8');
    const v=await f.service.command(actor,long());const id=v.positions[0].id;
    f.clock.t+=20_000;f.market.quote={...f.market.quote,mark:'50500',last:'50500'};
    const card=await f.service.card(actor,id);
    expect(card.revision).toBe(3);expect(card.id).toBe(`native:3:${id}`);
    expect(card).toMatchObject({valuationPrice:'50500',entryPrice:'50000.1',status:'OPEN',mode:'DEMO_LIVE'});
    f.market.quote={...f.market.quote,mark:'1',last:'1'};
    expect(await f.service.card(actor,id,3)).toEqual(card);
  });
  test('stale quotes are refused instead of valuing or filling at old prices',async()=>{
    const f=setup();await f.service.initialize(actor,'init-key-9');
    f.market.quote={...f.market.quote,age:10_000};
    await expect(f.service.command(actor,long())).rejects.toMatchObject({code:'quote_stale'});
    expect(f.repo.row!.commands).toHaveLength(0);
  });
  test('a checkpoint that no longer matches falls back to the full scenario instead of failing the account',async()=>{
    const f=setup();await f.service.initialize(actor,'init-key-10');
    await f.service.command(actor,long());f.repo.row!.checkpoint!.digest='corrupted';
    f.clock.t+=5_000;
    const v=await f.service.command(actor,{kind:'CLOSE',positionId:f.repo.row!.snapshot.positions[0].id,idempotencyKey:key()});
    expect(v.history).toHaveLength(1);expect(f.repo.row!.checkpoint!.digest).not.toBe('corrupted');
  });
});

describe('native Wallet collateral preferences',()=>{
  test('disabling BTC leaves it in Wallet assets but removes it from Cross collateral, and persists',async()=>{
    const f=setup();
    await f.service.initialize(actor,'init-collateral-1');
    const before=await f.service.wallet(actor);
    if(!before)throw new Error('wallet expected');
    const after=await f.service.setCollateralPreference(actor,'BTC',false,'collateral-btc-off');
    expect(after.assetsValue).toBe(before.assetsValue);
    expect(new BigNumber(before.account.collateral).minus(after.account.collateral).toFixed()).toBe('100000');
    expect(after.rows.find(r=>r.asset==='BTC')).toMatchObject({collateralEnabled:false,collateralToggleable:true});
    expect(f.repo.row?.disabledCollateralAssets).toEqual(['BTC']);
    const reloaded=await f.service.wallet(actor);
    expect(reloaded?.rows.find(r=>r.asset==='BTC')?.collateralEnabled).toBe(false);

    const on=await f.service.setCollateralPreference(actor,'BTC',true,'collateral-btc-on');
    expect(on.rows.find(r=>r.asset==='BTC')?.collateralEnabled).toBe(true);
    expect(on.account.collateral).toBe(before.account.collateral);
    expect(f.repo.row?.disabledCollateralAssets).toEqual([]);
  });

  test('server refuses to disable collateral that an existing account already needs',async()=>{
    const f=setup();
    // Build a legitimate position first. Then model a restored/migrated Cross
    // account whose free settle cash has already been consumed elsewhere:
    // BTC is what keeps the stored position safely above maintenance. The
    // toggle guard must reason from the EXISTING account, not try to create
    // an impossible new order just for this test.
    f.repo.wallet=[{asset:'BTC',available:'2',locked:'0'}];
    await f.service.initialize(actor,'init-collateral-2');
    await f.service.command(actor,long({margin:'5000',leverage:'20'}));
    f.repo.row!.snapshot.walletBalance='0';
    const before=await f.service.wallet(actor);
    expect(before?.account.liquidatable).toBe(false);
    expect(new BigNumber(before!.account.collateral).gt(before!.account.maintenanceMargin)).toBe(true);

    await expect(f.service.setCollateralPreference(actor,'BTC',false,'collateral-required'))
      .rejects.toMatchObject({code:'collateral_required',status:409});
    expect(f.repo.row?.disabledCollateralAssets??[]).toEqual([]);
    expect((await f.service.wallet(actor))?.rows.find(r=>r.asset==='BTC')?.collateralEnabled).toBe(true);
  });

  test('cannot enable an unpriced asset as collateral',async()=>{
    const f=setup();
    await f.service.initialize(actor,'init-collateral-3');
    const answer=f.market.freshQuote.bind(f.market);
    f.market.freshQuote=(async(symbol:string)=>{
      if(symbol==='XYZUSDT')throw new Error('NO_SUCH_CONTRACT');
      return answer(symbol);
    }) as typeof f.market.freshQuote;
    await f.service.setCollateralPreference(actor,'XYZ',false,'xyz-off');
    await expect(f.service.setCollateralPreference(actor,'XYZ',true,'xyz-on'))
      .rejects.toMatchObject({code:'collateral_unpriced',status:409});
    expect(f.repo.row?.disabledCollateralAssets).toEqual(['XYZ']);
  });
});

describe('the Cross collateral base is the whole wallet, priced or named',()=>{
  test('prices every asset it can and NAMES the one it cannot, instead of valuing it at 0',async()=>{
    const f=setup();
    // The fixture market answers every symbol, so make one genuinely fail —
    // exactly what an unlisted asset or a provider outage looks like.
    const answer=f.market.freshQuote.bind(f.market);
    f.market.freshQuote=(async(symbol:string)=>{
      if(symbol==='XYZUSDT')throw new Error('NO_SUCH_CONTRACT');
      return answer(symbol);
    }) as typeof f.market.freshQuote;

    const v=await f.service.collateral(actor);
    // 10 000 000 USDT + 2 BTC at the fixture mark of 50 000.
    expect(v.priced).toBe('10100000');
    expect(v.unpriced).toEqual(['XYZ']);
    expect(v.complete).toBe(false);
    const xyz=v.lines.find(l=>l.asset==='XYZ')!;
    expect(xyz.value).toBeNull();
    expect(xyz.price).toBeNull();
    // 7 XYZ are still 7 XYZ; only their worth is unknown.
    expect(xyz.quantity).toBe('7');
  });

  test('values collateral at the MARK, the same price the positions it backs use',async()=>{
    const f=setup();
    f.market.quote={...f.market.quote,mark:'60000',last:'12345'};
    const answer=f.market.freshQuote.bind(f.market);
    f.market.freshQuote=(async(symbol:string)=>{
      if(symbol==='XYZUSDT')throw new Error('NO_SUCH_CONTRACT');
      return answer(symbol);
    }) as typeof f.market.freshQuote;
    const v=await f.service.collateral(actor);
    expect(v.lines.find(l=>l.asset==='BTC')!.price).toBe('60000');
    expect(v.priced).toBe('10120000');
  });

  test('a complete wallet reports complete, and the total is the wallet — not a number written in the code',async()=>{
    const f=setup();
    f.repo.wallet=[{asset:'USDT',available:'1234.5',locked:'0.5'},{asset:'BTC',available:'1',locked:'0'}];
    const v=await f.service.collateral(actor);
    expect(v.complete).toBe(true);
    expect(v.unpriced).toEqual([]);
    expect(v.priced).toBe('51235');
    // Change the wallet, and the figure changes with it.
    f.repo.wallet=[{asset:'USDT',available:'7',locked:'0'}];
    expect((await f.service.collateral(actor)).priced).toBe('7');
  });

  test('the settle row needs no quote, so a total outage still values the USDT the owner holds',async()=>{
    const f=setup();
    f.repo.wallet=[{asset:'USDT',available:'900',locked:'0'},{asset:'BTC',available:'3',locked:'0'}];
    f.market.freshQuote=(async()=>{throw new Error('PROVIDER_DOWN');}) as typeof f.market.freshQuote;
    const v=await f.service.collateral(actor);
    expect(v.priced).toBe('900');
    expect(v.unpriced).toEqual(['BTC']);
    expect(v.complete).toBe(false);
  });
});

describe('the P&L card and the account come from the same numbers',()=>{
  test('the card reports the position AFTER fees and funding, not a separate estimate',async()=>{
    const f=setup();await f.service.initialize(actor,'card-init');
    await f.service.command(actor,long());
    f.clock.t+=60_000;f.market.quote={...f.market.quote,mark:'55000',last:'55000',bid:'54999.9',ask:'55000.1'};
    const state=await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    const position=state.positions[0];
    const card=await f.service.card(actor,position.id);

    // Same figures, not similar ones.
    expect(card.unrealizedPnl).toBe(position.unrealizedPnl);
    expect(card.roiPercent).toBe(position.roiPercent);
    expect(card.entryPrice).toBe(position.entryPrice);
    // netPnl carries the realized side — fees and funding included ONCE.
    expect(card.netPnl).toBe(position.netPnl);
    // An open position's headline figure is the unrealized one.
    expect(card.pnl).toBe(position.unrealizedPnl);
    expect(card.status).toBe('OPEN');
  });

  test('the account the card was taken from is the authoritative one',async()=>{
    const f=setup();await f.service.initialize(actor,'card-init-2');
    await f.service.command(actor,long());
    const authoritative=(await f.service.account(actor))!;
    const state=await f.service.state(actor);

    // One account object, two ways of asking for it.
    expect(state.account).toEqual(authoritative.account);
    expect(state.ledger).toEqual(authoritative.ledger);
    // And the ledger reconciles against the engine it was projected from.
    expect(authoritative.ledger.reconciled).toBe(true);
    expect(authoritative.ledger.closingBalance).toBe(authoritative.account.settleBalance);
  });

  test('equity = settle ledger + wallet collateral + unrealized P&L, every time',async()=>{
    const f=setup();await f.service.initialize(actor,'equation-init');
    // Only the settle row is left in the wallet after initialization moved
    // it; give the account a second asset so both halves are non-zero.
    f.repo.wallet=[{asset:'BTC',available:'2',locked:'0'}];
    await f.service.command(actor,long());
    f.clock.t+=60_000;f.market.quote={...f.market.quote,mark:'55000',last:'55000',bid:'54999.9',ask:'55000.1'};
    await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});

    const a=(await f.service.account(actor))!.account;
    const sum=new BigNumber(a.settleBalance).plus(a.walletCollateral).plus(a.unrealizedPnl);
    expect(sum.toFixed()).toBe(a.equity);
    expect(new BigNumber(a.settleBalance).plus(a.walletCollateral).toFixed()).toBe(a.collateral);
    // 2 BTC priced at the live mark, not at a written-in number.
    expect(a.walletCollateral).toBe('110000');
    expect(a.collateralComplete).toBe(true);
    // available = equity - initialMargin - orderReserve
    expect(new BigNumber(a.equity).minus(a.initialMargin).minus(a.orderReserve).toFixed()).toBe(a.available);
  });

  test('an unpriceable wallet asset makes the account incomplete and the verdict unknown',async()=>{
    const f=setup();await f.service.initialize(actor,'incomplete-init');
    f.repo.wallet=[{asset:'BTC',available:'2',locked:'0'},{asset:'XYZ',available:'5',locked:'0'}];
    const answer=f.market.freshQuote.bind(f.market);
    f.market.freshQuote=(async(symbol:string)=>{
      if(symbol==='XYZUSDT')throw new Error('NO_SUCH_CONTRACT');
      return answer(symbol);
    }) as typeof f.market.freshQuote;
    await f.service.command(actor,long());

    const a=(await f.service.account(actor))!.account;
    expect(a.collateralComplete).toBe(false);
    expect(a.unpricedAssets).toEqual(['XYZ']);
    expect(a.liquidatable).toBeNull();
    // The priced part is still reported, as a floor.
    expect(a.walletCollateral).toBe('100000');
  });
});

describe('a repeated request never trades twice',()=>{
  test('the same key twice opens ONE position and charges ONE fee',async()=>{
    const f=setup();await f.service.initialize(actor,'idem-init');
    const request=long();
    const first=await f.service.command(actor,request);
    const second=await f.service.command(actor,request);

    expect(second.revision).toBe(first.revision);
    expect(second.positions).toHaveLength(1);
    expect(second.account).toEqual(first.account);
    // One opening fee in the ledger, not two.
    const fees=second.ledger!.entries.filter(e=>e.source==='OPENING_FEE');
    expect(fees).toHaveLength(1);
    expect(second.ledger!.totals.fees).toBe(first.ledger!.totals.fees);
    expect(second.ledger!.reconciled).toBe(true);
  });

  test('a retry of the same key with DIFFERENT parameters is refused, not silently applied',async()=>{
    const f=setup();await f.service.initialize(actor,'idem-init-2');
    const request=long();
    await f.service.command(actor,request);
    await expect(f.service.command(actor,{...request,margin:'6000'}))
      .rejects.toMatchObject({status:409});
    // And the account is untouched by the refusal.
    const state=await f.service.state(actor);
    expect(state.positions).toHaveLength(1);
    expect(state.ledger!.entries.filter(e=>e.source==='OPENING_FEE')).toHaveLength(1);
  });

  test('a repeated CLOSE closes once and books one closing fee',async()=>{
    const f=setup();await f.service.initialize(actor,'idem-init-3');
    const opened=await f.service.command(actor,long());
    const id=opened.positions[0].id;
    f.clock.t+=60_000;f.market.quote={...f.market.quote,mark:'55000',last:'55000',bid:'54999.9',ask:'55000.1'};
    const close={kind:'CLOSE' as const,positionId:id,idempotencyKey:key()};
    const first=await f.service.command(actor,close);
    const second=await f.service.command(actor,close);

    expect(second.revision).toBe(first.revision);
    expect(second.positions).toHaveLength(0);
    expect(second.ledger!.entries.filter(e=>e.source==='CLOSING_FEE')).toHaveLength(1);
    expect(second.ledger!.entries.filter(e=>e.source==='REALIZED_PNL')).toHaveLength(1);
    expect(second.account).toEqual(first.account);
  });

  test('a reload between the two attempts changes nothing: the key still wins',async()=>{
    const f=setup();await f.service.initialize(actor,'idem-init-4');
    const request=long();
    const first=await f.service.command(actor,request);
    // A reload is a fresh state read followed by the retried command.
    await f.service.state(actor);
    const retried=await f.service.command(actor,request);
    expect(retried.revision).toBe(first.revision);
    expect(retried.positions).toHaveLength(1);
    expect(retried.ledger!.totals.fees).toBe(first.ledger!.totals.fees);
  });

  test('two in-flight commands do not interleave: the second is refused while the first runs',async()=>{
    const f=setup();await f.service.initialize(actor,'idem-init-5');
    const slow=f.service.command(actor,long());
    await expect(f.service.command(actor,long())).rejects.toMatchObject({status:409});
    await slow;
    const state=await f.service.state(actor);
    expect(state.positions).toHaveLength(1);
  });
});
