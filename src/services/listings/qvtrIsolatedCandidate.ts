/** Proposal DTO for the offline journal. Not a ListingConfig, never importable/publishable. */
import { TestMarketSimulation } from '../testMarkets/testMarketSimulation';
import { listingSimulationConfig, type ListingConfig } from './listingConfig';
import { validateScenarioControls, type ScenarioControlsProgram } from '../../shared/listingScenarioControls';
import { scenarioSourceFingerprint } from './isolatedScenarioJournal';

export const QVTR_PEAK_AT = Date.parse('2026-10-31T18:30:00Z');
export const QVTR_CORRECTION_START = Date.parse('2026-11-01T02:00:00Z');
export const QVTR_CORRECTION_END = Date.parse('2026-11-01T18:30:00Z'); // owner-approved completion
export function qvtrIsolatedCandidate(source: ListingConfig, effectiveAt: number) {
  if (effectiveAt % 300000) throw Error('FUTURE_TARGET_EXPIRED');
  return buildQvtrProgram(source,effectiveAt);
}
/** Exact millisecond start for a non-promotable observed-now review only. */
export function buildQvtrProgram(source: ListingConfig, effectiveAt: number) {
  if (source.symbol !== 'QVTR' || source.tradable || source.initialPrice !== '0.0140'
      || source.seed !== 'qaventra-20261028-v1' || source.listingAt !== '2026-10-28T13:00:00Z'
      || source.simulationProgram?.kind !== 'scenario-controls-v2') throw Error('QVTR_SOURCE_MISMATCH');
  const old = source.simulationProgram;
  const expected = [[24,'0.1092'],[12,'0.0784'],[72,'0.352'],[24,'0.352'],[72,'0.685'],[24,'0.51'],[72,'0.818']];
  if (old.maxPrice !== '0.88858' || old.stages.some((s,i) => !expected[i] || s.durationHours !== expected[i][0] || s.targetPrice !== expected[i][1]) || old.stages.length !== 7) throw Error('QVTR_SOURCE_MISMATCH');
  const listingAt = Date.parse(source.listingAt), rejoinAt = listingAt + 108 * 3600000;
  if (!Number.isSafeInteger(effectiveAt) || effectiveAt <= listingAt + 36 * 3600000 || effectiveAt >= QVTR_PEAK_AT) throw Error('FUTURE_TARGET_EXPIRED');
  const anchor = new TestMarketSimulation(listingSimulationConfig(source)).priceAt(effectiveAt)!;
  const hours = (start: number, end: number) => (end - start) / 3600000;
  const program: ScenarioControlsProgram = { ...JSON.parse(JSON.stringify(old)), stages: [
    ...old.stages.slice(0,2),
    { type: 'growth', durationHours: hours(listingAt + 36 * 3600000, effectiveAt), targetPrice: String(anchor) },
    { type: 'growth', durationHours: hours(effectiveAt, QVTR_PEAK_AT), targetPrice: '0.5383' },
    { type: 'range', durationHours: hours(QVTR_PEAK_AT, QVTR_CORRECTION_START), targetPrice: '0.5383' },
    { type: 'pullback', durationHours: hours(QVTR_CORRECTION_START, QVTR_CORRECTION_END), targetPrice: '0.32298' },
    { type: 'recovery', durationHours: hours(QVTR_CORRECTION_END, rejoinAt), targetPrice: '0.352' },
    ...old.stages.slice(3),
  ] };
  // Reuse the pure controls validator/canonical ticks. Fractional hours are
  // intentional in this offline DTO; the public ListingConfig schema stays unchanged.
  validateScenarioControls(program, source.initialPrice);
  return { scope: 'ISOLATED_MODEL_ONLY' as const, sourceConfigSha256: scenarioSourceFingerprint(source), effectiveAt, anchor, program, correctionEndApproved: true };
}
