import { publishedKseniaSeedBytes } from './publishedPerformanceSeedBytes';
import type { CashflowReviewState } from './canonical/reviewEconomicsTypes';

let approvedRecords: Map<string, string> | undefined;
function approvedRecord(id: string): string | undefined {
  if (!approvedRecords) {
    const state = JSON.parse(publishedKseniaSeedBytes().toString('utf8')) as CashflowReviewState;
    approvedRecords = new Map(state.cashflow.copiedTrades.map(record => [record.id, JSON.stringify(record)]));
  }
  return approvedRecords.get(id);
}

/** Storage compatibility, NOT a financial tolerance or rewrite permission.
 * The old review JSONB transport changed 9,269 copied quantity IEEE-754 tails;
 * replay differs by at most 4.782 machine epsilons relatively. Eight epsilons
 * bound the round-trip plus division/multiplication rounding with headroom.
 * Absolute tolerance is exactly 8*EPSILON*max(|old|,|replayed|), with no unit
 * floor, decimal rounding or general money epsilon. All monetary/price/time/ID
 * fields must remain EXACT. Only a byte-identical approved exported record may
 * be retained; future records and modified historical records remain strict.
 * The caller returns the EXISTING record, never the re-computed quantity. */
export function retainPublishedQuantityTail<T extends { id: string }>(existing: T, replayed: T): boolean {
  if (!existing.id.startsWith('KS-COHORT-') || !existing.id.includes(':copy:KS-REV-')) return false;
  const previous = existing as T & { quantity?: unknown };
  const next = replayed as T & { quantity?: unknown };
  const a = previous.quantity, b = next.quantity;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a)
      || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) return false;
  const keys = Object.keys(existing);
  if (keys.length !== Object.keys(replayed).length
      || keys.some(key => key !== 'quantity' && existing[key as keyof T] !== replayed[key as keyof T])) return false;
  if (Math.abs(a - b) > Number.EPSILON * 8 * Math.max(Math.abs(a), Math.abs(b))) return false;
  return approvedRecord(existing.id) === JSON.stringify(existing);
}
