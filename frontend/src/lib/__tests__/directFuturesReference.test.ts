import { applyFuturesTickerUpdate, parseDirectFuturesTickers, parseNormalizedFuturesSnapshot } from '../directFuturesReference';

test('maps public Bybit linear tickers without changing contract identity', () => {
  const rows = parseDirectFuturesTickers({
    retCode: 0,
    time: 1790150000000,
    result: {
      category: 'linear',
      list: [{
        symbol: '1000PEPEUSDT',
        lastPrice: '0.0075',
        bid1Price: '0.00749',
        ask1Price: '0.00751',
        highPrice24h: '0.008',
        lowPrice24h: '0.007',
        volume24h: '123456',
        turnover24h: '925.92',
        price24hPcnt: '0.025',
        indexPrice: '0.0075',
        markPrice: '0.0075',
        fundingRate: '0.0001',
        openInterest: '900000',
        openInterestValue: '6750',
      }],
    },
  }, 1790150000100);

  const row = rows.get('1000PEPE/USDT');
  expect(row).toMatchObject({
    id: 'linear_perpetual:1000PEPEUSDT',
    providerSymbol: '1000PEPEUSDT',
    pair: '1000PEPE/USDT',
    lastPrice: 0.0075,
    changePercent24h: 2.5,
    quoteVolume24h: 925.92,
    stale: false,
  });
  expect(rows.has('PEPE/USDT')).toBe(false);
});

test('rejects non-linear or unusable ticker payloads', () => {
  expect(() => parseDirectFuturesTickers({ retCode: 0, result: { category: 'spot', list: [] } })).toThrow();
  expect(() => parseDirectFuturesTickers({ retCode: 10001, result: { category: 'linear', list: [] } })).toThrow();
  expect(() => parseDirectFuturesTickers({ retCode: 0, result: { category: 'linear', list: [{ symbol: 'BTCUSDT', lastPrice: '0' }] } })).toThrow();
});


test('maps existing normalized fixture snapshots for local and CI without external market requests', () => {
  const row = {
    id: 'linear_perpetual:BTCUSDT',
    pair: 'BTC/USDT',
    symbol: 'BTC/USDT',
    providerSymbol: 'BTCUSDT',
    provider: 'bybit',
    marketType: 'linear_perpetual',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    settleAsset: 'USDT',
    lastPrice: 65000,
    bidPrice: 64999,
    askPrice: 65001,
    high24h: 66000,
    low24h: 64000,
    volume24h: 100,
    quoteVolume24h: 6500000,
    changePercent24h: 1.2,
    indexPrice: 65000,
    markPrice: 65000,
    fundingRate: 0.0001,
    fundingIntervalMinutes: 480,
    openInterest: 10,
    openInterestValue: 650000,
    providerEventAt: 1790150000000,
    sequence: 1,
    receivedAt: 1790150000000,
    fetchedAt: 1790150000000,
    stale: false,
  };
  const rows = parseNormalizedFuturesSnapshot({ type: 'snapshot', rows: [row] });
  expect(rows.get('BTC/USDT')).toEqual(row);
});


test('preserves bulk rows while overlaying focused WebSocket ticker deltas', () => {
  const initial=parseDirectFuturesTickers({
    retCode:0,time:1790150000000,result:{category:'linear',list:[{
      symbol:'BTCUSDT',lastPrice:'100',bid1Price:'99',ask1Price:'101',highPrice24h:'110',lowPrice24h:'90',
      price24hPcnt:'0.02',markPrice:'100',indexPrice:'100',fundingRate:'0.0001'
    }]}
  },1790150000100);
  const next=applyFuturesTickerUpdate(initial,'BTC/USDT',{
    symbol:'BTCUSDT',ts:1790150000200,lastPrice:'102',markPrice:'101.9',bid1Price:'101.8',ask1Price:'102.1'
  },1790150000300);
  expect(next.get('BTC/USDT')).toMatchObject({
    lastPrice:102,markPrice:101.9,bidPrice:101.8,askPrice:102.1,
    high24h:110,low24h:90,changePercent24h:2,providerEventAt:1790150000200
  });
});

test('keeps independent fallback provenance when edge returns OKX-normalized tickers',()=>{
  const rows=parseDirectFuturesTickers({
    retCode:0,source:'okx',time:1790150000000,result:{category:'linear',list:[{symbol:'BTCUSDT',lastPrice:'100'}]}
  });
  expect(rows.get('BTC/USDT')?.provider).toBe('okx');
});

describe('the reference loader beside the wake barrier', () => {
  const nativeFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = nativeFetch; jest.useRealTimers(); jest.resetModules(); jest.dontMock('../browserActivity'); });

  // 2026-10-21: production's edge fallback answered 503 market_data_unavailable. With the direct hosts
  // unreachable as well, this one display read put every wake into `error` and refused all input.
  test('tracks the whole logical read as optional and abandons a hanging attempt after 8 s on its own timer', async () => {
    jest.resetModules(); jest.useFakeTimers();
    const tracked: { reportFailure: boolean; label?: string }[] = [];
    jest.doMock('../browserActivity', () => ({
      isBrowserInactive: () => false, addBrowserActivityListener: () => {}, removeBrowserActivityListener: () => {},
      browserFallbackFetch: (...args: unknown[]) => (globalThis.fetch as any)(...args),
      trackBrowserRead: (promise: Promise<unknown>, reportFailure = true, label?: string) => { tracked.push({ reportFailure, label }); return promise; },
    }));
    const aborted: string[] = [];
    globalThis.fetch = jest.fn((url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => { aborted.push(url); reject(new DOMException('Aborted', 'AbortError')); });
    })) as unknown as typeof fetch;
    const { directFuturesReferenceStore } = await import('../directFuturesReference');
    const off = directFuturesReferenceStore.subscribe(() => {});
    await Promise.resolve();
    expect(tracked).toEqual([{ reportFailure: false, label: 'futures reference tickers' }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(7_999);
    expect(aborted).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(aborted).toEqual(['/api/v1/market/display']);
    // Retried by the loader's own 60 s timer, still optional — never by the wake.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(tracked.every(read => read.reportFailure === false)).toBe(true);
    off();
  });
});
