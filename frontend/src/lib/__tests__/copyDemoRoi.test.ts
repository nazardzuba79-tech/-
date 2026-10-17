import { DEMO_ROI_END, DEMO_ROI_START, demoRoiFor } from '../copyDemoRoi';

const cases = [
  ['VX-001', 'MODELED', 179], ['VX-KSENIA', 'SYNTHETIC_REVIEW', 132],
] as const;

describe.each(cases)('%s dated demo', (id, provenance, roi) => {
  const source = Object.freeze({ trader: Object.freeze({ id }), provenance });
  test.each([18, 19, 20, 21])('is fixed on October %i without calling it rolling 7D', day => {
    expect(demoRoiFor(id, '7D', source, Date.parse(`2026-10-${day}T12:00:00Z`)))
      .toEqual({ roi, period: '12–18.10.2026' });
  });
  test('uses an exclusive UTC deadline, including its last millisecond', () => {
    expect(new Date(DEMO_ROI_END).toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(demoRoiFor(id, '7D', source, DEMO_ROI_END - 1)?.roi).toBe(roi);
    for (const now of [DEMO_ROI_START - 1, DEMO_ROI_END, DEMO_ROI_END + 86_400_000, NaN])
      expect(demoRoiFor(id, '7D', source, now)).toBeUndefined();
  });
  test.each(['30D', '90D', 'ALL'] as const)('does not affect %s', period => {
    expect(demoRoiFor(id, period, source, DEMO_ROI_END - 1)).toBeUndefined();
  });
  test('refreshes cannot alter the scenario or mutate accounting/source metrics', () => {
    for (const actualRoi of [-9, 0, 76, 400]) {
      const refreshed = Object.freeze({ ...source,
        analytics: Object.freeze({ roi7: actualRoi, masterPnl: 23, followerPnl: 4, aum: 900 }),
        trades: Object.freeze([{ id: 'unchanged-trade' }]), balance: 100,
      });
      const before = JSON.stringify(refreshed);
      expect(demoRoiFor(id, '7D', refreshed, DEMO_ROI_END - 1)?.roi).toBe(roi);
      expect(demoRoiFor(id, '7D', refreshed, DEMO_ROI_END)).toBeUndefined();
      expect(JSON.stringify(refreshed)).toBe(before);
    }
  });
  test.each(['REAL', 'LIVE', 'REAL_EXECUTION', undefined, 'FIXTURE'])('rejects provenance %s', value => {
    expect(demoRoiFor(id, '7D', { ...source, provenance: value }, DEMO_ROI_END - 1)).toBeUndefined();
  });
  test('cannot infer demo permission from a name, a simulation clock, or another strategy', () => {
    for (const response of [null, { trader: { id }, simulation: { seed: 1 } },
      { ...source, trader: { id: 'someone-else', name: 'Nazar' } }])
      expect(demoRoiFor(id, '7D', response, DEMO_ROI_END - 1)).toBeUndefined();
    expect(demoRoiFor('VX-002', '7D', { ...source, trader: { id: 'VX-002' } }, DEMO_ROI_END - 1)).toBeUndefined();
  });
});
