import type { NativeAccount } from '../../../private-trading/native/store';
import { futuresDemoSourceFills, futuresDemoSourceNotional, futuresDemoSourceRiskCheck } from '../FuturesDemoSource';

function fixture(): NativeAccount {
  // Minimal persisted-journal fixture. This is NOT a trusted client payload.
  return {
    executionMode: 'LIVE_EXECUTION',
    commands: [{
      id: 'native-open-1', kind: 'OPEN', at: 1,
      order: { id: 'native-order-1', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET',
        quantity: '1', leverage: '2', marginType: 'CROSS', historical: false },
    }, {
      id: 'native-close-1', kind: 'CLOSE', at: 2, positionId: 'native-position-1',
    }],
    snapshot: {
      positions: [{ id: 'native-position-1', symbol: 'BTCUSDT', side: 'LONG',
        leverage: '2', marginType: 'CROSS', historical: false }],
      events: [
        { id: 'native-event-1', actionId: 'native-open-1', orderId: 'native-order-1',
          positionId: 'native-position-1', kind: 'OPEN', symbol: 'BTCUSDT', quantity: '0.25',
          price: '65000', pricing: 'OBSERVED_BOOK' },
        { id: 'native-event-2', actionId: 'native-close-1', orderId: null,
          positionId: 'native-position-1', kind: 'CLOSE', symbol: 'BTCUSDT', quantity: '0.10',
          price: '66000', pricing: 'OBSERVED_BOOK' },
      ],
    },
  } as unknown as NativeAccount;
}
const mutate = (fn: (row: NativeAccount) => void) => {
  const row = fixture(); fn(row); return futuresDemoSourceFills(row);
};
describe('Native Futures demo-copy source: read-only provenance and risk admission', () => {
  test('only real committed OPEN/CLOSE event receipts, not requested order size', () => {
    const result = futuresDemoSourceFills(fixture());
    expect(result.rejected).toEqual([]);
    expect(result.accepted.map(f => [f.kind, f.quantity, f.sourceEventId]))
      .toEqual([['OPEN', '0.25', 'native-event-1'], ['CLOSE', '0.10', 'native-event-2']]);
    expect(futuresDemoSourceNotional(result.accepted[0])).toBe('16250');
  });
  test('historical accounts refuse, while legacy initialized accounts default to LIVE', () => {
    expect(mutate(row => { row.executionMode = 'HISTORICAL_DEMO'; }).accepted).toEqual([]);
    // PrismaNativeRepository.initialize omits executionMode; native service displays
    // that state as LIVE_EXECUTION, so rejecting it would disable real fixtures.
    expect(mutate(row => { delete row.executionMode; }).accepted).toHaveLength(2);
  });
  test('historical candle and historical instruction are excluded', () => {
    expect(mutate(row => { (row.commands[0] as any).candle = { source: 'BYBIT_LINEAR' }; }).rejected[0].reason).toBe('HISTORICAL_SOURCE');
    expect(mutate(row => { (row.commands[0] as any).executionMode = 'HISTORICAL_DEMO'; }).rejected[0].reason).toBe('HISTORICAL_SOURCE');
  });
  test('fake action, missing source link and wrong type are refused', () => {
    expect(mutate(row => { row.snapshot.events[0].actionId = 'forged'; }).rejected[0].reason).toBe('UNVERIFIED_SOURCE_ACTION');
    expect(mutate(row => { delete row.snapshot.events[0].actionId; }).rejected[0].reason).toBe('MISSING_SOURCE_ACTION');
    expect(mutate(row => { row.snapshot.events[0].actionId = 'native-close-1'; }).rejected[0].reason).toBe('UNVERIFIED_SOURCE_ACTION');
  });
  test('requested order and position must match persisted event', () => {
    expect(mutate(row => { row.snapshot.events[0].orderId = 'unrelated'; }).rejected[0].reason).toBe('SOURCE_ORDER_MISMATCH');
    expect(mutate(row => { row.snapshot.events[0].positionId = 'unrelated'; }).rejected[0].reason).toBe('UNVERIFIED_SOURCE_POSITION');
    expect(mutate(row => { row.snapshot.events[1].positionId = 'unrelated'; }).rejected[0].reason).toBe('UNVERIFIED_SOURCE_POSITION');
  });
  test('only observed-book or maker-model fills are eligible', () => {
    for (const pricing of ['OHLC_PATH_MODEL', 'MARK_SETTLEMENT', 'SELECTED_POINT', 'NEAR_LIVE_DEMO'] as const) {
      const r = mutate(row => { row.snapshot.events[0].pricing = pricing; });
      expect(r.rejected[0].reason).toBe('NOT_BOOK_FILL');
      expect(r.accepted.map(e => e.sourceEventId)).toEqual(['native-event-2']);
    }
  });
  test('automated liquidation/funding and synthetic models never become copy intents', () => {
    const r = mutate(row => {
      row.snapshot.events.push({ ...row.snapshot.events[0], id: 'liquidation-event', kind: 'LIQUIDATION' });
      row.snapshot.events.push({ ...row.snapshot.events[0], id: 'funding-event', kind: 'FUNDING' });
    });
    expect(r.accepted).toHaveLength(2);
  });
  test('duplicates and invalid decimals are rejected, not double-copied', () => {
    expect(mutate(row => { row.snapshot.events[1].id = row.snapshot.events[0].id; }).rejected[0].reason).toBe('DUPLICATE_SOURCE_EVENT');
    expect(mutate(row => { row.snapshot.events[0].quantity = '0'; }).rejected[0].reason).toBe('INVALID_EXECUTED_FILL');
    expect(mutate(row => { row.snapshot.events[0].price = 'Infinity'; }).rejected[0].reason).toBe('INVALID_EXECUTED_FILL');
    expect(mutate(row => { row.snapshot.events[0].price = '-1'; }).rejected[0].reason).toBe('INVALID_EXECUTED_FILL');
  });
  test('explicit leverage and per-fill notional caps before any future executor', () => {
    const fill = futuresDemoSourceFills(fixture()).accepted[0];
    expect(futuresDemoSourceRiskCheck(fill, '2', '16250')).toBeNull();
    expect(futuresDemoSourceRiskCheck(fill, '1', '20000')).toBe('LEVERAGE_CAP_EXCEEDED');
    expect(futuresDemoSourceRiskCheck(fill, '2', '10000')).toBe('FILL_NOTIONAL_CAP_EXCEEDED');
    expect(futuresDemoSourceRiskCheck(fill, '0', '10000')).toBe('INVALID_FOLLOWER_CAP');
  });
});
