import { parseDirectSpotBook, parseDirectSpotCandles, readSpotPublicBook } from '../spotPublicMarket';
jest.mock('../api', () => ({ API_BASE: 'https://voltex-api.invalid/api/v1' }));
jest.mock('../testMarketStore', () => ({ fetchTestMarketJson: jest.fn() }));
// This suite covers existing venue/VTA transport with the optional factory OFF.
// Enabled factory routing is exercised against workerd by qa-managed-listings.
jest.mock('../managedListings', () => ({ isManagedPair: () => false, fetchManagedPublic: jest.fn() }));

test('VTA book uses only VOLTEX API, including errors and pre-listing; no external fallback', async () => {
  const { fetchTestMarketJson } = require('../testMarketStore');
  const originalFetch = global.fetch;
  global.fetch = jest.fn();
  try {
    fetchTestMarketJson.mockResolvedValueOnce({ pair:'VTA/USDT', bids:[{price:'0.01',quantity:'100'}],asks:[{price:'0.010004',quantity:'120'}],timestamp:1 });
    expect((await readSpotPublicBook('VTA/USDT')).bids).toHaveLength(1);
    expect(fetchTestMarketJson).toHaveBeenCalledWith('https://voltex-api.invalid/api/v1/market/display/spot-book/VTA-USDT', undefined);
    fetchTestMarketJson.mockResolvedValueOnce({ pair:'VTA/USDT',available:false,bids:[],asks:[],timestamp:1 });
    expect((await readSpotPublicBook('VTA/USDT')).status).toBe('unavailable');
    fetchTestMarketJson.mockRejectedValueOnce(new Error('offline'));
    await expect(readSpotPublicBook('VTA/USDT')).rejects.toThrow('offline');
    expect(global.fetch).not.toHaveBeenCalled();
  } finally { global.fetch = originalFetch; }
});

test('normalizes Kraken spot depth without inventing levels', () => {
  const snapshot = parseDirectSpotBook({
    error: [],
    result: {
      XBTUSDT: {
        bids: [['100.00','1.5',1790150000.1],['99.90','2',1790150000.0]],
        asks: [['100.10','1.1',1790150000.2],['100.20','2.2',1790150000.0]],
      },
    },
  }, 'BTC/USDT');

  expect(snapshot.bids).toEqual([
    { price:'100.00', quantity:'1.5' },
    { price:'99.90', quantity:'2' },
  ]);
  expect(snapshot.asks[0]).toEqual({ price:'100.10', quantity:'1.1' });
  expect(snapshot.asOf).toBe(1790150000200);
  expect(snapshot.status).toBe('live');
});

test('rejects crossed or malformed Kraken spot books', () => {
  expect(() => parseDirectSpotBook({
    error: [],
    result: { XBTUSDT: { bids:[['101','1',1]], asks:[['100','1',1]] } },
  }, 'BTC/USDT')).toThrow();

  expect(() => parseDirectSpotBook({
    error: [],
    result: { XBTUSDT: { bids:[['100','nope',1]], asks:[['101','1',1]] } },
  }, 'BTC/USDT')).toThrow();
});

test('normalizes Kraken OHLC candles and preserves real OHLCV', () => {
  const candles = parseDirectSpotCandles({
    error: [],
    result: {
      XBTUSDT: [
        [1790146800,'100','102','99','101','100.5','1234',12],
        [1790150400,'101','103','100','102','102','1500',14],
      ],
      last: 1790150400,
    },
  });

  expect(candles).toEqual([
    { time:1790146800, open:100, high:102, low:99, close:101, volume:1234 },
    { time:1790150400, open:101, high:103, low:100, close:102, volume:1500 },
  ]);
});

test('rejects provider errors instead of fabricating candles', () => {
  expect(() => parseDirectSpotCandles({ error:['EGeneral:Unavailable'], result:{} })).toThrow();
});
