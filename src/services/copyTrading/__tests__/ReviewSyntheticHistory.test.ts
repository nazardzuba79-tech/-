import { createReviewSyntheticState, REVIEW_SYNTHETIC_STATE_ID } from '../reviewSyntheticHistory';
import { toResponse } from '../SyntheticCopyTradingEngine';
import { selectSyntheticPeriod } from '../../../../frontend/src/lib/syntheticCopyTrading';

describe('versioned isolated review history', () => {
  test('current revision replaces the old build sample with full inception history', () => {
    const state = createReviewSyntheticState(new Date('2026-09-05'));
    expect(REVIEW_SYNTHETIC_STATE_ID).toBe('nazara-review-v6');
    expect(state.version).toBe(6);
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
