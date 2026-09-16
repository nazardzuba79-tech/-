const REPORTED_TRADE_ID = 'KS-REPORTED-20260916-BTC';
const REPORTED_OPEN_DATE = '2026-09-15';
const REPORTED_CLOSE_DATE = '2026-09-16';
const REPORTED_NET_PNL = 1_754;
const REPORTED_RETURN_PCT = 7.8;
const PERIOD_DAYS: Record<'7D' | '30D' | '90D' | 'ALL', number> = {
  '7D': 7, '30D': 30, '90D': 90, ALL: Number.POSITIVE_INFINITY,
};

const round = (value: number, digits = 4) => Number(value.toFixed(digits));
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
  .toISOString().slice(0, 10);

function periodIncludes(period: keyof typeof PERIOD_DAYS, end: string): boolean {
  if (REPORTED_CLOSE_DATE > end) return false;
  if (period === 'ALL') return true;
  return REPORTED_CLOSE_DATE > addDays(end, -PERIOD_DAYS[period]);
}

function riskMetrics(returns: number[]) {
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const deviation = Math.sqrt(variance);
  const downside = returns.length
    ? Math.sqrt(returns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / returns.length)
    : 0;
  let cumulative = 0;
  let peak = 100;
  let maximumDrawdown = 0;
  for (const value of returns) {
    cumulative += value;
    const equity = 100 + cumulative * 100;
    peak = Math.max(peak, equity);
    if (peak > 0) maximumDrawdown = Math.max(maximumDrawdown, (peak - equity) / peak * 100);
  }
  return {
    sharpe: deviation > 0 ? mean / deviation * Math.sqrt(365) : null,
    sortino: downside > 0 ? mean / downside * Math.sqrt(365) : null,
    annualizedVolatility: deviation * Math.sqrt(365) * 100,
    maximumDrawdown,
  };
}

function weekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return addDays(date, -d.getUTCDay());
}

/**
 * Public presentation overlay for an owner-reported Ksenia trade.
 *
 * Known facts are recorded exactly: BTCUSDT short, 10x, opened 2026-09-15,
 * closed 2026-09-16, +1,754 USDT, +7.8%. Exact execution prices, quantity,
 * intraday timestamps, fees/funding and holding duration were not supplied,
 * so they are intentionally absent and render as unknown rather than being
 * invented. The +7.8 percentage points are additive to the already-published
 * 2026-09-16 daily return and therefore to every rolling ROI window that
 * contains that day.
 */
