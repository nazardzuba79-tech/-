import {
  HOME_HERO_PAIR, HOME_SNAPSHOT_KEY, HOME_SNAPSHOT_VERSION, isFreshObservation, readHomeSnapshot, writeHomeSnapshot,
  type HydratedHomeMarket,
} from '../../pages/home/homeMarketSnapshot';

/**
 * The record on disk is not trusted for being ours. Every section is read
 * back through validators as strict as the live ones, and a section that
 * fails is dropped on its own — never coerced into a zero, never patched.
 */

const SIX_HOURS = 6 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function storage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(HOME_SNAPSHOT_KEY, initial);
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

/** A fully confirmed hydration, as the hook would commit it. */
function confirmed(): HydratedHomeMarket {
  return {
    tickers: {
      observedAt: NOW - 60_000, source: 'kraken',
      rows: [{ pair: 'BTC/USDT', base: 'BTC', quote: 'USDT', price: 64123.45, change: -1.27, quoteVolume: 81573125, high: 66000, low: 63000 },
        { pair: 'ETH/USDT', base: 'ETH', quote: 'USDT', price: 2479.53, change: NaN, quoteVolume: NaN, high: NaN, low: NaN }],
      history: { 'BTC/USDT': [64000, 64123.45], 'ETH/USDT': [2479.53] },
    },
    hero: {
      pair: HOME_HERO_PAIR, observedAt: NOW - 90_000,
      book: { pair: HOME_HERO_PAIR, timestamp: NOW - 90_000, bids: [{ price: '64123.44', quantity: '0.327' }], asks: [{ price: '64123.46', quantity: '0.815' }] },
      candles: [{ time: 1_700_000_000, open: 64010, high: 64200, low: 63900, close: 64123.45, volume: 178.2 },
        { time: 1_700_000_900, open: 64123.45, high: 64300, low: 64100, close: 64250, volume: 120 }],
      trades: [{ id: 'provider-4382', price: '64250', quantity: '0.02', side: 'SELL', time: NOW - 91_000 },
        { id: 'provider-4381', price: '64123.45', quantity: '0.081', side: 'BUY', time: NOW - 92_000 }],
    },
    rankings: { observedAt: NOW - 120_000, rows: [{ symbol: 'BTC', name: 'Bitcoin', image: 'https://x/btc.png', categories: ['LAYER1'], changePercent24h: -1.2, changePercent7d: null }] },
    global: { observedAt: NOW - 120_000, global: { totalVolume24hUsd: 8.9e10, totalMarketCapUsd: 2.4e12, btcDominancePercent: 55.1, ethDominancePercent: null, marketCapChangePercent24h: -0.4 }, fearGreed: { value: 61, classification: 'Greed', updatedAt: NOW - 120_000 } },
    cfd: { observedAt: NOW - 30_000, value: { source: 'twelvedata', configured: true, tickers: [{ symbol: 'XAUUSD', name: 'Gold Spot', price: '2000.5', status: 'live', stale: false, changePercent24h: '0.3' }] }, history: { XAUUSD: [1999, 2000.5] } },
    futures: { observedAt: NOW - 120_000, symbols: ['BTC/USDT', 'ETH/USDT'] },
  };
}

function roundTrip(mutate: (raw: any) => void = () => {}): HydratedHomeMarket {
  const store = storage();
  writeHomeSnapshot(store, confirmed(), NOW);
  const raw = JSON.parse(store.map.get(HOME_SNAPSHOT_KEY)!);
  mutate(raw);
  store.map.set(HOME_SNAPSHOT_KEY, JSON.stringify(raw));
  return readHomeSnapshot(store, NOW);
}

describe('the homepage snapshot survives a round trip without inventing anything', () => {
  it('restores every confirmed section, with unknown fields still unknown', () => {
    const back = roundTrip();
    const original = confirmed();
    expect(back.tickers?.rows[0]).toEqual(original.tickers!.rows[0]);
    // JSON turned NaN into null; it comes back as NaN, which renders as "—".
    const eth = back.tickers!.rows[1];
    expect(eth.price).toBe(2479.53);
    for (const key of ['change', 'quoteVolume', 'high', 'low'] as const) expect(Number.isNaN(eth[key])).toBe(true);
    expect(back.tickers?.history).toEqual(original.tickers!.history);
    expect(back.tickers?.observedAt).toBe(original.tickers!.observedAt);
    expect(back.hero).toEqual(original.hero);
    expect(back.rankings).toEqual(original.rankings);
    expect(back.global).toEqual(original.global);
    expect(back.cfd).toEqual(original.cfd);
    expect(back.futures).toEqual(original.futures);
  });

  it('writes the version and never writes loading, error or refreshing as data', () => {
    const store = storage();
    writeHomeSnapshot(store, confirmed(), NOW);
    const raw = store.map.get(HOME_SNAPSHOT_KEY)!;
    expect(JSON.parse(raw).version).toBe(HOME_SNAPSHOT_VERSION);
    expect(JSON.parse(raw).savedAt).toBe(NOW);
    expect(raw).not.toMatch(/"(loading|error|refreshing|Status)"/);
  });

  it('is absent, not an error, wherever the browser has no storage', () => {
    expect(readHomeSnapshot(null, NOW)).toMatchObject({ tickers: null, hero: null, cfd: null });
    expect(() => writeHomeSnapshot(null, confirmed(), NOW)).not.toThrow();
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    expect(readHomeSnapshot(throwing, NOW)).toMatchObject({ tickers: null });
    expect(() => writeHomeSnapshot(throwing, confirmed(), NOW)).not.toThrow();
  });
});

