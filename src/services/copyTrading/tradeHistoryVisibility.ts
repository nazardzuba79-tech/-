import { PERIODS, type Period } from './marketplaceSummary';

/**
 * WITHHOLDING A STRATEGY'S TRADES FROM VISITORS.
 *
 * The owner does not want the marketplace handing out a strategy's
 * executions. That is a rule about what leaves the server, not about what
 * the browser paints: a `display:none` over a table the response still
 * carries is not hiding anything, because the payload is one devtools tab
 * — or one `curl` — away.
 *
 * So the rows are removed HERE, at the last step before the response is
 * written, and the browser is never sent them. There is nothing to reveal
 * because there is nothing there.
 *
 * WHAT STAYS. Everything that is an AGGREGATE rather than an execution:
 * ROI per period, PnL, win rate, the trade COUNTS, gross profit and loss,
 * the equity curve, the daily series, followers' economics, main markets.
 * Those are still computed from the COMPLETE history on the server — see
 * marketplaceSummary.ts — so hiding the history does not turn a strategy
 * with 465 trades into one with none. "Hidden" is not "zero".
 *
 * WHY IT RUNS LAST. `withKseniaReportedTrade` merges an owner-reported row
 * into the display window and folds its result into the aggregates. If the
 * redaction ran first, that overlay would put a trade row straight back
 * into a response we had just cleaned. Order is the guarantee: fold in,
 * then redact, then send.
 *
 * WHAT THIS IS NOT. It is not authentication and it makes no claim about
 * who may see what. There is no "available to subscribers" here, because
 * there is no server rule that would make that true — every visitor gets
 * the same redacted response. A client-side «Копирую» or «Избранное» flag
 * cannot unlock it either: those never reach this code.
 */

/** The only visibility this module can produce; `VISIBLE` is the absence of it. */
export const TRADE_HISTORY_HIDDEN = 'HIDDEN' as const;

export interface TradeVisibility {
  mode: typeof TRADE_HISTORY_HIDDEN;
  /** Why, in the server's own closed vocabulary. Not a message to display. */
  reason: 'OWNER_RESTRICTED';
  /**
   * Periods whose holding-time aggregate is genuinely unknown.
   *
   * Names periods and nothing else — no market, side, size, price or date —
   * so it discloses no execution. It exists because an owner-reported trade
   * can be counted in a period without its duration ever having been
   * supplied, and the UI must show a dash there rather than read an unknown
   * duration as zero. Without it, the client could not tell "withheld" from
   * "malformed" and would drop the whole strategy.
   */
  holdingTimeUnknownPeriods: Period[];
}

/** Strategies whose executions are withheld from the public marketplace. */
const RESTRICTED = new Set(['VX-001', 'VX-KSENIA']);

export function tradeHistoryIsHidden(traderId: string): boolean {
  return RESTRICTED.has(traderId);
}

/**
 * Remove every execution from a marketplace section, leaving its statistics
 * untouched.
 *
 * Deliberately total: it drops the display rows AND the owner-reported
 * trade's own detail block, because a single reported execution is still an
 * execution. What survives of that trade is its contribution to the
 * aggregates, which is the part the owner does want published.
 */
export function redactTradeHistory<T>(input: T): T {
  const source = input as any;
  const traderId = source?.trader?.id;
  if (!source || typeof traderId !== 'string' || !tradeHistoryIsHidden(traderId)) return input;

  // Which periods lost their holding-time aggregate upstream. Read BEFORE
  // anything is removed, so the declaration describes the real payload.
  const holdingTimeUnknownPeriods = source.tradeStats
    ? PERIODS.filter(period => {
      const stats = source.tradeStats[period];
      return !!stats && !Number.isFinite(stats.holdingTimeTotalMinutes);
    })
    : [];

  const visibility: TradeVisibility = {
    mode: TRADE_HISTORY_HIDDEN,
    reason: 'OWNER_RESTRICTED',
    holdingTimeUnknownPeriods,
  };

  // A shallow copy is enough and is what keeps this cheap: every key we
  // replace we replace wholesale, and nothing nested is mutated.
  const output = { ...source, trades: [], tradeVisibility: visibility };
  delete output.reportedPerformance;
  return output as T;
}
