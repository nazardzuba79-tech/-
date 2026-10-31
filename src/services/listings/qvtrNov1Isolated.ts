/**
 * Offline, non-promotable QVTR scenario preview.
 * Never import from public listings, price endpoints, order/ledger, or valuation.
 * The runtime starting point is a fresh read of the already-published modeled quote.
 */
import { parseListingConfig, listingSimulationConfig, type ListingConfig } from './listingConfig';
import { TestMarketSimulation } from '../testMarkets/testMarketSimulation';
import { validateScenarioControls, type ScenarioControlsProgram } from '../../shared/listingScenarioControls';

const HOUR = 3600000;
export const NOV1_PEAK_AT = Date.parse('2026-11-01T06:00:00Z'); // 08:00 Kyiv, UTC+2
export const NOV1_CORRECTION_END = Date.parse('2026-11-01T18:30:00Z'); // 20:30 Kyiv, previously approved
export const NOV1_REJOIN_AT = Date.parse('2026-11-02T01:00:00Z'); // old WAVES hour 108
export const NOV1_PEAK_PRICE = 0.53830;
export const NOV1_CORRECTION_PRICE = 0.32298;

export interface FreshQvtrObservation {
  listingId: string; version: number; countdown: string; source: 'simulation';
  isTradable: false; serverTime: number; lastPrice: number;
}
export function buildQvtrNov1Isolated(sourceInput: ListingConfig, observed: FreshQvtrObservation, receivedAt: number) {
  const source = parseListingConfig(JSON.parse(JSON.stringify(sourceInput)));
  const old = source.simulationProgram;
  if (source.symbol !== 'QVTR' || source.initialPrice !== '0.0140' ||
      source.listingAt !== '2026-10-28T13:00:00Z' || source.seed !== 'qaventra-20261028-v1' ||
      source.tradable || old?.kind !== 'scenario-controls-v2' ||
      old.maxPrice !== '0.88858' || old.stages.length !== 7) throw Error('SOURCE_MISMATCH');
  if (observed.listingId !== 'qvtr-19568743' || observed.version !== 1 ||
      observed.countdown !== 'running' || observed.source !== 'simulation' ||
      observed.isTradable !== false) throw Error('SOURCE_VERSION_DRIFT');
  if (!Number.isSafeInteger(receivedAt) || !Number.isSafeInteger(observed.serverTime) ||
      observed.serverTime - receivedAt > 2000 || receivedAt - observed.serverTime > 5000)
    throw Error('FRESH_OBSERVATION_REQUIRED');
  const listingAt = Date.parse(source.listingAt);
  // The canonical engine prices at 10-second ticks. Admit a NEW cutover at the
  // next tick strictly AFTER receipt; never splice an unfinished older tick.
  const t0 = Math.ceil((receivedAt + 1) / 10000) * 10000;
  if (t0 <= listingAt + 36 * HOUR || t0 >= NOV1_PEAK_AT) throw Error('TARGET_EXPIRED');
  const baseline = new TestMarketSimulation(listingSimulationConfig(source));
  if (!Number.isFinite(observed.lastPrice) || observed.lastPrice <= 0 ||
      baseline.priceAt(observed.serverTime) !== observed.lastPrice) throw Error('SOURCE_PRICE_CHANGED');
  // Future tick anchor is model-projected, NOT the earlier observed lastPrice.
  const anchor = baseline.priceAt(t0);
  if (anchor === null || anchor >= NOV1_PEAK_PRICE) throw Error('TARGET_ALREADY_REACHED');
  const hrs = (a: number, b: number) => (b - a) / HOUR;
  const program: ScenarioControlsProgram = {
    ...JSON.parse(JSON.stringify(old)), stages: [
      ...old.stages.slice(0, 2),
      { type: 'growth', durationHours: hrs(listingAt + 36 * HOUR, t0), targetPrice: String(anchor) },
      { type: 'growth', durationHours: hrs(t0, NOV1_PEAK_AT), targetPrice: '0.5383' },
      { type: 'pullback', durationHours: hrs(NOV1_PEAK_AT, NOV1_CORRECTION_END), targetPrice: '0.32298' },
      { type: 'recovery', durationHours: hrs(NOV1_CORRECTION_END, NOV1_REJOIN_AT), targetPrice: '0.352' },
      ...old.stages.slice(3),
    ],
  };
  validateScenarioControls(program, source.initialPrice);
  const proposal = new TestMarketSimulation(listingSimulationConfig({ ...source, simulationProgram: program }));
  const actual = [proposal.priceAt(t0), proposal.priceAt(NOV1_PEAK_AT), proposal.priceAt(NOV1_CORRECTION_END), proposal.priceAt(NOV1_REJOIN_AT)];
  const expected = [anchor, NOV1_PEAK_PRICE, NOV1_CORRECTION_PRICE, 0.352];
  if (actual.some((v,i) => v === null || !Number.isFinite(v) || Math.abs(v-expected[i]) > 1e-8))
    throw Error('MODEL_ANCHOR_DRIFT '+JSON.stringify({ actual, expected }));
  return {
    scope: 'ISOLATED_QVTR_REVIEW_ONLY' as const, promotionAllowed: false as const,
    effectiveAt: t0, receivedAt, modeledFutureAnchor: anchor, observed: JSON.parse(JSON.stringify(observed)) as FreshQvtrObservation,
    source, program, peakAt: NOV1_PEAK_AT, peakPrice: '0.53830',
    correctionStart: NOV1_PEAK_AT, correctionEnd: NOV1_CORRECTION_END,
    correctionPrice: '0.32298', rejoinAt: NOV1_REJOIN_AT, sourceType: 'MODELED_NOT_EXTERNAL',
  };
}
/** A *read-only* display calculation, spliced at the captured instant. No backend writes. */
export function previewQvtrNov1Price(review: ReturnType<typeof buildQvtrNov1Isolated>, at: number) {
  if (review.scope !== 'ISOLATED_QVTR_REVIEW_ONLY' || review.promotionAllowed !== false ||
      !Number.isSafeInteger(at)) throw Error('REVIEW_ONLY');
  const original = new TestMarketSimulation(listingSimulationConfig(review.source));
  const future = new TestMarketSimulation(listingSimulationConfig({ ...review.source, simulationProgram: review.program }));
  return at <= review.effectiveAt ? original.priceAt(at) : future.priceAt(at);
}
