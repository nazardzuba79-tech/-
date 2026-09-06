import { createHash } from 'crypto';
import { createKseniaReviewState, advanceKseniaReview, kseniaReviewResponse, kseniaFeeEarnings365 } from '../kseniaReview';
import { createReviewSyntheticState } from '../reviewSyntheticHistory';
import { toResponse } from '../SyntheticCopyTradingEngine';

const baseline = createKseniaReviewState();
const money = (v: number) => Math.round(v * 10000) / 10000 || 0;
test('independent priced master ledger reconciles every daily capital/return and exact baseline outcomes', () => {
  expect(baseline.trades).toHaveLength(446);
  expect(baseline.trades.filter(t => t.netPnl > 0)).toHaveLength(397);
  expect(baseline.trades.filter(t => t.netPnl < 0)).toHaveLength(47);
  expect(baseline.trades.filter(t => t.netPnl === 0)).toHaveLength(2);
  for (const t of baseline.trades) {
    expect(t.grossPnl).toBe(money((t.side === 'LONG' ? 1 : -1) * (t.exitPrice - t.entryPrice) * t.quantity));
    expect(t.netPnl).toBe(money(t.grossPnl - t.fees - t.funding));
    expect(t.fees).toBe(money((t.entryPrice + t.exitPrice) * t.quantity * .00035));
    expect(Date.parse(t.closedAt) - Date.parse(t.openedAt)).toBe(t.holdingTimeMinutes * 60000);
  }
  for (const day of baseline.dailyResults) {
    const capital = baseline.cashflow.masterDays.find(d => d.date === day.date)!;
    const trades = baseline.trades.filter(t => t.closedAt.startsWith(day.date));
    expect(day.realizedPnl).toBe(money(trades.reduce((s, t) => s + t.netPnl, 0)));
    expect(day.dailyReturn).toBe(day.realizedPnl / capital.capitalAtRisk);
    expect(capital.closingEquity).toBe(money(capital.openingEquity + capital.tradingPnl + capital.deposits - capital.withdrawals));
  }
  expect(baseline.dailyResults).toHaveLength(396);
  const r = kseniaReviewResponse(baseline);
  for (const [period, roi] of Object.entries({ '7D': 62, '30D': 117, '90D': 468, ALL: 1756 })) {
    expect(r.economics!.periods[period as 'ALL'].roi).toBeCloseTo(roi, 5);
  }
  expect((397 / 444 * 100).toFixed(1)).toBe('89.4');
  expect(r.analytics.allTime.maximumDrawdown).toBeGreaterThan(7);
  expect(r.analytics.allTime.maximumDrawdown).toBeLessThan(9);
  expect(Math.min(...baseline.dailyResults.map(d => d.dailyReturn))).toBeGreaterThan(-.0351);
  expect(Math.max(...baseline.dailyResults.map(d => d.dailyReturn))).toBeLessThan(.161);
  expect(baseline.cashflow.masterDays.at(-1)!.cumulativeWithdrawals).toBeGreaterThan(2_000_000);
});
test('48 irregular cohorts, allocation-only 5.4M AUM, independently reconciled daily HWM and exact trailing fees', () => {
  expect(baseline.followers).toHaveLength(48);
  expect(baseline.followers.reduce((s, f) => s + f.allocatedCapital, 0)).toBe(5_400_000);
  expect(new Set(baseline.followers.map(f => f.copyStartDate)).size).toBeGreaterThan(40);
  for (const follower of baseline.followers) {
    let gross = 0, hwm = 0, fee = 0;
    for (const day of baseline.dailyResults) {
      const copies = baseline.cashflow.copiedTrades.filter(t => t.followerId === follower.id && t.closedAt.startsWith(day.date));
      gross = money(gross + copies.reduce((s, t) => s + t.grossPnl, 0));
      const eligible = money(Math.max(0, gross - hwm));
      const dailyFee = Math.round(Math.round(eligible * 10000) * .1) / 10000;
      const event = baseline.cashflow.performanceFeeEvents.find(e => e.followerId === follower.id && e.date.startsWith(day.date));
      if (dailyFee) expect(event?.feeAmount).toBe(dailyFee);
      else expect(event?.feeAmount ?? 0).toBe(0);
      fee = money(fee + dailyFee); hwm = Math.max(hwm, gross);
    }
    expect(follower.grossPnl).toBe(gross);
    expect(follower.performanceFees).toBe(fee);
    expect(follower.netPnl).toBe(money(gross - fee));
  }
  expect(kseniaFeeEarnings365(baseline)).toBe(1_275_547);
  expect(baseline.cashflow.performanceFeeEvents.reduce((s, e) => s + e.feeAmount, 0)).toBeGreaterThan(1_275_547);
});
test.each([1, 7, 30, 90, 365])('append-only +%i UTC days including copied trades, fee events and serialized restart', days => {
  const next = advanceKseniaReview(baseline, days);
  expect(next.dailyResults.slice(0, baseline.dailyResults.length)).toEqual(baseline.dailyResults);
  expect(next.trades.slice(0, baseline.trades.length)).toEqual(baseline.trades);
  expect(next.equityHistory.slice(0, baseline.equityHistory.length)).toEqual(baseline.equityHistory);
  expect(next.cashflow.copiedTrades.slice(0, baseline.cashflow.copiedTrades.length)).toEqual(baseline.cashflow.copiedTrades);
  expect(next.cashflow.performanceFeeEvents.slice(0, baseline.cashflow.performanceFeeEvents.length)).toEqual(baseline.cashflow.performanceFeeEvents);
  expect(next.trades.length).toBeGreaterThan(baseline.trades.length);
  const split = Math.floor(days / 2);
  const restarted = JSON.parse(JSON.stringify(advanceKseniaReview(baseline, split)));
  expect(advanceKseniaReview(restarted, days - split)).toEqual(next);
});
test('Nazar full financial response is unchanged by independent Ksenia generation', () => {
  const state = createReviewSyntheticState(new Date('2026-09-05T12:00:00Z'));
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const before = hash(toResponse(state));
  createKseniaReviewState();
  expect(hash(toResponse(state))).toBe(before);
  expect(before).toBe('5c960e5e203c3bc9d61e615efd4aa40f6c11e1f989af86308133d2b8a2e1ace2');
});
