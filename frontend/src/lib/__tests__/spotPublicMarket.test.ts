import { parseDirectSpotBook, parseDirectSpotCandles } from '../spotPublicMarket';

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
