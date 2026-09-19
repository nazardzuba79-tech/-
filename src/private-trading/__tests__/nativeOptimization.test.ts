import { setup, actor, key, outcome, M, H, H0 } from '../native/testing/liveFixture';
import { NativeDemoService } from '../native/service';
import { NativeHistoryCache, nativeHistoryCache, NATIVE_HISTORY_CACHE_BARS, NATIVE_HISTORY_CACHE_TTL } from '../native/historyCache';
import { compact, inflate, PrismaNativeRepository } from '../native/store';
import { liveCheckpoint, replayNativeDemoAsync } from '../native/replay';
import { NativeLimitPass } from '../native/limitPass';
import type { PrivateTradingMarketData } from '../marketData';
const open=(f:ReturnType<typeof setup>,extra:object={})=>f.service.command(actor,{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10',idempotencyKey:key(),...extra});

describe('issue 146 bounded command work',()=>{
  test('live commands and minute refresh use no history; full replay retains every financial outcome',async()=>{
    const f=setup();await f.service.initialize(actor,key());await open(f);
    for(let i=0;i<4;i++){f.clock.t+=M;await open(f,{quantity:'0.1'});await f.refresh();}
    expect(f.market.calls.history).toBe(0);
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.repo.row!.snapshot));
    expect(outcome(await f.replay('CHECKPOINT'))).toEqual(outcome(f.repo.row!.snapshot));
    expect(f.repo.row!.checkpoint?.commandCount).toBe(f.repo.row!.commands.length);
  });
  test('funding still uses observed boundary open; full, sealed and legacy checkpoints agree',async()=>{
    const f=setup({at:H0+8*H-M});await f.service.initialize(actor,key());await open(f);
    f.market.priceAt=t=>t>=H0+8*H?'51000':'50000';
    f.clock.t=H0+8*H+2*M;await f.refresh();
    expect(f.repo.row!.snapshot.events.filter(e=>e.kind==='FUNDING')).toHaveLength(1);
    expect(f.market.calls.history).toBe(1);
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.repo.row!.snapshot));
    expect(outcome(await f.replay('CHECKPOINT'))).toEqual(outcome(f.repo.row!.snapshot));
    const row=f.repo.row!;
    const legacy=await replayNativeDemoAsync({deposit:row.deposit,instructions:row.commands,asOf:f.clock.t},f.bars);
    expect(outcome((await replayNativeDemoAsync({deposit:row.deposit,instructions:row.commands,asOf:f.clock.t,checkpoint:legacy.checkpoint},f.bars)).snapshot)).toEqual(outcome(row.snapshot));
  });
  test('same-millisecond append is applied once; modified prefix invalidates sealed checkpoint',async()=>{
    const f=setup();await f.service.initialize(actor,key());await open(f);await open(f,{quantity:'0.2'});
    expect(f.repo.row!.snapshot.positions[0].quantity).toBe('1.2');
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(await f.replay('CHECKPOINT')));
    const row=structuredClone(f.repo.row!);const c=row.commands.find(c=>c.kind==='OPEN')!;if(c.kind==='OPEN')c.order.quantity='0.3';
    await expect(replayNativeDemoAsync({deposit:row.deposit,instructions:row.commands,asOf:f.clock.t,checkpoint:row.checkpoint},f.bars)).rejects.toMatchObject({code:'CHECKPOINT_MISMATCH'});
  });
  test('closing during the forming funding minute cannot checkpoint away funding owed before that close',async()=>{
    const f=setup({at:H0+8*H-M});await f.service.initialize(actor,key());const v=await open(f);
    f.clock.t=H0+8*H+1000;
    await f.service.command(actor,{kind:'CLOSE',positionId:v.positions[0].id,quantity:'0.2',idempotencyKey:key()});
    expect(f.repo.row!.checkpoint!.commandCount).toBeUndefined();
    f.clock.t=H0+8*H+2*M;await f.refresh();
    expect(f.repo.row!.snapshot.events.find(e=>e.kind==='FUNDING')).toMatchObject({quantity:'1',cashflow:'-50'});
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.repo.row!.snapshot));
    expect(outcome(await f.replay('CHECKPOINT'))).toEqual(outcome(f.repo.row!.snapshot));
  });
  test('historical instruction cannot reuse sealed live state',async()=>{
    const f=setup();await f.service.initialize(actor,key());await open(f);
    const commands=structuredClone(f.repo.row!.commands);const c=commands.find(c=>c.kind==='OPEN')!;
    if(c.kind==='OPEN')c.order.historical=true;
    expect(liveCheckpoint(f.repo.row!.snapshot,commands)).toBeNull();
    await expect(replayNativeDemoAsync({deposit:'100000',instructions:commands,asOf:f.clock.t,checkpoint:f.repo.row!.checkpoint},f.bars)).rejects.toMatchObject({code:'CHECKPOINT_MISMATCH'});
  });
  test('stored shared checkpoint round-trips without aliasing; immutable evidence remains intact',async()=>{
    const f=setup();await f.service.initialize(actor,key());await open(f);
    const stored=compact(f.repo.row!);expect(stored.checkpointSnapshot).toBe(true);expect(stored.checkpoint?.state).toBeUndefined();
    const restored=inflate(JSON.parse(JSON.stringify(stored)));
    expect(restored).toEqual(f.repo.row);
    expect(restored.checkpoint!.state).not.toBe(restored.snapshot);
    expect(JSON.stringify(stored).length).toBeLessThan(JSON.stringify(f.repo.row).length);
  });
  test('commands omit zero/disabled collateral quotes; wallet still values disabled holdings',async()=>{
    const f=setup();await f.service.initialize(actor,key());
    f.repo.wallet=[{asset:'ETH',available:'1',locked:'0'},{asset:'SOL',available:'0',locked:'0'}];
    f.repo.row!.disabledCollateralAssets=['ETH'];f.market.hasMarks=true;
    const marks=jest.spyOn(f.market,'marks');const quotes=jest.spyOn(f.market,'freshQuote');
    await open(f);expect(quotes.mock.calls.map(c=>c[0])).toEqual(['BTCUSDT']);expect(marks).not.toHaveBeenCalled();
    const wallet=await f.service.wallet(actor);
    expect(wallet!.collateral.priced).toBe('50000');expect(wallet!.collateral.collateralPriced).toBe('0');
    expect(marks.mock.calls.flatMap(c=>c[0])).toEqual(['ETHUSDT']);
  });
  test('collateral and portfolio share validated marks, but MARKET always requests its own book',async()=>{
    const f=setup();f.market.hasMarks=true;await f.service.initialize(actor,key());await open(f,{symbol:'ETHUSDT'});
    f.step();f.repo.wallet=[{asset:'ETH',available:'1',locked:'0'}];
    const marks=jest.spyOn(f.market,'marks'),quotes=jest.spyOn(f.market,'freshQuote');
    await open(f);await open(f,{quantity:'0.1'});
    expect(marks.mock.calls).toEqual([[['ETHUSDT']]]);
    expect(quotes.mock.calls.map(c=>c[0])).toEqual(['BTCUSDT','BTCUSDT']);
    f.clock.t+=5001;await open(f,{quantity:'0.1'});expect(marks).toHaveBeenCalledTimes(2);
  });
});

