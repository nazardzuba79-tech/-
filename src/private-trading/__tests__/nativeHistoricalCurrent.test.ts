import BigNumber from 'bignumber.js';
import { actor, setup, key, H, H0, M, outcome } from '../native/testing/liveFixture';
import { NativeCommand, NativeDemoService } from '../native/service';
import { demoPositionView } from '../native/engine';
import { assertHistoricalDemoCurrentPrice, assertPrivateFreshQuote, PrivateTradingMarketData } from '../marketData';

const selectedAt=H0-24*H;
const candle={source:'BYBIT_LINEAR' as const,interval:'1h' as const,openTime:selectedAt,pricePoint:'OPEN' as const};
async function fixture(entry='60000',current='81000',deposit='100000'){
  const f=setup({price:current,deposit});
  const market=Object.create(f.market) as PrivateTradingMarketData & Omit<typeof f.market,'resolveCandle'>;
  market.historicalDemoPrices=f.market.marks.bind(f.market);
  market.resolveCandle=async s=>({symbol:s.symbol,source:'BYBIT_LINEAR',interval:s.interval,intervalMs:H,openTime:s.openTime,closeTime:s.openTime+H,
    effectiveAt:s.openTime,price:entry,pricePoint:s.pricePoint,candle:{timestamp:s.openTime,open:entry,close:entry,high:entry,low:entry,volume:'10'},fetchedAt:f.clock.now(),verification:'VERIFIED'});
  const service=new NativeDemoService(f.repo,market,f.clock.now);
  await service.initialize(actor,key());
  const command=(c:Omit<NativeCommand,'idempotencyKey'>)=>service.command(actor,{...c,idempotencyKey:key()} as NativeCommand);
  const open=(extra:object={})=>command({kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'0.001',leverage:'10',marginType:'CROSS',executionMode:'HISTORICAL_DEMO',candle,...extra} as NativeCommand);
  const refresh=()=>command({kind:'REFRESH'});
  return {...f,source:f.market,market,service,command,open,refresh};
}

