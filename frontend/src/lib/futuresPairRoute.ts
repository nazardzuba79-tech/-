// Which contract the futures terminal opens on.
//
// The terminal used to hold the selected contract in React state ONLY. A
// refresh threw that state away, `?pair=` was never written back to the
// URL, and the page restarted on the hard-coded default — so a trader
// watching AKE/USDT came back to BTC/USDT after F5, on a position they
// still had open.
//
// The URL is the answer, because the URL is what survives a refresh AND
// what a direct link carries. `?pair=` is now written on every contract
// change (replacing the history entry, so the back button still leaves the
// terminal rather than walking back through the contracts looked at), and
// read on mount. localStorage backs it up for the one case a URL cannot
// cover: arriving at a bare `/futures` from the header, where there is no
// pair in the address to restore.
//
// BTC/USDT is reached in exactly the three cases the owner named: a first
// ever visit, nothing stored or passed, and a stored pair the venue no
// longer lists.

const KEY = 'voltex:futures:last-pair:v1';

/** The contract the terminal falls back to when nothing else is known. */
export const DEFAULT_FUTURES_PAIR = 'BTC/USDT';

// Same shape the spot terminal accepts, and the same shape the symbol warm
// cache stores. A query string is user input: anything else is ignored
// rather than selected, so `?pair=<script>` can never become a symbol.
const PAIR_PATTERN = /^[A-Z0-9._-]{1,24}\/[A-Z0-9._-]{1,12}$/;

export function isFuturesPair(value: unknown): value is string {
  return typeof value === 'string' && PAIR_PATTERN.test(value);
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Private mode / blocked storage: the URL still carries the pair.
    return null;
  }
}

/** The last contract this browser actually traded, or null. */
export function readLastFuturesPair(storage: StorageLike | null = browserStorage()): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    return isFuturesPair(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeLastFuturesPair(pair: string, storage: StorageLike | null = browserStorage()): void {
  if (!storage || !isFuturesPair(pair)) return;
  try {
    storage.setItem(KEY, pair);
  } catch {
    // Best-effort only — losing it costs one default open, never a trade.
  }
}

/**
 * The contract to open on, in the owner's order of precedence:
 *   1. the pair in the address (a refresh, a deep link, a shared URL),
 *   2. the pair this browser last had selected,
 *   3. BTC/USDT.
 *
 * It is deliberately NOT checked against the listed universe here: the
 * catalogue has not loaded on the first render, and refusing a pair for
 * being absent from a list that is still empty is how a valid deep link
 * gets thrown away. `resolveListedFuturesPair` does that check later, once
 * a real catalogue exists.
 */
export function initialFuturesPair(
  requested: string | null | undefined,
  stored: string | null = readLastFuturesPair(),
): string {
  if (isFuturesPair(requested)) return requested;
  if (isFuturesPair(stored)) return stored;
  return DEFAULT_FUTURES_PAIR;
}

/**
 * The selected contract, reconciled against a catalogue that has actually
 * loaded. A pair the venue still lists is kept exactly as it is — including
 * one that arrived by deep link — and only a pair that is genuinely gone is
 * replaced, by BTC/USDT when it is listed and by the first listed contract
 * when it is not.
 *
 * An empty catalogue returns the current pair untouched: "nothing listed"
 * is a catalogue that has not answered, not a delisting.
 */
export function resolveListedFuturesPair(current: string, listed: readonly string[]): string {
  if (!listed.length || listed.includes(current)) return current;
  return listed.includes(DEFAULT_FUTURES_PAIR) ? DEFAULT_FUTURES_PAIR : listed[0];
}
