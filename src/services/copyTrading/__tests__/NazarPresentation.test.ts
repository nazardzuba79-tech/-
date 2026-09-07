import { createHash } from 'crypto';
import { createNazarPresentationState, nazarPresentationResponse, NAZAR_PRESENTATION_REVISION } from '../nazarPresentation';
import { createReviewSyntheticState } from '../canonical/reviewSyntheticHistory';
import { advanceState, toResponse } from '../canonical/SyntheticCopyTradingEngine';
import { populateReviewFollowers } from '../canonical/reviewFollowerLedger';
import type { CashflowReviewState } from '../canonical/reviewEconomicsTypes';

const date = (day: string) => new Date(`${day}T12:00:00Z`);
const money = (value: number) => Math.round(value * 10_000) / 10_000 || 0;
const sumUnits = (values: number[]) => values.reduce((sum, value) => sum + Math.round(value * 10_000), 0);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const old = createReviewSyntheticState(date('2026-09-05'));
const next = createNazarPresentationState(date('2026-09-05'));

test('only the explicit read projection is revised; original source state/response remains exact', () => {
  const persisted = createReviewSyntheticState(date('2026-09-06'));
  const before = JSON.stringify(persisted);
  expect(hash(toResponse(persisted))).toBe('2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2');
  const response = nazarPresentationResponse(persisted);
  expect(response).toMatchObject({ provenance: 'MODELED', presentationRevision: NAZAR_PRESENTATION_REVISION });
  expect(JSON.stringify(persisted)).toBe(before);
  expect(nazarPresentationResponse(persisted)).toEqual(response);
  expect(() => nazarPresentationResponse({ ...persisted, seed: 0 })).toThrow('canonical synthetic source');
  expect(() => createNazarPresentationState(date('2026-09-04'))).toThrow();
});

test('seven true negative sessions span the 90-day interval without adding/removing trades, losses or zeros', () => {
  expect(old.dailyResults.slice(-90).filter(day => day.dailyReturn < 0).map(day => day.date))
    .toEqual(['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-17', '2026-07-18', '2026-08-20', '2026-09-01']);
  const losses = next.dailyResults.slice(-90).filter(day => day.dailyReturn < 0);
  expect(losses.map(day => day.date)).toEqual(['2026-06-16', '2026-06-29', '2026-07-08', '2026-07-24', '2026-08-04', '2026-08-20', '2026-09-01']);
  for (let i = 1; i < losses.length; i++) {
    const gap = (Date.parse(losses[i].date) - Date.parse(losses[i - 1].date)) / 86_400_000;
    expect(gap).toBeGreaterThanOrEqual(9);
    expect(gap).toBeLessThanOrEqual(16);
  }
  expect(next.trades).toHaveLength(471);
  expect(next.trades.filter(trade => trade.netPnl > 0)).toHaveLength(434);
  expect(next.trades.filter(trade => trade.netPnl < 0)).toHaveLength(34);
  expect(next.trades.filter(trade => trade.netPnl === 0)).toHaveLength(3);
  expect(next.trades.map(trade => trade.id)).toEqual(old.trades.map(trade => trade.id));
  for (const predicate of [(n: number) => n < 0, (n: number) => n === 0, (n: number) => n > 0]) {
    expect(next.dailyResults.filter(day => predicate(day.dailyReturn)).length)
      .toBe(old.dailyResults.filter(day => predicate(day.dailyReturn)).length);
  }
  expect(next.dailyResults.map(day => day.date)).toEqual(old.dailyResults.map(day => day.date));
  expect(new Set(next.dailyResults.map(day => day.date)).size).toBe(next.dailyResults.length);
});

test('all nested ROI plan budgets and exact baseline ALL PnL remain reconciled with emitted money precision', () => {
  const scenarios: [number, number | undefined, number][] = [[-7, undefined, 1.12], [-14, -7, 1.15],
    [-30, undefined, 2.71], [-90, undefined, 8.41], [0, undefined, 37.27]];
  for (const [start, end, expected] of scenarios) {
    const actual = next.dailyResults.slice(start, end).reduce((sum, day) => sum + day.dailyReturn, 0);
    // 0.0001-USDT capital and priced-trade allocation introduces <0.00001
    // percentage-point cumulative division error. Never round the ledger to
    // force a frontend percentage; money-unit equalities below remain exact.
    expect(Math.abs(actual - expected)).toBeLessThan(0.0000001);
    expect((actual * 100).toFixed(3)).toBe((expected * 100).toFixed(3));
  }
  expect(sumUnits(next.trades.map(trade => trade.netPnl))).toBe(4_711_027 * 10_000);
  expect(sumUnits(next.dailyResults.map(day => day.realizedPnl))).toBe(4_711_027 * 10_000);
  expect(next.cashflow.masterDays.at(-1)!.cumulativeTradingPnl).toBe(4_711_027);
  expect(next.cashflow.masterCashFlows.filter(flow => flow.type === 'DEPOSIT')).toHaveLength(1);
});

