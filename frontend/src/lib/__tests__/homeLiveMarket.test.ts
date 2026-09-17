import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const transpile = (file: string) => ts.transpileModule(readFileSync(resolve(__dirname, '../../pages/home', file), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const compiled = transpile('useHomeMarket.ts');
// The snapshot module reaches localStorage through `window`, so it runs
// against the same hand-made window as the hook, not Node's.
const snapshotCompiled = transpile('homeMarketSnapshot.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tickers = (price = 64123.45) => ({ source: 'kraken', tickers: [{
  pair: 'BTC/USDT', lastPrice: String(price), changePercent24h: '-1.27',
  quoteVolume24h: '81573125', high24h: '66000', low24h: '63000',
}] });
const book = { pair: 'BTC/USDT', timestamp: 1_700_000_000_000,
  bids: [{ price: '64123.44', quantity: '0.327' }],
  asks: [{ price: '64123.46', quantity: '0.815' }],
};
const candle = { time: 1_700_000_000, open: 64010, high: 64200, low: 63900, close: 64123.45, volume: 178.2 };
const trade = { id: 'provider-4381', price: '64123.45', quantity: '0.081', side: 'BUY', time: 1_700_000_000_125 };

/** An in-memory localStorage: exactly the three calls the snapshot uses. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}
type MemoryStorage = ReturnType<typeof memoryStorage>;
const T0 = 1_700_000_000_000;

/** Execute the actual hook with a hand-driven clock and effects. No endpoint
 * is contacted; each assertion counts its real calls and resulting state.
 * `storage` is the browser store the hook sees (null = the browser has
 * none); `clock` is the wall clock at mount, so a second mount can be "a
 * reload some hours later" against the same storage. */
function mount(overrides: Record<string, jest.Mock> = {},
  options: { storage?: MemoryStorage | null; clock?: number; hidden?: boolean; loadConfig?: jest.Mock } = {}) {
  let clock = options.clock ?? T0;
  const storage = options.storage === undefined ? memoryStorage() : options.storage;
  let index = 0;
  const state: any[] = [];
  const effects: (() => void | (() => void))[] = [];
  const cleanup: (() => void)[] = [];
  const intervals = new Map<number, () => void>();
  const listeners = new Map<string, Set<() => void>>();
  let intervalId = 0;
  const api = {
    getExternalTickers: jest.fn().mockResolvedValue(tickers()),
    getExternalOrderBook: jest.fn().mockResolvedValue(book),
    getExternalCandles: jest.fn().mockResolvedValue({ pair: 'BTC/USDT', interval: '15m', candles: [candle] }),
    getExternalTrades: jest.fn().mockResolvedValue({ pair: 'BTC/USDT', trades: [trade] }),
    getExternalRankings: jest.fn().mockResolvedValue({ rankings: [] }),
    getGlobalMarket: jest.fn().mockResolvedValue({ global: null, fearGreed: null }),
    getCfdTickers: jest.fn().mockResolvedValue({ configured: false, tickers: [] }),
    ...overrides,
  };
  const loadConfig = options.loadConfig ?? jest.fn().mockResolvedValue({ symbols: ['BTC/USDT'] });
  const react = {
    useState(initial: any) {
      const at = index++;
      if (!(at in state)) state[at] = typeof initial === 'function' ? initial() : initial;
      return [state[at], (value: any) => {
        state[at] = typeof value === 'function' ? value(state[at]) : value;
      }];
    },
    useEffect(fn: () => void | (() => void)) {
      const at = index++;
      if (!(at in state)) { state[at] = true; effects.push(fn); }
    },
  };
  const terminal = { id: 'home-live-terminal' };
  const document = {
    hidden: options.hidden ?? false,
    getElementById: (id: string) => id === terminal.id ? terminal : null,
    addEventListener(name: string, fn: () => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
    },
    removeEventListener(name: string, fn: () => void) { listeners.get(name)?.delete(fn); },
  };
  const observers: any[] = [];
  class Observer {
    observe = jest.fn();
    disconnect = jest.fn();
    constructor(public callback: (entries: { isIntersecting: boolean }[]) => void) { observers.push(this); }
  }
  const timeouts = new Map<number, { fn: () => void; at: number }>();
  let timeoutId = 1_000;
  const window = {
    setInterval: jest.fn((fn: () => void, ms: number) => { intervals.set(++intervalId, fn); return intervalId; }),
    clearInterval: jest.fn((id: number) => { intervals.delete(id); }),
    setTimeout: jest.fn((fn: () => void, ms: number) => { timeouts.set(++timeoutId, { fn, at: clock + ms }); return timeoutId; }),
    clearTimeout: jest.fn((id: number) => { timeouts.delete(id); }),
    localStorage: storage ?? undefined,
  };
  const snapshot: any = {};
  new Function('require', 'exports', 'window', snapshotCompiled)(
    (name: string) => { throw new Error(`Unexpected snapshot dependency: ${name}`); }, snapshot, window,
  );
  const output: any = {};
  new Function('require', 'exports', 'window', 'document', 'IntersectionObserver', 'Date', compiled)(
    (name: string) => {
      if (name === 'react') return react;
      if (name === '../../lib/api') return { api };
      if (name === '../../lib/futuresConfigStore') return { futuresConfigStore: { load: loadConfig } };
      if (name === '../../lib/priceChange') return { parseChangePercent: (raw: string) => parseFloat(raw) };
      if (name === './homeMarketSnapshot') return snapshot;
      throw new Error(`Unexpected hook dependency: ${name}`);
    }, output, window, document, Observer, { now: () => clock },
  );
  const render = () => {
    index = 0;
    const snapshot = output.useHomeMarket();
    effects.splice(0).forEach(fn => { const dispose = fn(); if (dispose) cleanup.push(dispose); });
    return snapshot;
  };
  render();
  return {
    api, loadConfig, window, document, observers, render, intervals, listeners, timeouts, storage,
    now: () => clock,
    advance(ms = SIX_HOURS) {
      clock += ms;
      intervals.forEach(fn => fn());
      for (const [id, timer] of [...timeouts]) if (timer.at <= clock) { timeouts.delete(id); timer.fn(); }
    },
    /** Move the clock and fire only the timers that came due — the interval
     * stays silent, so whatever happens is the expiry timer's doing. */
    tick(ms: number) {
      clock += ms;
      for (const [id, timer] of [...timeouts]) if (timer.at <= clock) { timeouts.delete(id); timer.fn(); }
    },
    visibility(hidden: boolean) {
      document.hidden = hidden;
      listeners.get('visibilitychange')?.forEach(fn => fn());
    },
    unmount() { cleanup.splice(0).forEach(fn => fn()); },
  };
}

