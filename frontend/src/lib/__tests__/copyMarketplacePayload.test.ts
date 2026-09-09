import { readFileSync } from 'fs';
import { resolve } from 'path';
import { gzipSync } from 'zlib';
import { selectSyntheticPeriod, type SyntheticCopyTradingResponse } from '../syntheticCopyTrading';
import { validStrategy, VISIBLE_TRADE_ROWS } from '../copyMarketplaceStore';
import { summarizeStrategy } from '../../../../src/services/copyTrading/marketplaceSummary';
import type { Period } from '../../pages/copy-trading-bolt/traders';

/**
 * The marketplace transports display rows; the statistics still describe the
 * whole history.
 *
 * Measured against a fixture built to the real engine config, `trades[]` was
 * 98% of the marketplace payload. The risk in removing it is not the removal
 * — it is that a number quietly starts describing ten trades instead of
 * thousands. That is what most of this file checks.
 */

const PERIODS: Period[] = ['7D', '30D', '90D', 'ALL'];
const DAY = 86_400_000;
const END = Date.parse('2026-09-09T00:00:00Z');
const day = (back: number) => new Date(END - back * DAY).toISOString().slice(0, 10);

function trade(i: number) {
  return {
    id: `t${i}`, symbol: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'][i % 3], side: (i % 2 ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
    entryPrice: 100 + i, exitPrice: 101 + i, quantity: 0.5 + (i % 7) / 10, leverage: 10,
    openedAt: new Date(END - i * DAY).toISOString(),
    closedAt: new Date(END - i * DAY + 3_600_000).toISOString(),
    grossPnl: 12, fees: 1.1, funding: 0.2, netPnl: i % 3 === 0 ? -18.5 : 27.25,
    returnPct: 0.9, holdingTimeMinutes: 40 + (i % 13), riskR: 0.8,
    result: (i % 3 === 0 ? 'LOSS' : 'WIN') as 'WIN' | 'LOSS',
  };
}

/** A realistic strategy: 400 days, one trade a day, full economics. */
function fullStrategy(id = 'VX-001', count = 400): SyntheticCopyTradingResponse {
  const periodMetrics = {
    roi: 5, masterPnl: 1000, masterTradingVolume: 90_000, copiedTradingVolume: 70_000,
    grossFollowersPnl: 800, performanceFeeEarnings: 160, netFollowersPnl: 640,
    activeTradingDays: 300, calendarDays: 365, maximumDrawdown: 8.2, annualizedVolatility: 30,
    sharpe: 1.4, sortino: 2.0, profitFactor: 1.8,
  };
  return {
    trader: { id, name: 'Trader', vip: true },
    simulation: { seed: 1, mode: 'REAL_TIME', simulatedAt: new Date(END).toISOString(), stateVersion: 8 },
    economics: {
      methodology: 'DAILY_TWR', performanceFeeRate: 0.2,
      periods: { '7D': periodMetrics, '30D': periodMetrics, '90D': periodMetrics, ALL: periodMetrics },
    },
    analytics: {
      roi7: 2, roi30: 8, roi90: 22, roiAll: 64, winRate: 66, maximumDrawdown: 8.2,
      averageWinR: 1.9, averageLossR: 1, plRatio: 1.9, grossProfit: 9000, grossLoss: 5000,
      profitFactor: 1.8, expectancy: 240, expectancyR: 0.3, sharpe: 1.4, sortino: 2, calmar: 1.8,
      annualizedVolatility: 30, totalTradingDays: 365, totalTrades: count, winningTrades: 0, losingTrades: 0,
      tradesLast7D: 7, tradesLast30D: 30, averageTradesPerDay: 1, averageTradesPerWeek: 7,
      averageHoldingTimeMinutes: 45, medianHoldingTimeMinutes: 44, longestTradeMinutes: 500, shortestTradeMinutes: 5,
      masterPnl: 1000, followerPnl: 640, followerPnl7: 10, followerPnl30: 40, followerPnl90: 120,
      aum: 4_200_000, activeFollowers: 32, tradingVolume: 90_000,
      allTime: { roi: 64, pnl: 1000, totalTrades: count, winningTrades: 0, losingTrades: 0, winRate: 66,
        maximumDrawdown: 8.2, profitFactor: 1.8, sharpe: 1.4, sortino: 2, tradingDays: 365,
        averageTrade: 3, followersPnl: 640, aum: 4_200_000 },
    },
    trades: Array.from({ length: count }, (_, i) => trade(i)),
    equityHistory: Array.from({ length: 400 }, (_, i) => ({ date: day(399 - i), equity: 1_000_000 + i * 1150 })),
    aumHistory: Array.from({ length: 400 }, (_, i) => ({ date: day(399 - i), aum: 3_000_000 + i * 3200, followerCount: 32 })),
    dailyResults: Array.from({ length: 400 }, (_, i) => ({ date: day(399 - i), startEquity: 1_000_000 + i * 1150,
      endEquity: 1_000_000 + (i + 1) * 1150, realizedPnl: 1150, dailyReturn: 0.0011, drawdown: 0.4 })),
    followers: Array.from({ length: 32 }, (_, i) => ({ id: `f${i}`, displayName: `Follower ${i}`,
      copyStartDate: day(i), allocatedCapital: 10_000, currentEquity: 12_000, realizedPnl: 1200,
      unrealizedPnl: 40, roi: 12, copiedTrades: 300, copyRatio: 1, slippageBps: 4, latencyMs: 120, active: true })),
    weekly: Array.from({ length: 52 }, (_, i) => ({ period: `W${i}`, roi: 1, pnl: 8000, trades: 7, winRate: 66, maxDrawdown: 3 })),
    monthly: Array.from({ length: 12 }, (_, i) => ({ period: `M${i}`, roi: 5, pnl: 34000, trades: 30, winRate: 66, maxDrawdown: 6 })),
  } as SyntheticCopyTradingResponse;
}

