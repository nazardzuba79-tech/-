import { marketDataStore, type MarketState } from '../marketDataStore';
import { assetMetadataStore } from '../assetMetadataStore';
import { api } from '../api';

/**
 * The client-side half of the load argument.
 *
 * The backend's ProviderCache already collapses concurrent consumers into
 * one PROVIDER request — that is proven in
 * src/services/marketData/__tests__/. What it cannot do is stop VOLTEX
 * itself from being asked N times: before this store, one page view could
 * run six or more independent `setInterval`s against overlapping market
 * endpoints, and that count scaled with both components on screen and
 * users online.
 *
 * These tests assert the property that fixes it: ONE timer and ONE
 * in-flight request per tab, no matter how many components subscribe.
 */
jest.mock('../api', () => ({
  api: {
    getMarketSnapshot: jest.fn(),
    getAssetIcons: jest.fn(),
  },
}));

const getMarketSnapshot = api.getMarketSnapshot as jest.Mock;
const getAssetIcons = api.getAssetIcons as jest.Mock;

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    tickers: {
      available: true,
      source: 'kraken',
      fetchedAt: 1_700_000_000_000,
      stale: false,
      value: [
        {
          pair: 'BTC/USDT',
          lastPrice: '50000',
          bidPrice: '49999',
          askPrice: '50001',
          high24h: '51000',
          low24h: '49000',
          volume24h: '0',
          quoteVolume24h: '1000',
          changePercent24h: '2.5',
        },
      ],
    },
    overview: {
      available: true,
      source: 'coingecko',
      fetchedAt: 1_700_000_000_000,
      stale: false,
      value: {
        totalMarketCapUsd: 2_500_000_000_000,
        totalVolume24hUsd: 90_000_000_000,
        btcDominancePercent: 54.2,
        ethDominancePercent: 13.1,
        marketCapChangePercent24h: 1.4,
      },
    },
    sentiment: {
      available: true,
      source: 'alternative.me',
      fetchedAt: 1_700_000_000_000,
      stale: false,
      value: { value: 61, classification: 'Greed', updatedAt: 1_700_000_000 },
    },
    ...overrides,
  };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('marketDataStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    marketDataStore._resetForTests();
    getMarketSnapshot.mockReset();
    getMarketSnapshot.mockResolvedValue(snapshot());
  });
  afterEach(() => {
    marketDataStore._resetForTests();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('serves 100 concurrent subscribers from ONE request and ONE timer', async () => {
    const unsubscribes = Array.from({ length: 100 }, () => marketDataStore.subscribe(() => {}, 4000));
    await flush();

    // The headline number: 100 components mounting together cost VOLTEX
    // one HTTP request, not 100.
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1);
    expect(marketDataStore._timerCount).toBe(1);
    expect(marketDataStore._subscriberCount).toBe(100);

    unsubscribes.forEach((fn) => fn());
  });

  it('still runs exactly one timer after a full poll cycle with many subscribers', async () => {
    const unsubscribes = Array.from({ length: 50 }, () => marketDataStore.subscribe(() => {}, 3000));
    await flush();
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(3000);
    await flush();

    // One tick, one request — not one per subscriber.
    expect(getMarketSnapshot).toHaveBeenCalledTimes(2);
    expect(marketDataStore._timerCount).toBe(1);
    unsubscribes.forEach((fn) => fn());
  });

  it('joins an in-flight request rather than issuing a second', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    getMarketSnapshot.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));

    const a = marketDataStore.refresh();
    const b = marketDataStore.refresh();
    const c = marketDataStore.refresh();
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1);

    resolveFirst(snapshot());
    await Promise.all([a, b, c]);
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1);
  });

  it('stops polling entirely when the last subscriber leaves', async () => {
    const off1 = marketDataStore.subscribe(() => {}, 3000);
    const off2 = marketDataStore.subscribe(() => {}, 3000);
    await flush();
    expect(marketDataStore._timerCount).toBe(1);

    off1();
    expect(marketDataStore._timerCount).toBe(1);

    off2();
    // A tab with no market UI on screen polls nothing at all.
    expect(marketDataStore._timerCount).toBe(0);

    const before = getMarketSnapshot.mock.calls.length;
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(getMarketSnapshot).toHaveBeenCalledTimes(before);
  });

  it('polls at the fastest cadence any live subscriber asked for', async () => {
    const offSlow = marketDataStore.subscribe(() => {}, 15_000);
    const offFast = marketDataStore.subscribe(() => {}, 3_000);
    await flush();
    const baseline = getMarketSnapshot.mock.calls.length;

    jest.advanceTimersByTime(3_000);
    await flush();

    // The 15s subscriber is served the 3s data — nobody is ever given
    // staler data than they asked for.
    expect(getMarketSnapshot).toHaveBeenCalledTimes(baseline + 1);
    offSlow();
    offFast();
  });

  it('never polls faster than the backend ticker TTL, however low the request', async () => {
    const off = marketDataStore.subscribe(() => {}, 100);
    await flush();
    const baseline = getMarketSnapshot.mock.calls.length;

    jest.advanceTimersByTime(2_900);
    await flush();
    // Floored at 3s: polling under the backend's 5s ticker cache cannot
    // return fresher data, it can only cost requests.
    expect(getMarketSnapshot).toHaveBeenCalledTimes(baseline);

    jest.advanceTimersByTime(200);
    await flush();
    expect(getMarketSnapshot).toHaveBeenCalledTimes(baseline + 1);
    off();
  });

  it('exposes source and freshness rather than hiding them', async () => {
    let state: MarketState | null = null;
    const off = marketDataStore.subscribe((s) => { state = s; }, 3000);
    await flush();

    expect(state!.tickersMeta).toEqual({ source: 'kraken', fetchedAt: 1_700_000_000_000, stale: false });
    off();
  });

  it('marks stale data as stale instead of presenting it as live', async () => {
    getMarketSnapshot.mockResolvedValue(
      snapshot({
        tickers: { ...snapshot().tickers, stale: true },
      })
    );
    let state: MarketState | null = null;
    const off = marketDataStore.subscribe((s) => { state = s; }, 3000);
    await flush();

    expect(state!.tickersMeta!.stale).toBe(true);
    // Still real data, still rendered — just flagged.
    expect(state!.tickers.get('BTC/USDT')!.lastPrice).toBe('50000');
    off();
  });

  it('keeps a REAL zero as zero', async () => {
    let state: MarketState | null = null;
    const off = marketDataStore.subscribe((s) => { state = s; }, 3000);
    await flush();

    // volume24h is genuinely "0" in the fixture. It must survive as "0",
    // not be scrubbed away by the no-fake-zeros rule.
    expect(state!.tickers.get('BTC/USDT')!.volume24h).toBe('0');
    off();
  });

  it('turns an unavailable section into an absence, never a zero', async () => {
    getMarketSnapshot.mockResolvedValue(
      snapshot({ overview: { available: false, reason: 'provider_unavailable' } })
    );
    let state: MarketState | null = null;
    const off = marketDataStore.subscribe((s) => { state = s; }, 3000);
    await flush();

    // null, so a view renders a dash. Not 0, which would render as a real
    // market cap of zero dollars.
    expect(state!.overview).toBeNull();
    expect(state!.overviewMeta).toBeNull();
    // The available sections are unaffected.
    expect(state!.tickers.size).toBe(1);
    off();
  });

  it('keeps the last known good data when a poll fails, and flags the error', async () => {
    let state: MarketState | null = null;
    const off = marketDataStore.subscribe((s) => { state = s; }, 3000);
    await flush();
    expect(state!.tickers.size).toBe(1);

    getMarketSnapshot.mockRejectedValueOnce(new Error('network'));
    jest.advanceTimersByTime(3000);
    await flush();

    expect(state!.status).toBe('error');
    // The list is NOT blanked — a transient failure must not read as "the
    // market disappeared".
    expect(state!.tickers.get('BTC/USDT')!.lastPrice).toBe('50000');
    off();
  });

  it('gives a late subscriber the current snapshot immediately', async () => {
    const off1 = marketDataStore.subscribe(() => {}, 3000);
    await flush();

    let lateState: MarketState | null = null;
    const off2 = marketDataStore.subscribe((s) => { lateState = s; }, 3000);

    // Synchronously, with no extra request.
    expect(lateState).not.toBeNull();
    expect(lateState!.tickers.size).toBe(1);
    off1();
    off2();
  });
});