test('one shared clock fetches one ticker snapshot and bounded real hero sources per interval', async () => {
  const h = mount();
  await flush();
  expect(h.window.setInterval.mock.calls.map(call => call[1])).toEqual([SIX_HOURS]);
  expect(h.api.getExternalTickers).toHaveBeenCalledTimes(1);
  expect(h.api.getExternalOrderBook).toHaveBeenCalledWith('BTC/USDT', 12);
  expect(h.api.getExternalCandles).toHaveBeenCalledWith('BTC/USDT', '15m', 48);
  expect(h.api.getExternalTrades).toHaveBeenCalledWith('BTC/USDT', 8);
  const actual = h.render();
  expect(actual.tickers[0]).toMatchObject({ price: 64123.45, change: -1.27, quoteVolume: 81573125 });
  expect(actual.hero.book).toEqual(book);
  expect(actual.hero.candles).toEqual([candle]);
  expect(actual.hero.trades).toEqual([trade]);
  expect(actual.priceHistory['BTC/USDT']).toEqual([64123.45]);
  h.advance();
  await flush();
  for (const call of [h.api.getExternalTickers, h.api.getExternalOrderBook, h.api.getExternalCandles, h.api.getExternalTrades]) {
    expect(call).toHaveBeenCalledTimes(2);
  }
  // Rankings, the global figures and the contract list are provider reads
  // too: they follow the same six-hour snapshot rather than one read per
  // mount, so the persisted snapshot stays one coherent observation.
  for (const call of [h.api.getExternalRankings, h.api.getGlobalMarket, h.loadConfig]) {
    expect(call).toHaveBeenCalledTimes(2);
  }
  expect(h.api.getCfdTickers).toHaveBeenCalledTimes(2);
  h.unmount();
});

test('laptop hero requests start before the full ticker universe and publish independently', async () => {
  const tickerGate = deferred<ReturnType<typeof tickers>>();
  const bookGate = deferred<typeof book>();
  const h = mount({
    getExternalTickers: jest.fn().mockReturnValue(tickerGate.promise),
    getExternalOrderBook: jest.fn().mockReturnValue(bookGate.promise),
  });
  await flush();
  const partial = h.render();
  expect(partial.tickersStatus).toBe('loading');
  expect(partial.hero.pair).toBe('BTC/USDT');
  expect(partial.hero.bookStatus).toBe('loading');
  expect(partial.hero.candlesStatus).toBe('ok');
  expect(partial.hero.candles).toEqual([candle]);
  expect(partial.hero.tradesStatus).toBe('ok');
  expect(partial.hero.trades).toEqual([trade]);
  expect(h.api.getExternalOrderBook).toHaveBeenCalledWith('BTC/USDT', 12);
  expect(h.api.getExternalCandles).toHaveBeenCalledWith('BTC/USDT', '15m', 48);
  expect(h.api.getExternalTrades).toHaveBeenCalledWith('BTC/USDT', 8);
  bookGate.resolve(book);
  tickerGate.resolve(tickers());
  await flush();
  expect(h.render().hero).toMatchObject({ book, bookStatus:'ok', candlesStatus:'ok', tradesStatus:'ok' });
  h.unmount();
});

