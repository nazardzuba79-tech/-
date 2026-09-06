import {
  createLegacyV7ReviewSyntheticState as createReviewSyntheticState,
  LEGACY_REVIEW_SYNTHETIC_STATE_ID as REVIEW_SYNTHETIC_STATE_ID,
  createReviewSyntheticState as createCurrentReviewSyntheticState,
  REVIEW_SYNTHETIC_STATE_ID as CURRENT_REVIEW_SYNTHETIC_STATE_ID,
} from '../reviewSyntheticHistory';
import { catchUpRealTime, toResponse } from '../SyntheticCopyTradingEngine';
import { selectSyntheticPeriod } from '../../../../frontend/src/lib/syntheticCopyTrading';

describe('explicit legacy v7 isolated review history remains unchanged', () => {
  test('current revision replaces the old build sample with full inception history', () => {
    const state = createReviewSyntheticState(new Date('2026-09-05'));
    expect(REVIEW_SYNTHETIC_STATE_ID).toBe('nazara-review-v7');
    expect(state.version).toBe(7);
    expect(state.initialEquityDate).toBe('2025-08-21');
    expect(state.dailyResults).toHaveLength(380);
    expect(toResponse(state).analytics.allTime.roi).toBe(3727);
    expect(state).toEqual(createReviewSyntheticState(new Date('2026-09-05')));
  });

  test.each([1, 7, 30, 90, 400])('rebuilding review +%i days never shifts inception or loses past trades', days => {
    const original = createReviewSyntheticState(new Date('2026-09-05'));
    const now = new Date(Date.parse('2026-09-05') + days * 86_400_000);
    const current = createReviewSyntheticState(now);
    expect(current.initialEquityDate).toBe(original.initialEquityDate);
    expect(current.dailyResults.slice(0, 380)).toEqual(original.dailyResults);
    expect(current.trades.slice(0, original.trades.length)).toEqual(original.trades);
    expect(current.equityHistory.slice(0, 381)).toEqual(original.equityHistory);
    expect(current.aumHistory.slice(0, 381)).toEqual(original.aumHistory);
    const response = toResponse(current);
    expect(response.analytics.allTime.pnl).toBeGreaterThan(4_711_027);
    expect(response.analytics.allTime.tradingDays).toBe(380 + days);
    for (const period of ['7D', '30D', '90D', 'ALL'] as const) {
      const selected = selectSyntheticPeriod(response, period);
      expect(selected.daily).toHaveLength(period === 'ALL' ? 380 + days : parseInt(period));
      expect(selected.equity).toHaveLength(selected.daily.length + 1);
      expect(selected.equity.at(-1)!.date).toBe(now.toISOString().slice(0, 10));
    }
  });
});

describe('current v8 calendar-driven isolated review history', () => {
  const baselineDate = new Date('2026-09-05T12:00:00Z');
  const original = createCurrentReviewSyntheticState(baselineDate);
  test('current revision uses additive methodology and the exact baseline trade ledger', () => {
    expect(CURRENT_REVIEW_SYNTHETIC_STATE_ID).toBe('nazara-review-v8');
    expect(original.version).toBe(8);
    expect(original.initialEquityDate).toBe('2025-08-21');
    expect(original.dailyResults).toHaveLength(380);
    expect(original.trades).toHaveLength(471);
    expect(original.trades.filter(trade => trade.netPnl > 0)).toHaveLength(458);
    expect(original.trades.filter(trade => trade.netPnl < 0)).toHaveLength(13);
    const response = toResponse(original);
    expect(response.economics?.methodology).toBe('CASH_FLOW_ADJUSTED_SIMPLE_RETURN');
    expect(response.analytics.allTime.roi).toBe(3727);
    expect(response.analytics.allTime.pnl).toBe(4_711_027);
    expect(response.analytics.activeFollowers).toBe(64);
    expect(response.analytics.aum).toBe(7_200_000);
    expect(original).toEqual(createCurrentReviewSyntheticState(new Date('2026-09-05T23:59:59Z')));
    expect(() => createCurrentReviewSyntheticState(new Date('2026-09-04T23:59:59Z'))).toThrow(/precedes/);
  });

  test.each([1, 7, 30, 90, 400])('UTC-date construction +%i days appends without rewriting any prior financial event', days => {
    const now = new Date(Date.parse('2026-09-05T12:00:00Z') + days * 86_400_000);
    const current = createCurrentReviewSyntheticState(now);
    expect(current.mode).toBe('REAL_TIME');
    expect(current.dailyResults).toHaveLength(380 + days);
    expect(current.dailyResults.slice(0, 380)).toEqual(original.dailyResults);
    expect(current.trades.slice(0, original.trades.length)).toEqual(original.trades);
    expect(current.equityHistory.slice(0, 381)).toEqual(original.equityHistory);
    expect(current.aumHistory.slice(0, 381)).toEqual(original.aumHistory);
    expect(current.cashflow.masterDays.slice(0, 380)).toEqual(original.cashflow.masterDays);
    expect(current.cashflow.masterCashFlows.slice(0, original.cashflow.masterCashFlows.length)).toEqual(original.cashflow.masterCashFlows);
    const copied = new Map(current.cashflow.copiedTrades.map(trade => [trade.id, trade]));
    original.cashflow.copiedTrades.forEach(trade => expect(copied.get(trade.id)).toEqual(trade));
    const fees = new Map(current.cashflow.performanceFeeEvents.map(event => [event.id, event]));
    original.cashflow.performanceFeeEvents.forEach(event => expect(fees.get(event.id)).toEqual(event));
    const response = toResponse(current);
    const sumReturn = current.dailyResults.reduce((sum, day) => sum + day.dailyReturn, 0) * 100;
    const sumPnl = current.trades.reduce((sum, trade) => sum + Math.round(trade.netPnl * 10_000), 0) / 10_000;
    expect(response.economics!.periods.ALL.roi).toBeCloseTo(sumReturn, 10);
    expect(response.economics!.periods.ALL.masterPnl).toBeCloseTo(sumPnl, 4);
    for (const period of ['7D', '30D', '90D', 'ALL'] as const) {
      const selected = selectSyntheticPeriod(response, period);
      expect(selected.daily).toHaveLength(period === 'ALL' ? 380 + days : parseInt(period));
      expect(selected.equity.at(-1)!.date).toBe(now.toISOString().slice(0, 10));
    }
    if (days === 7) expect(response.economics!.periods['7D'].roi).toBeCloseTo(72, 4);
    if (days === 400) expect(catchUpRealTime(original, now)).toEqual(current);
  });
});
