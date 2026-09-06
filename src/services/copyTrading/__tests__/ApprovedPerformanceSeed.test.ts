import { createHash } from 'crypto';
import {
  loadPublishedKseniaState, PUBLISHED_KSENIA_STATE_SHA256, PUBLISHED_KSENIA_RESPONSE_SHA256,
} from '../approvedPerformanceSeeds';
import { kseniaReviewResponse, kseniaFeeEarnings365, advanceKseniaReview } from '../canonical/kseniaReview';
import { decodePerformanceState, encodePerformanceState } from '../CopyPerformanceService';
import publishedPackage from '../canonical/fixtures/kseniaPublishedSeed.json';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('lossless packaged reviewed state exactly preserves published raw tokens, public response, and 365D fees', () => {
  const state = loadPublishedKseniaState();
  expect(hash(state)).toBe(PUBLISHED_KSENIA_STATE_SHA256);
  expect(hash(kseniaReviewResponse(state))).toBe(PUBLISHED_KSENIA_RESPONSE_SHA256);
  expect(kseniaFeeEarnings365(state)).toBe(1_275_547);
  expect(state.simulatedAt).toBe('2026-09-06T23:59:59.999Z');
  expect(state.trades).toHaveLength(446);
  expect(state.followers).toHaveLength(48);
  expect(hash(decodePerformanceState(encodePerformanceState(state)))).toBe(PUBLISHED_KSENIA_STATE_SHA256);
});

test('each import is independent and cannot mutate the approved bootstrap for another process', () => {
  const first = loadPublishedKseniaState();
  const second = loadPublishedKseniaState();
  first.trades[0].netPnl = 0;
  first.followers[0].allocatedCapital = 0;
  expect(hash(second)).toBe(PUBLISHED_KSENIA_STATE_SHA256);
  expect(hash(loadPublishedKseniaState())).toBe(PUBLISHED_KSENIA_STATE_SHA256);
});

test('corrupt packaged metadata or compressed data fails closed instead of generating a replacement history', () => {
  const originalSha = publishedPackage.stateSha256;
  const originalPart = publishedPackage.parts[0];
  try {
    publishedPackage.stateSha256 = '0'.repeat(64);
    expect(() => loadPublishedKseniaState()).toThrow('metadata mismatch');
    publishedPackage.stateSha256 = originalSha;
    publishedPackage.parts[0] = 'AAAA' + originalPart.slice(4);
    expect(() => loadPublishedKseniaState()).toThrow();
  } finally {
    publishedPackage.stateSha256 = originalSha;
    publishedPackage.parts[0] = originalPart;
  }
  expect(hash(loadPublishedKseniaState())).toBe(PUBLISHED_KSENIA_STATE_SHA256);
});

test.each([1, 7, 30, 90, 365])('exact reviewed persistence appends +%i days without replacing a single historical value', days => {
  const original = loadPublishedKseniaState();
  const next = advanceKseniaReview(original, days);
  expect(next.trades.slice(0, original.trades.length)).toEqual(original.trades);
  expect(JSON.stringify(next.trades.slice(0, original.trades.length))).toBe(JSON.stringify(original.trades));
  expect(next.dailyResults.slice(0, original.dailyResults.length)).toEqual(original.dailyResults);
  expect(next.equityHistory.slice(0, original.equityHistory.length)).toEqual(original.equityHistory);
  expect(next.aumHistory.slice(0, original.aumHistory.length)).toEqual(original.aumHistory);
  expect(next.cashflow.masterDays.slice(0, original.cashflow.masterDays.length)).toEqual(original.cashflow.masterDays);
  expect(next.cashflow.masterCashFlows.slice(0, original.cashflow.masterCashFlows.length)).toEqual(original.cashflow.masterCashFlows);
  expect(next.cashflow.copiedTrades.slice(0, original.cashflow.copiedTrades.length)).toEqual(original.cashflow.copiedTrades);
  expect(JSON.stringify(next.cashflow.copiedTrades.slice(0, original.cashflow.copiedTrades.length))).toBe(JSON.stringify(original.cashflow.copiedTrades));
  expect(next.cashflow.performanceFeeEvents.slice(0, original.cashflow.performanceFeeEvents.length)).toEqual(original.cashflow.performanceFeeEvents);
  expect(JSON.stringify(next.cashflow.performanceFeeEvents.slice(0, original.cashflow.performanceFeeEvents.length))).toBe(JSON.stringify(original.cashflow.performanceFeeEvents));
  const split = Math.floor(days / 2);
  const restarted = decodePerformanceState(encodePerformanceState(advanceKseniaReview(original, split)));
  expect(advanceKseniaReview(restarted, days - split)).toEqual(next);
  expect(hash(original)).toBe(PUBLISHED_KSENIA_STATE_SHA256);
});