test('slow ticker and hero requests cannot overlap with their next scheduled reads', async () => {
  const tickerGate = deferred<ReturnType<typeof tickers>>();
  const bookGate = deferred<typeof book>();
  const h = mount({ getExternalTickers: jest.fn().mockReturnValue(tickerGate.promise),
    getExternalOrderBook: jest.fn().mockReturnValue(bookGate.promise) });
  h.advance(45_000);
  h.visibility(false);
  expect(h.api.getExternalTickers).toHaveBeenCalledTimes(1);
  tickerGate.resolve(tickers());
  await flush();
  h.advance();
  await flush();
  expect(h.api.getExternalOrderBook).toHaveBeenCalledTimes(1);
  bookGate.resolve(book);
  await flush();
  h.advance();
  await flush();
  expect(h.api.getExternalOrderBook).toHaveBeenCalledTimes(2);
  h.unmount();
});

test('offscreen hero pauses its three reads; hidden document pauses all recurring reads', async () => {
  const h = mount();
  await flush();
  h.observers[0].callback([{ isIntersecting: false }]);
  h.advance();
  await flush();
  expect(h.api.getExternalTickers).toHaveBeenCalledTimes(2);
  expect(h.api.getExternalOrderBook).toHaveBeenCalledTimes(1);
  h.visibility(true);
  h.advance(60_000);
  await flush();
  expect(h.api.getExternalTickers).toHaveBeenCalledTimes(2);
  h.visibility(false);
  h.visibility(false);
  h.observers[0].callback([{ isIntersecting: true }]);
  h.observers[0].callback([{ isIntersecting: true }]);
  await flush();
  expect(h.api.getExternalTickers).toHaveBeenCalledTimes(2);
  expect(h.api.getExternalOrderBook).toHaveBeenCalledTimes(2);
  h.unmount();
});

test('cleanup removes the clock, observer, and visibility listener and ignores a late ticker response', async () => {
  const gate = deferred<ReturnType<typeof tickers>>();
  const h = mount({ getExternalTickers: jest.fn().mockReturnValue(gate.promise) });
  const before = h.render();
  expect(h.api.getExternalOrderBook).toHaveBeenCalledTimes(1);
  h.unmount();
  expect(h.intervals.size).toBe(0);
  expect(h.timeouts.size).toBe(0);
  expect(h.observers[0].disconnect).toHaveBeenCalledTimes(1);
  expect(h.listeners.get('visibilitychange')?.size).toBe(0);
  gate.resolve(tickers());
  await flush();
  expect(h.render().tickers).toBe(before.tickers);
  expect(h.api.getExternalOrderBook).toHaveBeenCalledTimes(1);
});

test('history retains only the last 24 prices actually received, without seeding a first-load chart', async () => {
  const h = mount();
  await flush();
  expect(h.render().priceHistory['BTC/USDT']).toEqual([64123.45]);
  for (let index = 1; index <= 26; index++) {
    h.api.getExternalTickers.mockResolvedValue(tickers(64000 + index));
    h.advance();
    await flush();
  }
  expect(h.render().priceHistory['BTC/USDT']).toEqual(Array.from({ length: 24 }, (_, index) => 64003 + index));
  h.unmount();
});

test('a failed refresh preserves the last real data and marks it stale without advancing its timestamp', async () => {
  const h = mount();
  await flush();
  const before = h.render();
  h.api.getExternalTickers.mockRejectedValue(new Error('offline'));
  h.api.getExternalCandles.mockRejectedValue(new Error('offline'));
  h.advance();
  await flush();
  const after = h.render();
  expect(after.tickers).toBe(before.tickers);
  expect(after.tickersStale).toBe(true);
  expect(after.tickerUpdatedAt).toBe(before.tickerUpdatedAt);
  expect(after.priceHistory).toBe(before.priceHistory);
  expect(after.hero.candles).toBe(before.hero.candles);
  expect(after.hero.candlesStatus).toBe('error');
  expect(after.hero.stale).toBe(true);
  h.unmount();
});

test('malformed and wrong-pair hero records cannot be presented as valid real data', async () => {
  const h = mount({
    getExternalOrderBook: jest.fn().mockResolvedValue({ ...book, bids: [{ price: 'Infinity', quantity: '2' }], asks: book.asks }),
    getExternalTrades: jest.fn().mockResolvedValue({ pair: 'BTC/USDT', trades: [{ ...trade, quantity: 'Infinity' }] }),
    getExternalCandles: jest.fn().mockResolvedValue({ pair: 'ETH/USDT', candles: [candle] }),
  });
  await flush();
  expect(h.render().hero).toMatchObject({ pair:'BTC/USDT', book: null, candles: [], trades: [], bookStatus: 'error', candlesStatus: 'error', tradesStatus: 'error', stale: false });
  h.unmount();
});

