import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';

const source = readFileSync(resolve(__dirname, '../../pages/home/useHomeMarket.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
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

/** Execute the actual hook with a hand-driven clock and effects. No endpoint
 * is contacted; each assertion counts its real calls and resulting state. */
function mount(overrides: Record<string, jest.Mock> = {}) {
  let clock = 1_700_000_000_000;
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
  const loadConfig = jest.fn().mockResolvedValue({ symbols: ['BTC/USDT'] });
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
    hidden: false,
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
  const window = {
    setInterval: jest.fn((fn: () => void, ms: number) => { intervals.set(++intervalId, fn); return intervalId; }),
    clearInterval: jest.fn((id: number) => { intervals.delete(id); }),
  };
  const output: any = {};
  new Function('require', 'exports', 'window', 'document', 'IntersectionObserver', 'Date', compiled)(
    (name: string) => {
      if (name === 'react') return react;
      if (name === '../../lib/api') return { api };
      if (name === '../../lib/futuresConfigStore') return { futuresConfigStore: { load: loadConfig } };
      if (name === '../../lib/priceChange') return { parseChangePercent: (raw: string) => parseFloat(raw) };
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
    api, loadConfig, window, document, observers, render, intervals, listeners,
    advance(ms = 15_000) { clock += ms; intervals.forEach(fn => fn()); },
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
  expect(h.window.setInterval.mock.calls.map(call => call[1])).toEqual([15_000]);
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
  for (const call of [h.api.getExternalRankings, h.api.getGlobalMarket, h.api.getCfdTickers, h.loadConfig]) {
    expect(call).toHaveBeenCalledTimes(1);
  }
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
  expect(h.api.getExternalTickers).toHaveBeenCalledTimes(3);
  expect(h.api.getExternalOrderBook).toHaveBeenCalledTimes(2);
  h.unmount();
});

test('cleanup removes the clock, observer, and visibility listener and ignores a late response', async () => {
  const gate = deferred<ReturnType<typeof tickers>>();
  const h = mount({ getExternalTickers: jest.fn().mockReturnValue(gate.promise) });
  const before = h.render();
  h.unmount();
  expect(h.intervals.size).toBe(0);
  expect(h.observers[0].disconnect).toHaveBeenCalledTimes(1);
  expect(h.listeners.get('visibilitychange')?.size).toBe(0);
  gate.resolve(tickers());
  await flush();
  expect(h.render().tickers).toBe(before.tickers);
  expect(h.api.getExternalOrderBook).not.toHaveBeenCalled();
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
  // There is no retained snapshot yet: unavailable is different from stale.
  expect(h.render().hero).toMatchObject({ book: null, candles: [], trades: [], bookStatus: 'error', candlesStatus: 'error', tradesStatus: 'error', stale: false });
  h.unmount();
});

test.each(['transport failure', 'empty response', 'no USDT market'])('%s leaves no endless hero loading and recovers on the next real snapshot', async initial => {
  const tickerCall = jest.fn().mockResolvedValue(tickers());
  if (initial === 'transport failure') tickerCall.mockRejectedValueOnce(new Error('offline'));
  else if (initial === 'empty response') tickerCall.mockResolvedValueOnce({ source: 'kraken', tickers: [] });
  else tickerCall.mockResolvedValueOnce({ source: 'kraken', tickers: [{ ...tickers().tickers[0], pair: 'BTC/EUR' }] });
  const bookGate = deferred<typeof book>();
  const h = mount({ getExternalTickers: tickerCall,
    getExternalOrderBook: jest.fn().mockReturnValue(bookGate.promise) });
  await flush();
  const unavailable = h.render();
  expect(unavailable.tickersStale).toBe(false);
  expect(unavailable.hero).toMatchObject({ pair: null, book: null, candles: [], trades: [],
    bookStatus: 'error', candlesStatus: 'error', tradesStatus: 'error', stale: false, updatedAt: null });
  for (const call of [h.api.getExternalOrderBook, h.api.getExternalCandles, h.api.getExternalTrades]) {
    expect(call).not.toHaveBeenCalled();
  }

  h.advance();
  await flush();
  const loading = h.render();
  expect(loading.tickersStatus).toBe('ok');
  expect(loading.hero).toMatchObject({ pair: 'BTC/USDT', bookStatus: 'loading', candlesStatus: 'loading', tradesStatus: 'loading' });
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
