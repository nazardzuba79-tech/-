import { hash } from '../store';
import { compact, inflate, revisionPayload, type NativeAccount } from '../native/store';
import { emptyDemoState } from '../native/engine';

describe('private command request identity', () => {
  test('equivalent nested object keys preserve idempotence after JSON storage reorders keys', () => {
    const request = { id: 'position', marginDelta: '10', protection: { stopLoss: '90', takeProfit: '120' }, events: [{ id: 'a', amount: '1' }, { id: 'b', amount: '2' }] };
    const persisted = { events: [{ amount: '1', id: 'a' }, { amount: '2', id: 'b' }], protection: { takeProfit: '120', stopLoss: '90' }, marginDelta: '10', id: 'position' };
    expect(hash(request)).toBe(hash(persisted));
    expect(hash({ ...request, unused: undefined })).toBe(hash(request));
  });
  test('changed money, event ordering and null remain different commands', () => {
    const request = { amount: '10', events: ['a', 'b'] };
    expect(hash({ ...request, amount: '11' })).not.toBe(hash(request));
    expect(hash({ ...request, events: ['b', 'a'] })).not.toBe(hash(request));
    expect(hash({ ...request, optional: null })).not.toBe(hash(request));
  });
});

describe('the stored native account carries each instrument once', () => {
  const instrument = (symbol: string) => ({
    rules: { symbol, tickSize: '0.1', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' },
    profile: { pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture', takerFeeRate: '0.00055', makerFeeRate: '0.0002', liquidationFeeRate: '0', slippageBps: '0',
      riskTiers: Array.from({ length: 20 }, (_, i) => ({ maxNotional: String(100000 * (i + 1)), maintenanceRate: (0.005 + 0.005 * i).toFixed(4), deduction: String(500 * i * (i + 1) / 2) })), assumptions: [] },
  });
  const open = (id: string, symbol: string): NativeAccount['commands'][number] => ({ id, kind: 'OPEN', at: 1, seq: 1, order: { id, symbol, side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10' }, instrument: instrument(symbol), mark: '100', last: '100', point: '100' });
  const account = (): NativeAccount => ({
    revision: 3, deposit: '1000', createdAt: 1, source: 'DEMO_BALANCE', snapshot: emptyDemoState('1000', 1),
    commands: [open('a', 'AAAUSDT'), open('b', 'AAAUSDT'), open('c', 'BBBUSDT'), { id: 'x', kind: 'CANCEL', at: 2, orderId: 'a' }, open('d', 'AAAUSDT')],
  });

  test('compact replaces repeated instruments by a reference and inflate restores the exact instructions', () => {
    const original = account();
    const stored = compact(original);
    expect(Object.keys(stored.instrumentTable!).sort()).toHaveLength(2);
    for (const c of stored.commands as Array<Record<string, unknown>>) if (c.kind === 'OPEN') { expect(c).not.toHaveProperty('instrument'); expect(typeof c.instrumentRef).toBe('string'); }
    expect(inflate(JSON.parse(JSON.stringify(stored)))).toEqual(JSON.parse(JSON.stringify(original)));
  });

  test('the stored payload is a fraction of the inflated one, and a row without a table reads as before', () => {
    const original = account();
    const inflated = JSON.stringify(original).length, compacted = JSON.stringify(compact(original)).length;
    expect(compacted).toBeLessThan(inflated * 0.6);
    // An older row has no table and is returned untouched.
    expect(inflate(original)).toBe(original);
    // The revision payload compacts the same way.
    expect(inflate(JSON.parse(JSON.stringify(compact(revisionPayload(original)))))).toEqual(JSON.parse(JSON.stringify(revisionPayload(original))));
  });

  test('a reference that has no instrument is refused rather than replayed as nothing', () => {
    const stored = compact(account());
    delete stored.instrumentTable!['AAAUSDT#' + (Object.keys(stored.instrumentTable!).find(k => k.startsWith('AAAUSDT')) as string).split('#')[1]];
    expect(() => inflate(stored)).toThrow(/журнал|journal_corrupt/i);
  });
});
