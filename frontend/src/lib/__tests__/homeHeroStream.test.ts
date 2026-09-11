import { startHeroStream, combineHeroFeed, extendHeroCandle } from '../../pages/home/heroStream';
import type { HeroStreamSnapshot } from '../../pages/home/heroStream';
import type { HomeHeroFeed, HomeCandle } from '../../pages/home/useHomeMarket';

const start = 1_800_000_000_000;
const candle: HomeCandle = { time: start / 1000, open: 100, high: 105, low: 98, close: 102, volume: 10 };
const trade = (id: string, price: string, offset = 5000) => ({ id, price, quantity: '0.1', side: 'BUY' as const, time: start + offset });
const book = { bids: [{ price: '100', quantity: '2' }], asks: [{ price: '101', quantity: '1' }] };
const base: HomeHeroFeed = { pair: 'BTC/USDT', book: { ...book, pair: 'BTC/USDT', timestamp: start },
  candles: [candle], trades: [], bookStatus: 'ok', candlesStatus: 'ok', tradesStatus: 'ok', stale: false, updatedAt: start };
const live = (overrides: Partial<HeroStreamSnapshot> = {}): HeroStreamSnapshot => ({ pair: 'BTC/USDT', book,
  bookReceivedAt: start + 5000, receivedAt: start + 5000, trades: [trade('t1','107')], ...overrides });

function session() {
  let now = start;
  let nextId = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const listeners: any = {};
  const releases = [jest.fn(), jest.fn(), jest.fn()];
  const publish = jest.fn();
  const socket = {
    subscribeBook: jest.fn((_pair, fn) => { listeners.book = fn; return releases[0]; }),
    subscribeTrades: jest.fn((_pair, fn) => { listeners.trade = fn; return releases[1]; }),
    subscribeStatus: jest.fn(fn => { listeners.status = fn; return releases[2]; }),
  };
  const stop = startHeroStream(socket, 'BTC/USDT', publish, {
    now: () => now,
    set: (callback, ms) => { timers.set(++nextId, { due: now + ms, callback }); return nextId; },
    clear: id => { timers.delete(id); },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, value]) => value.due <= end).sort((a,b) => a[1].due-b[1].due)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].due; next[1].callback();
    }
    now = end;
  };
  return { listeners, releases, publish, timers, stop, advance };
}

test('busy real streams coalesce to one publish per second and never publish synthetic executions', () => {
  const s = session();
  for (let i=0;i<300;i++) s.listeners.book(book);
  s.listeners.trade(trade('a','102',0));
  s.listeners.trade(trade('a','102',0));
  expect(s.publish).not.toHaveBeenCalled();
  s.advance(1000);
  expect(s.publish).toHaveBeenCalledTimes(1);
  expect(s.publish.mock.calls[0][0].trades).toEqual([trade('a','102',0)]);
  s.advance(5000);
  expect(s.publish).toHaveBeenCalledTimes(1);
  s.stop();
});

test('cleanup releases all subscribers, timers and ignores in-flight callbacks', () => {
  const s = session(); s.listeners.book(book); s.stop();
  expect(s.timers.size).toBe(0);
  s.releases.forEach(release => expect(release).toHaveBeenCalledTimes(1));
  s.listeners.book(book); s.listeners.trade(trade('late','999',0)); s.listeners.status('disconnected');
  s.advance(60_000); expect(s.publish).not.toHaveBeenCalled();
});

test('disconnect and a silent connection discard live values so REST can take over', () => {
  const s = session(); s.listeners.book(book); s.advance(1000);
  s.listeners.status('disconnected'); expect(s.publish).toHaveBeenLastCalledWith(null);
  s.listeners.book(book); s.advance(1000); expect(s.publish.mock.calls.at(-1)?.[0].book).toEqual(book);
  s.advance(15_000); expect(s.publish).toHaveBeenLastCalledWith(null); s.stop();
});

test('malformed/crossed books, old subscription history and future trades produce no fake activity', () => {
  const s = session();
  s.listeners.book({ bids:[{price:'102',quantity:'2'}],asks:book.asks });
  s.listeners.book({ bids:[{price:'',quantity:'2'}],asks:book.asks });
  s.listeners.trade(trade('future','102',60_000));
  s.listeners.trade(trade('old','102',-61_000));
  s.listeners.trade(trade('broken','102abc',0));
  s.advance(1000); expect(s.publish).not.toHaveBeenCalled(); s.stop();
});

test('updates grow only the real current candle, preserve open/volume and accept out-of-order trades chronologically', () => {
  expect(extendHeroCandle([candle], [trade('new','103',7000),trade('old','110',5000)]))
    .toEqual([{ ...candle, high:110, close:103 }]);
  expect(extendHeroCandle([candle], [trade('next','300',900_000)])).toEqual([candle]);
  expect(extendHeroCandle([], [trade('first','300')])).toEqual([]);
  expect(extendHeroCandle([candle], [trade('previous','300',-1)])).toEqual([candle]);
});

test('no wrong-pair overlay or old trade may rewrite a newer authoritative candle', () => {
  expect(combineHeroFeed(base, live({ pair:'ETH/USDT' }))).toBe(base);
  const newer = { ...base, candlesUpdatedAt:start+10_000, candles:[{...candle,close:109,high:109}] };
  expect(combineHeroFeed(newer, live()).candles).toBe(newer.candles);
  expect(combineHeroFeed(base, live()).candles.at(-1)?.close).toBe(107);
});

test('continued trades cannot keep an old book labelled as a live stream', () => {
  const merged = combineHeroFeed(base, live({ receivedAt:start+30_000,bookReceivedAt:start }));
  expect(merged.book).toBe(base.book); expect(merged.streaming).toBe(false);
});

test('REST and socket trades deduplicate by execution identity even with different string precision', () => {
  const same = trade('rest-id','107.00');
  const merged = combineHeroFeed({...base,trades:[same]},live());
  expect(merged.trades).toHaveLength(1);
});
