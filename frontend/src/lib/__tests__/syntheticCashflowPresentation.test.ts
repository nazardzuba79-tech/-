import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  formatSyntheticHistoryDate, formatSyntheticTradePrice, formatSyntheticTradeTime, selectSyntheticPeriod, syntheticChartData, syntheticNazaraTrader, syntheticPerformancePoints,
  type SyntheticCopyTradingResponse, type SyntheticPeriodEconomics,
} from '../syntheticCopyTrading';
import {
  formatAccountSize, formatPercent, generateProfileData, generateTrades, getChartData,
  getCopierProfit, getTraderEarnings, marketplaceTraders, nazarTrader, PERIODS,
} from '../../pages/copy-trading-bolt/traders';

/** Tiny transparent ledger: profits are withdrawn from the private master account.
 * The public performance index compounds; dollar PnL is deliberately different. */
function fixture(): SyntheticCopyTradingResponse {
  const dailyReturns = [0, 0, 0, 0, 0, .1, -.1, .2, 0, .05];
  let index = 100;
  const dailyResults = dailyReturns.map((dailyReturn, offset) => {
    const startEquity = index;
    index *= 1 + dailyReturn;
    return { date: `2026-01-${String(offset + 1).padStart(2, '0')}`, startEquity,
      endEquity: index, dailyReturn, realizedPnl: 1_000 * dailyReturn, drawdown: 0 };
  });
  const trades = dailyResults.filter(day => day.dailyReturn !== 0).map((day, offset) => ({
    id: `trade-${offset}`, symbol: 'BTCUSDT', side: 'LONG' as const,
    entryPrice: 100, exitPrice: 100 + day.realizedPnl / 10, quantity: 10,
    leverage: 2, openedAt: `${day.date}T10:00:00Z`, closedAt: `${day.date}T11:00:00Z`,
    grossPnl: day.realizedPnl, fees: 0, funding: 0, netPnl: day.realizedPnl,
    returnPct: day.dailyReturn * 100, holdingTimeMinutes: 60, riskR: 1,
    result: day.realizedPnl > 0 ? 'WIN' as const : 'LOSS' as const,
  }));
  const periods = Object.fromEntries(PERIODS.map(period => {
    const selected = period === '7D' ? dailyResults.slice(-7) : dailyResults;
    const roi = (selected.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1) * 100;
    const entry: SyntheticPeriodEconomics = {
      roi, masterPnl: selected.reduce((sum, day) => sum + day.realizedPnl, 0),
      masterTradingVolume: 4_000, copiedTradingVolume: 81_230,
      // Crystallized high-water-mark fees need not equal 10% of current-window gross.
      grossFollowersPnl: 483, performanceFeeEarnings: 17, netFollowersPnl: 466,
      activeTradingDays: 4, calendarDays: selected.length,
      sharpe: 1.25, sortino: 3.9, profitFactor: 3.5, maximumDrawdown: 10,
      annualizedVolatility: 36.7,
    };
    return [period, entry];
  })) as NonNullable<SyntheticCopyTradingResponse['economics']>['periods'];
  let pnl = 0;
  return {
    trader: { id: 'VX-001', name: 'Nazara', vip: true },
    simulation: { seed: 1, mode: 'REAL_TIME', simulatedAt: '2026-01-10T12:00:00Z', stateVersion: 7 },
    analytics: { roi7: 122, roi30: 122, roi90: 122, roiAll: 3741, winRate: 75,
      maximumDrawdown: 99, activeFollowers: 32, aum: 9, tradingVolume: 9,
      followerPnl7: 9, followerPnl30: 9, followerPnl90: 9,
      allTime: { roi: 3741, pnl: 9, followersPnl: 9 } } as SyntheticCopyTradingResponse['analytics'],
    economics: { methodology: 'DAILY_TWR', performanceFeeRate: .1,
      policy: { methodology: 'DAILY_TWR', performanceFeeRate: .1, feeCrystallization: 'WEEKLY_HWM',
        copyMinimumPolicyEffectiveDate: '2025-11-01', currentCopyMinimum: 20_000,
        holidays: [{ start: '2025-12-18', end: '2026-01-05', reason: 'Trader holiday' }] },
      periods, cumulativePnlHistory: [{ date: '2025-12-31', pnl: 0 }, ...dailyResults.map(day => ({ date: day.date, pnl: pnl += day.realizedPnl }))],
    },
    trades, dailyResults,
    equityHistory: [{ date: '2025-12-31', equity: 100 }, ...dailyResults.map(day => ({ date: day.date, equity: day.endEquity }))],
    aumHistory: [],
    followers: Array.from({ length: 64 }, (_, index) => ({
      id: `f-${index}`, displayName: `Follower ${index}`, copyStartDate: '2025-12-31',
      allocatedCapital: index === 0 ? 5_000 : index === 1 ? 7_000 : 25_500 + index * 123,
      startingAllocation: index === 0 ? 5_000 : index === 1 ? 7_000 : 25_000,
      currentEquity: 0, realizedPnl: 2, unrealizedPnl: 0, roi: .2, copiedTrades: 4,
      copyRatio: .9, slippageBps: 2, latencyMs: 30, active: true,
      grossPnl: 3, performanceFees: 1, netPnl: 2, copiedVolume: 4_000,
    })), weekly: [], monthly: [],
  };
}

