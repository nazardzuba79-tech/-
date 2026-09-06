import { advanceSimpleReturnMasterState, createSimpleReturnMasterState } from '../reviewPerformanceV8';
import { REVIEW_PERFORMANCE_V8_CONFIG as C } from '../reviewPerformanceV8Config';
import type { CashflowReviewState } from '../reviewEconomicsTypes';

const money = (value: number) => Math.round(value * 10_000) / 10_000 || 0;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const units = (values: number[]) => values.reduce((total, value) => total + Math.round(value * 10_000), 0);
const week = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
};
const returnOf = (state: CashflowReviewState, from: number, to?: number) => sum(state.dailyResults.slice(from, to).map(day => day.dailyReturn));

describe('review v8 canonical simple-return master ledger', () => {
  const baseline = createSimpleReturnMasterState();

  test('471 actual executions reproduce all nested simple-return anchors and exact money units', () => {
    expect(baseline.version).toBe(8);
    expect(baseline.initialEquityDate).toBe('2025-08-21');
    expect(baseline.simulatedAt).toBe('2026-09-05T23:59:59.999Z');
    expect(baseline.cashflow.policy.methodology).toBe('CASH_FLOW_ADJUSTED_SIMPLE_RETURN');
    expect(baseline.trades).toHaveLength(471);
    expect(baseline.trades.filter(trade => trade.netPnl > 0)).toHaveLength(434);
    expect(baseline.trades.filter(trade => trade.netPnl < 0)).toHaveLength(34);
    expect(baseline.trades.filter(trade => trade.netPnl === 0)).toHaveLength(3);
    expect(baseline.trades.filter(trade => trade.result === 'BREAKEVEN')).toHaveLength(3);
    expect((434 / 468 * 100).toFixed(1)).toBe('92.7');
    expect(units(baseline.trades.map(trade => trade.netPnl))).toBe(4_711_027 * 10_000);
    expect(units(baseline.dailyResults.map(day => day.realizedPnl))).toBe(4_711_027 * 10_000);
    expect(baseline.cashflow.masterDays.at(-1)!.cumulativeTradingPnl).toBe(4_711_027);
    // Tolerances are sub-financial-rounding differences from emitted 0.0001
    // USDT executions / money-rounded weekly targets, not independent KPIs.
    expect(returnOf(baseline, -7)).toBeCloseTo(1.12, 7);
    expect(returnOf(baseline, -14, -7)).toBeCloseTo(1.15, 7);
    expect(returnOf(baseline, -30)).toBeCloseTo(2.71, 7);
    expect(returnOf(baseline, -90)).toBeCloseTo(8.41, 7);
    expect(returnOf(baseline, 0)).toBeCloseTo(37.27, 7);
    expect(returnOf(baseline, -30, -14)).toBeCloseTo(0.44, 7);
  });

  test('every net result is independently reproducible from emitted price, quantity and costs', () => {
    for (const trade of baseline.trades) {
      const direction = trade.side === 'LONG' ? 1 : -1;
      const gross = money(direction * (trade.exitPrice - trade.entryPrice) * trade.quantity);
      const fees = money((trade.entryPrice + trade.exitPrice) * trade.quantity * 0.0002);
      const holding = (Date.parse(trade.closedAt) - Date.parse(trade.openedAt)) / 60_000;
      const funding = money(trade.entryPrice * trade.quantity * 0.00005 * holding / 480);
      expect(trade.grossPnl).toBe(gross);
      expect(trade.fees).toBe(fees);
      expect(trade.funding).toBe(funding);
      expect(trade.netPnl).toBe(money(gross - fees - funding));
      expect(trade.holdingTimeMinutes).toBe(holding);
      expect(trade.entryPrice).toBeGreaterThan(0);
      expect(trade.exitPrice).toBeGreaterThan(0);
      expect(trade.quantity).toBeGreaterThan(0);
      expect(trade.leverage).toBeGreaterThanOrEqual(2);
      expect(trade.leverage).toBeLessThanOrEqual(8);
      expect(Math.abs(trade.exitPrice / trade.entryPrice - 1)).toBeLessThan(0.067);
      expect(trade.openedAt.slice(0, 10)).toBe(trade.closedAt.slice(0, 10));
    }
  });

  test('daily returns divide actual trade net PnL by actual operating capital, never the public index', () => {
    let runningReturn = 0;
    for (const [i, day] of baseline.dailyResults.entries()) {
      const trades = baseline.trades.filter(trade => trade.closedAt.startsWith(day.date));
      const master = baseline.cashflow.masterDays[i];
      const pnl = units(trades.map(trade => trade.netPnl)) / 10_000;
      expect(day.realizedPnl).toBe(pnl);
      expect(day.numberOfTrades).toBe(trades.length);
      expect(day.dailyReturn).toBe(pnl / master.capitalAtRisk);
      expect(master.capitalAtRisk).toBe(Math.min(master.openingEquity, master.operatingCapitalTarget!));
      runningReturn += pnl / master.capitalAtRisk;
      expect(baseline.equityHistory[i + 1].equity).toBeCloseTo(100 + runningReturn * 100, 8);
      expect(day.dailyReturn).toBeLessThanOrEqual(0.22);
    }
    const compound = baseline.dailyResults.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1;
    expect(Math.abs(compound - runningReturn)).toBeGreaterThan(1_000);
  });

  test('actual margin stays available and positions never overlap', () => {
    for (const day of baseline.cashflow.masterDays) {
      const trades = baseline.trades.filter(trade => trade.openedAt.startsWith(day.date));
      let available = day.openingEquity;
      let lastClose = 0;
      for (const trade of trades) {
        expect(Date.parse(trade.openedAt)).toBeGreaterThanOrEqual(lastClose);
        const margin = trade.entryPrice * trade.quantity / trade.leverage;
        expect(margin).toBeLessThanOrEqual(available);
        expect(margin / day.capitalAtRisk).toBeLessThanOrEqual(0.720001);
        available = money(available + trade.netPnl);
        lastClose = Date.parse(trade.closedAt);
      }
    }
  });

  test('daily account and cash-flow reconstruction has no hidden loss-repair deposit or full compounding', () => {
    const flows = baseline.cashflow.masterCashFlows;
    const deposits = flows.filter(flow => flow.type === 'DEPOSIT');
    expect(deposits).toHaveLength(1);
    expect(deposits[0].date).toBe('2025-08-21');
    const opening = deposits[0].amount;
    let account = opening, cumulativePnl = 0, withdrawals = 0;
    for (const [i, day] of baseline.cashflow.masterDays.entries()) {
      expect(day.openingEquity).toBe(account);
      expect(day.deposits).toBe(0);
      expect(day.operatingCapitalTarget).toBe(i ? baseline.cashflow.masterDays[i - 1].nextOperatingCapitalTarget : opening);
      expect(day.nextOperatingCapitalTarget! / day.operatingCapitalTarget!).toBeLessThanOrEqual(1.004501);
      expect(day.retainedProfit!).toBeCloseTo(day.nextOperatingCapitalTarget! - day.operatingCapitalTarget!, 3);
      const matching = flows.filter(flow => flow.date === day.date && flow.type === 'WITHDRAWAL');
      expect(units(matching.map(flow => flow.amount))).toBe(Math.round(day.withdrawals * 10_000));
      if (day.withdrawals) {
        expect(new Date(`${day.date}T00:00:00Z`).getUTCDay()).toBe(6);
        expect(matching[0].timing).toBe('AFTER_TRADING');
      }
      account = money(account + day.tradingPnl - day.withdrawals);
      cumulativePnl = money(cumulativePnl + day.tradingPnl);
      withdrawals = money(withdrawals + day.withdrawals);
      expect(day.closingEquity).toBe(account);
      expect(day.cumulativeTradingPnl).toBe(cumulativePnl);
      expect(day.cumulativeWithdrawals).toBe(withdrawals);
      expect(day.cumulativeDeposits).toBe(opening);
      expect(account).toBeGreaterThan(0);
    }
    expect(account).toBe(money(opening + cumulativePnl - withdrawals));
    expect(withdrawals / cumulativePnl).toBeGreaterThan(0.99);
    expect(account / opening).toBeLessThan(1.20);
    expect(Math.abs(opening - cumulativePnl / 37.27)).toBeGreaterThan(1_000);
    const deficits = baseline.cashflow.masterDays.filter(day => day.openingEquity < day.operatingCapitalTarget! - 0.01);
    expect(deficits.length).toBeGreaterThan(0);
  });

  test('holiday zeros, meaningful loss sessions and earlier strong weeks survive calibration', () => {
    for (const holiday of C.holidays) {
      const days = baseline.dailyResults.filter(day => day.date >= holiday.start && day.date <= holiday.end);
      for (const day of days) {
        expect(day.numberOfTrades).toBe(0);
        expect(day.realizedPnl).toBe(0);
        expect(day.dailyReturn).toBe(0);
        expect(baseline.cashflow.masterCashFlows.filter(flow => flow.date === day.date)).toHaveLength(0);
      }
    }
    const weekly = new Map<string, number>();
    for (const day of baseline.dailyResults) weekly.set(week(day.date), (weekly.get(week(day.date)) ?? 0) + day.dailyReturn);
    const earlier = [...weekly.entries()].filter(([start]) => start < '2026-08-23');
    expect(earlier.filter(([, value]) => value > 0.90).length).toBeGreaterThanOrEqual(10);
    expect(weekly.get('2025-10-12')).toBeCloseTo(-0.15, 7);
    expect(weekly.get('2026-02-08')).toBeCloseTo(-0.15, 7);
    expect(earlier.filter(([, value]) => value < -0.10).length).toBeGreaterThanOrEqual(2);
    expect(earlier.filter(([, value]) => value >= 0.55 && value <= 0.90).length).toBeGreaterThan(15);
    expect(baseline.dailyResults.filter(day => day.dailyReturn < 0)).toHaveLength(25);
    expect(baseline.dailyResults.filter(day => !day.dailyReturn).length).toBeGreaterThan(22);
    expect(returnOf(baseline, -30) / returnOf(baseline, 0)).toBeLessThan(0.08);
    const weeksWithLargeBars = new Set(baseline.dailyResults.filter(day => day.date < '2026-08-23' && day.dailyReturn >= 0.18).map(day => week(day.date)));
    // Smaller corrected losses also reduce nearby gains; strong bars still
    // occur in 15 earlier weeks, not in a terminal balancing cluster.
    expect(weeksWithLargeBars.size).toBeGreaterThanOrEqual(15);
  });

  test('corrected small losing sessions generate uncapped risk ratios from the canonical ledger', () => {
    const returns = baseline.dailyResults.map(day => day.dailyReturn);
    const mean = sum(returns) / returns.length;
    const downside = Math.sqrt(sum(returns.map(value => Math.min(0, value) ** 2)) / returns.length);
    const sortino = mean / downside * Math.sqrt(365);
    const profit = units(baseline.trades.filter(trade => trade.netPnl > 0).map(trade => trade.netPnl));
    const loss = -units(baseline.trades.filter(trade => trade.netPnl < 0).map(trade => trade.netPnl));
    let index = 100, peak = 100, maximumDrawdown = 0;
    for (const value of returns) {
      index += value * 100; peak = Math.max(peak, index);
      maximumDrawdown = Math.max(maximumDrawdown, (peak - index) / peak * 100);
    }
    // Wide qualitative scenario bounds, independently derived from every
    // execution/day. Production risk formulas contain no metric clamps.
    expect(sortino).toBeGreaterThan(100);
    expect(Number.isFinite(sortino)).toBe(true);
    expect(profit / loss).toBeGreaterThan(30);
    expect(Number.isFinite(profit / loss)).toBe(true);
    expect(maximumDrawdown).toBeCloseTo(5.79, 5);
    expect(maximumDrawdown.toFixed(2)).toBe('5.79');
    expect(returns.filter(value => value < -0.05)).toHaveLength(0);
    expect(Math.min(...returns)).toBeGreaterThanOrEqual(-0.05);
  });

  test('same seed/date produce the identical whole canonical baseline', () => {
    expect(createSimpleReturnMasterState()).toEqual(baseline);
  });

  test.each([7, 30, 90])('+%i days append only priced executions/capital/withdrawals', days => {
    const snapshot = JSON.stringify(baseline);
    const advanced = advanceSimpleReturnMasterState(baseline, days);
    expect(JSON.stringify(baseline)).toBe(snapshot);
    expect(advanced.trades.slice(0, 471)).toEqual(baseline.trades);
    expect(advanced.dailyResults.slice(0, 380)).toEqual(baseline.dailyResults);
    expect(advanced.equityHistory.slice(0, 381)).toEqual(baseline.equityHistory);
    expect(advanced.cashflow.masterDays.slice(0, 380)).toEqual(baseline.cashflow.masterDays);
    expect(advanced.cashflow.masterCashFlows.slice(0, baseline.cashflow.masterCashFlows.length)).toEqual(baseline.cashflow.masterCashFlows);
    expect(advanced.dailyResults).toHaveLength(380 + days);
    expect(advanced.trades.length).toBeGreaterThan(471);
    expect(advanced.cashflow.masterDays.at(-1)!.cumulativeTradingPnl).toBeGreaterThan(4_711_027);
    for (const day of advanced.cashflow.masterDays.slice(380)) {
      expect(day.nextOperatingCapitalTarget! / day.operatingCapitalTarget!).toBeLessThanOrEqual(1.004501);
      expect(day.capitalAtRisk).toBeLessThanOrEqual(day.openingEquity);
    }
    expect(advanced.cashflow.masterCashFlows.filter(flow => flow.type === 'DEPOSIT')).toHaveLength(1);
  });

  test('first future complete week is +72% and partial/batched serialized progression is identical', () => {
    const advanced = advanceSimpleReturnMasterState(baseline, 7);
    expect(advanced.simulatedAt).toBe('2026-09-12T23:59:59.999Z');
    expect(returnOf(advanced, -7)).toBeCloseTo(0.72, 7);
    expect(returnOf(advanced, 0)).toBeCloseTo(37.99, 7);
    const oneThenSix = advanceSimpleReturnMasterState(JSON.parse(JSON.stringify(advanceSimpleReturnMasterState(baseline, 1))), 6);
    expect(oneThenSix).toEqual(advanced);
    const thirtyThenSixty = advanceSimpleReturnMasterState(advanceSimpleReturnMasterState(baseline, 30), 60);
    expect(thirtyThenSixty).toEqual(advanceSimpleReturnMasterState(baseline, 90));
  });

  test('future regimes vary without exceeding the real daily ceiling', () => {
    const advanced = advanceSimpleReturnMasterState(baseline, 365);
    const future = advanced.dailyResults.slice(380);
    const weekly = new Map<string, number>();
    for (const day of future) {
      weekly.set(week(day.date), (weekly.get(week(day.date)) ?? 0) + day.dailyReturn);
      expect(day.dailyReturn).toBeLessThanOrEqual(0.22);
    }
    const values = [...weekly.values()].slice(0, -1);
    expect(values.some(value => value < 0)).toBe(true);
    expect(values.some(value => value > 0.9)).toBe(true);
    expect(values.some(value => value > 0 && value < 0.25)).toBe(true);
    expect(values.filter(value => value >= 0.55 && value <= 0.85).length).toBeGreaterThan(15);
    expect(new Set(values.map(value => value.toFixed(4))).size).toBeGreaterThan(40);
  });

  test('zero days is value-preserving and invalid advances do not mutate anything', () => {
    expect(advanceSimpleReturnMasterState(baseline, 0)).toEqual(baseline);
    for (const days of [-1, 0.5, 366, NaN]) expect(() => advanceSimpleReturnMasterState(baseline, days)).toThrow();
    expect(() => advanceSimpleReturnMasterState({ ...baseline, version: 7 }, 1)).toThrow(/cannot migrate/);
  });
});
