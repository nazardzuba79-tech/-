'use strict';
// ALL prices/providers below are deterministic TEST FIXTURES, never production data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ReferenceQuoteRouter } = require(path.resolve(process.env.CFD_ROUTER_BUILD || 'dist/services/marketData/cfd/ReferenceQuoteRouter.js'));
const START = Date.parse('2026-09-13T12:00:00Z');
const instrument = { id: 'fixture-XAU-spot-last', contract: 'spot:XAU', currency: 'USD', unit: 'troy_oz', kind: 'last' };
function admission(provider, extra = {}) {
  return { provider, instrument, providerSymbol: 'XAU/USD', mappingEvidence: 'fixture:mapping', displayRightsEvidence: 'fixture:rights',
    enabled: true, lineage: provider, priority: provider === 'primary' ? 1 : 2, maxSourceAgeMs: 5000, maxReceiveAgeMs: 5000, ...extra };
}
function observation(provider, extra = {}) {
  return { ...instrument, provider, providerSymbol: 'XAU/USD', priceDecimal: '100.1234567890123456789',
    sourceTimestamp: START, observationDate: null, receivedAt: START, marketState: 'open', ...extra };
}
function setup(extra = {}, admissions = [admission('primary'), admission('reserve')]) {
  let clock = START;
  const router = new ReferenceQuoteRouter(admissions, { now: () => clock, ...extra });
  return { router, time: value => { clock = value; } };
}
test('empty and unknown instruments return null, never zero', () => {
  const { router } = setup();
  for (const id of [instrument.id, 'unknown']) {
    const q = router.read(id); assert.equal(q.quote, null); assert.equal(q.status, 'unavailable'); assert.equal(q.executionAllowed, false);
  }
});
test('exact provider decimal is preserved without binary rounding', () => {
  const { router } = setup(); router.ingest(observation('primary'));
  assert.equal(router.read(instrument.id).quote.priceDecimal, '100.1234567890123456789');
});
test('healthy reserve takes over immediately when primary fails', () => {
  const { router } = setup(); router.ingest(observation('primary')); router.ingest(observation('reserve'));
  assert.equal(router.read(instrument.id).quote.provider, 'primary'); router.fail('primary', instrument.id);
  assert.equal(router.read(instrument.id).quote.provider, 'reserve');
});
test('both failed yields null current, separately labelled last-known', () => {
  const { router } = setup(); router.ingest(observation('primary')); router.read(instrument.id); router.fail('primary', instrument.id);
  const q = router.read(instrument.id); assert.equal(q.quote, null); assert.equal(q.status, 'unavailable'); assert.ok(q.lastKnown);
});
test('freshness is rechecked on every read, including cached data', () => {
  const { router, time } = setup(); router.ingest(observation('primary')); router.read(instrument.id); time(START + 5001);
  assert.equal(router.read(instrument.id).quote, null);
});
test('re-fetching an old source timestamp does not refresh the data age', () => {
  const { router, time } = setup(); router.ingest(observation('primary')); time(START + 5001);
  assert.equal(router.ingest(observation('primary', { receivedAt: START + 5001 })), false);
});
test('future source timestamps are rejected', () => {
  const { router } = setup(); assert.equal(router.ingest(observation('primary', { sourceTimestamp: START + 1001 })), false);
});
test('future received timestamps are rejected', () => {
  const { router } = setup(); assert.equal(router.ingest(observation('primary', { receivedAt: START + 1001 })), false);
});
test('missing source timestamp cannot masquerade as a live observation', () => {
  const { router } = setup(); assert.equal(router.ingest(observation('primary', { sourceTimestamp: null })), false);
});
test('wrong symbol, currency, unit, contract or kind is rejected', () => {
  for (const change of [{ providerSymbol: 'XAG/USD' }, { currency: 'EUR' }, { unit: 'gram' }, { contract: 'future:XAU:202612' }, { kind: 'mid' }]) {
    const { router } = setup(); assert.equal(router.ingest(observation('primary', change)), false);
  }
});
test('WTI cannot substitute Brent through an ambiguous registry ID', () => {
  assert.throws(() => setup({}, [admission('primary'), admission('reserve', { instrument: { ...instrument, contract: 'spot:WTI' } })]));
});
test('unknown, disabled or missing-rights providers are denied', () => {
  for (const extra of [{ enabled: false }, { mappingEvidence: '' }, { displayRightsEvidence: '' }]) {
    const { router } = setup({}, [admission('primary', extra)]); assert.equal(router.ingest(observation('primary')), false);
  }
  assert.equal(setup().router.ingest(observation('unregistered')), false);
});
test('revoke immediately removes current and historical data from that provider', () => {
  const { router } = setup(); router.ingest(observation('primary')); router.read(instrument.id); router.revoke('primary', instrument.id);
  const q = router.read(instrument.id); assert.equal(q.quote, null); assert.equal(q.lastKnown, null); assert.equal(router.ingest(observation('primary')), false);
});
test('same upstream via two delivery providers is NOT two independent sources', () => {
  const { router } = setup({}, [admission('primary', { lineage: 'fixture:EIA' }), admission('reserve', { lineage: 'fixture:EIA' })]);
  router.ingest(observation('primary')); router.ingest(observation('reserve'));
  assert.equal(router.read(instrument.id).verifiedIndependentSources, 1); assert.equal(router.read(instrument.id).redundant, false);
});
test('unknown upstream lineage does not count as verified independence', () => {
  const { router } = setup({}, [admission('primary', { lineage: null }), admission('reserve', { lineage: null })]);
  router.ingest(observation('primary')); router.ingest(observation('reserve')); assert.equal(router.read(instrument.id).verifiedIndependentSources, 0);
});
test('comparable disagreement quarantines instead of averaging', () => {
  const { router } = setup(); router.ingest(observation('primary', { priceDecimal: '100' })); router.ingest(observation('reserve', { priceDecimal: '110' }));
  const q = router.read(instrument.id); assert.equal(q.status, 'conflict'); assert.equal(q.quote, null); assert.equal(q.redundant, false);
});
test('accepted prices are never averaged', () => {
  const { router } = setup(); router.ingest(observation('primary', { priceDecimal: '100' })); router.ingest(observation('reserve', { priceDecimal: '100.1' }));
  assert.equal(router.read(instrument.id).quote.priceDecimal, '100');
});
test('genuine zero and negative reference values are not missing values', () => {
  for (const priceDecimal of ['0', '-37.63']) {
    const { router } = setup(); assert.equal(router.ingest(observation('primary', { priceDecimal })), true);
    assert.equal(router.read(instrument.id).quote.priceDecimal, priceDecimal); assert.equal(router.read(instrument.id).executionAllowed, false);
  }
});
test('non-decimal and non-finite values are rejected', () => {
  for (const priceDecimal of ['', ' ', 'NaN', 'Infinity', '0x10', '1e999', null, 0, true]) {
    assert.equal(setup().router.ingest(observation('primary', { priceDecimal })), false);
  }
});
test('older responses do not overwrite a newer observation', () => {
  const { router, time } = setup(); time(START + 1000); router.ingest(observation('primary', { sourceTimestamp: START + 1000, receivedAt: START + 1000 }));
  assert.equal(router.ingest(observation('primary')), false); assert.equal(router.read(instrument.id).quote.sourceTimestamp, START + 1000);
});
test('same-timestamp contradictory update is denied', () => {
  const { router } = setup(); router.ingest(observation('primary')); assert.equal(router.ingest(observation('primary', { priceDecimal: '120' })), false);
  assert.equal(router.read(instrument.id).quote, null);
});
test('closed-market reference is labelled, not executable', () => {
  const { router } = setup(); router.ingest(observation('primary', { marketState: 'closed' }));
  assert.equal(router.read(instrument.id).status, 'market_closed'); assert.equal(router.read(instrument.id).executionAllowed, false);
});
test('daily dates retain their actual precision; no invented 23:59:59 timestamp', () => {
  const daily = { ...instrument, id: 'fixture-Brent-EIA-daily', contract: 'spot:Brent:EIA-assessment', unit: 'barrel', kind: 'daily_reference' };
  const { router } = setup({}, [admission('primary', { instrument: daily, maxSourceAgeMs: 10 * 86400000 })]);
  const q = observation('primary', { ...daily, sourceTimestamp: null, observationDate: '2026-09-11' });
  assert.equal(router.ingest(q), true); assert.equal(router.read(daily.id).quote.sourceTimestamp, null);
  assert.equal(router.ingest({ ...q, sourceTimestamp: START }), false);
});
test('invalid and future daily dates are rejected', () => {
  const daily = { ...instrument, kind: 'daily_reference' };
  for (const observationDate of ['2026-02-30', '2026-09-14', 'not-a-date']) {
    const { router } = setup({}, [admission('primary', { instrument: daily, maxSourceAgeMs: 365 * 86400000 })]);
    assert.equal(router.ingest(observation('primary', { ...daily, sourceTimestamp: null, observationDate })), false);
  }
});
test('a newer daily release wins even if delivered by lower priority provider', () => {
  const daily = { ...instrument, kind: 'daily_reference' };
  const admissions = ['primary', 'reserve'].map(p => admission(p, { instrument: daily, maxSourceAgeMs: 10 * 86400000 }));
  const { router } = setup({}, admissions);
  router.ingest(observation('primary', { ...daily, sourceTimestamp: null, observationDate: '2026-09-10', priceDecimal: '100' }));
  router.ingest(observation('reserve', { ...daily, sourceTimestamp: null, observationDate: '2026-09-11', priceDecimal: '110' }));
  assert.equal(router.read(daily.id).quote.provider, 'reserve');
});
test('failback waits for distinct healthy samples and hold time', () => {
  const { router, time } = setup({ failbackHoldMs: 2000 });
  router.ingest(observation('primary')); router.ingest(observation('reserve')); router.read(instrument.id); router.fail('primary', instrument.id); router.read(instrument.id);
  for (const elapsed of [1000, 2000, 3000]) {
    time(START + elapsed);
    router.ingest(observation('primary', { sourceTimestamp: START + elapsed, receivedAt: START + elapsed }));
    router.ingest(observation('reserve', { sourceTimestamp: START + elapsed, receivedAt: START + elapsed }));
    assert.equal(router.read(instrument.id).quote.provider, elapsed < 3000 ? 'reserve' : 'primary');
  }
});
test('replayed samples do not qualify a primary for failback', () => {
  const { router } = setup({ failbackHoldMs: 0 }); router.ingest(observation('primary')); router.ingest(observation('reserve')); router.read(instrument.id);
  router.fail('primary', instrument.id); router.read(instrument.id);
  for (let i = 0; i < 5; i++) router.ingest(observation('primary'));
  assert.equal(router.read(instrument.id).quote.provider, 'reserve');
});
test('external mutation cannot alter cache, admission, or returned history', () => {
  const a = admission('primary', { instrument: { ...instrument } }); const { router } = setup({}, [a]); a.enabled = false; a.instrument.currency = 'EUR';
  const original = observation('primary'); router.ingest(original); original.priceDecimal = '200';
  const selected = router.read(instrument.id); selected.quote.priceDecimal = '300';
  assert.equal(router.read(instrument.id).quote.priceDecimal, '100.1234567890123456789');
});
test('duplicate and excessive admissions are rejected', () => {
  assert.throws(() => setup({}, [admission('primary'), admission('primary')]));
  assert.throws(() => setup({}, Array.from({ length: 257 }, (_, n) => admission(`p${n}`))));
});
test('invalid router policy is rejected', () => {
  for (const policy of [{ maxSkewMs: -1 }, { maxDivergenceBps: NaN }, { failbackSamples: 0 }, { failbackHoldMs: Infinity }]) assert.throws(() => setup(policy));
});

test('a late now-stale response cannot poison an already newer healthy quote', () => {
  const { router, time } = setup(); time(START + 6000);
  router.ingest(observation('primary', { sourceTimestamp: START + 6000, receivedAt: START + 6000 }));
  assert.equal(router.ingest(observation('primary')), false);
  assert.equal(router.read(instrument.id).quote.sourceTimestamp, START + 6000);
});
