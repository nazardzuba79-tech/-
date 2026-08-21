import { CandleService } from '../CandleService';

const FIXED_NOW = new Date('2026-01-01T00:05:00.000Z').getTime(); // exactly on a minute boundary

function makeTrade(price: string, quantity: string, secondsBeforeNow: number) {
  return {
    price: { toString: () => price } as any,
    quantity: { toString: () => quantity } as any,
    executedAt: new Date(FIXED_NOW - secondsBeforeNow * 1000),
  };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('CandleService', () => {
  it('buckets trades into the correct 1-minute candles with correct OHLC', () => {
    const trades = [
      makeTrade('100', '1', 170), // bucket A (00:02:10)
      makeTrade('105', '2', 150), // bucket A (00:02:30)
      makeTrade('102', '1', 130), // bucket A (00:02:50, last -> close)
      makeTrade('110', '1', 50), // bucket B (00:04:10)
      makeTrade('108', '1', 10), // bucket B (00:04:50, last -> close)
    ];
    const prisma = { trade: { findMany: jest.fn().mockResolvedValue(trades) } } as any;
    const service = new CandleService(prisma);

    return service.getCandles('BTC/USDT', '1m', 10).then((candles) => {
      expect(candles).toHaveLength(2);

      const [a, b] = candles;
      expect(a.open).toBe(100);
      expect(a.high).toBe(105);
      expect(a.low).toBe(100);
      expect(a.close).toBe(102);
      expect(a.volume).toBe(4);

      expect(b.open).toBe(110);
      expect(b.close).toBe(108);
      expect(b.volume).toBe(2);

      expect(a.time).toBeLessThan(b.time);
    });
  });

  it('returns an empty array when there are no trades', async () => {
    const prisma = { trade: { findMany: jest.fn().mockResolvedValue([]) } } as any;
    const service = new CandleService(prisma);
    const candles = await service.getCandles('BTC/USDT', '1h');
    expect(candles).toEqual([]);
  });
});
