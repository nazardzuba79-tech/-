// Which terminal a returning trader is sent to when they haven't asked for
// a specific one.
//
// Only three places in the app pick a trading destination without the user
// naming a market: an authenticated visit to "/", the same to "/login", and
// the redirect after signing in or registering. Everything else — /trade,
// /futures, /trade?pair=SOL/USDT, a link out of Markets — names its own
// destination and is never rewritten by this. Direct links always win.
//
// Futures is the default for anyone with no stored preference, and after
// that the last terminal actually used wins. Landing on either terminal is
// what records it (see the rememberTradingMode call in TradePage and
// FuturesPage), so the preference follows what the trader does rather than
// needing a settings toggle.

const KEY = 'voltex_trading_mode';

export type TradingMode = 'spot' | 'futures';

/** The stored preference, or null when this browser has never had one. */
export function getTradingMode(): TradingMode | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'spot' || raw === 'futures' ? raw : null;
  } catch {
    // Private mode, blocked storage: fall back to the default below.
    return null;
  }
}

export function rememberTradingMode(mode: TradingMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Best-effort — the preference just won't survive this session.
  }
}

/** Where to send someone who hasn't named a market. */
export function defaultTradingPath(): string {
  return getTradingMode() === 'spot' ? '/trade' : '/futures';
}