test('cash-flow-neutral index ROI and actual USDT PnL remain distinct and share daily/trade history', () => {
  const data = fixture();
  for (const period of PERIODS) {
    const selected = selectSyntheticPeriod(data, period);
    expect(selected.pnl).toBeCloseTo(selected.daily.reduce((sum, day) => sum + day.realizedPnl, 0), 10);
    expect(selected.pnl).toBeCloseTo(selected.trades.reduce((sum, trade) => sum + trade.netPnl, 0), 10);
    expect(selected.roi).toBeCloseTo((selected.daily.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1) * 100, 10);
    expect(selected.roi).toBeCloseTo(data.economics!.periods[period].roi, 10);
    expect(selected.pnl).toBe(250);
    expect(selected.pnl).not.toBeCloseTo(selected.equity.at(-1)!.equity - selected.equity[0].equity, 3);
    const pnlPoints = syntheticPerformancePoints(selected, 'PnL');
    const roiPoints = syntheticPerformancePoints(selected, 'ROI');
    expect(pnlPoints.at(-1)!.value).toBe(selected.pnl);
    expect(roiPoints.at(-1)!.value).toBeCloseTo(selected.roi, 9);
    expect(pnlPoints.map(point => point.date)).toEqual(roiPoints.map(point => point.date));
  }
  // A change to account cash-flow/balance metadata cannot change trading performance.
  const withCashflows = { ...data, privateCapital: 1_000, withdrawals: [{ date: '2026-01-06', amount: 100 }] };
  expect(selectSyntheticPeriod(withCashflows, 'ALL')).toEqual(selectSyntheticPeriod(data, 'ALL'));
  const withDifferentCashflows = { ...data, privateCapital: 20_000, withdrawals: [{ date: '2026-01-06', amount: 20_000 }] };
  expect(selectSyntheticPeriod(withDifferentCashflows, 'ALL')).toEqual(selectSyntheticPeriod(data, 'ALL'));
});

