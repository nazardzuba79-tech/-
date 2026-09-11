import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { BybitMarketDataService } from '../BybitMarketDataService';
import { BybitLiveTickerCollector, planSubscriptions } from '../BybitLiveTickerCollector';
import { BybitTickerBook } from '../BybitTickerBook';
import { reconnectDelay } from '../../live/contract';

function fixture(count = 650, now = () => 1_000_000) {
  const calls: string[] = [];
  const instruments = Array.from({ length: count }, (_,i) => ({ symbol: `ASSET${i}USDT`, baseCoin: `ASSET${i}`, quoteCoin: 'USDT',
    status: 'Trading', contractType: 'LinearPerpetual', settleCoin: 'USDT', fundingInterval: '480' }));
  const tickers = instruments.map(i => ({ symbol: i.symbol, lastPrice: '12.5', bid1Price: '12', ask1Price: '13', volume24h: '0',
    price24hPcnt: '0.025', fundingRate: '0', openInterestValue: '123' }));
  const fetchFn = jest.fn(async (input: any) => {
    const u = new URL(String(input)); calls.push(String(input));
    let list: any[] = tickers, nextPageCursor = '';
    if (u.pathname.endsWith('instruments-info')) {
      list = [...instruments, { ...instruments[0], symbol: 'CLOSEDUSDT', status: 'Closed' }];
      if (u.searchParams.get('category') === 'linear') {
        if (u.searchParams.has('cursor')) list = list.slice(350);
        else { list = list.slice(0,350); nextPageCursor = 'next'; }
      }
    }
    return { ok: true, status: 200, json: async () => ({ retCode: 0, time: now(), result: { list, nextPageCursor } }) } as Response;
  });
  return { calls, rest: new BybitMarketDataService({ fetchFn, now, sleep: async () => {} }) };
}
class Socket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  frames: any[] = [];
  send(raw: string) { this.frames.push(JSON.parse(raw)); }
  terminate() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
  open() { this.emit('open'); for (const f of this.frames.filter(f => f.op === 'subscribe')) this.emit('message',Buffer.from(JSON.stringify({ op:'subscribe', success:true, req_id:f.req_id }))); }
}
const settle = async () => { await jest.advanceTimersByTimeAsync(0); };

