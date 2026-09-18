import BigNumber from 'bignumber.js';
import { NativeDemoService, NATIVE_REFRESH_PERSIST_MS, NATIVE_COMMAND_QUEUE_LIMIT, NATIVE_QUOTE_REUSE_MS, NATIVE_COMMIT_ATTEMPTS } from '../native/service';
import { nativeAdmissionLimits } from '../native/replay';
import { NativeAccount, NativeRepository, revisionPayload, commandHash } from '../native/store';
import { emptyDemoState } from '../native/engine';
import { assertNativeInvariants } from '../native/invariants';
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
    // One critical section, like the row lock in Postgres: the idempotency check and the revision CAS never interleave with another commit.
    const known=this.keys.get(key);
    if(known){if(known.hash!==hash)throw new PrivateTradingError('idempotency_conflict','conflict',409);return structuredClone(known.row);}
    if(this.row?.revision!==expected)throw new PrivateTradingError('account_changed','changed',409);
    // Every persisted mutation in this suite is held to the account invariants before it is stored.
    assertNativeInvariants(next.snapshot,undefined,`commit ${expected+1}`);
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
  /** Age of the provider snapshot per contract, when a test needs ONE contract's quote to be old. */
  ageBySymbol:Record<string,number>={};
  candles=new Map<number,{open:string;high:string;low:string;close:string}>();
  historyRequests:PrivateHistoryRequest[]=[];
  constructor(private clock:Clock){}
  async instrument(symbol:string){return instrument(symbol);}
  /** A source that answers late: the function runs (and may move the clock) before the quote is built. */
  waitFor:Record<string,()=>Promise<void>|void>={};
  async freshQuote(symbol:string):Promise<PrivateFreshQuote>{
    if(this.waitFor[symbol])await this.waitFor[symbol]();
    const t=this.clock.now()-(this.ageBySymbol[symbol]??this.quote.age);
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
    // The fixture moved the market without moving the clock: let the service's short quote snapshot expire.
    f.clock.t+=NATIVE_QUOTE_REUSE_MS+1;
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

describe('freshness is checked at the moment a quote is USED, not only when it was fetched',()=>{
  /** Little settle cash, plenty of wallet ETH: a new order needs the ETH to be priced, and priced FRESH. */
  function poor(){
    const f=setup();
    f.repo.initialize=async function(this:typeof f.repo,_a:OwnerSession,key:string){
      if(this.row)return structuredClone(this.row);const t=f.clock.now();
      this.row={revision:1,deposit:'1000',commands:[],snapshot:emptyDemoState('1000',t),createdAt:t,source:'DEMO_BALANCE'};
      this.revisions.set(1,revisionPayload(this.row));this.keys.set(key,{hash:commandHash({kind:'INITIALIZE'}),row:revisionPayload(this.row)});return structuredClone(this.row);
    } as typeof f.repo.initialize;
    f.repo.wallet=[{asset:'ETH',available:'2',locked:'0'}];
    const asked:string[]=[];const answer=f.market.freshQuote.bind(f.market);
    f.market.freshQuote=(async(symbol:string)=>{asked.push(symbol);return answer(symbol);}) as typeof f.market.freshQuote;
    return{...f,asked};
  }
  test('a collateral quote that was 4.5 s old when taken is not reused 1.5 s later as if it were fresh: it is fetched again, and a stale answer leaves the asset UNPRICED so no new risk is admitted on it',async()=>{
    const f=poor();
    // The provider's snapshot is 4.5 s old when it is taken (by the read that initialize answers with): inside the
    // 5 s window, so the wallet is priced, and the command right after reuses that snapshot from the cache …
    f.market.quote.age=4500;
    await f.service.initialize(actor,'fresh-init');
    f.asked.length=0;
    const first=await f.service.command(actor,long({margin:'5000',leverage:'20'}));
    expect(first.positions).toHaveLength(1);
    expect(f.asked).toEqual(['BTCUSDT']);                          // ETH served from the 4.5-second-old, still-fresh snapshot
    expect(f.repo.row!.snapshot.collateral).toMatchObject({priced:'100000',complete:true});
    // … 1.5 s later that quote is still inside the service's 2 s reuse window, but the observation it carries is 6 s old.
    f.clock.t+=1500;f.asked.length=0;
    f.market.quote.age=0;f.market.ageBySymbol.ETHUSDT=6000;    // the executed contract quotes fresh; the collateral's provider snapshot is 6 s old
    await expect(f.service.command(actor,long({margin:'5000',leverage:'20'}))).rejects.toMatchObject({code:'INSUFFICIENT_DEMO_MARGIN'});
    // ETH was asked again (the 1.5-second-old cached snapshot was NOT trusted), and the refetch failed the check:
    // the wallet is unpriced, and 1 000 of cash cannot admit a 5 000 order.
    expect(f.asked.filter(s=>s==='ETHUSDT').length).toBeGreaterThanOrEqual(1);
    // A read says so instead of pricing the wallet on the old snapshot.
    f.clock.t+=100;
    const read=await f.service.state(actor);
    expect(read.account!.collateralComplete).toBe(false);
    expect(read.account!.walletCollateral).toBe('0');
    expect(f.repo.row!.snapshot.collateral).toMatchObject({priced:'100000',complete:true}); // the journal keeps what the FIRST command was decided on
  });
  test('the same 1.5-second-old cache entry IS reused when the observation inside it is still fresh',async()=>{
    const f=poor();
    f.market.quote.age=1000;
    await f.service.initialize(actor,'fresh-init-2');
    await f.service.command(actor,long({margin:'5000',leverage:'20'}));
    f.clock.t+=1500;f.asked.length=0;
    const v=await f.service.command(actor,long({symbol:'BTCUSDT',margin:'1000',leverage:'20'}));
    expect(v.positions[0].quantity).toBe('2.4');
    expect(f.asked).toEqual(['BTCUSDT']);                       // the executed contract, fresh; ETH served from the still-fresh snapshot
  });
});

describe('freshness after waiting on other sources (R8)',()=>{
  /** Little cash, two priced assets: ETH answers at once, SOL only after `release` has run. */
  function twoAssets(){
    const f=setup();
    f.repo.initialize=async function(this:typeof f.repo,_a:OwnerSession,key:string){
      if(this.row)return structuredClone(this.row);const t=f.clock.now();
      this.row={revision:1,deposit:'1000',commands:[],snapshot:emptyDemoState('1000',t),createdAt:t,source:'DEMO_BALANCE'};
      this.revisions.set(1,revisionPayload(this.row));this.keys.set(key,{hash:commandHash({kind:'INITIALIZE'}),row:revisionPayload(this.row)});return structuredClone(this.row);
    } as typeof f.repo.initialize;
    // SOL is a token amount: without ETH the wallet cannot admit the 5 000 order on 1 000 of cash.
    f.repo.wallet=[{asset:'ETH',available:'2',locked:'0'},{asset:'SOL',available:'0.001',locked:'0'}];
    const asked:string[]=[];const answer=f.market.freshQuote.bind(f.market);
    f.market.freshQuote=(async(symbol:string)=>{asked.push(symbol);return answer(symbol);}) as typeof f.market.freshQuote;
    return{...f,asked};
  }
  test('a price that was fresh when it answered but is stale by the time the slow source has answered is fetched ONCE more, and the decision is taken on that',async()=>{
    const f=twoAssets();await f.service.initialize(actor,'r8-init');
    // ETH's snapshot is 2.5 s old at fetch; SOL takes 3 s to answer (the clock moves inside its fetch).
    f.clock.t+=NATIVE_QUOTE_REUSE_MS+1;f.asked.length=0;
    f.market.ageBySymbol.ETHUSDT=2500;f.market.waitFor.SOLUSDT=()=>{f.clock.t+=3000;};
    const v=await f.service.command(actor,long({margin:'5000',leverage:'20'}));
    // By the time both answered, ETH's first snapshot was 5.5 s old: it was fetched again (fresh at 2.5 s) and the wallet is priced on THAT.
    expect(f.asked.filter(s=>s==='ETHUSDT')).toHaveLength(2);
    expect(v.positions).toHaveLength(1);
    expect(v.account!.collateralComplete).toBe(true);
  });
  test('when the second fetch is stale too, the asset is unpriced and no new risk is admitted on it — one extra round, never a loop',async()=>{
    const f=twoAssets();await f.service.initialize(actor,'r8-init-2');
    f.clock.t+=NATIVE_QUOTE_REUSE_MS+1;f.asked.length=0;
    f.market.ageBySymbol.ETHUSDT=2500;
    f.market.waitFor.SOLUSDT=()=>{f.clock.t+=3000;f.market.ageBySymbol.ETHUSDT=6000;};   // the provider's ETH snapshot has not moved on either
    await expect(f.service.command(actor,long({margin:'5000',leverage:'20'}))).rejects.toMatchObject({code:'INSUFFICIENT_DEMO_MARGIN'});
    expect(f.asked.filter(s=>s==='ETHUSDT')).toHaveLength(2);
    expect(f.repo.row!.revision).toBe(1);
  });
  test('an execution book observed before a long wait is not the one the command commits on: the decision is taken again, once, on a fresh book',async()=>{
    const f=twoAssets();await f.service.initialize(actor,'r8-init-3');
    f.clock.t+=NATIVE_QUOTE_REUSE_MS+1;f.asked.length=0;
    // The order's own quote is taken first; then the wallet valuation waits 6 s on SOL. The book is stale at the decision.
    let waited=0;f.market.waitFor.SOLUSDT=()=>{if(waited++===0)f.clock.t+=6000;};
    const t0=f.clock.t;
    const v=await f.service.command(actor,long({margin:'5000',leverage:'20'}));
    expect(f.service.expiredDecisions).toBe(1);
    // BTC was quoted three times: the first decision's book, the projected position's valuation once the first
    // book had aged out of the reuse window, and the second decision's fresh book. Bounded, and every one checked.
    expect(f.asked.filter(s=>s==='BTCUSDT')).toHaveLength(3);
    expect(v.positions).toHaveLength(1);
    const stored=f.repo.row!.commands.find(c=>c.kind==='OPEN')!;
    expect(stored.kind==='OPEN'&&stored.book!.timestamp).toBe(t0+6000);          // the book that was fresh when the decision was made
    expect(stored.at).toBe(t0+6000);
  });
  test('if the fresh book has expired again by the second decision, the command is refused, nothing is committed',async()=>{
    const f=twoAssets();await f.service.initialize(actor,'r8-init-4');
    f.clock.t+=NATIVE_QUOTE_REUSE_MS+1;
    // An open position, and a closed minute since it: every decision has to replay a history window for it,
    // and THIS source is the slow one — 6 s per window, every time. The wallet quotes are cached and fast.
    const first=await f.service.command(actor,long({margin:'500',leverage:'20'}));
    expect(first.positions).toHaveLength(1);
    f.clock.t=Math.floor(f.clock.t/M)*M+M+1000;
    const history=f.market.history.bind(f.market);
    f.market.history=(async(r:PrivateHistoryRequest)=>{f.clock.t+=6000;return history(r);}) as typeof f.market.history;
    const revision=f.repo.row!.revision,commands=f.repo.row!.commands.length;
    await expect(f.service.command(actor,long({margin:'500',leverage:'20'}))).rejects.toMatchObject({code:'quote_stale'});
    expect(f.service.expiredDecisions).toBe(1);
    expect(f.repo.row!.revision).toBe(revision);
    expect(f.repo.row!.commands).toHaveLength(commands);
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
    // Initialization already valued XYZ successfully; let that snapshot expire so the outage is seen.
    f.clock.t+=NATIVE_QUOTE_REUSE_MS+1;
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

  test('two in-flight commands do not interleave: the second runs AFTER the first, and is not refused',async()=>{
    const f=setup();await f.service.initialize(actor,'idem-init-5');
    const first=f.service.command(actor,long());
    const second=f.service.command(actor,long({margin:'2500'}));
    const [a,b]=await Promise.all([first,second]);
    expect(a.revision).toBe(2);expect(b.revision).toBe(3);
    const state=await f.service.state(actor);
    // Same symbol, side and bucket: the second fill averaged into ONE position.
    expect(state.positions).toHaveLength(1);expect(state.positions[0].quantity).toBe('3');
  });
});

describe('commands for one account are serialized in arrival order, never refused as busy',()=>{
  /** Hold the first repository read until released, so later commands queue behind it. */
  function gateFirstRead(f:ReturnType<typeof setup>,userId=actor.userId){
    let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let reads=0;
    const read=f.repo.read.bind(f.repo);
    f.repo.read=(async(a:OwnerSession)=>{if(a.userId===userId){reads+=1;if(reads===1)await gate;}return read();}) as typeof f.repo.read;
    return{release,reads:()=>reads};
  }
  test('a CLOSE that arrives while a REFRESH is running is executed after it, not dropped',async()=>{
    const f=setup();await f.service.initialize(actor,'lane-init-1');
    const opened=await f.service.command(actor,long());const id=opened.positions[0].id;
    f.clock.t+=5_000;
    const gate=gateFirstRead(f);
    const refresh=f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    const close=f.service.command(actor,{kind:'CLOSE',positionId:id,idempotencyKey:key()});
    expect(f.service.queued(actor.userId)).toBe(2);
    gate.release();
    const [r,c]=await Promise.all([refresh,close]);
    expect(r.positions).toHaveLength(1);
    expect(c.positions).toHaveLength(0);expect(c.history).toHaveLength(1);
    expect(f.service.queued(actor.userId)).toBe(0);
  });
  test('the same key queued twice by a double click trades once and answers with one receipt',async()=>{
    const f=setup();await f.service.initialize(actor,'lane-init-2');
    const request=long();
    const [a,b]=await Promise.all([f.service.command(actor,request),f.service.command(actor,request)]);
    expect(b.revision).toBe(a.revision);expect(b.positions).toHaveLength(1);
    expect(f.repo.commits).toBe(1);
  });
  test('plain refreshes queued together are answered by ONE computation',async()=>{
    const f=setup();await f.service.initialize(actor,'lane-init-3');
    await f.service.command(actor,long());f.clock.t+=5_000;
    const gate=gateFirstRead(f);
    const all=Promise.all([1,2,3].map(()=>f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()})));
    expect(f.service.queued(actor.userId)).toBe(1);
    gate.release();
    const results=await all;
    expect(gate.reads()).toBe(1);
    expect(results.map(r=>r.revision)).toEqual([2,2,2]);
  });
  test('a refresh queued AFTER a close observes the close instead of sharing the earlier refresh',async()=>{
    const f=setup();await f.service.initialize(actor,'lane-init-4');
    const opened=await f.service.command(actor,long());const id=opened.positions[0].id;f.clock.t+=5_000;
    const gate=gateFirstRead(f);
    const early=f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    const close=f.service.command(actor,{kind:'CLOSE',positionId:id,idempotencyKey:key()});
    const late=f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(f.service.queued(actor.userId)).toBe(3);
    gate.release();
    const [a,,c]=await Promise.all([early,close,late]);
    expect(a.positions).toHaveLength(1);
    expect(c.positions).toHaveLength(0);expect(c.history).toHaveLength(1);
  });
  test('the lane is bounded: overflow is an explicit retriable refusal, and the queue drains',async()=>{
    const f=setup();await f.service.initialize(actor,'lane-init-5');
    const gate=gateFirstRead(f);
    const queued=Array.from({length:NATIVE_COMMAND_QUEUE_LIMIT},()=>f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()},{persist:true}));
    await expect(f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()},{persist:true})).rejects.toMatchObject({code:'native_queue_full',status:429});
    gate.release();
    await Promise.all(queued);
    expect(f.service.queued(actor.userId)).toBe(0);
  });
  test('accounts do not block each other',async()=>{
    const f=setup();await f.service.initialize(actor,'lane-init-6');
    const other:OwnerSession={userId:'other',sessionId:'s2',expiresAt:Number.MAX_SAFE_INTEGER};
    const gate=gateFirstRead(f);
    const slow=f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()},{persist:true});
    // The other account shares the repository fixture row here; only the lane is under test.
    const fast=await f.service.state(other);
    expect(fast.initialized).toBe(true);
    expect(f.service.queued(other.userId)).toBe(0);
    gate.release();await slow;
  });
});