test('replayed prices/costs, daily returns, accounts and drawdown derive from the same ledger', () => {
  let index = 100, peak = 100, drawdown = 0;
  let account = next.cashflow.masterCashFlows[0].amount;
  for (let i = 0; i < next.dailyResults.length; i++) {
    const day = next.dailyResults[i], capital = next.cashflow.masterDays[i];
    const trades = next.trades.filter(trade => trade.closedAt.startsWith(day.date));
    expect(day.numberOfTrades).toBe(trades.length);
    expect(sumUnits(trades.map(trade => trade.netPnl))).toBe(Math.round(day.realizedPnl * 10_000));
    expect(day.dailyReturn).toBe(day.realizedPnl / capital.capitalAtRisk);
    expect(capital.capitalAtRisk).toBe(Math.min(capital.openingEquity, capital.operatingCapitalTarget!));
    expect(capital.openingEquity).toBe(account);
    account = money(account + day.realizedPnl - capital.withdrawals);
    expect(capital.closingEquity).toBe(account);
    let priorClose = 0, available = capital.openingEquity;
    for (const trade of trades) {
      const direction = trade.side === 'LONG' ? 1 : -1;
      expect(trade.grossPnl).toBe(money(direction * (trade.exitPrice - trade.entryPrice) * trade.quantity));
      expect(trade.fees).toBe(money((trade.exitPrice + trade.entryPrice) * trade.quantity * .0002));
      expect(trade.netPnl).toBe(money(trade.grossPnl - trade.fees - trade.funding));
      expect(trade.entryPrice * trade.quantity / trade.leverage).toBeLessThanOrEqual(available);
      expect(Date.parse(trade.openedAt)).toBeGreaterThanOrEqual(priorClose);
      expect(trade.openedAt.slice(0, 10)).toBe(day.date);
      priorClose = Date.parse(trade.closedAt);
      available = money(available + trade.netPnl);
    }
    index += day.dailyReturn * 100; peak = Math.max(peak, index);
    drawdown = Math.max(drawdown, (peak - index) / peak * 100);
    expect(next.equityHistory[i + 1].equity).toBeCloseTo(index, 10);
    expect(day.dailyReturn).toBeGreaterThan(-.05);
    expect(day.dailyReturn).toBeLessThan(.22);
  }
  expect(drawdown).toBeCloseTo(5.79, 5);
  expect(toResponse(next).analytics.allTime.maximumDrawdown).toBeCloseTo(drawdown, 10);
});

test('followers, fees and recent trades are replayed rather than stale copies of the old response', () => {
  expect(next.cashflow.copiedTrades).not.toEqual(old.cashflow.copiedTrades);
  const before = JSON.stringify(next);
  const reloaded = JSON.parse(before) as CashflowReviewState;
  populateReviewFollowers(reloaded);
  expect(reloaded).toEqual(next);
  expect(JSON.stringify(next)).toBe(before);
  const response = toResponse(next), previous = toResponse(old);
  expect(response.analytics.aum).toBe(previous.analytics.aum);
  expect(next.followers.map(follower => [follower.id, follower.copyStartDate, follower.allocatedCapital]))
    .toEqual(old.followers.map(follower => [follower.id, follower.copyStartDate, follower.allocatedCapital]));
  expect(response.economics!.periods.ALL.netFollowersPnl).not.toBe(previous.economics!.periods.ALL.netFollowersPnl);
  expect(response.analytics.allTime.profitFactor).not.toBe(previous.analytics.allTime.profitFactor);
  expect(response.trades.map(trade => trade.id)).toEqual(previous.trades.map(trade => trade.id));
});

test.each([1, 7, 30, 90])('presentation +%i days is deterministic and preserves its own historical prefix', days => {
  const asOf = new Date(date('2026-09-05').getTime() + days * 86_400_000);
  const full = createNazarPresentationState(asOf);
  const advanced = advanceState(next, days) as CashflowReviewState;
  advanced.mode = 'REAL_TIME';
  expect(full).toEqual(advanced);
  expect(full.trades.slice(0, next.trades.length)).toEqual(next.trades);
  expect(full.dailyResults.slice(0, next.dailyResults.length)).toEqual(next.dailyResults);
  expect(full.equityHistory.slice(0, next.equityHistory.length)).toEqual(next.equityHistory);
  expect(JSON.stringify(full.cashflow.copiedTrades.slice(0, next.cashflow.copiedTrades.length)))
    .toBe(JSON.stringify(next.cashflow.copiedTrades));
});