const full = fullStrategy();
const summary = summarizeStrategy(full as never) as unknown as SyntheticCopyTradingResponse;

// ── The claim that matters most ─────────────────────────────────────

describe('the summary produces the SAME numbers as the full history', () => {
  it.each(PERIODS)('every period-analytics field is identical for %s', (period) => {
    const before = selectSyntheticPeriod(full, period);
    const after = selectSyntheticPeriod(summary, period);
    // Compared field by field rather than as one object, because `trades`
    // is the one thing that is legitimately different.
    for (const key of [
      'roi', 'pnl', 'winRate', 'maximumDrawdown', 'averagePnl', 'profitFactor',
      'averageTradesPerWeek', 'averageHoldingTimeMinutes', 'annualizedVolatility',
      'sharpe', 'sortino', 'totalTrades', 'winningTrades', 'losingTrades',
      'tradingDays', 'calendarDays', 'followerPnl',
    ] as const) {
      expect({ period, key, value: after[key] }).toEqual({ period, key, value: before[key] });
    }
    expect(after.equity).toEqual(before.equity);
    expect(after.daily).toEqual(before.daily);
    expect(after.cumulativePnl).toEqual(before.cumulativePnl);
  });

  it('reports the real trade count, not the number of rows it shipped', () => {
    const after = selectSyntheticPeriod(summary, 'ALL');
    expect(after.totalTrades).toBe(400);
    expect(after.trades.length).toBeLessThanOrEqual(VISIBLE_TRADE_ROWS);
    expect(after.summarized).toBe(true);
  });

  it('would give a DIFFERENT answer if the statistics were taken from the ten rows', () => {
    // Guards the guard: if the ten rows happened to reproduce the whole
    // history's numbers, the test above would prove nothing.
    const naive = { ...summary, tradeStats: undefined } as SyntheticCopyTradingResponse;
    const wrong = selectSyntheticPeriod(naive, 'ALL');
    expect(wrong.totalTrades).toBe(VISIBLE_TRADE_ROWS);
    expect(wrong.totalTrades).not.toBe(selectSyntheticPeriod(summary, 'ALL').totalTrades);
    expect(wrong.winRate).not.toBeCloseTo(selectSyntheticPeriod(summary, 'ALL').winRate, 6);
  });
});

// ── Visible history ─────────────────────────────────────────────────

describe('visible trade history', () => {
  it('is the latest ten, newest first', () => {
    expect(summary.trades).toHaveLength(10);
    const closes = summary.trades.map((t) => Date.parse(t.closedAt));
    expect(closes).toEqual([...closes].sort((a, b) => b - a));
    expect(closes[0]).toBe(Math.max(...full.trades.map((t) => Date.parse(t.closedAt))));
  });

  it('shows all of them when a strategy has fewer than ten, and never pads', () => {
    const small = summarizeStrategy(fullStrategy('VX-001', 3) as never) as unknown as SyntheticCopyTradingResponse;
    expect(small.trades).toHaveLength(3);
    expect(selectSyntheticPeriod(small, 'ALL').totalTrades).toBe(3);
  });
});

// ── Network-boundary safety ─────────────────────────────────────────

