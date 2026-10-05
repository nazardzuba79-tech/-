/**
 * «Спот / Фьючерсы» — where each half of the switch goes.
 *
 * Each half opens its own route and its own engine; nothing is carried over
 * but the instrument NAME, and only when the other market is known to list
 * it. A Spot-only coin must not become an invented perpetual, and a
 * perpetual-only contract must not become an invented Spot pair, so an
 * unknown name travels as `?from=` instead of `?pair=`: the target page
 * keeps what it was showing, checks its own catalogue, and either selects
 * the pair or opens its picker with a note. No price, size or side travels.
 */
export const FUTURES_CORE_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'] as const;
const PAIR = /^[A-Z0-9._-]{1,24}\/[A-Z0-9._-]{1,12}$/;

export type TerminalMarket = 'spot' | 'futures';

/** `listed` is the catalogue the page already holds, or null when it holds none. */
export function futuresSwitchHref(pair: string, listed: readonly string[] | null): string {
  if (!PAIR.test(pair)) return '/futures';
  const known = listed ?? FUTURES_CORE_PAIRS;
  return known.includes(pair) ? `/futures?pair=${encodeURIComponent(pair)}` : `/futures?from=${encodeURIComponent(pair)}`;
}

/**
 * Spot lists most USDT contracts, so with no snapshot in memory the pair is
 * passed and the Spot terminal resolves it exactly as it resolves any deep
 * link. With a snapshot that lacks it, it travels as `?from=`.
 */
export function spotSwitchHref(pair: string, listed: ReadonlySet<string> | null): string {
  if (!PAIR.test(pair)) return '/trade';
  return !listed || listed.has(pair) ? `/trade?pair=${encodeURIComponent(pair)}` : `/trade?from=${encodeURIComponent(pair)}`;
}

/** A `?from=` value is user input: only a well-formed pair is ever considered. */
export function switchedFrom(value: string | null): string | null {
  return value && PAIR.test(value) ? value : null;
}

/**
 * What the target page does with `?from=X` once it can tell.
 * 'wait' — its catalogue has not answered yet; 'select' — it lists X;
 * 'choose' — it answered and does not list X: open the picker and say so.
 */
export function resolveSwitchedPair(from: string, listed: { has(pair: string): boolean } | null, settled: boolean): 'wait' | 'select' | 'choose' {
  if (listed?.has(from)) return 'select';
  return settled ? 'choose' : 'wait';
}