test.each(['transport failure', 'empty response', 'no USDT market'])('%s in the ticker universe does not block the BTC laptop feed', async initial => {
  const tickerCall = jest.fn().mockResolvedValue(tickers());
  if (initial === 'transport failure') tickerCall.mockRejectedValueOnce(new Error('offline'));
  else if (initial === 'empty response') tickerCall.mockResolvedValueOnce({ source: 'kraken', tickers: [] });
  else tickerCall.mockResolvedValueOnce({ source: 'kraken', tickers: [{ ...tickers().tickers[0], pair: 'BTC/EUR' }] });
  const bookGate = deferred<typeof book>();
  const h = mount({ getExternalTickers: tickerCall,
    getExternalOrderBook: jest.fn().mockReturnValue(bookGate.promise) });
  await flush();
  const first = h.render();
  expect(first.tickersStale).toBe(false);
  expect(first.hero).toMatchObject({ pair:'BTC/USDT', book:null, candles:[candle], trades:[trade],
    bookStatus:'loading', candlesStatus:'ok', tradesStatus:'ok', stale:false, updatedAt:null });
  for (const call of [h.api.getExternalOrderBook, h.api.getExternalCandles, h.api.getExternalTrades]) {
    expect(call).toHaveBeenCalledTimes(1);
  }

  h.advance();
  await flush();
  expect(h.api.getExternalTickers).toHaveBeenCalledTimes(2);
  for (const call of [h.api.getExternalOrderBook, h.api.getExternalCandles, h.api.getExternalTrades]) {
    expect(call).toHaveBeenCalledTimes(1);
  }

  bookGate.resolve(book);
  await flush();
  expect(h.render().hero).toMatchObject({ pair: 'BTC/USDT', book, candles: [candle], trades: [trade],
    bookStatus: 'ok', candlesStatus: 'ok', tradesStatus: 'ok', stale: false });
  expect(h.render().hero.updatedAt).not.toBeNull();
  expect(h.window.setInterval).toHaveBeenCalledTimes(1);
  h.unmount();
});

test('an empty refresh cannot erase a populated tape or claim a fresh observation', async () => {
  const h = mount();
  await flush();
  const before = h.render();
  h.api.getExternalTickers.mockResolvedValue({ source: 'kraken', tickers: [] });
  h.advance();
  await flush();
  const after = h.render();
  expect(after.tickers).toBe(before.tickers);
  expect(after.priceHistory).toBe(before.priceHistory);
  expect(after.tickerUpdatedAt).toBe(before.tickerUpdatedAt);
  expect(after.tickersStale).toBe(true);
  h.unmount();
});

test('a genuine price and change remain usable when turnover is unavailable', async () => {
  const response = tickers();
  const missingVolume = { ...response, tickers: [{ ...response.tickers[0], quoteVolume24h: '' }] };
  const h = mount({ getExternalTickers: jest.fn().mockResolvedValue(missingVolume) });
  await flush();
  const actual = h.render();
  expect(actual.tickers).toHaveLength(1);
  expect(actual.tickers[0]).toMatchObject({ price: 64123.45, change: -1.27 });
  expect(Number.isFinite(actual.tickers[0].quoteVolume)).toBe(false);
  expect(actual.tickersStatus).toBe('ok');
  h.unmount();
});

test('missing quote fields stay unknown while actual zero remains zero', async () => {
  const response = tickers(0);
  const partial = {...response,tickers:[{...response.tickers[0],high24h:'',low24h:'invalid',changePercent24h:'',quoteVolume24h:'0'}]};
  const h = mount({getExternalTickers:jest.fn().mockResolvedValue(partial)}); await flush();
  const row = h.render().tickers[0];
  expect(row.price).toBe(0); expect(row.quoteVolume).toBe(0);
  expect(Number.isNaN(row.high)).toBe(true); expect(Number.isNaN(row.low)).toBe(true); expect(Number.isNaN(row.change)).toBe(true);
  h.unmount();
});

test('CFD reference observations share the six-hour clock and pause offscreen', async () => {
  const row={symbol:'XAUUSD',price:'2000',changePercent24h:'0',status:'live',stale:false};
  const response={configured:true,source:'twelvedata',tickers:[row]};
  const h=mount({getCfdTickers:jest.fn().mockResolvedValue(response)}); await flush();
  h.advance(); await flush(); expect(h.api.getCfdTickers).toHaveBeenCalledTimes(2);
  h.advance(); await flush(); expect(h.api.getCfdTickers).toHaveBeenCalledTimes(3);
  expect(h.render().cfdPriceHistory.XAUUSD).toEqual([2000]);
  h.observers[0].callback([{isIntersecting:false}]); h.advance(); await flush();
  expect(h.api.getCfdTickers).toHaveBeenCalledTimes(3);
  h.api.getCfdTickers.mockRejectedValue(new Error('offline'));
  h.observers[0].callback([{isIntersecting:true}]); await flush();
  expect(h.render().cfd).toEqual(response); expect(h.render().cfdStatus).toBe('error'); h.unmount();
});

