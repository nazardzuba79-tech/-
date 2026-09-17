import { resolveNativeReduceTarget } from '../nativeReduceTarget';
import type { NativePosition } from '../nativeDemoApi';

/**
 * WHICH POSITION A REDUCING ORDER TOUCHES.
 *
 * The native account can hold a Cross and an Isolated position on the same
 * contract in the same direction, and two positions can be the same size.
 * The identity of the target is the position ID carried from the table row
 * (or the chart exit); nothing else — not the quantity, not row order, not
 * a candidate in the other bucket — is ever used to pick one.
 */
const protection = { takeProfit: null, stopLoss: null, quantity: null, triggerBy: 'MARK' as const };
function position(id: string, marginMode: 'CROSS' | 'ISOLATED', quantity: string, extra: Partial<NativePosition> = {}): NativePosition {
  return {
    id, symbol: 'BTCUSDT', side: 'LONG', quantity, entryPrice: '50000', markPrice: '51000', lastPrice: '51000', leverage: '10',
    status: 'OPEN', openedAt: 1, closedAt: null, historical: false, unrealizedPnl: '0', realizedPnl: '0', netPnl: '0', roiPercent: '0',
    roiBasis: '1', closedRoiBasis: '0', fundingNet: '0', protection, liquidationPrice: null, liquidationStatus: 'ACCOUNT_CROSS_ESTIMATE',
    marginMode, isolatedMargin: marginMode === 'ISOLATED' ? '5000' : '0', ...extra,
  };
}
const sell = (extra: { marginType?: 'CROSS' | 'ISOLATED'; positionId?: string; symbol?: string; side?: 'BUY' | 'SELL' } = {}) =>
  ({ symbol: 'BTC/USDT', side: 'SELL' as const, ...extra });

describe('a named position is the identity', () => {
  const cross = position('cross', 'CROSS', '1'), isolated = position('isolated', 'ISOLATED', '1');

  test('the table row ID wins over the form bucket', () => {
    expect(resolveNativeReduceTarget([cross, isolated], sell({ marginType: 'CROSS', positionId: 'isolated' }), null).position?.id).toBe('isolated');
  });

  test('a chart exit ID is a name too', () => {
    expect(resolveNativeReduceTarget([cross, isolated], sell({ marginType: 'CROSS' }), 'isolated').position?.id).toBe('isolated');
  });

  test('the row ID wins over a stale chart exit', () => {
    expect(resolveNativeReduceTarget([cross, isolated], sell({ positionId: 'cross' }), 'isolated').position?.id).toBe('cross');
  });

  test('a name that is closed, on another contract, or on the same side is refused — not substituted', () => {
    const closed = position('closed', 'CROSS', '1', { status: 'CLOSED' });
    expect(resolveNativeReduceTarget([cross, closed], sell({ positionId: 'closed' }), null).refusal?.code).toBe('reduce_target_not_open');
    expect(resolveNativeReduceTarget([cross], sell({ positionId: 'missing' }), null).refusal?.code).toBe('reduce_target_not_open');
    expect(resolveNativeReduceTarget([cross], sell({ positionId: 'cross', symbol: 'ETH/USDT' }), null).refusal?.code).toBe('reduce_target_symbol');
    expect(resolveNativeReduceTarget([cross], sell({ positionId: 'cross', side: 'BUY' }), null).refusal?.code).toBe('reduce_target_side');
  });
});

describe('without a name, only ONE candidate in the chosen bucket is acceptable', () => {
  test('one open position of that contract, direction and bucket is the target', () => {
    const cross = position('cross', 'CROSS', '3'), isolated = position('isolated', 'ISOLATED', '7');
    expect(resolveNativeReduceTarget([cross, isolated], sell({ marginType: 'ISOLATED' }), null).position?.id).toBe('isolated');
    expect(resolveNativeReduceTarget([cross, isolated], sell({ marginType: 'CROSS' }), null).position?.id).toBe('cross');
  });

  test('quantity is NOT an identity: two candidates in the bucket are refused even when sizes differ', () => {
    const a = position('a', 'CROSS', '1', { historical: true }), b = position('b', 'CROSS', '2');
    const result = resolveNativeReduceTarget([a, b], sell({ marginType: 'CROSS' }), null);
    expect(result.refusal?.code).toBe('reduce_target_ambiguous');
    expect(result.refusal?.message).toMatch(/таблице/);
  });

  test('no candidate in the chosen bucket is a refusal, never a close in the OTHER bucket', () => {
    const isolated = position('isolated', 'ISOLATED', '1');
    expect(resolveNativeReduceTarget([isolated], sell({ marginType: 'CROSS' }), null).refusal?.code).toBe('reduce_target_missing');
  });

  test('wrong side and closed positions are never candidates', () => {
    const short = position('short', 'CROSS', '1', { side: 'SHORT' });
    const closed = position('closed', 'CROSS', '1', { status: 'CLOSED' });
    expect(resolveNativeReduceTarget([short, closed], sell({ marginType: 'CROSS' }), null).refusal?.code).toBe('reduce_target_missing');
  });

  test('an unspecified bucket considers both buckets, and still refuses two', () => {
    const cross = position('cross', 'CROSS', '1'), isolated = position('isolated', 'ISOLATED', '1');
    expect(resolveNativeReduceTarget([cross], sell(), null).position?.id).toBe('cross');
    expect(resolveNativeReduceTarget([cross, isolated], sell(), null).refusal?.code).toBe('reduce_target_ambiguous');
  });
});