describe('historical entry with current server valuation and exit',()=>{
  test.each(['LONG','SHORT'] as const)('%s: immutable historical entry, new mark, reload, current exit, exact ledger',async side=>{
    const f=await fixture(side==='LONG'?'60000':'82000');
    await f.open({side});
    let s=f.repo.row!.snapshot,p=s.positions[0];
    const entry=p.entryPrice,q=p.quantity,feeRate=s.instruments.BTCUSDT.profile.takerFeeRate;
    expect(entry).toBe(side==='LONG'?'60000':'82000');expect(p.entryTimestamp).toBe(selectedAt);
    expect(p.openedAt).toBe(f.clock.now());expect(p.markPrice).toBe('81000');
    expect(demoPositionView(s,p).unrealizedPnl).toBe(new BigNumber('81000').minus(entry).times(q).times(side==='LONG'?1:-1).toFixed());
    expect(p.openingFees).toBe(new BigNumber(entry).times(q).times(feeRate).toFixed());
    f.clock.t+=M;f.market.price='81500';await f.refresh();
    const restarted=new NativeDemoService(f.repo,f.market,f.clock.now);
    const read=await restarted.state(actor);
    expect(read.positions[0].entryPrice).toBe(entry);expect(read.positions[0].openedAt).toBe(selectedAt);
    expect(read.positions[0].markPrice).toBe('81500');
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.repo.row!.snapshot));
    expect(outcome(await f.replay('CHECKPOINT'))).toEqual(outcome(f.repo.row!.snapshot));
    f.clock.t+=1000;f.market.price='81600';
    await f.command({kind:'CLOSE',positionId:p.id,candle} as NativeCommand);
    s=f.repo.row!.snapshot;p=s.positions[0];
    const exit=s.events.find(e=>e.kind==='CLOSE')!;
    expect(exit.price).toBe('81600');expect(exit.pricing).toBe('NEAR_LIVE_DEMO');
    const gross=new BigNumber(exit.price!).minus(entry).times(q).times(side==='LONG'?1:-1);
    const fees=new BigNumber(entry).plus(exit.price!).times(q).times(feeRate);
    expect(p.realizedGross).toBe(gross.toFixed());
    expect(s.walletBalance).toBe(new BigNumber(s.initialDeposit).plus(gross).minus(fees).toFixed());
    expect(s.positions.filter(p=>p.status==='OPEN')).toHaveLength(0);
    expect(s.orders.filter(o=>['OPEN','PARTIALLY_FILLED'].includes(o.status))).toHaveLength(0);
    expect(f.market.calls.quote).toBe(0);
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(s));
  });

  test('8 second transaction delay accepts a 45 second current quote; historical entry never wall-clock expires',async()=>{
    const f=await fixture();
    const marks=f.market.historicalDemoPrices.bind(f.market);
    f.market.historicalDemoPrices=async symbols=>new Map([...(await marks(symbols))].map(([s,q])=>[s,{...q,markProviderTimestamp:q.markProviderTimestamp-45000}]));
    const commit=f.repo.commit.bind(f.repo);
    (f.repo as any).commit=async(...args:any[])=>{f.clock.t+=8000;args[5]();return (commit as any)(...args);};
    await f.open();expect(f.repo.row!.snapshot.positions[0].status).toBe('OPEN');
  });

  test('price expires during transaction: no account write, order, fill, balance change',async()=>{
    const f=await fixture();const before=structuredClone(f.repo.row);
    const commit=f.repo.commit.bind(f.repo);
    (f.repo as any).commit=async(...args:any[])=>{f.clock.t+=60001;args[5]();return (commit as any)(...args);};
    await expect(f.open()).rejects.toMatchObject({code:'near_live_price_stale'});
    expect(f.repo.row).toEqual(before);expect(f.repo.commits).toBe(0);
  });

  test('partial close and target reduce-only LIMIT leave another historical lot unchanged',async()=>{
    const f=await fixture();await f.open({quantity:'0.003'});await f.open({quantity:'0.002'});
    const [a,b]=f.repo.row!.snapshot.positions;
    await f.command({kind:'CLOSE',positionId:a.id,quantity:'0.001'} as NativeCommand);
    expect(f.repo.row!.snapshot.positions[0].quantity).toBe('0.002');
    await f.open({side:'SHORT',type:'LIMIT',quantity:'0.002',price:'82000',reduceOnly:true,positionId:a.id,candle:undefined});
    expect(f.repo.row!.snapshot.orders.at(-1)!.status).toBe('OPEN');
    f.market.price='82500';await f.refresh();
    expect(f.repo.row!.snapshot.positions[0].status).toBe('CLOSED');
    expect(f.repo.row!.snapshot.positions[1].quantity).toBe(b.quantity);
    expect(f.repo.row!.snapshot.events.filter(e=>e.kind==='CLOSE').at(-1)!.price).toBe('82500');
  });

  test('LIMIT waits for current observed price, cancellation persists, Isolated uses the same engine',async()=>{
    const f=await fixture();await f.open({type:'LIMIT',price:'59000',candle:undefined,marginType:'ISOLATED'});
    const id=f.repo.row!.snapshot.orders[0].id;
    await f.command({kind:'CANCEL',orderId:id} as NativeCommand);
    expect(f.repo.row!.snapshot.orders[0].status).toBe('CANCELLED');
    await f.open({type:'LIMIT',price:'80000',candle:undefined,marginType:'ISOLATED'});
    expect(f.repo.row!.snapshot.positions).toHaveLength(0);
    f.market.price='79900';await f.refresh();
    const p=f.repo.row!.snapshot.positions[0];
    expect(p.entryPrice).toBe('79900');expect(p.isolatedMargin).toBe(new BigNumber(p.entryPrice).times(p.quantity).div(p.leverage).toFixed());
    await f.command({kind:'CLOSE',positionId:p.id} as NativeCommand);
    expect(f.repo.row!.snapshot.positions[0].status).toBe('CLOSED');
  });

  test.each([['TAKE_PROFIT',{takeProfit:'82000'},'83000'],['STOP_LOSS',{stopLoss:'80000'},'79000']] as const)('%s triggers and settles on the actual current observation',async(kind,protection,price)=>{
    const f=await fixture();await f.open({protection});f.market.price=price;await f.refresh();
    expect(f.repo.row!.snapshot.events.find(e=>e.kind===kind)?.price).toBe(price);
    expect(f.repo.row!.snapshot.positions[0].status).toBe('CLOSED');
  });

  test('duplicate idempotency key returns the saved fill, insufficient funds never persists an order',async()=>{
    const f=await fixture();const c:NativeCommand={kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'0.001',leverage:'10',candle,executionMode:'HISTORICAL_DEMO',idempotencyKey:key()};
    await f.service.command(actor,c);const before=structuredClone(f.repo.row);
    await f.service.command(actor,c);expect(f.repo.row).toEqual(before);
    const poor=await fixture('60000','60000','1');
    await expect(poor.open()).rejects.toHaveProperty('code');expect(poor.repo.commits).toBe(0);
  });

  test('near-live contract is bounded, invalid identity rejected, LIVE keeps 5 second guard',async()=>{
    const f=await fixture();const q=(await f.market.historicalDemoPrices(['BTCUSDT'])).get('BTCUSDT')!;
    expect(()=>assertHistoricalDemoCurrentPrice(q,'BTCUSDT',f.clock.t+60000)).not.toThrow();
    expect(()=>assertHistoricalDemoCurrentPrice(q,'BTCUSDT',f.clock.t+60001)).toThrow();
    expect(()=>assertHistoricalDemoCurrentPrice(q,'ETHUSDT',f.clock.t)).toThrow();
    expect(()=>assertPrivateFreshQuote(f.market.quoteNow('BTCUSDT'),'BTCUSDT',f.clock.t+6000)).toThrow();
  });
  test('unquoted collateral is unknown, known collateral follows current prices and OFF/ON survives reload',async()=>{
    const f=await fixture();f.repo.wallet=[{asset:'BTC',available:'1',locked:'0'},{asset:'EUR',available:'5',locked:'0'}];f.source.frame=['BTCUSDT'];
    await f.open();let v=await f.service.collateral(actor);
    expect(v.complete).toBe(false);expect(v.lines.find(l=>l.asset==='EUR')!.value).toBeNull();
    expect(v.collateralPriced).toBe('81000');
    await f.service.setCollateralPreference(actor,'BTC',false,key());
    v=await f.service.collateral(actor);expect(v.collateralPriced).toBe('0');expect(v.lines.find(l=>l.asset==='BTC')!.value).toBe('81000');
    await f.service.setCollateralPreference(actor,'BTC',true,key());
    f.market.price='81500';await f.refresh();
    v=await new NativeDemoService(f.repo,f.market,f.clock.now).collateral(actor);expect(v.collateralPriced).toBe('81500');
    expect(f.repo.wallet[0].available).toBe('1');
  });
  test('historical candles cannot trigger a post-entry order or TP, including funding boundaries',async()=>{
    const f=await fixture();await f.open({protection:{takeProfit:'82000'}});
    await f.open({type:'LIMIT',price:'79000',candle:undefined});
    // Deliberately contradictory history: only explicit current observations may settle this mode.
    const history=f.market.history.bind(f.market);
    (f.market as PrivateTradingMarketData).history=async r=>{const h=await history(r);return {...h,tradeCandles:h.tradeCandles.map(c=>({...c,high:'90000',low:'10000'}))};};
    f.clock.t=H0+8*H+2*M;await f.refresh();
    expect(f.repo.row!.snapshot.positions[0].status).toBe('OPEN');expect(f.repo.row!.snapshot.orders.at(-1)!.status).toBe('OPEN');
    expect(f.repo.row!.snapshot.positions[0].markPrice).toBe('81000');
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.repo.row!.snapshot));
  });
});
