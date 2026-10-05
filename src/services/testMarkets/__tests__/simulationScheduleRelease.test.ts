const { fingerprintFor, TRAJECTORY_FILES } = require('../../../../scripts/check-nrx-scenario-release.cjs');
import { NEURIX, NRX_BALANCE_SELLOFF_SCENARIO, NRX_TWO_WEEK_SCENARIO } from '../neurix';

// The old reviewed plan remains fingerprintable; NEURIX now carries the forward-only v4 terminal plan.
const SCHEDULED = { ...NEURIX, scheduledScenario: NRX_TWO_WEEK_SCENARIO };

test('release identity covers every scenario field and all legacy trajectory inputs', () => {
  const source = (file: string) => file + '\nsource\n';
  const baseline = fingerprintFor(SCHEDULED, source);
  for (const key of Object.keys(NRX_TWO_WEEK_SCENARIO)) {
    expect(fingerprintFor({ ...SCHEDULED, scheduledScenario: { ...NRX_TWO_WEEK_SCENARIO, [key]: 999 } }, source)).not.toBe(baseline);
  }
  expect(fingerprintFor(NEURIX, source)).not.toBe(baseline);
  for (const change of [
    { initialPrice: 1 }, { listingAt: NEURIX.listingAt + 10000 }, { seed: 'other' },
    { marketStructure: undefined }, { marketStructure: { from: NEURIX.listingAt + 3600000 } },
    { realismFrom: NEURIX.listingAt }, { simulationProfile: 'CALM_TREND' },
    { naturalWicks: { from: NEURIX.listingAt } }, { realismSeedOffset: 2 },
  ]) expect(fingerprintFor({ ...SCHEDULED, ...change }, source)).not.toBe(baseline);
  for (const file of TRAJECTORY_FILES) {
    expect(fingerprintFor(SCHEDULED, (name: string) => source(name) + (name === file ? 'changed' : ''))).not.toBe(baseline);
  }
});

test('release identity survives key ordering and Windows line endings', () => {
  const reversed = Object.fromEntries(Object.entries(NEURIX).reverse());
  expect(fingerprintFor(reversed, () => 'a\r\nb\r\n')).toBe(fingerprintFor(NEURIX, () => 'a\nb\n'));
});


test('attached v4 balance/selloff plan is release-fingerprinted field by field', () => {
  const source = (file: string) => file + '\nsource\n';
  expect(NEURIX.scheduledScenario).toEqual(NRX_BALANCE_SELLOFF_SCENARIO);
  const baseline = fingerprintFor(NEURIX, source);
  for (const [key, value] of Object.entries(NRX_BALANCE_SELLOFF_SCENARIO)) {
    const changed = typeof value === 'number' ? value + 10 : 'growth-range-selloff-range';
    expect(fingerprintFor({ ...NEURIX, scheduledScenario: { ...NRX_BALANCE_SELLOFF_SCENARIO, [key]: changed } }, source)).not.toBe(baseline);
  }
});