describe('a reducing order names ONE position, and the name has to fit',()=>{
  async function twoBuckets(){
    const f=setup();await f.service.initialize(actor,'target-init');
    const cross=(await f.service.command(actor,long())).positions[0];
    const state=await f.service.command(actor,long({marginType:'ISOLATED',margin:'2500'}));
    const isolated=state.positions.find(p=>p.marginMode==='ISOLATED')!;
    expect(state.positions).toHaveLength(2);
    expect(cross).toMatchObject({marginMode:'CROSS',quantity:'2'});expect(isolated).toMatchObject({marginMode:'ISOLATED',quantity:'1'});
    return{f,cross,isolated};
  }
  const reduce=(positionId:string,extra:object={})=>({kind:'OPEN' as const,symbol:'BTCUSDT',side:'SHORT' as const,type:'LIMIT' as const,quantity:'1',leverage:'20',price:'60000',reduceOnly:true as const,positionId,idempotencyKey:key(),...extra});
  test('the client cannot move a close into another bucket by naming one',async()=>{
    const {f,isolated}=await twoBuckets();const before=f.repo.row!.commands.length;
    await expect(f.service.command(actor,reduce(isolated.id,{marginType:'CROSS'}))).rejects.toMatchObject({code:'MARGIN_TYPE_MISMATCH'});
    expect(f.repo.row!.commands).toHaveLength(before);
  });
  test('the bucket comes from the position: a LIMIT reduce of the isolated position rests in the isolated bucket',async()=>{
    const {f,isolated}=await twoBuckets();
    const v=await f.service.command(actor,reduce(isolated.id));
    const order=v.orders.find(o=>o.status==='OPEN')!;
    expect(order).toMatchObject({marginType:'ISOLATED',positionId:isolated.id,reduceOnly:true,type:'LIMIT',price:'60000',remaining:'1'});
    expect(v.positions.map(p=>[p.marginMode,p.quantity]).sort()).toEqual([['CROSS','2'],['ISOLATED','1']]);
  });
  test('a position of another contract, the same side, or more than remains is refused before any market data is read',async()=>{
    const {f,cross,isolated}=await twoBuckets();
    const quotes=()=>f.market.freshQuote.bind(f.market);let asked=0;const answer=quotes();
    f.market.freshQuote=(async(symbol:string)=>{asked+=1;return answer(symbol);}) as typeof f.market.freshQuote;
    await expect(f.service.command(actor,reduce(cross.id,{symbol:'ETHUSDT'}))).rejects.toMatchObject({code:'INVALID_REDUCE_SYMBOL'});
    await expect(f.service.command(actor,reduce(cross.id,{side:'LONG'}))).rejects.toMatchObject({code:'INVALID_REDUCE_SIDE'});
    await expect(f.service.command(actor,reduce(isolated.id,{quantity:'1.5'}))).rejects.toMatchObject({code:'CLOSE_EXCEEDS_POSITION'});
    await expect(f.service.command(actor,reduce('native-does-not-exist'))).rejects.toMatchObject({code:'POSITION_NOT_OPEN'});
    await expect(f.service.command(actor,{kind:'CLOSE',positionId:isolated.id,quantity:'2',idempotencyKey:key()})).rejects.toMatchObject({code:'CLOSE_EXCEEDS_POSITION'});
    expect(asked).toBe(0);
  });
  test('when the resting reduce fills, exactly the named position shrinks and the other bucket is untouched',async()=>{
    const {f,cross,isolated}=await twoBuckets();
    await f.service.command(actor,reduce(isolated.id));
    // The market trades up and the next observed book has 10 on the bid AT 60 000: the SHORT limit at 60 000
    // fills from that book, at its own price, inside the same minute. (A bid of 59 999.9 would fill nothing:
    // nobody is paying the order's price, whatever the last printed.)
    const t0=f.clock.t;f.market.price=t=>t<t0?'50000':'60000';
    f.market.quote={...f.market.quote,mark:'60000',last:'60000',bid:'60000',ask:'60000.1'};
    f.clock.t+=NATIVE_QUOTE_REUSE_MS+1;
    const v=await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(v.positions.map(p=>[p.id,p.marginMode,p.quantity])).toEqual([[cross.id,'CROSS','2']]);
    expect(v.history.map(p=>[p.id,p.status])).toEqual([[isolated.id,'CLOSED']]);
    expect(v.orders.find(o=>o.positionId===isolated.id&&o.reduceOnly)).toMatchObject({status:'FILLED',averagePrice:'60000',marginType:'ISOLATED'});
  });
});