describe('shared closed history cache',()=>{
  test('overlapping accounts reuse only complete closed bars and fetch the missing suffix',async()=>{
    const f=setup(),cache=nativeHistoryCache(f.market as unknown as PrivateTradingMarketData,f.clock.now);
    const history=jest.spyOn(f.market,'history'),end=Math.floor(f.clock.t/M)*M;
    const r={symbol:'BTCUSDT',start:end-3*M,end:end-M,intervalMs:M};
    const a=await cache.load(r);a[0].mark.open='1';
    const b=await cache.load({...r,end});expect(b[0].mark.open).toBe('50000');
    expect(history.mock.calls.map(c=>[c[0].startTime,c[0].endTime])).toEqual([[end-3*M,end-M],[end-M,end]]);
    expect(nativeHistoryCache(f.market as unknown as PrivateTradingMarketData,f.clock.now)).toBe(cache);
    await expect(cache.load({...r,end:end+M})).rejects.toMatchObject({code:'HISTORY_GAP'});
  });
  test('failed coverage is retriable, concurrent identical loads share one adapter request',async()=>{
    const f=setup(),cache=new NativeHistoryCache(f.market as unknown as PrivateTradingMarketData,f.clock.now);
    const end=Math.floor(f.clock.t/M)*M,r={symbol:'BTCUSDT',start:end-M,end,intervalMs:M};
    const history=jest.spyOn(f.market,'history');history.mockImplementationOnce(async()=>{throw new Error('down');});
    await expect(cache.load(r)).rejects.toThrow('down');
    await Promise.all([cache.load(r),cache.load(r)]);expect(history).toHaveBeenCalledTimes(2);
    f.clock.t+=NATIVE_HISTORY_CACHE_TTL;await cache.load(r);expect(history).toHaveBeenCalledTimes(3);
  });
  test('retention is bounded by bar count',async()=>{
    const f=setup({at:H0+6*24*H}),cache=new NativeHistoryCache(f.market as unknown as PrivateTradingMarketData,f.clock.now);
    await cache.load({symbol:'BTCUSDT',start:H0,end:H0+(NATIVE_HISTORY_CACHE_BARS+10)*M,intervalMs:M});
    expect(cache.size).toBe(NATIVE_HISTORY_CACHE_BARS);
  });
});