test('calendar holidays stay flat and retained, while active trading days count only trading activity', () => {
  const all = selectSyntheticPeriod(fixture(), 'ALL');
  expect(all.calendarDays).toBe(10);
  expect(all.tradingDays).toBe(4);
  expect(all.daily.slice(0, 5).map(day => day.realizedPnl)).toEqual([0, 0, 0, 0, 0]);
  expect(syntheticPerformancePoints(all, 'PnL').slice(0, 6).map(point => point.value)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(syntheticPerformancePoints(all, 'ROI')).toHaveLength(11);
  const week = selectSyntheticPeriod(fixture(), '7D');
  expect(week.daily).toHaveLength(7);
  expect(week.daily[0].date).toBe('2026-01-04');
  expect(week.equity[0].date).toBe('2026-01-03');
});

test('snapshot dates and full ISO follower join timestamps share valid UTC labels', () => {
  expect(formatSyntheticHistoryDate('2025-08-21')).toBe('21.08.2025');
  expect(formatSyntheticHistoryDate('2025-08-21T00:00:00.000Z')).toBe('21.08.2025');
  expect(formatSyntheticHistoryDate('2025-08-21T23:59:59.999Z', false)).toBe('21.08');
  expect(formatSyntheticHistoryDate('')).toBe('—');
  expect(formatSyntheticHistoryDate('invalid')).toBe('—');
});

test('v7 execution timestamps stay inside the displayed UTC simulation day and low prices remain distinct', () => {
  const closedAt = '2026-09-05T22:17:03.000Z';
  expect(formatSyntheticTradeTime(closedAt)).toContain('05.09.2026');
  expect(formatSyntheticTradeTime(closedAt)).toContain('22:17:03');
  expect(formatSyntheticTradeTime(closedAt)).not.toContain('06.09.2026');
  expect(formatSyntheticTradeTime('2026-09-06T01:17:03+03:00')).toBe(formatSyntheticTradeTime(closedAt));
  expect(formatSyntheticTradeTime('invalid')).toBe('—');
  expect(formatSyntheticTradePrice(.610011)).toBe('0,610011');
  expect(formatSyntheticTradePrice(.610012)).toBe('0,610012');
  expect(formatSyntheticTradePrice(2.4512)).toBe('2,4512');
  expect(formatSyntheticTradePrice(.00000007)).not.toMatch(/^0,0+$/);
  expect(formatSyntheticTradePrice(NaN)).toBe('—');
});

test('rolling7/30/90 retain their exact calendar boundaries and ALL never drops the earlier history', () => {
  const data = fixture();
  const prefix = Array.from({ length: 90 }, (_, offset) => ({
    date: new Date(Date.parse('2025-12-31T00:00:00Z') - (89 - offset) * 86_400_000).toISOString().slice(0, 10),
    startEquity: 100, endEquity: 100, realizedPnl: 0, dailyReturn: 0, drawdown: 0,
  }));
  data.dailyResults = [...prefix, ...data.dailyResults];
  data.equityHistory = [{ date: '2025-10-02', equity: 100 }, ...data.dailyResults.map(day => ({ date: day.date, equity: day.endEquity }))];
  for (const period of PERIODS) {
    const selected = selectSyntheticPeriod(data, period);
    const expectedCount = period === 'ALL' ? 100 : parseInt(period, 10);
    expect(selected.daily).toHaveLength(expectedCount);
    expect(selected.equity).toHaveLength(expectedCount + 1);
    expect(syntheticPerformancePoints(selected, 'PnL')).toHaveLength(expectedCount + 1);
    expect(selected.cumulativePnl.at(-1)?.pnl).toBe(250);
  }
  expect(selectSyntheticPeriod(data, 'ALL').equity[0].date).toBe('2025-10-02');
});

test('fee-event economics, nullable risks, canonical follower cohort and allocations override stale analytics', () => {
  const data = fixture();
  const trader = syntheticNazaraTrader(data);
  expect(trader.copiers).toBe(64);
  expect(trader.aum).toBe(data.followers.reduce((sum, follower) => sum + follower.allocatedCapital, 0));
  expect(trader.performanceFee).toBe(.1);
  expect(trader.roiAll).toBeCloseTo(data.economics!.periods.ALL.roi, 10);
  for (const period of PERIODS) {
    const selected = selectSyntheticPeriod(data, period);
    expect(selected.economics).toBe(data.economics!.periods[period]);
    expect(selected.followerPnl).toBe(466);
    expect(selected.economics!.performanceFeeEarnings).toBe(17);
    expect(selected.economics!.performanceFeeEarnings).not.toBe(selected.economics!.grossFollowersPnl * .1);
    expect(selected.sharpe).toBe(1.25);
    expect(selected.sortino).toBe(3.9);
  }
  data.economics!.periods['7D'].sharpe = null;
  data.economics!.periods['7D'].sortino = null;
  data.economics!.periods['7D'].profitFactor = null;
  const undefinedRisk = selectSyntheticPeriod(data, '7D');
  expect(undefinedRisk.sharpe).toBeNull();
  expect(undefinedRisk.sortino).toBeNull();
  expect(undefinedRisk.profitFactor).toBeNull();
});

test('missing Nazara payload never becomes stale ROI, zero economics, fabricated trades or a catalogue curve', () => {
  const missing = syntheticNazaraTrader(null);
  for (const value of [missing.roi7, missing.roi30, missing.roi90, missing.roiAll, missing.aum,
    missing.copiers, missing.performanceFee, getCopierProfit(missing), getTraderEarnings(missing)]) {
    expect(Number.isNaN(value)).toBe(true);
    expect(formatPercent(value)).toBe('—');
    expect(formatAccountSize(value)).toBe('—');
  }
  expect(generateTrades(nazarTrader)).toEqual([]);
  expect(generateProfileData(nazarTrader).totalTrades).toBeNaN();
  expect(getChartData(nazarTrader, 'ALL').linePath).toBe('');
  expect(marketplaceTraders[0].roi7).toBe(9.4);
  expect(marketplaceTraders[0].performanceFee).toBe(.15);
});

test('canonical chart exposes ROI percentages without fabricated benchmark or dollar-index series', () => {
  const chart = syntheticChartData(fixture(), 'ALL');
  expect(chart.linePath.match(/[ML]/g)).toHaveLength(11);
  expect(chart.linePath).not.toMatch(/NaN|Infinity|[QC]/);
  expect(chart.marketPath).toBe('');
  expect(chart.btcPath).toBe('');
  expect(chart.yLabels.every(label => label.endsWith('%') && !label.includes('$'))).toBe(true);
});

test('presentation retains periods and replaces private master balances with turnover and explicit fee economics', () => {
  const components = readFileSync(resolve(__dirname, '../../pages/copy-trading-bolt/components.tsx'), 'utf8');
  const page = readFileSync(resolve(__dirname, '../../pages/CopyTradingPage.tsx'), 'utf8');
  const traderSource = readFileSync(resolve(__dirname, '../../pages/copy-trading-bolt/traders.ts'), 'utf8');
  expect(PERIODS).toEqual(['7D', '30D', '90D', 'ALL']);
  expect(components).not.toMatch(/Начальный капитал|Текущий капитал|Капитал стратегии с момента запуска/);
  expect(components).toContain('Оборот мастера');
  expect(components).toContain('Оборот копирования');
  expect(components).toContain('economics?.performanceFeeEarnings');
  expect(components).toContain('economics?.grossFollowersPnl');
  expect(components).toContain('follower.performanceFees');
  expect(components).toContain('follower.startingAllocation');
  expect(components).toContain("cashflowHistory ? 'Open Time · UTC' : 'Open Time'");
  expect(components).toContain("cashflowHistory ? 'Close Time · UTC' : 'Close Time'");
  expect(page).toContain('syntheticNazaraTrader(synthetic)');
  expect(traderSource).not.toMatch(/GROWTH_ANCHORS|COPIER_COHORTS|nazarEconomics|roi7: 122|roiAll: 3741/);
});