describe('one collateral snapshot: admission, liquidation reference and the response agree',()=>{
  /** Little settle cash, plenty of wallet BTC: the account is backed by the wallet, or it is not backed at all. */
  function poor(){
    const f=setup();
    f.repo.initialize=async function(this:typeof f.repo,_a:OwnerSession,key:string){
      if(this.row)return structuredClone(this.row);const t=f.clock.now();
      this.row={revision:1,deposit:'1000',commands:[],snapshot:emptyDemoState('1000',t),createdAt:t,source:'DEMO_BALANCE'};
      this.revisions.set(1,revisionPayload(this.row));this.keys.set(key,{hash:commandHash({kind:'INITIALIZE'}),row:revisionPayload(this.row)});return structuredClone(this.row);
    } as typeof f.repo.initialize;
    // ETH, not BTC: the position's own quote and the collateral quote are
    // then different symbols, so a test can fail exactly one of them.
    f.repo.wallet=[{asset:'ETH',available:'2',locked:'0'}];
    return f;
  }
  test('an order the settle row cannot cover is admitted on the wallet the response reports, and the journal records that valuation',async()=>{
    const f=poor();await f.service.initialize(actor,'one-snapshot-init');
    const before=await f.service.state(actor);
    // 2 ETH at the fixture mark (50 000 for every symbol) = 100 000 of collateral on top of 1 000 of cash.
    expect(before.account!.walletCollateral).toBe('100000');expect(before.account!.available).toBe('101000');
    const v=await f.service.command(actor,long({margin:'5000',leverage:'20'}));
    expect(v.positions).toHaveLength(1);expect(v.positions[0].quantity).toBe('2');
    const stored=f.repo.row!.commands[0];
    expect(stored.collateral).toEqual({priced:'100000',complete:true,asOf:f.clock.t});
    expect(f.repo.row!.snapshot.collateral).toEqual(stored.collateral);
    // The response account IS the engine account: same available, same verdict.
    expect(v.account!.walletCollateral).toBe('100000');
    expect(new BigNumber(v.account!.equity).minus(v.account!.initialMargin).minus(v.account!.orderReserve).toFixed()).toBe(v.account!.available);
    expect(v.account!.liquidatable).toBe(false);
    // A cross liquidation reference on the SAME pool: 100k behind a 100k position is unreachable.
    expect(v.positions[0].liquidationPrice).toBeNull();
  });
  test('a plain read after the command reports the same account as the command did',async()=>{
    const f=poor();await f.service.initialize(actor,'one-snapshot-init-2');
    const v=await f.service.command(actor,long({margin:'5000',leverage:'20'}));
    const read=await f.service.state(actor);
    expect(read.account).toEqual(v.account);
    expect(read.positions[0].liquidationPrice).toBe(v.positions[0].liquidationPrice);
  });
  test('an adverse move that the settle row alone could not survive is NOT liquidated while the wallet backs it, and IS once the wallet is gone',async()=>{
    const f=poor();await f.service.initialize(actor,'one-snapshot-init-3');
    await f.service.command(actor,long({margin:'5000',leverage:'20'}));
    f.clock.t+=30_000;f.market.quote={...f.market.quote,mark:'45000',last:'45000',bid:'44999.9',ask:'45000.1'};
    let v=await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    // -10 000 on 1 000 of cash: the settle row is deep under water; the account is not.
    expect(v.positions).toHaveLength(1);expect(v.account!.liquidatable).toBe(false);
    expect(new BigNumber(v.account!.equity).gt(0)).toBe(true);
    // The owner moves the ETH out of the wallet: the next command sees an unbacked account and closes it.
    f.repo.wallet=[];f.clock.t+=30_000;
    v=await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(v.positions).toHaveLength(0);expect(v.history[0].status).toBe('LIQUIDATED');
    const observe=f.repo.row!.commands.find(c=>c.kind==='OBSERVE')!;
    expect(observe.collateral).toEqual({priced:'0',complete:true,asOf:null});
  });
  test('an unpriceable wallet asset withholds the verdict instead of liquidating on the floor',async()=>{
    const f=poor();await f.service.initialize(actor,'one-snapshot-init-4');
    await f.service.command(actor,long({margin:'5000',leverage:'20'}));
    // The position's own quote still answers; the collateral asset's does not.
    const answer=f.market.freshQuote.bind(f.market);
    f.market.freshQuote=(async(symbol:string)=>{if(symbol==='ETHUSDT')throw new Error('PROVIDER_DOWN');return answer(symbol);}) as typeof f.market.freshQuote;
    f.clock.t+=30_000;
    f.market.quote={...f.market.quote,mark:'45000',last:'45000',bid:'44999.9',ask:'45000.1'};
    const v=await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(v.account!.collateralComplete).toBe(false);
    expect(v.account!.liquidatable).toBeNull();
    expect(v.positions).toHaveLength(1);
    expect(v.positions[0].liquidationPrice).toBeNull();
  });
});

