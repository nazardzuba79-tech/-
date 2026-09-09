import { computeTradeStats, latestTrades, summarizeStrategy, VISIBLE_TRADES, PERIODS, type StrategySummary } from '../marketplaceSummary';

/** `summarizeStrategy` returns its input untouched when there is nothing to
 *  summarize; every fixture here has a history, so the summarized branch is
 *  the one under test. */
const summarize = (data: unknown) => summarizeStrategy(data as never) as StrategySummary;

/**
 * Separating calculation data from display data.
 *
 * The rule this file exists to enforce, in one line: **the ten trades the
 * browser receives are never an input to a statistic.** Everything is
 * computed here, over the complete history, before the history is dropped
 * from the wire.
 */

const DAY = 86_400_000;
const END = Date.parse('2026-09-09T00:00:00Z');
const day = (back: number) => new Date(END - back * DAY).toISOString().slice(0, 10);

function trade(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `t${i}`, symbol: 'BTC/USDT', side: 'LONG', entryPrice: 100 + i, exitPrice: 101 + i,
    quantity: 1, leverage: 10, openedAt: new Date(END - i * DAY).toISOString(),
    closedAt: new Date(END - i * DAY + 3_600_000).toISOString(),
    grossPnl: 10, fees: 1, funding: 0, netPnl: i % 3 === 0 ? -20 : 30,
    returnPct: 1, holdingTimeMinutes: 60, riskR: 1, result: 'WIN',
    ...over,
  };
}

/** 400 days of history — well past every period boundary. */
function strategy(count = 400) {
  return {
    trader: { id: 'VX-001', name: 'Nazar', vip: true },
    simulation: { seed: 1, mode: 'REAL_TIME', simulatedAt: new Date(END).toISOString() },
    analytics: {},
    trades: Array.from({ length: count }, (_, i) => trade(i)),
    equityHistory: Array.from({ length: 400 }, (_, i) => ({ date: day(399 - i), equity: 1000 + i })),
    aumHistory: [], dailyResults: [], followers: [], weekly: [], monthly: [],
  } as any;
}

describe('display rows', () => {
  it('sends at most ten trades, newest first', () => {
    const summary = summarize(strategy());
    expect(summary.trades).toHaveLength(VISIBLE_TRADES);
    const closes = summary.trades.map((t: { closedAt: string }) => Date.parse(t.closedAt));
    expect(closes).toEqual([...closes].sort((a, b) => b - a));
    // Truly the LATEST ten, not the first ten of the array.
    const newest = Math.max(...strategy().trades.map((t: any) => Date.parse(t.closedAt)));
    expect(closes[0]).toBe(newest);
  });

  it('sends all of them when fewer than ten exist, and never pads', () => {
    const summary = summarize(strategy(4));
    expect(summary.trades).toHaveLength(4);
    expect(summary.tradeHistoryCount).toBe(4);
  });

  it('keeps the REAL total next to the ten rows', () => {
    const summary = summarize(strategy());
    expect(summary.tradeHistoryCount).toBe(400);
    expect(summary.tradeStats.ALL.totalTrades).toBe(400);
    // The thing the owner asked for explicitly: total trades must not
    // become ten because the table shows ten.
    expect(summary.tradeStats.ALL.totalTrades).not.toBe(VISIBLE_TRADES);
  });
});

describe('statistics come from the complete history', () => {
  const full = strategy();
  const stats = computeTradeStats(full);

  it('counts every trade in ALL, not the visible ten', () => {
    expect(stats.ALL.totalTrades).toBe(400);
    expect(stats.ALL.winningTrades + stats.ALL.losingTrades).toBe(400);
  });

  it('windows each period by close date, exactly as the client used to', () => {
    // One trade per day, so a 7-day window holds 7 and a 30-day window 30.
    expect(stats['7D'].totalTrades).toBe(7);
    expect(stats['30D'].totalTrades).toBe(30);
    expect(stats['90D'].totalTrades).toBe(90);
  });

  it('sums gross profit and gross loss over the whole window', () => {
    const losses = full.trades.filter((t: any) => t.netPnl < 0);
    const wins = full.trades.filter((t: any) => t.netPnl > 0);
    expect(stats.ALL.winningTrades).toBe(wins.length);
    expect(stats.ALL.losingTrades).toBe(losses.length);
    expect(stats.ALL.grossProfit).toBeCloseTo(wins.reduce((s: number, t: any) => s + t.netPnl, 0), 8);
    expect(stats.ALL.grossLoss).toBeCloseTo(Math.abs(losses.reduce((s: number, t: any) => s + t.netPnl, 0)), 8);
  });

  it('is NOT what the ten display rows add up to', () => {
    const ten = latestTrades(full);
    const fromTen = ten.filter((t) => t.netPnl > 0).length;
    // The whole point: a win count over ten rows is a different number.
    expect(stats.ALL.winningTrades).not.toBe(fromTen);
    expect(stats.ALL.holdingTimeTotalMinutes).toBe(400 * 60);
  });

  it('reports a real zero as zero for a period with no trades', () => {
    // Nothing closed inside the window — that is a fact about the period,
    // not missing data, so it is 0 rather than a dash.
    const quiet = strategy(2);
    quiet.trades = [trade(300), trade(301)];
    const quietStats = computeTradeStats(quiet);
    expect(quietStats['7D'].totalTrades).toBe(0);
    expect(quietStats['7D'].grossProfit).toBe(0);
    expect(quietStats.ALL.totalTrades).toBe(2);
  });

  it('covers every period the UI can select', () => {
    expect(Object.keys(stats).sort()).toEqual([...PERIODS].sort());
  });
});

describe('the summary keeps everything else intact', () => {
  it('passes analytics, equity, AUM, daily, followers and economics through untouched', () => {
    const full = strategy();
    full.economics = { methodology: 'DAILY_TWR', performanceFeeRate: 0.2, periods: { ALL: { roi: 1 } } };
    full.analytics = { roiAll: 64.2, allTime: { pnl: 420000 } };
    const summary = summarize(full);
    expect(summary.economics).toBe(full.economics);
    expect(summary.analytics).toBe(full.analytics);
    expect(summary.equityHistory).toBe(full.equityHistory);
    expect(summary.aumHistory).toBe(full.aumHistory);
    expect(summary.dailyResults).toBe(full.dailyResults);
    expect(summary.followers).toBe(full.followers);
    expect(summary.trader).toBe(full.trader);
  });

  it('does not mutate the source history', () => {
    const full = strategy();
    summarize(full);
    expect(full.trades).toHaveLength(400);
  });
});
