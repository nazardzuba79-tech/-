import { createCashflowMasterState, advanceCashflowMasterState } from '../reviewMasterLedger';
import { REVIEW_ECONOMICS_CONFIG as C, isReviewHoliday } from '../reviewEconomicsConfig';

const cents4 = (value: number) => Math.round(value * 10_000);
const r4 = (value: number) => cents4(value) / 10_000;
const state = createCashflowMasterState();
const factor = (start: number, end = state.dailyResults.length) => state.dailyResults.slice(start, end)
  .reduce((value, day) => value * (1 + day.realizedPnl / state.cashflow.masterDays.find(capital => capital.date === day.date)!.capitalAtRisk), 1);

describe('review master cash-flow accounting', () => {
  test('pinned, deterministic, complete calendar and exact nested TWR from the emitted ledger', () => {
    expect(state).toEqual(createCashflowMasterState());
    expect(state.version).toBe(7);
    expect(state.dailyResults).toHaveLength(380);
    expect(state.equityHistory).toHaveLength(381);
    expect(state.initialEquityDate).toBe('2025-08-21');
    expect(state.simulatedAt).toBe('2026-09-05T23:59:59.999Z');
    expect(state.equityHistory[0].equity).toBe(100);
    for (const [period, count] of [['7D', 7], ['30D', 30], ['90D', 90], ['ALL', 380]] as const) {
      const calculated = factor(380 - count);
      expect(calculated).toBeCloseTo(C.factors[period], 6);
      expect(state.equityHistory.at(-1)!.equity / state.equityHistory[380 - count].equity).toBeCloseTo(calculated, 10);
    }
    expect(factor(350, 373)).toBeCloseTo(3.71 / 2.12, 7);
    expect(factor(290, 350)).toBeCloseTo(9.41 / 3.71, 7);
    expect(factor(0, 290)).toBeCloseTo(38.27 / 9.41, 7);
  });

  test('every trade independently reconstructs gross, costs, net and position margin from rounded executions', () => {
    for (const trade of state.trades) {
      const day = state.cashflow.masterDays.find(day => day.date === trade.closedAt.slice(0, 10))!;
      const notional = trade.entryPrice * trade.quantity;
      const gross = r4((trade.side === 'LONG' ? 1 : -1) * (trade.exitPrice - trade.entryPrice) * trade.quantity);
      const fees = r4((trade.entryPrice + trade.exitPrice) * trade.quantity * C.tradingFeeRate);
      const funding = r4(notional * C.fundingRatePerEightHours * trade.holdingTimeMinutes / 480);
      expect(trade.grossPnl).toBe(gross);
      expect(trade.fees).toBe(fees);
      expect(trade.funding).toBe(funding);
      expect(cents4(trade.netPnl)).toBe(cents4(gross) - cents4(fees) - cents4(funding));
      expect(trade.returnPct).toBeCloseTo(trade.netPnl / (notional / trade.leverage) * 100, 7);
      expect(trade.leverage).toBeGreaterThanOrEqual(2);
      expect(trade.leverage).toBeLessThanOrEqual(8);
      expect(notional / trade.leverage).toBeLessThan(day.capitalAtRisk * 0.721);
      expect(trade.entryPrice).toBeGreaterThan(0);
      expect(trade.exitPrice).toBeGreaterThan(0);
      expect(trade.openedAt.slice(0, 10)).toBe(trade.closedAt.slice(0, 10));
      expect(Date.parse(trade.closedAt) - Date.parse(trade.openedAt)).toBe(trade.holdingTimeMinutes * 60000);
      // Even the extreme required review headline is not explained by a huge
      // single loss or absurd leverage; actual price movement stays bounded.
      expect(Math.abs(trade.exitPrice / trade.entryPrice - 1)).toBeLessThan(0.10);
    }
    const sorted = [...state.trades].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].openedAt >= sorted[i - 1].closedAt).toBe(true);
    expect(state.trades).toHaveLength(3250);
    expect(state.trades.filter(trade => trade.result === 'WIN')).toHaveLength(3159);
    expect(state.trades.filter(trade => trade.result === 'LOSS')).toHaveLength(91);
  });

  test('daily/ALL money totals reconcile; withdrawals never reduce trading PnL or index', () => {
    const initial = state.cashflow.masterCashFlows.find(flow => flow.type === 'DEPOSIT')!.amount;
    let account = initial, pnl = 0, withdrawn = 0;
    expect(initial).not.toBeCloseTo(4_711_027 / 37.27, 0);
    expect(state.cashflow.masterCashFlows.filter(flow => flow.type === 'DEPOSIT')).toHaveLength(1);
    for (let i = 0; i < state.dailyResults.length; i++) {
      const day = state.dailyResults[i], capital = state.cashflow.masterDays[i];
      const trades = state.trades.filter(trade => trade.closedAt.startsWith(day.date));
      const net = trades.reduce((sum, trade) => sum + cents4(trade.netPnl), 0);
      expect(cents4(day.realizedPnl)).toBe(net);
      expect(capital.capitalAtRisk).toBe(capital.openingEquity);
      expect(capital.openingEquity).toBe(account);
      expect(cents4(capital.closingEquity)).toBe(cents4(account) + net + cents4(capital.deposits) - cents4(capital.withdrawals));
      const flows = state.cashflow.masterCashFlows.filter(flow => flow.date === day.date && flow.type === 'WITHDRAWAL');
      expect(flows.reduce((sum, flow) => sum + cents4(flow.amount), 0)).toBe(cents4(capital.withdrawals));
      expect(day.dailyReturn).toBe(day.realizedPnl / capital.capitalAtRisk);
      expect(state.equityHistory[i + 1].equity).toBeCloseTo(state.equityHistory[i].equity * (1 + day.dailyReturn), 9);
      expect(capital.closingEquity).toBeLessThanOrEqual(initial);
      expect(capital.closingEquity).toBeGreaterThan(initial * 0.95);
      account = capital.closingEquity; pnl += net; withdrawn += cents4(capital.withdrawals);
      expect(cents4(capital.cumulativeTradingPnl)).toBe(pnl);
      expect(cents4(capital.cumulativeWithdrawals)).toBe(withdrawn);
    }
    expect(pnl).toBe(4_711_027 * 10_000);
    expect(cents4(account)).toBe(cents4(initial) + pnl - withdrawn);
    expect(state.cashflow.masterCashFlows.filter(flow => flow.type === 'WITHDRAWAL').length).toBeGreaterThan(250);
  });

  test('holiday and Easter periods have no trades, money flows or manufactured returns', () => {
    const inactive = state.dailyResults.filter(day => isReviewHoliday(day.date));
    expect(inactive).toHaveLength(22);
    for (const day of inactive) {
      expect(day.numberOfTrades).toBe(0); expect(day.realizedPnl).toBe(0); expect(day.dailyReturn).toBe(0);
      expect(day.fees).toBe(0); expect(day.funding).toBe(0);
      expect(day.startEquity).toBe(day.endEquity);
      expect(state.cashflow.masterCashFlows.some(flow => flow.date === day.date)).toBe(false);
    }
    expect(state.dailyResults.filter(day => day.realizedPnl < 0).length).toBeGreaterThan(15);
    expect(new Set(state.dailyResults.map(day => day.numberOfTrades)).size).toBeGreaterThan(6);
    expect(new Set(state.trades.map(trade => trade.holdingTimeMinutes)).size).toBeGreaterThan(60);
    expect(state.dailyResults.at(-1)!.realizedPnl).toBeLessThan(Math.max(...state.dailyResults.map(day => day.realizedPnl)));
    for (const count of [7, 30, 90, 380]) {
      const days = state.cashflow.masterDays.slice(-count), from = days[0].date;
      const trades = state.trades.filter(trade => trade.closedAt.slice(0, 10) >= from);
      const turnover = trades.reduce((sum, trade) => sum + trade.entryPrice * trade.quantity, 0);
      const averageCapital = days.reduce((sum, day) => sum + day.capitalAtRisk, 0) / days.length;
      expect(turnover / averageCapital).toBeGreaterThan(count * 4);
      expect(trades.some(trade => trade.netPnl < 0)).toBe(true);
    }
  });

  test.each([7, 30, 90])('append +%i days retains every historical trade/day/cashflow and recalculates forward', days => {
    const original = JSON.parse(JSON.stringify(state));
    const next = advanceCashflowMasterState(state, days);
    expect(state).toEqual(original);
    expect(next.trades.slice(0, state.trades.length)).toEqual(state.trades);
    expect(next.dailyResults.slice(0, 380)).toEqual(state.dailyResults);
    expect(next.equityHistory.slice(0, 381)).toEqual(state.equityHistory);
    expect(next.cashflow.masterDays.slice(0, 380)).toEqual(state.cashflow.masterDays);
    expect(next.cashflow.masterCashFlows.slice(0, state.cashflow.masterCashFlows.length)).toEqual(state.cashflow.masterCashFlows);
    expect(next.dailyResults).toHaveLength(380 + days);
    expect(next.trades.length).toBeGreaterThan(state.trades.length);
    expect(next.cashflow.masterDays.at(-1)!.cumulativeTradingPnl).toBeGreaterThan(4_711_027);
    expect(next).toEqual(advanceCashflowMasterState(advanceCashflowMasterState(state, 3), days - 3));
  });
});