describe('the live path fetches each quote once and values the rest from a fresh snapshot',()=>{
  function counting(f:ReturnType<typeof setup>){
    const answer=f.market.freshQuote.bind(f.market);const asked:string[]=[];
    f.market.freshQuote=(async(symbol:string)=>{asked.push(symbol);return answer(symbol);}) as typeof f.market.freshQuote;
    return asked;
  }
  test('an OPEN quotes its own contract once (fresh) and reuses quotes younger than the reuse window for the others',async()=>{
    const f=setup();await f.service.initialize(actor,'quote-init');f.repo.wallet=[];
    for(const symbol of ['AAAUSDT','BBBUSDT','CCCUSDT']){await f.service.command(actor,long({symbol,margin:'1000'}));f.clock.t+=100;}
    const asked=counting(f);
    await f.service.command(actor,long({symbol:'AAAUSDT',margin:'1000'}));
    // The executed contract is fetched fresh; the two others were quoted 100-200 ms ago and are reused.
    expect(asked).toEqual(['AAAUSDT']);
    f.clock.t+=NATIVE_QUOTE_REUSE_MS+1;asked.length=0;
    await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect([...asked].sort()).toEqual(['AAAUSDT','BBBUSDT','CCCUSDT']);
    asked.length=0;f.clock.t+=100;
    await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(asked).toEqual([]);
  });
  test('a reused quote is still checked for freshness at use: an old snapshot is refused, not applied',async()=>{
    const f=setup();await f.service.initialize(actor,'quote-init-2');f.repo.wallet=[];
    await f.service.command(actor,long({symbol:'AAAUSDT',margin:'1000'}));
    // Nothing is fetched for a minute; the snapshot is older than the reuse window and a fresh one is taken.
    f.clock.t+=60_000;const asked=counting(f);
    await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()});
    expect(asked).toEqual(['AAAUSDT']);
  });
});

