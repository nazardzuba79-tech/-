import type { SyntheticCopyTradingResponse } from './syntheticCopyTrading';

/** Defense at the display boundary for a validated pre-privacy response or
 * warm cache. Server redaction remains mandatory; this cannot retract data
 * already delivered by an older release. Aggregates and provenance stay intact.
 * Call ONLY after validStrategy succeeds, never to excuse malformed input. */
export function privateStrategyView<T extends SyntheticCopyTradingResponse>(value: T): T {
  if (!['VX-001', 'VX-KSENIA'].includes(value.trader.id)) return value;
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
