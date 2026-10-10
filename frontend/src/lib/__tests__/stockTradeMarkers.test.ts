import { groupTrades, layoutTradeGroups, quoteAge } from '../../pages/stocks/global/tradeMarkers';
import type { Candle, Fill } from '../../pages/stocks/global/types';

const candle = (time: number): Candle => ({ time, open: 100, high: 102, low: 99, close: 101, volume: 10 });
const fill = (id: string, timestamp: number, side = 'BUY', instrumentId = 'BYBIT:AAPLXUSDT'): Fill => ({
  id, timestamp, side, instrumentId, currency: 'USDT', quantity: '0.25000000', price: '100.00000000',
  nativePrice: '100.00000000', realized: side === 'SELL' ? '0.50000000' : '0.00000000', provider: 'bybit', quoteTimestamp: timestamp,
});

describe('Stocks compact trade markers preserve the ledger', () => {
  it('groups buys and sells on the same actual candle, retaining full execution details', () => {
    const trades = [fill('sell', 110_000, 'SELL'), fill('buy', 100_000)];
    const original = JSON.stringify(trades);
    const groups = groupTrades('BYBIT:AAPLXUSDT', '1m', [candle(60)], trades);
    expect(groups).toHaveLength(1);
    expect(groups[0].fills.map(f => f.id)).toEqual(['buy', 'sell']);
    expect(groups[0].fills[1].realized).toBe('0.50000000');
    expect(JSON.stringify(trades)).toBe(original);
  });
  it('keeps provider/token identities separate even when the underlying company matches', () => {
    const trades = [fill('x', 100_000), fill('b', 100_000, 'BUY', 'BINANCE:AAPLBUSDT')];
    expect(groupTrades('BYBIT:AAPLXUSDT', '1m', [candle(60)], trades)[0].fills.map(f => f.id)).toEqual(['x']);
  });
  it('uses half-open candle intervals and never maps executions into missing session bars', () => {
    const trades = [fill('before', 59_999), fill('first', 60_000), fill('next', 120_000), fill('gap', 190_000), fill('later', 360_000)];
    expect(groupTrades('BYBIT:AAPLXUSDT', '1m', [candle(60), candle(120), candle(360)], trades)
      .map(g => g.fills.map(f => f.id))).toEqual([['first'], ['next'], ['later']]);
  });
  it('supports every offered native interval without mutating fills', () => {
    for (const [interval, seconds] of Object.entries({ '1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,'1D':86400 })) {
      expect(groupTrades('BYBIT:AAPLXUSDT', interval, [candle(0)], [fill('last', seconds * 1000 - 1), fill('outside', seconds * 1000)])[0].fills.map(f => f.id)).toEqual(['last']);
    }
    expect(groupTrades('BYBIT:AAPLXUSDT', 'unknown', [candle(0)], [fill('x', 1)])).toEqual([]);
  });
  it('clusters adjacent screen positions so markers cannot overlap at small zoom', () => {
    const groups = [0, 60, 120, 180].map(time => ({ time, fills: [fill(String(time), time * 1000)] }));
    const before = JSON.stringify(groups);
    const screen = layoutTradeGroups(groups, time => time / 4, 100);
    expect(screen).toHaveLength(1);
    expect(screen[0].fills).toHaveLength(4);
    expect(JSON.stringify(groups)).toBe(before);
    const zoomed = layoutTradeGroups(groups, time => time, 220);
    expect(zoomed).toHaveLength(4);
    expect(zoomed.every((g, i) => !i || g.x - zoomed[i - 1].x >= 34)).toBe(true);
  });
  it('hides offscreen groups and keeps touch targets away from the price axis', () => {
    const groups = [-10, 0, 100, 110].map(time => ({ time, fills: [fill(String(time), time)] }));
    const screen = layoutTradeGroups(groups, time => time, 100);
    expect(screen.map(g => g.x)).toEqual([17, 83]);
    expect(layoutTradeGroups(groups, () => null, 100)).toEqual([]);
    expect(layoutTradeGroups(groups, time => time, 20)).toEqual([]);
  });
});

it('labels last-known quote age explicitly even when refresh fails', () => {
  expect(quoteAge(undefined, 100000)).toBe('Время не подтверждено');
  expect(quoteAge(1000, 31_000)).toBe('30 с назад');
  expect(quoteAge(1000, 181_000)).toBe('3 мин назад');
  expect(quoteAge(1000, 7_201_000)).toBe('2 ч назад');
});