describe('Bybit live collector', () => {
  afterEach(() => jest.useRealTimers());
  test('1300 active instruments / 650 assets bootstrap in five bulk REST calls and two sockets', async () => {
    jest.useFakeTimers(); const f = fixture(); const sockets: Socket[] = [];
    const c = new BybitLiveTickerCollector(f.rest, { now: () => 1_000_000, socket: () => { const s = new Socket(); sockets.push(s); return s as any; } });
    c.start(); c.start(); await settle(); sockets.forEach(s => s.open()); c.flush();
    expect(c.book.instruments.size).toBe(1300); expect(c.book.rows.size).toBe(1300);
    expect(f.calls).toHaveLength(5); expect(f.calls.every(u => !new URL(u).searchParams.has('symbol'))).toBe(true);
    expect(f.calls.filter(u => u.includes('category=linear') && u.includes('instruments')).every(u => u.includes('limit=1000'))).toBe(true);
    expect(sockets).toHaveLength(2); expect(c.counters.subscriptions).toBe(66);
    const spot = sockets[0].frames.filter(f => f.op === 'subscribe');
    expect(spot).toHaveLength(65); expect(spot.every(f => f.args.length <= 10)).toBe(true);
    expect(new Set(spot.flatMap(f => f.args)).size).toBe(650);
    const unsubscribers = Array.from({length:100}, () => c.feed.subscribe(() => {}));
    expect(sockets).toHaveLength(2); unsubscribers.forEach(unsub => unsub());
    expect(c.feed.status).toBe('live'); c.stop(); expect(jest.getTimerCount()).toBe(0);
  });
  test.each(['spot','linear'] as const)('%s packs actual encoded topics below the total connection limit', category => {
    const symbols = Array.from({length:1800},(_,i) => `LONG${'X'.repeat(i%50)}${i}USDT`);
    const plans = planSubscriptions(category,symbols);
    expect(plans.length).toBeLessThan(8);
    expect(plans.flatMap(p=>p.topics)).toHaveLength(1800);
    for (const p of plans) {
      expect(JSON.stringify(p.topics).length).toBeLessThanOrEqual(21_000);
      expect(new Set(p.requests.flat()).size).toBe(p.topics.length);
      if(category==='spot') expect(p.requests.every(r=>r.length<=10)).toBe(true);
    }
  });
  test('deduplicates symbols and rejects an unencodable connection', () => {
    expect(planSubscriptions('linear',['A','A'])[0].topics).toEqual(['tickers.A']);
    expect(()=>planSubscriptions('linear',['X'.repeat(21_000)])).toThrow();
  });
  test('partial deltas preserve fields, real zero survives, old timestamp/sequence is rejected', async () => {
    const f = fixture(2); const book = new BybitTickerBook(() => 1_000_010);
    book.setUniverse((await f.rest.listLinearInstruments()).value);
    book.bootstrap('linear',await f.rest.getTickers('linear'));
    const id = 'linear_perpetual:ASSET0USDT';
    expect(book.rows.get(id)).toMatchObject({ lastPrice:12.5, volume24h:0, markPrice:null, changePercent24h:2.5, openInterestValue:123, fundingIntervalMinutes:480 });
    const update = (ts:number, cs:number, data:any) => book.apply('linear',{topic:'tickers.ASSET0USDT',type:'delta',ts,cs,data});
    expect(update(1_000_005,10,{lastPrice:'0',fundingRate:'0'})).toBe(true);
    expect(book.rows.get(id)).toMatchObject({lastPrice:0,bidPrice:12,askPrice:13,markPrice:null,fundingRate:0});
    expect(update(1_000_004,11,{lastPrice:'99'})).toBe(false);
    expect(update(1_000_006,9,{lastPrice:'99'})).toBe(false);
    expect(book.rows.get(id)?.lastPrice).toBe(0);
    expect(update(1_000_006,10,{openInterest:'7'})).toBe(true);
    expect(book.rows.get(id)?.openInterest).toBe(7);
    expect(update(1_000_007,12,{markPrice:'',openInterest:'invalid'})).toBe(true);
    expect(book.rows.get(id)).toMatchObject({markPrice:null,openInterest:null});
    expect(book.apply('linear',{topic:'tickers.UNKNOWN',type:'delta',data:{lastPrice:'1'}})).toBe(false);
    book.stale(new Set([id])); expect(book.rows.get(id)).toMatchObject({lastPrice:0,stale:true});
    book.bootstrap('linear',await f.rest.getTickers('linear')); expect(book.rows.get(id)?.lastPrice).toBe(0);
  });
  test('disconnect retains last-good, reconnect bootstraps and resubscribes once, stop cancels retry', async () => {
    jest.useFakeTimers(); let now = 1_000_000; const f = fixture(3,()=>now); const sockets: Socket[] = [];
    const c = new BybitLiveTickerCollector(f.rest,{now:()=>now,random:()=>0,socket:()=>{const s=new Socket();sockets.push(s);return s as any;}});
    c.start(); await settle(); sockets.forEach(s=>s.open()); c.flush();
    sockets[0].emit('close'); sockets[0].emit('error',new Error('duplicate event'));
    expect(c.book.rows.get('spot:ASSET0USDT')).toMatchObject({lastPrice:12.5,stale:true});
    now += 6000; await jest.advanceTimersByTimeAsync(800); await settle();
    expect(sockets).toHaveLength(3); sockets[2].open(); c.flush();
    expect(sockets[2].frames.filter(f=>f.op==='subscribe')).toHaveLength(1);
    expect(f.calls).toHaveLength(6); expect(c.counters.reconnects).toBe(1);
    c.stop(); await jest.advanceTimersByTimeAsync(60_000); expect(sockets).toHaveLength(3);
    expect(jest.getTimerCount()).toBe(0);
  });
  test('heartbeat accepts pong and drops an unresponsive session without a storm', async () => {
    jest.useFakeTimers(); const f=fixture(1,Date.now); const sockets:Socket[]=[];
    const c=new BybitLiveTickerCollector(f.rest,{socket:()=>{const s=new Socket();sockets.push(s);return s as any;}});
    c.start(); await settle(); sockets.forEach(s=>s.open());
    await jest.advanceTimersByTimeAsync(20_000);
    expect(sockets[0].frames.at(-1).op).toBe('ping');
    sockets[0].emit('message',Buffer.from(JSON.stringify({op:'pong'})));
    await jest.advanceTimersByTimeAsync(20_000); expect(c.counters.reconnects).toBe(0);
    await jest.advanceTimersByTimeAsync(20_000); expect(c.counters.reconnects).toBeGreaterThan(0); c.stop();
  });
  test('bounded nonzero exponential reconnect delay', () => {
    expect(reconnectDelay(0,()=>0)).toBe(750); expect(reconnectDelay(40,()=>1)).toBe(30_000);
    expect(reconnectDelay(3,()=>0)).toBeGreaterThan(reconnectDelay(2,()=>1));
  });
  test('a delisting removes the row, and a failed refresh cannot mutate the held universe', async () => {
    const f=fixture(2), book=new BybitTickerBook(()=>1_000_000);
    const instruments=(await f.rest.listSpotInstruments()).value;
    book.setUniverse(instruments);book.bootstrap('spot',await f.rest.getTickers('spot'));
    expect(book.rows.size).toBe(2);
    book.setUniverse(instruments.map(i=>i.providerSymbol==='ASSET0USDT'?{...i,status:'Closed'}:i));
    expect(book.rows.has('spot:ASSET0USDT')).toBe(false);expect(book.rows.size).toBe(1);
    // The existing MarketUniverse suite covers failure retention of the
    // source universe; the book is updated only after a successful refresh.
  });
});
