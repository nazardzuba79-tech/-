import { parseDirectFuturesTickers } from '../directFuturesReference';

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
