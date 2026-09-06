import { retainPublishedQuantityTail } from '../publishedQuantityCompatibility';
import { loadPublishedKseniaState } from '../approvedPerformanceSeeds';

const original = loadPublishedKseniaState().cashflow.copiedTrades[0];

test('only an exact approved record may retain its stored quantity after a sub-machine replay difference', () => {
  const oldBytes = JSON.stringify(original);
  const candidate = { ...original, quantity: original.quantity * (1 + Number.EPSILON) };
  expect(candidate.quantity).not.toBe(original.quantity);
  expect(retainPublishedQuantityTail(original, candidate)).toBe(true);
  expect(JSON.stringify(original)).toBe(oldBytes);
});

test('monetary and price fields have zero tolerance, even inside the quantity transport bound', () => {
  const candidate = { ...original, quantity: original.quantity * (1 + Number.EPSILON) };
  for (const field of ['notional', 'grossPnlBeforeCosts', 'tradingFees', 'funding', 'executionCost', 'grossPnl', 'entryPrice', 'exitPrice'] as const) {
    expect(retainPublishedQuantityTail(original, { ...candidate, [field]: candidate[field] + .0001 })).toBe(false);
  }
});

test('future records, changed historical records, zero/nonfinite quantities and out-of-bound changes stay strict', () => {
  const candidate = { ...original, quantity: original.quantity * (1 + Number.EPSILON) };
  expect(retainPublishedQuantityTail({ ...original, quantity: candidate.quantity }, original)).toBe(false);
  const unknown = { ...original, id: 'KS-COHORT-001:copy:KS-REV-9999999' };
  expect(retainPublishedQuantityTail(unknown, { ...unknown, quantity: candidate.quantity })).toBe(false);
  for (const quantity of [0, NaN, Infinity, original.quantity * (1 + Number.EPSILON * 32)]) {
    expect(retainPublishedQuantityTail(original, { ...original, quantity })).toBe(false);
  }
  expect(retainPublishedQuantityTail(original, original)).toBe(false);
});
