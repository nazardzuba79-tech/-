import type { SyntheticCopyResponse } from './canonical/types';

/**
 * Separating CALCULATION data from DISPLAY data.
 *
 * A strategy accumulates a trade per few hours and never discards one, so a
 * year of history is a few thousand rows. Measured against a fixture built
 * to the real engine config, `trades[]` was 98% of the marketplace payload —
 * 1.72 MB of the 1.76 MB — and the marketplace does not render a single one
 * of those rows.
 *
 * Every statistic still comes from the COMPLETE history. This module reads
 * all of it, computes the trade-derived aggregates per period exactly as the
 * client used to compute them itself, and then sends the client the numbers
 * plus the ten most recent trades to show in the history table.
 *
 * So the user still reads "2,920 trades" above a table of the latest ten.
 * The count is the real count. Nothing is recomputed from ten rows, nothing
 * is estimated, and nothing is invented to fill a table.
 */

/** How many trade rows the browser needs. Display only — never an input to
 *  any statistic. */
export const VISIBLE_TRADES = 10;

export type Period = '7D' | '30D' | '90D' | 'ALL';
export const PERIODS: Period[] = ['7D', '30D', '90D', 'ALL'];
const PERIOD_DAYS: Record<Period, number> = { '7D': 7, '30D': 30, '90D': 90, ALL: Number.POSITIVE_INFINITY };

/**
 * The trade-derived aggregates, per period.
 *
 * Exactly the fields the client used to derive from the full array, and no
 * others: everything else it computes comes from equity, daily results or
 * the server's own economics block and is unaffected by this change.
 *
 * `null` is not used here — each of these is a real count or a real mean
 * over a real set. A period with no trades yields 0 trades, 0 wins and 0
 * losses, which is a fact, not a placeholder.
 */
export interface PeriodTradeStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  grossProfit: number;
  grossLoss: number;
  netPnlTotal: number;
  holdingTimeTotalMinutes: number;
}

export type TradeStats = Record<Period, PeriodTradeStats>;

type Trade = SyntheticCopyResponse['trades'][number];

/**
 * The period cutoff, mirroring the client's convention exactly: the last
 * equity date is "today", and a trade belongs to the window when its close
 * date is strictly after the boundary.
 */
function cutoffFor(data: SyntheticCopyResponse, period: Period): string {
  if (period === 'ALL') return '';
  const currentDate = data.equityHistory[data.equityHistory.length - 1]?.date
    ?? data.simulation.simulatedAt.slice(0, 10);
  return new Date(Date.parse(`${currentDate}T00:00:00Z`) - PERIOD_DAYS[period] * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function statsFor(trades: Trade[]): PeriodTradeStats {
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  return {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    grossProfit: wins.reduce((sum, trade) => sum + trade.netPnl, 0),
    grossLoss: Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0)),
    netPnlTotal: trades.reduce((sum, trade) => sum + trade.netPnl, 0),
    holdingTimeTotalMinutes: trades.reduce((sum, trade) => sum + trade.holdingTimeMinutes, 0),
  };
}

/** Aggregates over the FULL history, per period. */
export function computeTradeStats(data: SyntheticCopyResponse): TradeStats {
  const out = {} as TradeStats;
  for (const period of PERIODS) {
    const cutoff = cutoffFor(data, period);
    out[period] = statsFor(
      period === 'ALL' ? data.trades : data.trades.filter((trade) => trade.closedAt.slice(0, 10) > cutoff)
    );
  }
  return out;
}

/** The most recent trades, newest first. Fewer than `VISIBLE_TRADES` when
 *  fewer exist — never padded, because a fabricated trade is a lie about a
 *  trade that did not happen. */
export function latestTrades(data: SyntheticCopyResponse, limit = VISIBLE_TRADES): Trade[] {
  return [...data.trades].sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt)).slice(0, limit);
}

export type StrategySummary = Omit<SyntheticCopyResponse, 'trades'> & {
  /** Display rows only, newest first, at most `VISIBLE_TRADES`. */
  trades: Trade[];
  /** Aggregates over the complete history, per period. */
  tradeStats: TradeStats;
  /** How many trades the summary was computed from, so the client can state
   *  the real total next to a ten-row table. */
  tradeHistoryCount: number;
};

/**
 * The wire shape for a strategy.
 *
 * Everything the detail UI needs, minus the thousands of rows it never
 * shows. The full history stays server-side and is what every number here
 * was computed from.
 */
export function summarizeStrategy<T extends SyntheticCopyResponse>(data: T): T | (StrategySummary & Omit<T, 'trades'>) {
  // Nothing to summarize is not an error, and it is certainly not a reason
  // to fail the request: a payload without a trade history or without the
  // equity series the period windows are cut from is passed through
  // untouched. It then reaches the client's validator in exactly the shape
  // it arrived in, which is what decides whether it is usable — this
  // transform must never be the thing that turns an odd payload into a 503,
  // and must never invent a `tradeStats` block for data it never read.
  if (!Array.isArray(data?.trades) || !Array.isArray(data?.equityHistory)) return data;
  return {
    ...data,
    trades: latestTrades(data),
    tradeStats: computeTradeStats(data),
    tradeHistoryCount: data.trades.length,
  };
}