describe('assetMetadataStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    assetMetadataStore._resetForTests();
    getAssetIcons.mockReset();
    getAssetIcons.mockResolvedValue({
      assets: {
        BTC: { id: 'cg:bitcoin', name: 'Bitcoin', logoUrl: 'btc.png' },
        ETH: { id: 'cg:ethereum', name: 'Ethereum', logoUrl: 'eth.png' },
      },
    });
  });
  afterEach(() => {
    assetMetadataStore._resetForTests();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('batches a 500-symbol render into ONE metadata request', async () => {
    const symbols = Array.from({ length: 500 }, (_, i) => `SYM${i}`);
    // Simulating rows mounting one at a time, as a table actually renders.
    for (const symbol of symbols) assetMetadataStore.request([symbol]);

    jest.advanceTimersByTime(60);
    await flush();

    // The whole point: 500 rows, one request. Not 500.
    expect(getAssetIcons).toHaveBeenCalledTimes(1);
  });

  it('never re-requests a symbol it already knows', async () => {
    assetMetadataStore.request(['BTC', 'ETH']);
    jest.advanceTimersByTime(60);
    await flush();
    expect(getAssetIcons).toHaveBeenCalledTimes(1);

    assetMetadataStore.request(['BTC', 'ETH']);
    jest.advanceTimersByTime(60);
    await flush();

    expect(getAssetIcons).toHaveBeenCalledTimes(1);
    expect(assetMetadataStore.get('BTC')!.logoUrl).toBe('btc.png');
  });

  it('remembers a catalogue miss so it costs one request, not one per render', async () => {
    assetMetadataStore.request(['NOPE']);
    jest.advanceTimersByTime(60);
    await flush();
    expect(getAssetIcons).toHaveBeenCalledTimes(1);

    // Absent from the response = not in the catalogue. Asking again must
    // not re-issue the request on every scroll.
    for (let i = 0; i < 20; i++) assetMetadataStore.request(['NOPE']);
    jest.advanceTimersByTime(60);
    await flush();

    expect(getAssetIcons).toHaveBeenCalledTimes(1);
    expect(assetMetadataStore.get('NOPE')).toBeNull();
  });

  it('survives a metadata failure without breaking anything', async () => {
    getAssetIcons.mockRejectedValueOnce(new Error('down'));
    assetMetadataStore.request(['BTC']);
    jest.advanceTimersByTime(60);
    await flush();

    // No throw, no poisoned state — the icon simply falls through to
    // CryptoIcon's later tiers.
    expect(assetMetadataStore.get('BTC')).toBeNull();
  });

  it('resolves canonical ids, not bare tickers', async () => {
    assetMetadataStore.request(['BTC']);
    jest.advanceTimersByTime(60);
    await flush();

    expect(assetMetadataStore.get('BTC')!.id).toBe('cg:bitcoin');
    expect(assetMetadataStore.get('BTC')!.id).not.toBe('BTC');
  });
});