describe('admission caps bound NEW risk and never a risk-reducing command',()=>{
  const symbolAt=(i:number)=>`D${String.fromCharCode(65+(i%26))}${Math.floor(i/26)}USDT`;
  afterEach(()=>{delete process.env.NATIVE_MAX_CONCURRENT_CONTRACTS;delete process.env.NATIVE_COMMAND_LIMIT;});
  test('the default contract cap is 30, and the 31st contract is refused before any market data is read',async()=>{
    expect(nativeAdmissionLimits().contracts).toBe(30);
    const f=setup();await f.service.initialize(actor,'cap-init');f.repo.wallet=[];
    for(let i=0;i<30;i++){await f.service.command(actor,long({symbol:symbolAt(i),margin:'1000'}));f.clock.t+=10;}
    const state=await f.service.state(actor);expect(state.positions).toHaveLength(30);
    const answer=f.market.freshQuote.bind(f.market);let asked=0;
    f.market.freshQuote=(async(symbol:string)=>{asked+=1;return answer(symbol);}) as typeof f.market.freshQuote;
    await expect(f.service.command(actor,long({symbol:symbolAt(30),margin:'1000'}))).rejects.toMatchObject({code:'CONTRACT_LIMIT'});
    expect(asked).toBe(0);
    // Adding to a contract already held, reducing, closing and refreshing are all still admitted.
    f.clock.t+=NATIVE_QUOTE_REUSE_MS+1;
    const added=await f.service.command(actor,long({symbol:symbolAt(0),margin:'1000'}));expect(added.positions).toHaveLength(30);
    const id=added.positions.find(p=>p.symbol===symbolAt(1))!.id;f.clock.t+=10;
    const reduced=await f.service.command(actor,{kind:'OPEN',symbol:symbolAt(1),side:'SHORT',type:'LIMIT',price:'70000',quantity:'0.001',leverage:'20',reduceOnly:true,positionId:id,idempotencyKey:key()});
    expect(reduced.orders.some(o=>o.reduceOnly&&o.status==='OPEN')).toBe(true);f.clock.t+=10;
    const closed=await f.service.command(actor,{kind:'CLOSE',positionId:id,idempotencyKey:key()});expect(closed.positions).toHaveLength(29);
  });
  test('the journal limit refuses only a NEW opening order; closing stays available on a full journal',async()=>{
    process.env.NATIVE_COMMAND_LIMIT='12';expect(nativeAdmissionLimits().commands).toBe(12);
    const f=setup();await f.service.initialize(actor,'journal-init');f.repo.wallet=[];
    let v=await f.service.command(actor,long({margin:'1000'}));
    for(let i=1;i<12;i++){f.clock.t+=10;v=await f.service.command(actor,long({margin:'1000'}));}
    expect(f.repo.row!.commands.length).toBeGreaterThanOrEqual(12);
    f.clock.t+=10;
    await expect(f.service.command(actor,long({margin:'1000'}))).rejects.toMatchObject({code:'COMMAND_LIMIT'});
    const id=v.positions[0].id;f.clock.t+=10;
    const closed=await f.service.command(actor,{kind:'CLOSE',positionId:id,idempotencyKey:key()});
    expect(closed.positions).toHaveLength(0);expect(closed.history[0].status).toBe('CLOSED');
    f.clock.t+=10;
    await expect(f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()})).resolves.toBeTruthy();
  });
  test('the caps can be tuned from the environment within bounds',()=>{
    process.env.NATIVE_MAX_CONCURRENT_CONTRACTS='12';process.env.NATIVE_COMMAND_LIMIT='999999';
    expect(nativeAdmissionLimits()).toEqual({contracts:12,commands:5000});
    process.env.NATIVE_MAX_CONCURRENT_CONTRACTS='0';
    expect(nativeAdmissionLimits().contracts).toBe(30);
  });
});