// ---------------------------------------------------------------------------
// The persisted last-good snapshot. A browser that confirmed real market data
// paints it again on the next visit before any request is made, asks for
// nothing while it is under six hours old, and never lets a failed refresh
// take a confirmed value off the screen.
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const ranking = { symbol: 'BTC', name: 'Bitcoin', image: 'https://x/btc.png', categories: ['LAYER1'], changePercent24h: -1.2, changePercent7d: null };
const globalMarket = {
  global: { totalVolume24hUsd: 8.9e10, totalMarketCapUsd: 2.4e12, btcDominancePercent: 55.1, ethDominancePercent: null, marketCapChangePercent24h: -0.4 },
  fearGreed: { value: 61, classification: 'Greed', updatedAt: T0 },
};
const cfdResponse = { source: 'twelvedata', configured: true,
  tickers: [{ symbol: 'XAUUSD', name: 'Gold Spot', price: '2000.5', status: 'live', stale: false, changePercent24h: '0.3' }] };
const PROVIDERS = ['getExternalTickers', 'getExternalOrderBook', 'getExternalCandles', 'getExternalTrades',
  'getExternalRankings', 'getGlobalMarket', 'getCfdTickers'] as const;
const providerCalls = (h: ReturnType<typeof mount>) =>
  Object.fromEntries([...PROVIDERS.map(name => [name, h.api[name].mock.calls.length]), ['loadConfig', h.loadConfig.mock.calls.length]]);
const noProviderCalls = Object.fromEntries([...PROVIDERS, 'loadConfig'].map(name => [name, 0]));
const oneProviderCall = Object.fromEntries([...PROVIDERS, 'loadConfig'].map(name => [name, 1]));
const everyStatus = (m: any) => [m.tickersStatus, m.hero.bookStatus, m.hero.candlesStatus, m.hero.tradesStatus,
  m.rankingsStatus, m.globalStatus, m.cfdStatus, m.futuresStatus];
/** Every provider held open: nothing has answered yet. */
const pending = () => Object.fromEntries(PROVIDERS.map(name => [name, jest.fn().mockReturnValue(new Promise(() => {}))]));

/** A first visit at `clock` on which every section was confirmed by a real
 * response, written to storage by the hook itself — no hand-made record. */
async function confirmedVisit(clock = T0) {
  const first = mount({
    getExternalRankings: jest.fn().mockResolvedValue({ rankings: [ranking] }),
    getGlobalMarket: jest.fn().mockResolvedValue(globalMarket),
    getCfdTickers: jest.fn().mockResolvedValue(cfdResponse),
  }, { clock });
  await flush();
  first.unmount();
  const storage = first.storage!;
  expect(storage.map.has('voltex.home.market.v1')).toBe(true);
  return storage;
}

test('a snapshot under six hours old paints every section at once and asks no provider for anything until it expires', async () => {
  const storage = await confirmedVisit(T0);
  const h = mount({}, { storage, clock: T0 + HOUR });
  const painted = h.render();
  expect(everyStatus(painted)).toEqual(Array(8).fill('ok'));
  expect(painted.tickers[0]).toMatchObject({ pair: 'BTC/USDT', price: 64123.45, change: -1.27, quoteVolume: 81573125 });
  expect(painted.tickersStale).toBe(false);
  expect(painted.tickerUpdatedAt).toBe(T0);
  expect(painted.tickerSource).toBe('kraken');
  expect(painted.priceHistory).toEqual({ 'BTC/USDT': [64123.45] });
  expect(painted.hero).toMatchObject({ pair: 'BTC/USDT', book, candles: [candle], trades: [trade], stale: false, updatedAt: T0 });
  expect(painted.rankings).toEqual([ranking]);
  expect(painted.global).toEqual(globalMarket.global);
  expect(painted.fearGreed).toEqual(globalMarket.fearGreed);
  expect(painted.cfd).toEqual(cfdResponse);
  expect(painted.cfdPriceHistory).toEqual({ XAUUSD: [2000.5] });
  expect(painted.futuresSymbols).toEqual(['BTC/USDT']);
  expect(painted.logoOf('btc')).toBe(ranking.image);
  await flush();
  expect(providerCalls(h)).toEqual(noProviderCalls);

  // One clock, one expiry timer: armed for the moment the snapshot turns six
  // hours old, not six hours after this mount.
  expect(h.window.setInterval.mock.calls.map(call => call[1])).toEqual([SIX_HOURS]);
  expect([...h.timeouts.values()].map(timer => timer.at)).toEqual([T0 + SIX_HOURS]);
  h.advance(SIX_HOURS - HOUR - 1);
  await flush();
  expect(providerCalls(h)).toEqual(noProviderCalls);
  expect(h.timeouts.size).toBe(1);

  // At expiry the timer alone brings one refresh per source, then re-arms
  // once. There is no second loop behind it.
  h.tick(1);
  await flush();
  expect(h.now()).toBe(T0 + SIX_HOURS);
  expect(providerCalls(h)).toEqual(oneProviderCall);
  expect([...h.timeouts.values()].map(timer => timer.at)).toEqual([T0 + 2 * SIX_HOURS]);
  expect(h.render()).toMatchObject({ tickerUpdatedAt: T0 + SIX_HOURS, tickersStale: false });
  h.tick(SIX_HOURS);
  await flush();
  expect(providerCalls(h)).toEqual(Object.fromEntries([...PROVIDERS, 'loadConfig'].map(name => [name, 2])));
  expect(h.timeouts.size).toBe(1);
  h.unmount();
  expect(h.timeouts.size).toBe(0);
  expect(h.intervals.size).toBe(0);
});

