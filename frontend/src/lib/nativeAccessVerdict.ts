import type { PrivateTradingError } from './privateTradingError';

/**
 * Which engine the signed-in account is bound to, as decided by the
 * `/private-trading/access` probe (see pages/private-trading/useNativeDemo).
 *
 *   'unknown'  — no verdict yet (or an outage): fail-closed, no engine writes
 *   'owner'    — the simulation engine; never released to real-money routes
 *   'ordinary' — the real Futures engine
 */
export type NativeBinding = 'unknown' | 'owner' | 'ordinary';

/**
 * The server's explicit refusal of the optional engine. The private-trading
 * router answers every account that is neither the owner nor an approved
 * test account with exactly this status and code, so it is a VERDICT about
 * the account, not a transport failure.
 */
export function isOrdinaryAccountDenial(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { status, code } = error as Partial<Pick<PrivateTradingError, 'status' | 'code'>>;
  return status === 403 && code === 'private_access_denied';
}

/**
 * The binding after a FAILED access probe.
 *
 * 2026-10-13 audit: the probe's catch used to treat the explicit denial like
 * an outage and leave the binding 'unknown'. `useNativeFuturesExecution`
 * then kept a non-ready native execution, the real account store never
 * polled, and an ordinary account's Futures ticket showed «Доступно —» with
 * both actions disabled — on every environment where the account is not the
 * owner. The denial releases the real engine here; everything else (network,
 * 5xx, a 403 with another code) stays an outage and keeps the current
 * binding, and an owner is never released by a later refusal.
 */
export function bindingAfterAccessFailure(error: unknown, current: NativeBinding): NativeBinding {
  if (current === 'owner') return 'owner';
  return isOrdinaryAccountDenial(error) ? 'ordinary' : current;
}
