import { chartExits } from '../nativeChartExits';
import type { NativeEvent } from '../nativeDemoApi';

const event = (id: string, kind: string, time: number, quantity: string, price: string, actionId?: string): NativeEvent =>
  ({ id, kind, time, positionId: 'p', orderId: null, symbol: 'BTCUSDT', quantity, price, fee: '0', cashflow: '0', pricing: 'OBSERVED_BOOK', ...(actionId ? { actionId } : {}) });

describe('one close action draws one marker', () => {
  test('several fills of ONE close action fold into one marker at the quantity-weighted price', () => {
    const exits = chartExits([
      event('e1', 'CLOSE', 1000, '0.4', '100', 'close-a'),
      event('e2', 'CLOSE', 1000, '0.4', '99', 'close-a'),
      event('e3', 'CLOSE', 1000, '0.2', '98', 'close-a'),
    ], 'p');
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ kind: 'CLOSE', quantity: 1 });
    expect(exits[0].price).toBeCloseTo((0.4 * 100 + 0.4 * 99 + 0.2 * 98) / 1, 10);
  });

  test('two different close actions within the same seconds stay two markers', () => {
    const exits = chartExits([
      event('e1', 'CLOSE', 1000, '0.5', '100', 'close-a'),
      event('e2', 'CLOSE', 1500, '0.5', '99', 'close-b'),
    ], 'p');
    expect(exits).toHaveLength(2);
  });

  test('a liquidation and a close are never folded into one another', () => {
    const exits = chartExits([
      event('e1', 'CLOSE', 1000, '0.5', '100', 'a'),
      event('e2', 'LIQUIDATION', 1000, '0.5', '90', 'a'),
    ], 'p');
    expect(exits.map(e => e.kind)).toEqual(['CLOSE', 'LIQUIDATION']);
  });

  test('events without an action id keep the historical 15-second window rule', () => {
    const exits = chartExits([
      event('e1', 'CLOSE', 1000, '0.5', '100'),
      event('e2', 'CLOSE', 5000, '0.5', '99'),
      event('e3', 'CLOSE', 30000, '0.5', '98'),
    ], 'p');
    expect(exits).toHaveLength(2);
  });

  test('journal order is numeric on the event id, not lexical', () => {
    const exits = chartExits([
      event('e10', 'CLOSE', 1000, '0.1', '110', 'a'),
      event('e9', 'CLOSE', 1000, '0.1', '90', 'a'),
    ], 'p');
    expect(exits).toHaveLength(1);
    expect(exits[0].price).toBeCloseTo(100, 10);
  });
});