test('a snapshot over six hours old is painted first, flagged stale, and replaced in the background with no loading state in between', async () => {
  const storage = await confirmedVisit(T0);
  const tickerGate = deferred<ReturnType<typeof tickers>>();
  const bookGate = deferred<typeof book>();
  const h = mount({
    getExternalTickers: jest.fn().mockReturnValue(tickerGate.promise),
    getExternalOrderBook: jest.fn().mockReturnValue(bookGate.promise),
    getExternalRankings: jest.fn().mockResolvedValue({ rankings: [ranking] }),
    getGlobalMarket: jest.fn().mockResolvedValue(globalMarket),
    getCfdTickers: jest.fn().mockResolvedValue(cfdResponse),
  }, { storage, clock: T0 + 7 * HOUR });
  const painted = h.render();
  expect(everyStatus(painted)).toEqual(Array(8).fill('ok'));
  expect(painted.tickers[0].price).toBe(64123.45);
  expect(painted.tickersStale).toBe(true);
  expect(painted.hero).toMatchObject({ book, candles: [candle], trades: [trade], stale: true, updatedAt: T0 });
  // The refresh goes out at once, and nothing on screen changes until a
  // real answer arrives: the last quote stays, the stale flag stays.
  expect(providerCalls(h)).toEqual(oneProviderCall);
  await flush();
  const meanwhile = h.render();
  expect(meanwhile.tickers[0].price).toBe(64123.45);
  expect(meanwhile.tickersStatus).toBe('ok');
  expect(meanwhile.tickersStale).toBe(true);
  expect(meanwhile.hero).toMatchObject({ book, bookStatus: 'ok', stale: true });

  tickerGate.resolve(tickers(65000));
  bookGate.resolve({ ...book, timestamp: T0 + 7 * HOUR });
  await flush();
  const replaced = h.render();
  expect(replaced.tickers[0].price).toBe(65000);
  expect(replaced.tickersStale).toBe(false);
  expect(replaced.tickerUpdatedAt).toBe(T0 + 7 * HOUR);
  expect(replaced.priceHistory['BTC/USDT']).toEqual([64123.45, 65000]);
  expect(replaced.hero).toMatchObject({ book: { ...book, timestamp: T0 + 7 * HOUR }, stale: false, updatedAt: T0 + 7 * HOUR });
  expect(everyStatus(replaced)).toEqual(Array(8).fill('ok'));
  const persisted = JSON.parse(storage.map.get('voltex.home.market.v1')!);
  expect(persisted.tickerUpdatedAt).toBe(T0 + 7 * HOUR);
  expect(persisted.tickers[0].lastPrice ?? persisted.tickers[0].price).toBe(65000);
  expect(persisted.hero.updatedAt).toBe(T0 + 7 * HOUR);
  h.unmount();
});

test('a failed background refresh keeps every last-good value on screen and leaves the persisted snapshot as it was', async () => {
  const storage = await confirmedVisit(T0);
  const before = storage.map.get('voltex.home.market.v1')!;
  const offline = () => jest.fn().mockRejectedValue(new Error('offline'));
  const h = mount(Object.fromEntries(PROVIDERS.map(name => [name, offline()])), { storage, clock: T0 + 9 * HOUR, loadConfig: offline() });
  await flush();
  expect(providerCalls(h)).toEqual(oneProviderCall);
  const kept = h.render();
  expect(kept.tickers[0].price).toBe(64123.45);
  expect(kept.tickersStatus).toBe('ok');
  expect(kept.tickersStale).toBe(true);
  expect(kept.tickerUpdatedAt).toBe(T0);
  expect(kept.priceHistory).toEqual({ 'BTC/USDT': [64123.45] });
  expect(kept.hero).toMatchObject({ book, candles: [candle], trades: [trade], stale: true, updatedAt: T0,
    bookStatus: 'error', candlesStatus: 'error', tradesStatus: 'error' });
  expect(kept.rankings).toEqual([ranking]);
  expect(kept.global).toEqual(globalMarket.global);
  expect(kept.fearGreed).toEqual(globalMarket.fearGreed);
  expect(kept.cfd).toEqual(cfdResponse);
  expect(kept.cfdPriceHistory).toEqual({ XAUUSD: [2000.5] });
  expect(kept.futuresSymbols).toEqual(['BTC/USDT']);
  expect(everyStatus(kept)).not.toContain('loading');
  expect(storage.map.get('voltex.home.market.v1')).toBe(before);
  h.unmount();
});

