import type { SyntheticCopyTradingResponse } from './syntheticCopyTrading';

/** The strategies whose executions the owner withholds from every visitor. */
export const PRIVATE_STRATEGY_IDS = ['VX-001', 'VX-KSENIA'] as const;

/**
 * Is this strategy's trade history withheld?
 *
 * Deliberately a function of the STRATEGY alone. It takes no viewer, no
 * subscription, no deposit and no favourite, because none of those changes
 * the answer: the server sends no executions to anybody, so there is no
 * state in which a trade row could be rendered. A UI that asked "is the
 * viewer allowed?" would be describing a rule that does not exist.
 */
export function tradeHistoryIsHidden(traderId: string): boolean {
  return (PRIVATE_STRATEGY_IDS as readonly string[]).includes(traderId);
}

/**
 * The one sentence the «Сделки» tab shows instead of a table.
 *
 * It says the information is hidden and stops there — no «доступно
 * подписчикам», because a subscriber does not see it either, and no
 * mention of policy, provenance or server behaviour, because none of that
 * is the visitor's business.
 */
export const HIDDEN_TRADE_HISTORY_MESSAGE = 'Торговая информация этого трейдера скрыта';

/** Defense at the display boundary for a validated pre-privacy response or
 * warm cache. Server redaction remains mandatory; this cannot retract data
 * already delivered by an older release. Aggregates and provenance stay intact.
 * Call ONLY after validStrategy succeeds, never to excuse malformed input. */
export function privateStrategyView<T extends SyntheticCopyTradingResponse>(value: T): T {
  if (!tradeHistoryIsHidden(value.trader.id)) return value;
  const periods = ['7D', '30D', '90D', 'ALL'] as const;
  const output = { ...value, trades: [], tradeVisibility: {
    mode: 'HIDDEN' as const,
    reason: 'OWNER_RESTRICTED' as const,
    holdingTimeUnknownPeriods: periods.filter(period =>
      value.tradeStats?.[period]?.holdingTimeTotalMinutes === undefined),
  } };
  delete (output as T & { reportedPerformance?: unknown }).reportedPerformance;
  return output;
}