describe('a record that does not validate is dropped, section by section', () => {
  it('rejects unparseable JSON and an older schema outright', () => {
    expect(readHomeSnapshot(storage('{not json'), NOW).tickers).toBeNull();
    expect(roundTrip(raw => { raw.version = 0; }).tickers).toBeNull();
    expect(roundTrip(raw => { delete raw.savedAt; }).tickers).toBeNull();
  });

  it('drops a ticker row whose price is gone, and keeps the rows beside it', () => {
    const back = roundTrip(raw => { raw.tickers[0].price = null; });
    expect(back.tickers?.rows.map(row => row.pair)).toEqual(['ETH/USDT']);
    const infinite = roundTrip(raw => { raw.tickers[0].price = 'Infinity'; });
    expect(infinite.tickers?.rows.map(row => row.pair)).toEqual(['ETH/USDT']);
    // No rows left is no section at all — the live path refuses an empty
    // universe, and the cache must not be more generous.
    expect(roundTrip(raw => { raw.tickers = [{ pair: 'BTC/USDT' }]; }).tickers).toBeNull();
  });

  it('drops a whole history series that carries a non-number, rather than patching it', () => {
    const back = roundTrip(raw => { raw.priceHistory['BTC/USDT'][0] = null; });
    expect(back.tickers?.history).toEqual({ 'ETH/USDT': [2479.53] });
  });

  it('refuses a hero for any other pair, and each malformed hero part on its own', () => {
    expect(roundTrip(raw => { raw.hero.pair = 'ETH/USDT'; }).hero).toBeNull();
    const badBook = roundTrip(raw => { raw.hero.book.bids[0].price = '-1'; });
    expect(badBook.hero?.book).toBeNull();
    expect(badBook.hero?.candles).toHaveLength(2);
    const badCandle = roundTrip(raw => { raw.hero.candles[1].low = 99_999; });
    expect(badCandle.hero?.candles).toEqual([]);
    expect(badCandle.hero?.book).not.toBeNull();
    const unordered = roundTrip(raw => { raw.hero.candles.reverse(); });
    expect(unordered.hero?.candles).toEqual([]);
    const badTrade = roundTrip(raw => { raw.hero.trades[0].side = 'HOLD'; });
    expect(badTrade.hero?.trades).toEqual([]);
    const truncated = roundTrip(raw => { raw.hero.candles = raw.hero.candles.slice(0, 1); raw.hero.candles[0].volume = undefined; });
    expect(truncated.hero?.candles).toEqual([]);
  });

  it('keeps a valid hero part when another part is missing entirely', () => {
    const back = roundTrip(raw => { raw.hero.book = null; raw.hero.trades = []; });
    expect(back.hero?.book).toBeNull();
    expect(back.hero?.trades).toEqual([]);
    expect(back.hero?.candles).toHaveLength(2);
  });

  it('rejects a global figure that is not a number and a CFD row with the wrong types', () => {
    const noGlobal = roundTrip(raw => { raw.global.totalMarketCapUsd = 'big'; });
    expect(noGlobal.global?.global).toBeNull();
    expect(noGlobal.global?.fearGreed).not.toBeNull();
    const neither = roundTrip(raw => { raw.global = null; raw.fearGreed = { value: 'high' }; });
    expect(neither.global).toBeNull();
    const cfd = roundTrip(raw => { raw.cfd.tickers.push({ symbol: 'XAGUSD', name: 'Silver', price: 25 }); });
    expect(cfd.cfd?.value.tickers.map(row => row.symbol)).toEqual(['XAUUSD']);
    expect(roundTrip(raw => { raw.cfd.configured = 'yes'; }).cfd).toBeNull();
    expect(roundTrip(raw => { raw.futuresSymbols = ['BTC/USDT', '']; }).futures).toBeNull();
  });

  it('needs an observation time for every section it restores', () => {
    expect(roundTrip(raw => { raw.tickerUpdatedAt = null; }).tickers).toBeNull();
    expect(roundTrip(raw => { raw.hero.updatedAt = 'yesterday'; }).hero).toBeNull();
    expect(roundTrip(raw => { raw.cfdUpdatedAt = NaN; }).cfd).toBeNull();
  });
});

describe('freshness is judged on the observation, against the cadence', () => {
  it('is fresh strictly inside six hours and stale from six hours on', () => {
    expect(isFreshObservation(NOW - SIX_HOURS + 1, NOW, SIX_HOURS)).toBe(true);
    expect(isFreshObservation(NOW - SIX_HOURS, NOW, SIX_HOURS)).toBe(false);
    expect(isFreshObservation(NOW - 10 * SIX_HOURS, NOW, SIX_HOURS)).toBe(false);
  });

  it('treats a timestamp from the future as stale rather than as fresh forever', () => {
    expect(isFreshObservation(NOW + 1, NOW, SIX_HOURS)).toBe(false);
    expect(isFreshObservation(NaN, NOW, SIX_HOURS)).toBe(false);
  });
});