describe('the validator got stricter, not laxer', () => {
  it('accepts a well-formed summary', () => {
    expect(validStrategy(summary, 'VX-001')).toBe(true);
  });

  it('rejects display rows arriving WITHOUT the full-history aggregates', () => {
    // The dangerous shape: ten rows and no stats would make every
    // trade-derived figure describe ten trades.
    const { tradeStats, ...withoutStats } = summary as never as Record<string, unknown>;
    expect(validStrategy(withoutStats, 'VX-001')).toBe(false);
  });

  it('rejects a payload still carrying a full history in the display field', () => {
    expect(validStrategy({ ...summary, trades: full.trades }, 'VX-001')).toBe(false);
  });

  it('rejects a total that is smaller than what it shipped', () => {
    expect(validStrategy({ ...summary, tradeHistoryCount: 2 }, 'VX-001')).toBe(false);
  });

  it('rejects a total that disagrees with the ALL aggregate', () => {
    expect(validStrategy({ ...summary, tradeHistoryCount: 9999 }, 'VX-001')).toBe(false);
  });

  it('rejects display rows that are not newest-first', () => {
    expect(validStrategy({ ...summary, trades: [...summary.trades].reverse() }, 'VX-001')).toBe(false);
  });

  it('still rejects a malformed trade row', () => {
    const broken = [{ ...summary.trades[0], netPnl: 'x' }, ...summary.trades.slice(1)];
    expect(validStrategy({ ...summary, trades: broken }, 'VX-001')).toBe(false);
  });

  it('still rejects a malformed aggregate', () => {
    expect(validStrategy({ ...summary, tradeStats: { ...summary.tradeStats, '7D': { totalTrades: 'x' } } }, 'VX-001')).toBe(false);
  });
});

// ── Measured payload ────────────────────────────────────────────────

describe('payload size', () => {
  it('drops the trade history from the wire and reports the reduction', () => {
    // Sized to the real engine config — tradesPerDay 4-12 over 365 days is
    // about 2,920 rows per strategy — so the ratio here is the ratio in
    // production, not an artefact of a small fixture.
    const large = fullStrategy('VX-001', 2920);
    const largeSummary = summarizeStrategy(large as never) as unknown as SyntheticCopyTradingResponse;
    const before = Buffer.from(JSON.stringify({ nazar: large, ksenia: large }));
    const after = Buffer.from(JSON.stringify({ nazar: largeSummary, ksenia: largeSummary }));
    const tradesBefore = Buffer.byteLength(JSON.stringify(large.trades)) * 2;
    const tradesAfter = Buffer.byteLength(JSON.stringify(largeSummary.trades)) * 2;

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      rawBefore: before.length, rawAfter: after.length,
      gzipBefore: gzipSync(before).length, gzipAfter: gzipSync(after).length,
      tradeBytesBefore: tradesBefore, tradeBytesAfter: tradesAfter,
      rawReductionPercent: +(100 - (after.length / before.length) * 100).toFixed(1),
      gzipReductionPercent: +(100 - (gzipSync(after).length / gzipSync(before).length) * 100).toFixed(1),
    }, null, 2));

    // The payload was ~98% trades; what remains must be a small fraction.
    expect(after.length).toBeLessThan(before.length / 8);
    expect(tradesAfter).toBeLessThan(tradesBefore / 100);
    expect(largeSummary.tradeStats?.ALL.totalTrades).toBe(2920);
  });

  it('keeps every non-trade section on the wire', () => {
    // The saving must come from trades, not from quietly dropping history
    // the charts need.
    expect(summary.equityHistory).toHaveLength(400);
    expect(summary.aumHistory).toHaveLength(400);
    expect(summary.dailyResults).toHaveLength(400);
    expect(summary.followers).toHaveLength(32);
    expect(summary.weekly).toHaveLength(52);
    expect(summary.monthly).toHaveLength(12);
    expect(summary.economics).toEqual(full.economics);
    expect(summary.analytics).toEqual(full.analytics);
  });
});

// ── The route actually uses it ──────────────────────────────────────

describe('wiring', () => {
  const route = readFileSync(resolve(__dirname, '../../../../src/api/routes/copyPerformance.ts'), 'utf8');
  it('summarizes both the aggregate and the per-strategy endpoints', () => {
    expect(route).toContain("service.get('nazar').then(summarizeStrategy)");
    expect(route).toContain("service.get('ksenia').then(summarizeStrategy)");
    expect(route).toContain('summarizeStrategy(await service.get(strategy))');
  });

  it('leaves the one-request marketplace bootstrap intact', () => {
    // The shared store, single in-flight fetch and stable shells are not
    // touched by this change.
    expect(route).toContain('Promise.allSettled');
    expect(route).toContain("res.setHeader('Cache-Control', 'no-store')");
  });
});