test('a record that fails validation is refused section by section; only the refused sections are requested again', async () => {
  const storage = await confirmedVisit(T0);
  const raw = JSON.parse(storage.map.get('voltex.home.market.v1')!);
  raw.tickers[0].price = 'Infinity';
  raw.priceHistory['BTC/USDT'][0] = null;
  storage.map.set('voltex.home.market.v1', JSON.stringify(raw));
  const h = mount(pending(), { storage, clock: T0 + HOUR });
  const painted = h.render();
  expect(painted.tickersStatus).toBe('loading');
  expect(painted.tickers).toEqual([]);
  expect(painted.priceHistory).toEqual({});
  expect(painted.hero).toMatchObject({ book, candles: [candle], trades: [trade], bookStatus: 'ok', stale: false });
  expect(painted.rankings).toEqual([ranking]);
  expect(painted.cfd).toEqual(cfdResponse);
  expect(providerCalls(h)).toEqual({ ...noProviderCalls, getExternalTickers: 1 });
  h.unmount();

  for (const corrupt of ['{not json', JSON.stringify({ ...raw, version: 0 }), JSON.stringify({ version: 1 }), '[]']) {
    const broken = memoryStorage();
    broken.map.set('voltex.home.market.v1', corrupt);
    const cold = mount(pending(), { storage: broken, clock: T0 + HOUR });
    const nothing = cold.render();
    expect(everyStatus(nothing)).toEqual(Array(8).fill('loading'));
    expect(nothing.tickers).toEqual([]);
    expect(nothing.hero).toMatchObject({ pair: 'BTC/USDT', book: null, candles: [], trades: [], updatedAt: null });
    expect(providerCalls(cold)).toEqual(oneProviderCall);
    cold.unmount();
  }
});

test('with no snapshot nothing is painted before the first real response, and the response is what gets persisted', async () => {
  const gates = pending();
  const config = jest.fn().mockReturnValue(new Promise(() => {}));
  const h = mount(gates, { loadConfig: config });
  const blank = h.render();
  expect(everyStatus(blank)).toEqual(Array(8).fill('loading'));
  expect(blank).toMatchObject({ tickers: [], priceHistory: {}, tickerUpdatedAt: null, tickerSource: '', tickersStale: false,
    rankings: [], global: null, fearGreed: null, cfd: null, cfdPriceHistory: {}, futuresSymbols: [] });
  expect(blank.hero).toMatchObject({ pair: 'BTC/USDT', book: null, candles: [], trades: [], stale: false, updatedAt: null });
  expect(h.storage!.map.size).toBe(0);
  h.unmount();

  const confirmed = await confirmedVisit(T0);
  const raw = confirmed.map.get('voltex.home.market.v1')!;
  expect(raw).not.toMatch(/"(loading|error|refreshing)"/);
  const record = JSON.parse(raw);
  expect(record).toMatchObject({ version: 1, savedAt: T0, tickerUpdatedAt: T0, tickerSource: 'kraken' });
  expect(record.hero).toMatchObject({ pair: 'BTC/USDT', updatedAt: T0 });
  expect(record.hero.candles).toEqual([candle]);
  expect(record.futuresSymbols).toEqual(['BTC/USDT']);
});

test('history continues from the persisted observations and grows only by prices actually received', async () => {
  const storage = await confirmedVisit(T0);
  const h = mount({ getExternalTickers: jest.fn().mockResolvedValue(tickers(64200)) }, { storage, clock: T0 + 7 * HOUR });
  await flush();
  expect(h.render().priceHistory).toEqual({ 'BTC/USDT': [64123.45, 64200] });
  h.advance();
  await flush();
  // The same price again is not a new observation.
  expect(h.render().priceHistory).toEqual({ 'BTC/USDT': [64123.45, 64200] });
  h.api.getExternalTickers.mockResolvedValue(tickers(64300));
  h.advance();
  await flush();
  expect(h.render().priceHistory).toEqual({ 'BTC/USDT': [64123.45, 64200, 64300] });
  expect(JSON.parse(storage.map.get('voltex.home.market.v1')!).priceHistory).toEqual({ 'BTC/USDT': [64123.45, 64200, 64300] });
  h.unmount();
});

