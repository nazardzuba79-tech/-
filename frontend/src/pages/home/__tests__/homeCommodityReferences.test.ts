import { parseGoldReference, parseOilReference } from '../useHomeCommodityReferences';

const now = Date.parse('2026-09-12T20:00:00Z');

test('accepts a fresh real gold reference price', () => {
  expect(parseGoldReference({ price: 4323.1, updatedAt: '2026-09-12T19:59:30Z' }, now)).toMatchObject({
    price: 4323.1,
    source: 'gold-api',
    label: 'XAU/USD',
  });
});

test('rejects stale, zero or malformed gold data rather than inventing a value', () => {
  expect(parseGoldReference({ price: 4323.1, updatedAt: '2026-09-12T19:30:00Z' }, now)).toBeNull();
  expect(parseGoldReference({ price: 0, updatedAt: '2026-09-12T19:59:30Z' }, now)).toBeNull();
  expect(parseGoldReference({ price: 'not-a-price', updatedAt: '2026-09-12T19:59:30Z' }, now)).toBeNull();
});

test('accepts a fresh Brent reference with a contributing source', () => {
  expect(parseOilReference({ base: 'USD', price: 108.07, sources: 2, timestamp: '2026-09-12T19:20:00Z' }, now)).toMatchObject({
    price: 108.07,
    source: 'croncopia',
    label: 'Brent · USD/bbl',
  });
});

test('rejects stale, wrong-currency or source-less oil data', () => {
  expect(parseOilReference({ base: 'USD', price: 108.07, sources: 1, timestamp: '2026-09-12T14:00:00Z' }, now)).toBeNull();
  expect(parseOilReference({ base: 'EUR', price: 108.07, sources: 1, timestamp: '2026-09-12T19:20:00Z' }, now)).toBeNull();
  expect(parseOilReference({ base: 'USD', price: 108.07, sources: 0, timestamp: '2026-09-12T19:20:00Z' }, now)).toBeNull();
});