export function withKseniaReportedTrade<T>(input: T): T {
  const source = input as any;
  if (!source || source.trader?.id !== 'VX-KSENIA') return input;
  if (Array.isArray(source.trades) && source.trades.some((trade: any) => trade?.id === REPORTED_TRADE_ID)) return input;
  const end = source.simulation?.simulatedAt?.slice?.(0, 10);
  if (typeof end !== 'string' || end < REPORTED_CLOSE_DATE) return input;
  if (!Array.isArray(source.dailyResults) || !source.dailyResults.some((day: any) => day?.date === REPORTED_CLOSE_DATE)) return input;

  const data = JSON.parse(JSON.stringify(source));
  const day = data.dailyResults.find((row: any) => row.date === REPORTED_CLOSE_DATE);
  day.dailyReturn = round(day.dailyReturn + REPORTED_RETURN_PCT / 100, 12);
  day.realizedPnl = round(day.realizedPnl + REPORTED_NET_PNL, 4);

  for (const point of data.equityHistory ?? []) {
    if (point.date >= REPORTED_CLOSE_DATE) point.equity = round(point.equity + REPORTED_RETURN_PCT, 12);
  }
  for (const row of data.dailyResults) {
    if (row.date === REPORTED_CLOSE_DATE) row.endEquity = round(row.endEquity + REPORTED_RETURN_PCT, 12);
    else if (row.date > REPORTED_CLOSE_DATE) {
      row.startEquity = round(row.startEquity + REPORTED_RETURN_PCT, 12);
      row.endEquity = round(row.endEquity + REPORTED_RETURN_PCT, 12);
    }
  }

  if (Array.isArray(data.economics?.cumulativePnlHistory)) {
    for (const point of data.economics.cumulativePnlHistory) {
      if (point.date >= REPORTED_CLOSE_DATE) point.pnl = round(point.pnl + REPORTED_NET_PNL, 4);
    }
  }

  const reportedRow = {
    id: REPORTED_TRADE_ID,
    symbol: 'BTCUSDT · 10x',
    marketSymbol: 'BTCUSDT',
    side: 'SHORT',
    leverage: 10,
    openedAt: `${REPORTED_OPEN_DATE}T??:??:??Z`,
    closedAt: `${REPORTED_CLOSE_DATE}T??:??:??Z`,
    openedOn: REPORTED_OPEN_DATE,
    closedOn: REPORTED_CLOSE_DATE,
    netPnl: REPORTED_NET_PNL,
    returnPct: REPORTED_RETURN_PCT,
    result: 'WIN',
    source: 'OWNER_REPORTED',
  };
  data.trades = [reportedRow, ...(data.trades ?? [])].slice(0, 10);

  if (data.tradeStats) {
    for (const period of ['7D', '30D', '90D', 'ALL'] as const) {
      if (!periodIncludes(period, end)) continue;
      const stats = data.tradeStats[period];
      if (!stats) continue;
      stats.totalTrades += 1;
      stats.winningTrades += 1;
      stats.grossProfit = round(stats.grossProfit + REPORTED_NET_PNL, 4);
      stats.netPnlTotal = round(stats.netPnlTotal + REPORTED_NET_PNL, 4);
      // Exact holding time is unknown; omitting this aggregate makes the UI
      // display an honest dash instead of treating an unknown duration as 0.
      delete stats.holdingTimeTotalMinutes;
    }
    data.tradeHistoryCount = data.tradeStats.ALL.totalTrades;
  } else if (Number.isFinite(data.tradeHistoryCount)) {
    data.tradeHistoryCount += 1;
  }

  const dailyFor = (period: keyof typeof PERIOD_DAYS) => {
    if (period === 'ALL') return data.dailyResults.filter((row: any) => row.date <= end);
    const cutoff = addDays(end, -PERIOD_DAYS[period]);
    return data.dailyResults.filter((row: any) => row.date > cutoff && row.date <= end);
  };

  if (data.economics?.periods) {
    for (const period of ['7D', '30D', '90D', 'ALL'] as const) {
      if (!periodIncludes(period, end)) continue;
      const metrics = data.economics.periods[period];
      if (!metrics) continue;
      const daily = dailyFor(period);
      const returns = daily.map((row: any) => row.dailyReturn);
      const risk = riskMetrics(returns);
      metrics.roi = round(returns.reduce((sum: number, value: number) => sum + value, 0) * 100, 4);
      metrics.masterPnl = round(metrics.masterPnl + REPORTED_NET_PNL, 4);
      metrics.sharpe = risk.sharpe === null ? null : round(risk.sharpe, 12);
      metrics.sortino = risk.sortino === null ? null : round(risk.sortino, 12);
      metrics.annualizedVolatility = round(risk.annualizedVolatility, 12);
      metrics.maximumDrawdown = round(risk.maximumDrawdown, 12);
      const stats = data.tradeStats?.[period];
      metrics.profitFactor = stats
        ? (stats.grossLoss > 0 ? round(stats.grossProfit / stats.grossLoss, 12) : null)
        : metrics.profitFactor;
    }
  }

  const analytics = data.analytics;
  if (analytics && data.economics?.periods) {
    const p7 = data.economics.periods['7D'];
    const p30 = data.economics.periods['30D'];
    const p90 = data.economics.periods['90D'];
    const all = data.economics.periods.ALL;
    analytics.roi7 = p7.roi;
    analytics.roi30 = p30.roi;
    analytics.roi90 = p90.roi;
    analytics.roiAll = all.roi;
    analytics.masterPnl = all.masterPnl;
    if (data.tradeStats?.ALL) {
      const allStats = data.tradeStats.ALL;
      analytics.totalTrades = allStats.totalTrades;
      analytics.winningTrades = allStats.winningTrades;
      analytics.losingTrades = allStats.losingTrades;
      analytics.grossProfit = allStats.grossProfit;
      analytics.grossLoss = allStats.grossLoss;
      const resolved = allStats.winningTrades + allStats.losingTrades;
      analytics.winRate = resolved ? round(allStats.winningTrades / resolved * 100, 3) : 0;
      analytics.expectancy = allStats.totalTrades ? round(all.masterPnl / allStats.totalTrades, 4) : 0;
      analytics.averageTradesPerDay = allStats.totalTrades / Math.max(1, all.calendarDays);
      analytics.averageTradesPerWeek = analytics.averageTradesPerDay * 7;
      analytics.averageHoldingTimeMinutes = null;
      analytics.medianHoldingTimeMinutes = null;
      analytics.longestTradeMinutes = null;
      analytics.shortestTradeMinutes = null;
      analytics.allTime = {
        ...analytics.allTime,
        roi: all.roi,
        pnl: all.masterPnl,
        totalTrades: allStats.totalTrades,
        winningTrades: allStats.winningTrades,
        losingTrades: allStats.losingTrades,
        winRate: analytics.winRate,
        maximumDrawdown: all.maximumDrawdown,
        profitFactor: all.profitFactor ?? 0,
        sharpe: all.sharpe ?? 0,
        sortino: all.sortino ?? 0,
        averageTrade: allStats.totalTrades ? all.masterPnl / allStats.totalTrades : 0,
      };
    }
    if (data.tradeStats?.['7D']) analytics.tradesLast7D = data.tradeStats['7D'].totalTrades;
    if (data.tradeStats?.['30D']) analytics.tradesLast30D = data.tradeStats['30D'].totalTrades;
    analytics.maximumDrawdown = p90.maximumDrawdown;
    analytics.profitFactor = p90.profitFactor ?? 0;
    analytics.sharpe = p90.sharpe ?? 0;
    analytics.sortino = p90.sortino ?? 0;
    analytics.annualizedVolatility = p90.annualizedVolatility;
    analytics.calmar = p90.maximumDrawdown
      ? (p90.roi / 100 * 365 / Math.max(1, p90.calendarDays)) / (p90.maximumDrawdown / 100)
      : 0;
  }

  const updateSummary = (rows: any[], key: string) => {
    const item = rows?.find((row: any) => row.period === key);
    if (!item) return;
    const oldTrades = item.trades;
    const oldWins = Math.round(oldTrades * item.winRate / 100);
    item.roi = round(item.roi + REPORTED_RETURN_PCT, 3);
    item.pnl = round(item.pnl + REPORTED_NET_PNL, 4);
    item.trades = oldTrades + 1;
    item.winRate = round((oldWins + 1) / item.trades * 100, 3);
    const daily = key.length === 7
      ? data.dailyResults.filter((row: any) => row.date.startsWith(key))
      : data.dailyResults.filter((row: any) => row.date >= key && row.date < addDays(key, 7));
    if (daily.length) item.maxDrawdown = round(riskMetrics(daily.map((row: any) => row.dailyReturn)).maximumDrawdown, 4);
  };
  if (Array.isArray(data.weekly)) updateSummary(data.weekly, weekKey(REPORTED_CLOSE_DATE));
  if (Array.isArray(data.monthly)) {
    const month = data.monthly.find((row: any) => row.period === REPORTED_CLOSE_DATE.slice(0, 7));
    if (month) {
      const oldTrades = month.trades;
      const oldWins = Math.round(oldTrades * month.winRate / 100);
      month.roi = round(month.roi + REPORTED_RETURN_PCT, 3);
      month.pnl = round(month.pnl + REPORTED_NET_PNL, 4);
      month.trades = oldTrades + 1;
      month.winRate = round((oldWins + 1) / month.trades * 100, 3);
      const returns = data.dailyResults.filter((row: any) => row.date.startsWith(REPORTED_CLOSE_DATE.slice(0, 7)))
        .map((row: any) => row.dailyReturn);
      if (returns.length) month.maxDrawdown = round(riskMetrics(returns).maximumDrawdown, 4);
    }
  }

  data.reportedPerformance = [{
    id: REPORTED_TRADE_ID,
    source: 'OWNER_REPORTED',
    market: 'BTCUSDT',
    side: 'SHORT',
    leverage: 10,
    openedOn: REPORTED_OPEN_DATE,
    closedOn: REPORTED_CLOSE_DATE,
    netPnl: REPORTED_NET_PNL,
    returnPct: REPORTED_RETURN_PCT,
    entryPrice: null,
    exitPrice: null,
    quantity: null,
    openedAt: null,
    closedAt: null,
    fees: null,
    funding: null,
  }];
  return data as T;
}
