import BigNumber from 'bignumber.js';
import { actor, setup, key, H, H0, M, outcome } from '../native/testing/liveFixture';
import { NativeCommand, NativeDemoService, NATIVE_OBSERVE_COMPACT_MIN, NATIVE_OBSERVE_COMPACT_RETRY_MS, supersededObservations } from '../native/service';
import { demoPositionView } from '../native/engine';
import { assertHistoricalDemoCurrentPrice, assertPrivateFreshQuote, PrivateMarketDataError, PrivateTradingMarketData } from '../marketData';
import { deriveNativeLiveProjection, projectionDigest, verifiedProjection } from '../native/liveProjection';

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
  test('59,592ms collateral is refreshed before valuation; 6,626ms persistence retains exact entry and fresh collateral',async()=>{
    const f=await fixture();f.repo.wallet=[{asset:'USDC',available:'100',locked:'0'}];
    const request=jest.fn(async()=>new Response(JSON.stringify({status:'live',fetchedAt:f.clock.now(),marks:
      [...(await f.source.marks(['BTCUSDT','USDCUSDT']))].map(([s,q])=>({...q,
        ...(s==='USDCUSDT'?{markPrice:'0.98',lastPrice:'0.98',markProviderTimestamp:f.clock.now()-59592}:{} )}))})));
    const feed=new PrivateTradingMarketData({collector:{url:'http://127.0.0.1',token:'fixture'},now:f.clock.now,request});
    const refresh=jest.spyOn(feed,'freshQuote').mockImplementation(async s=>({...f.source.quoteNow(s),markPrice:'0.999',lastPrice:'0.999'}));
    f.market.historicalDemoPrices=feed.historicalDemoPrices.bind(feed);
    // Read-only valuation retains the unchanged 60s policy.
    expect((await feed.historicalDemoPrices(['USDCUSDT','BTCUSDT'])).get('USDCUSDT')!.markPrice).toBe('0.98');
    expect(refresh).not.toHaveBeenCalled();
    const commit=f.repo.commit.bind(f.repo);
    (f.repo as any).commit=async(...args:any[])=>{args[5]();f.clock.t+=3563;args[5]();f.clock.t+=3063;args[5]();return (commit as any)(...args);};
    await f.open();
    expect(refresh).toHaveBeenCalledTimes(1);expect(refresh.mock.calls[0][0]).toBe('USDCUSDT');
    const row=f.repo.row!,p=row.snapshot.positions[0],open=row.commands.find(c=>c.kind==='OPEN')!;
    expect(p.entryPrice).toBe('60000');expect(p.markPrice).toBe('81000');
    expect(open.context!.marks.USDCUSDT.mark).toBe('0.999');
    expect(open.context!.observedAt!.USDCUSDT).toBe(f.clock.now()-6626);
    expect(f.repo.commits).toBe(1);
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(row.snapshot));
  });
  test('source ignoring headroom fails before a write, without retry or balance change',async()=>{
    const f=await fixture(),before=structuredClone(f.repo.row),marks=f.market.historicalDemoPrices.bind(f.market);
    f.market.historicalDemoPrices=jest.fn(async symbols=>new Map([...(await marks(symbols))].map(([s,q])=>[s,{...q,receivedAt:f.clock.now()-59592}])));
    await expect(f.open()).rejects.toMatchObject({code:'near_live_price_stale'});
    expect(f.repo.row).toEqual(before);expect(f.repo.commits).toBe(0);expect(f.market.historicalDemoPrices).toHaveBeenCalledTimes(1);
  });
  test('compact reload preserves historical mode and 60s current valuation without financial writes or history',async()=>{
    const f=await fixture();await f.open();const before=structuredClone(f.repo.row);
    Object.assign(f.repo,{live:async()=>deriveNativeLiveProjection(f.repo.row!)});
    const marks=f.market.historicalDemoPrices.bind(f.market);
    f.market.historicalDemoPrices=async symbols=>new Map([...(await marks(symbols))].map(([s,q])=>[s,{...q,markPrice:'81500',markProviderTimestamp:f.clock.now()-8000}]));
    const v=await new NativeDemoService(f.repo,f.market,f.clock.now).live(actor);
    expect(v.executionMode).toBe('HISTORICAL_DEMO');expect(v.revision).toBe(before!.revision);
    expect(v.positions[0].entryPrice).toBe('60000');expect(v.positions[0].markPrice).toBe('81500');
    expect(f.repo.row).toEqual(before);expect(v.history).toEqual([]);
    const p=deriveNativeLiveProjection(f.repo.row!),{executionMode,...old}=p;
    expect(verifiedProjection(old,projectionDigest(old),p.revision)).toBeNull();
  });
  test.each(['LONG','SHORT'] as const)('%s: immutable historical entry, new mark, reload, current exit, exact ledger',async side=>{
    const f=await fixture(side==='LONG'?'60000':'82000');
    await f.open({side});
    let s=f.repo.row!.snapshot,p=s.positions[0];
    const entry=p.entryPrice,q=p.quantity,feeRate=s.instruments.BTCUSDT.profile.takerFeeRate;
    expect(entry).toBe(side==='LONG'?'60000':'82000');expect(p.entryTimestamp).toBe(selectedAt);
    expect(p.openedAt).toBe(f.clock.now());expect(p.markPrice).toBe('81000');
    expect(demoPositionView(s,p).unrealizedPnl).toBe(new BigNumber('81000').minus(entry).times(q).times(side==='LONG'?1:-1).toFixed());
    expect(p.openingFees).toBe(new BigNumber(entry).times(q).times(feeRate).toFixed());
    // A mark-only REFRESH is journaled once the stored observation is 15 minutes old.
    f.clock.t+=15*M;f.market.price='81500';await f.refresh();
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

  describe('a reduce-only LIMIT is accepted without a current price and fills on the next fresh one',()=>{
    const outage=(f:Awaited<ReturnType<typeof fixture>>,how:'down'|'stale')=>{
      const marks=f.market.historicalDemoPrices.bind(f.market),instrument=f.market.instrument.bind(f.market);
      if(how==='down'){
        f.market.historicalDemoPrices=jest.fn(async()=>{throw new PrivateMarketDataError('collector_unavailable');});
        f.market.instrument=jest.fn(async()=>{throw new TypeError('fetch failed');});
      }else f.market.historicalDemoPrices=jest.fn(async symbols=>new Map([...(await marks(symbols))].map(([s,q])=>[s,{...q,markProviderTimestamp:f.clock.now()-59000}])));
      return()=>{f.market.historicalDemoPrices=marks;f.market.instrument=instrument;};
    };
    test.each(['down','stale'] as const)('collector %s: the close rests at once, marketable or not, and fills at the next observation',async how=>{
      const f=await fixture();await f.open({quantity:'0.002'});
      const p=f.repo.row!.snapshot.positions[0],marksBefore=structuredClone(f.repo.row!.snapshot.marks),wallet=f.repo.row!.snapshot.walletBalance;
      const restore=outage(f,how);
      // 80000 is BELOW the last observed 81000: a sell limit that would have filled at once.
      await f.open({side:'SHORT',type:'LIMIT',quantity:'0.002',price:'80000',reduceOnly:true,positionId:p.id,candle:undefined});
      let s=f.repo.row!.snapshot;
      expect(s.orders.at(-1)).toMatchObject({type:'LIMIT',price:'80000',reduceOnly:true,positionId:p.id,status:'OPEN',filled:'0'});
      expect(s.positions[0]).toMatchObject({status:'OPEN',quantity:'0.002'});
      // Nothing was valued, re-marked or settled at an old price.
      expect(s.marks).toEqual(marksBefore);expect(s.walletBalance).toBe(wallet);
      expect(f.repo.row!.commands.at(-1)).toMatchObject({kind:'OPEN',mark:'',last:''});
      // Still no price: the order waits, the account is not touched.
      f.clock.t+=10_000;await expect(f.refresh()).rejects.toBeTruthy();
      expect(f.repo.row!.snapshot.orders.at(-1)!.status).toBe('OPEN');
      // The price comes back: the next observation fills it at that observation's price.
      restore();f.clock.t+=10_000;f.market.price='80500';await f.refresh();
      s=f.repo.row!.snapshot;
      expect(s.orders.at(-1)!.status).toBe('FILLED');expect(s.positions[0].status).toBe('CLOSED');
      expect(s.events.filter(e=>e.kind==='CLOSE').at(-1)).toMatchObject({price:'80500',pricing:'NEAR_LIVE_DEMO'});
      expect(outcome(await f.replay('FULL'))).toEqual(outcome(s));
      expect(outcome(await f.replay('CHECKPOINT'))).toEqual(outcome(s));
    });
    test('a close above the market rests through the outage and fills only when the price reaches it',async()=>{
      const f=await fixture();await f.open();const p=f.repo.row!.snapshot.positions[0];
      const restore=outage(f,'down');
      await f.open({side:'SHORT',type:'LIMIT',quantity:'0.001',price:'82000',reduceOnly:true,positionId:p.id,candle:undefined});
      restore();f.clock.t+=5000;f.market.price='81500';await f.refresh();
      expect(f.repo.row!.snapshot.orders.at(-1)!.status).toBe('OPEN');
      f.clock.t+=5000;f.market.price='82100';await f.refresh();
      expect(f.repo.row!.snapshot.positions[0].status).toBe('CLOSED');
      expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.repo.row!.snapshot));
    });
    test('the same key after the outage answers with the saved order; a CANCEL also needs no price',async()=>{
      const f=await fixture();await f.open();const p=f.repo.row!.snapshot.positions[0];
      outage(f,'down');
      const c={kind:'OPEN',symbol:'BTCUSDT',side:'SHORT',type:'LIMIT',quantity:'0.001',price:'90000',leverage:'10',marginType:'CROSS',
        reduceOnly:true,positionId:p.id,executionMode:'HISTORICAL_DEMO',idempotencyKey:key()} as NativeCommand;
      await f.service.command(actor,c);const saved=structuredClone(f.repo.row);
      await f.service.command(actor,c);expect(f.repo.row).toEqual(saved);
      await f.command({kind:'CANCEL',orderId:f.repo.row!.snapshot.orders.at(-1)!.id} as NativeCommand);
      expect(f.repo.row!.snapshot.orders.at(-1)!.status).toBe('CANCELLED');
      expect(f.repo.row!.snapshot.positions[0].status).toBe('OPEN');
    });
    test('anything that adds or prices risk is still refused without a current price',async()=>{
      const f=await fixture();await f.open();const p=f.repo.row!.snapshot.positions[0];
      outage(f,'stale');const before=structuredClone(f.repo.row);
      await expect(f.open()).rejects.toMatchObject({code:'near_live_price_stale'});
      await expect(f.open({type:'LIMIT',price:'70000',candle:undefined})).rejects.toMatchObject({code:'near_live_price_stale'});
      await expect(f.command({kind:'CLOSE',positionId:p.id} as NativeCommand)).rejects.toMatchObject({code:'near_live_price_stale'});
      await expect(f.open({side:'SHORT',type:'MARKET',quantity:'0.001',reduceOnly:true,positionId:p.id,candle:undefined})).rejects.toMatchObject({code:'near_live_price_stale'});
      expect(f.repo.row).toEqual(before);
    });
    test('a reduce order that does not fit its position is refused as before, not rested',async()=>{
      const f=await fixture();await f.open();const p=f.repo.row!.snapshot.positions[0];
      outage(f,'down');const before=structuredClone(f.repo.row);
      await expect(f.open({side:'SHORT',type:'LIMIT',quantity:'0.005',price:'82000',reduceOnly:true,positionId:p.id,candle:undefined}))
        .rejects.toMatchObject({code:'CLOSE_EXCEEDS_POSITION'});
      await expect(f.open({side:'LONG',type:'LIMIT',quantity:'0.001',price:'82000',reduceOnly:true,positionId:p.id,candle:undefined}))
        .rejects.toMatchObject({code:'INVALID_REDUCE_SIDE'});
      expect(f.repo.row).toEqual(before);
    });
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

describe('an open historical account does not grow its journal with every price',()=>{
  test('a mark-only REFRESH is answered, not journaled; a fill is journaled at once; one observation per 15 minutes',async()=>{
    const f=await fixture();await f.open();
    const p=f.repo.row!.snapshot.positions[0];
    await f.open({side:'SHORT',type:'LIMIT',quantity:'0.001',price:'82000',reduceOnly:true,positionId:p.id,candle:undefined});
    const commits=f.repo.commits,length=f.repo.row!.commands.length,revision=f.repo.row!.revision;
    for(let i=0;i<30;i++){f.clock.t+=10_000;f.market.price=String(81000+i);const v=await f.refresh();expect(v.positions[0].markPrice).toBe(String(81000+i));}
    // Five minutes of 10 s limit passes: no write, no journal growth, no new revision.
    expect(f.repo.commits).toBe(commits);expect(f.repo.row!.commands).toHaveLength(length);expect(f.repo.row!.revision).toBe(revision);
    // The price reaches the resting close: journaled on that very pass.
    f.clock.t+=10_000;f.market.price='82100';await f.refresh();
    expect(f.repo.commits).toBe(commits+1);expect(f.repo.row!.snapshot.positions[0].status).toBe('CLOSED');
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.repo.row!.snapshot));
  });
  test('a stored observation 15 minutes old is refreshed in the journal',async()=>{
    const f=await fixture();await f.open();const commits=f.repo.commits;
    f.clock.t+=14*M;await f.refresh();expect(f.repo.commits).toBe(commits);
    f.clock.t+=M;f.market.price='81200';await f.refresh();expect(f.repo.commits).toBe(commits+1);
    expect(f.repo.row!.snapshot.positions[0].markPrice).toBe('81200');
  });
  test('a journal bloated by the old rule is compacted on the next command, to the identical account',async()=>{
    const f=await fixture();await f.open({quantity:'0.002'});
    const p=f.repo.row!.snapshot.positions[0];
    await f.open({side:'SHORT',type:'LIMIT',quantity:'0.001',price:'82000',reduceOnly:true,positionId:p.id,candle:undefined});
    // The old rule: every 10 s pass journaled (forced here with `persist`), with no compaction yet.
    const off=jest.spyOn(NativeDemoService.prototype as any,'compactHistoricalObservations').mockImplementation(async(row:any)=>row);
    const pass=async(price:string)=>{f.clock.t+=10_000;f.market.price=price;await f.service.command(actor,{kind:'REFRESH',idempotencyKey:key()},{persist:true});};
    for(let i=0;i<150;i++)await pass(String(81000+(i%7)));
    await pass('82050');// fills half the position: an event inside the bloat
    for(let i=0;i<150;i++)await pass(String(81500+(i%5)));
    off.mockRestore();
    const bloated=f.repo.row!,before=structuredClone(bloated.snapshot);
    expect(bloated.commands.length).toBeGreaterThan(300);
    const drop=supersededObservations(bloated);
    expect(drop.size).toBeGreaterThanOrEqual(NATIVE_OBSERVE_COMPACT_MIN);
    // The observation that filled the order is never a candidate.
    const fill=before.events.find(e=>e.kind==='CLOSE')!;
    expect(bloated.commands.filter(c=>c.kind==='OBSERVE'&&c.at===fill.time).every(c=>!drop.has(c.id))).toBe(true);
    // A transient history transport failure must not blacklist this unchanged revision forever.
    const commitsBeforeCompaction=f.repo.commits,revisionBeforeCompaction=f.repo.row!.revision;
    const history=jest.spyOn(f.market,'history').mockRejectedValueOnce(new TypeError('fetch failed'));
    f.clock.t+=10_000;f.market.price='81501';await f.refresh();
    expect(f.repo.commits).toBe(commitsBeforeCompaction);
    expect(f.repo.row!.revision).toBe(revisionBeforeCompaction);
    expect(f.repo.row!.commands.length).toBeGreaterThan(300);
    history.mockRestore();
    // Same revision, after the transient cooldown: verification retries and the ordinary REFRESH persists it.
    f.clock.t+=NATIVE_OBSERVE_COMPACT_RETRY_MS+1;f.market.price='81502';await f.refresh();
    const row=f.repo.row!;
    expect(f.repo.commits).toBe(commitsBeforeCompaction+1);
    expect(row.commands.length).toBeLessThan(20);
    expect(row.snapshot.events.slice(0,before.events.length)).toEqual(before.events);
    expect(row.snapshot.positions[0]).toMatchObject({status:'OPEN',quantity:before.positions[0].quantity,realizedGross:before.positions[0].realizedGross});
    expect(row.snapshot.walletBalance).toBe(before.walletBalance);
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(row.snapshot));
    expect(outcome(await f.replay('CHECKPOINT'))).toEqual(outcome(row.snapshot));
  });
});
