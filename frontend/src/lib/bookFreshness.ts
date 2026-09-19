/**
 * One set of freshness rules for every order book on the exchange.
 *
 * THE RULE THAT MATTERS. The stale threshold must be LONGER than the
 * refresh interval — by enough to survive a missed cycle, not by one
 * second. If they are close, an ordinary gap between two refreshes reads as
 * "out of date" and the terminal accuses itself of being broken on a
 * perfectly healthy feed. That false alarm is worse than no indicator at
 * all, because a trader who learns to ignore it will also ignore the real
 * one.
 *
 * So: a book refreshes every `BOOK_REFRESH_MS`, and is only called stale
 * after `BOOK_STALE_AFTER_MS` — three missed cycles — and only called
 * unavailable after `BOOK_UNAVAILABLE_AFTER_MS`.
 *
 * WHAT THESE ARE NOT. None of this governs execution. The visible book is a
 * display mirror of a public venue; an order is matched on the exchange's
 * own server-side book, read fresh at the moment the order is handled. A
 * slow display cadence can never slow, stale or misprice a trade — see
 * `__tests__/orderBookExecutionIndependence.test.ts`, which pins that.
 */

/** How often a book re-reads when its live stream has gone quiet. */
export const BOOK_REFRESH_MS = 30_000;

/** Three missed refreshes. Below this, a gap is ordinary operation. */
export const BOOK_STALE_AFTER_MS = 90_000;

/** The feed has stopped, rather than slowed. */
export const BOOK_UNAVAILABLE_AFTER_MS = 300_000;

/**
 * How long a reconnect may take before it is worth telling anyone.
 *
 * A tab that has been in the background has its timers throttled and its
 * socket often closed outright by the browser, so coming back ALWAYS starts
 * with a handshake. Announcing that as a lost connection is a false alarm
 * on the most ordinary action a person takes. This is longer than one
 * refresh cycle, so a reconnect that completes within normal operation is
 * silent — and a connection that is still down afterwards is real, and is
 * still reported.
 */
export const RECONNECT_GRACE_MS = 35_000;

/** Whether a book last updated at `asOf` is still worth presenting as live. */
export function bookFreshness(asOf: number | null, now = Date.now()): 'live' | 'stale' | 'unavailable' {
  if (asOf === null) return 'unavailable';
  const age = now - asOf;
  if (age >= BOOK_UNAVAILABLE_AFTER_MS) return 'unavailable';
  if (age >= BOOK_STALE_AFTER_MS) return 'stale';
  return 'live';
}
