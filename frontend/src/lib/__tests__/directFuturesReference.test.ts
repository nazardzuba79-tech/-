import { parseDirectFuturesTickers, parseNormalizedFuturesSnapshot } from '../directFuturesReference';

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