describe('two server instances on one account: the revision CAS decides, the loser decides again, nothing is duplicated or lost',()=>{
  /** Two services (two replicas: separate lanes) on ONE repository; both commits are held until both have arrived. */
  function pair(){
    const f=setup();
    const other=new NativeDemoService(f.repo,f.market as unknown as PrivateTradingMarketData,f.clock.now);
    const calls={commit:0};
    /** From now on the next two commits are held until both have arrived, so both attempts read the SAME revision. */
    const arm=()=>{
      let waiting=0,release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
      const commit=f.repo.commit.bind(f.repo);
      f.repo.commit=async(...args:Parameters<MemoryRepository['commit']>)=>{calls.commit+=1;if(++waiting===2)release();await gate;return commit(...args);};
    };
    return{...f,other,calls,arm};
  }
  test('two OPENs on different contracts from two instances: both commit, in order, and the first is not lost',async()=>{
    const f=pair();await f.service.initialize(actor,key());f.arm();
    const [a,b]=await Promise.all([f.service.command(actor,long()),f.other.command(actor,long({symbol:'ETHUSDT'}))]);
    expect(f.calls.commit).toBe(3);                                   // one CAS refusal, one retry
    expect(f.service.conflicts+f.other.conflicts).toBe(1);
    expect([a.revision,b.revision].sort()).toEqual([2,3]);
    const last=a.revision>b.revision?a:b;
    expect(last.positions.map(p=>p.symbol).sort()).toEqual(['BTCUSDT','ETHUSDT']);
    expect(last.events.filter(e=>e.kind==='OPEN')).toHaveLength(2);
    expect(f.repo.row!.commands.filter(c=>c.kind==='OPEN').map(c=>c.seq)).toEqual([1,2]);
  });
  test('the same order from two instances MERGES on the retry: one position, two fills, two fees, never a duplicate',async()=>{
    const f=pair();await f.service.initialize(actor,key());f.arm();
    const [a,b]=await Promise.all([f.service.command(actor,long()),f.other.command(actor,long())]);
    const last=a.revision>b.revision?a:b;
    expect(last.positions).toHaveLength(1);
    expect(last.positions[0].quantity).toBe('4');                     // 2 + 2, decided on the winner's row
    expect(last.events.filter(e=>e.kind==='OPEN')).toHaveLength(2);
    expect(new Set(last.events.filter(e=>e.kind==='OPEN').map(e=>e.actionId)).size).toBe(2);
    expect(f.repo.row!.revision).toBe(3);
  });
  test('a CLOSE whose position the other instance already closed is REFUSED on the retry, never filled twice',async()=>{
    const f=pair();await f.service.initialize(actor,key());
    const opened=await f.service.command(actor,long());const id=opened.positions[0].id;
    f.clock.t+=NATIVE_QUOTE_REUSE_MS+1;f.arm();
    const results=await Promise.allSettled([f.service.command(actor,{kind:'CLOSE',positionId:id,idempotencyKey:key()}),f.other.command(actor,{kind:'CLOSE',positionId:id,idempotencyKey:key()})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'POSITION_NOT_OPEN'}});
    const state=await f.service.state(actor);
    expect(state.events.filter(e=>e.kind==='CLOSE')).toHaveLength(1);
    expect(state.history.find(p=>p.id===id)?.status).toBe('CLOSED');
  });
  test('the same idempotency key on two instances answers with ONE receipt and no conflict at all',async()=>{
    const f=pair();await f.service.initialize(actor,key());f.arm();
    const request=long();
    const [a,b]=await Promise.all([f.service.command(actor,request),f.other.command(actor,request)]);
    expect(a.revision).toBe(b.revision);
    expect(a.positions).toEqual(b.positions);
    expect(f.service.conflicts+f.other.conflicts).toBe(0);
    expect(f.repo.row!.revision).toBe(2);
  });
  test('the retry is bounded: a row that keeps changing under the command is reported after the last attempt, with nothing persisted',async()=>{
    const f=setup();await f.service.initialize(actor,key());
    let attempts=0;
    f.repo.commit=async()=>{attempts+=1;throw new PrivateTradingError('account_changed','changed',409);};
    await expect(f.service.command(actor,long())).rejects.toMatchObject({code:'account_changed',status:409});
    expect(attempts).toBe(NATIVE_COMMIT_ATTEMPTS);
    expect(f.service.conflicts).toBe(NATIVE_COMMIT_ATTEMPTS-1);
    expect(f.repo.row!.revision).toBe(1);
    expect(f.repo.row!.snapshot.positions).toHaveLength(0);
  });
  test('an idempotency conflict or any other refusal is never retried',async()=>{
    const f=setup();await f.service.initialize(actor,key());
    let attempts=0;
    f.repo.commit=async()=>{attempts+=1;throw new PrivateTradingError('idempotency_conflict','conflict',409);};
    await expect(f.service.command(actor,long())).rejects.toMatchObject({code:'idempotency_conflict'});
    expect(attempts).toBe(1);
  });
});