describe('R9 sampled server pass',()=>{
  test('without a browser, a resting limit partially fills then completes on new depth, with replay equality',async()=>{
    const f=setup({price:'101'});await f.service.initialize(actor,key());await open(f,{type:'LIMIT',price:'100'});
    f.step();f.market.price='100';f.market.bids=[{price:'97',quantity:'1'}];f.market.asks=[{price:'99',quantity:'0.2'}];
    const worker=new NativeLimitPass(f.service,async()=>[actor],f.clock.now);
    await worker.tick();expect(f.repo.row!.snapshot.orders[0]).toMatchObject({status:'PARTIALLY_FILLED',remaining:'0.8'});
    await worker.tick();expect(f.repo.row!.snapshot.orders[0].remaining).toBe('0.8');
    f.step();f.market.asks=[{price:'98',quantity:'0.8'}];await worker.tick();
    expect(f.repo.row!.snapshot.orders[0].status).toBe('FILLED');
    expect(f.repo.row!.snapshot.events.filter(e=>e.kind==='OPEN')).toEqual(expect.arrayContaining([expect.objectContaining({price:'100',sourcePrice:'99',pricing:'MAKER_MODEL'})]));
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.repo.row!.snapshot));
    expect(worker.failures).toBe(0);
  });
  test('overlapping ticks coalesce, busy/expired actors skip and errors do not stop other accounts',async()=>{
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const service={queued:jest.fn(id=>id==='busy'?1:0),command:jest.fn(async()=>{await wait;throw new Error('stale');})};
    const targets=jest.fn(async()=>[{...actor,userId:'busy'},{...actor,expiresAt:1},{...actor,userId:'valid'},{...actor,userId:'other'}]);
    const pass=new NativeLimitPass(service as any,targets,()=>100);
    const first=pass.tick();expect(pass.tick()).toBe(first);release();await first;
    expect(service.command).toHaveBeenCalledTimes(2);expect(pass.failures).toBe(2);expect(targets).toHaveBeenCalledTimes(1);
    await pass.stop();
  });
});
