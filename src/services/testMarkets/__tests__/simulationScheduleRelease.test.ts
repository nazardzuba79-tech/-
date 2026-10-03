const { fingerprintFor, TRAJECTORY_FILES } = require('../../../../scripts/check-nrx-scenario-release.cjs');
import { NEURIX } from '../neurix';

test('release identity covers every scenario field and all legacy trajectory inputs', () => {
  const source = (file: string) => file + '\nsource\n';
  const baseline = fingerprintFor(NEURIX, source);
  for (const key of Object.keys(NEURIX.scheduledScenario!)) {
    expect(fingerprintFor({ ...NEURIX, scheduledScenario: { ...NEURIX.scheduledScenario, [key]: 999 } }, source)).not.toBe(baseline);
  }
  for (const change of [
    { initialPrice: 1 }, { listingAt: NEURIX.listingAt + 10000 }, { seed: 'other' },
    { marketStructure: undefined }, { marketStructure: { from: NEURIX.listingAt + 3600000 } },
    { realismFrom: NEURIX.listingAt }, { simulationProfile: 'CALM_TREND' },
    { naturalWicks: { from: NEURIX.listingAt } }, { realismSeedOffset: 2 },
  ]) expect(fingerprintFor({ ...NEURIX, ...change }, source)).not.toBe(baseline);
  for (const file of TRAJECTORY_FILES) {
    expect(fingerprintFor(NEURIX, (name: string) => source(name) + (name === file ? 'changed' : ''))).not.toBe(baseline);
  }
});

test('release identity survives key ordering and Windows line endings', () => {
  const reversed = Object.fromEntries(Object.entries(NEURIX).reverse());
  expect(fingerprintFor(reversed, () => 'a\r\nb\r\n')).toBe(fingerprintFor(NEURIX, () => 'a\nb\n'));
});