test('a hidden tab paints its snapshot and asks no provider for anything until it is shown', async () => {
  const storage = await confirmedVisit(T0);
  const h = mount({}, { storage, clock: T0 + 7 * HOUR, hidden: true });
  const painted = h.render();
  expect(painted.tickers[0].price).toBe(64123.45);
  expect(painted.tickersStale).toBe(true);
  expect(painted.rankings).toEqual([ranking]);
  h.advance(HOUR);
  await flush();
  expect(providerCalls(h)).toEqual(noProviderCalls);
  expect(h.timeouts.size).toBe(0);
  h.visibility(false);
  await flush();
  expect(providerCalls(h)).toEqual(oneProviderCall);
  expect(h.render()).toMatchObject({ tickersStale: false, tickerUpdatedAt: T0 + 8 * HOUR });
  h.unmount();
});

test('an offscreen hero keeps its cached terminal and defers only its own reads past expiry', async () => {
  const storage = await confirmedVisit(T0);
  const h = mount({}, { storage, clock: T0 + HOUR });
  h.observers[0].callback([{ isIntersecting: false }]);
  h.tick(SIX_HOURS - HOUR);
  await flush();
  expect(providerCalls(h)).toEqual({ ...oneProviderCall, getExternalOrderBook: 0, getExternalCandles: 0, getExternalTrades: 0, getCfdTickers: 0 });
  expect(h.render().hero).toMatchObject({ book, candles: [candle], trades: [trade], bookStatus: 'ok', updatedAt: T0 });
  // The hero is due but gated; the next timer still tracks the tickers.
  expect([...h.timeouts.values()].map(timer => timer.at)).toEqual([T0 + 2 * SIX_HOURS]);
  h.observers[0].callback([{ isIntersecting: true }]);
  await flush();
  expect(providerCalls(h)).toEqual(oneProviderCall);
  expect(h.render().hero).toMatchObject({ stale: false, updatedAt: T0 + SIX_HOURS });
  h.unmount();
});

test('regression: a reloaded browser shows the confirmed BTC snapshot before the API answers, with no skeleton and no early refresh', async () => {
  // 1. The browser received a real BTC snapshot.
  const first = mount({
    getExternalRankings: jest.fn().mockResolvedValue({ rankings: [ranking] }),
    getGlobalMarket: jest.fn().mockResolvedValue(globalMarket),
    getCfdTickers: jest.fn().mockResolvedValue(cfdResponse),
  }, { clock: T0 });
  await flush();
  expect(first.render().tickers[0]).toMatchObject({ pair: 'BTC/USDT', price: 64123.45 });
  expect(first.render().hero.candles).toEqual([candle]);
  // 2. The snapshot was persisted.
  const storage = first.storage!;
  const record = JSON.parse(storage.map.get('voltex.home.market.v1')!);
  expect(record.version).toBe(1);
  expect(record.tickers[0].pair).toBe('BTC/USDT');
  expect(record.hero.candles).toHaveLength(1);
  first.unmount();
  // 3. "Browser reload": a new store and hook, two hours later.
  const reload = mount(pending(), { storage, clock: T0 + 2 * HOUR, loadConfig: jest.fn().mockReturnValue(new Promise(() => {})) });
  // 4. No API request has answered.
  await flush();
  // 5. BTC price, candles, book, the market map and the popular markets
  //    are already there from the cache.
  const shown = reload.render();
  expect(shown.tickers[0]).toMatchObject({ pair: 'BTC/USDT', price: 64123.45, change: -1.27 });
  expect(shown.hero.candles).toEqual([candle]);
  expect(shown.hero.book).toEqual(book);
  expect(shown.hero.trades).toEqual([trade]);
  expect(shown.priceHistory['BTC/USDT']).toEqual([64123.45]);
  expect(shown.rankings).toEqual([ranking]);
  expect(shown.cfd).toEqual(cfdResponse);
  expect(shown.futuresSymbols).toEqual(['BTC/USDT']);
  // 6. No skeleton replaces the confirmed values.
  expect(everyStatus(shown)).toEqual(Array(8).fill('ok'));
  expect(shown.tickersStale).toBe(false);
  expect(shown.hero.stale).toBe(false);
  // 7. No extra provider refresh occurs before the six-hour TTL.
  expect(providerCalls(reload)).toEqual(noProviderCalls);
  reload.advance(SIX_HOURS - 2 * HOUR - 1);
  await flush();
  expect(providerCalls(reload)).toEqual(noProviderCalls);
  expect(reload.window.setInterval).toHaveBeenCalledTimes(1);
  expect([...reload.timeouts.values()].map(timer => timer.at)).toEqual([T0 + SIX_HOURS]);
  reload.tick(1);
  await flush();
  expect(providerCalls(reload)).toEqual(oneProviderCall);
  reload.unmount();
});
