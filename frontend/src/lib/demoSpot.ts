import { useEffect, useState } from 'react';
import { api, getToken, onSessionChange } from './api';
import { isManagedTradablePair, isTestMarketPair } from './testMarkets';

/**
 * Demo Spot (Issue #592): an account an admin credited with demo funds trades
 * the ordinary Spot terminal on the demo ledger (DemoBalance), which has no
 * path to a withdrawal.
 *
 * Two independent switches, both off by default: this build flag, and the
 * server's DEMO_SPOT_ENABLED. Without the build flag the terminal never asks
 * and never changes; with it, the server still decides who is admitted.
 */
export const DEMO_SPOT_BUILD = import.meta.env.VITE_DEMO_SPOT_ENABLED === 'true';

/**
 * The server decides (`ledger`, see demoSpotAccess on the API):
 * 'off'    — the ordinary Spot ledger, exactly as before (the flag is off).
 * 'spot'   — Demo Spot is on and the account holds ordinary Balance funds
 *            (e.g. an earlier admin Balance adjustment): the ordinary terminal
 *            and ledger, as before, plus a request ID on each order.
 * 'trader' — no ordinary funds, admitted to demo Spot: balances, orders and
 *            history come from the demo ledger.
 * 'silent' — neither (or the answer is not known yet): Buy/Sell stay
 *            clickable and send nothing — never a real order instead.
 */
export type DemoSpotMode = 'off' | 'trader' | 'spot' | 'silent';

/** The modes in which the terminal shows the demo ledger. */
export type DemoLedgerMode = Extract<DemoSpotMode, 'trader' | 'silent'>;

/** Test markets, managed listings and VTA keep their own paths unchanged. */
export function isDemoSpotPair(pair: string): boolean {
  return !isTestMarketPair(pair) && !isManagedTradablePair(pair) && pair.toUpperCase() !== 'VTA/USDT';
}

let cached: { token: string; mode: Promise<DemoSpotMode> } | null = null;

/** One question per session; a failure is not remembered and fails closed. */
function readMode(token: string): Promise<DemoSpotMode> {
  if (cached?.token === token) return cached.mode;
  const mode = api.getDemoSpotAccess()
    .then(access => (!access.enabled ? 'off' : access.ledger === 'spot' ? 'spot'
      : (access.ledger ?? (access.admitted ? 'demo' : 'none')) === 'demo' ? 'trader' : 'silent') as DemoSpotMode)
    .catch(() => { if (cached?.token === token) cached = null; return 'silent' as const; });
  cached = { token, mode };
  return mode;
}

export function useDemoSpotMode(): DemoSpotMode {
  const [session, setSession] = useState(() => getToken());
  const [answer, setAnswer] = useState<{ token: string; mode: DemoSpotMode } | null>(null);
  useEffect(() => onSessionChange(() => setSession(getToken())), []);
  useEffect(() => {
    if (!DEMO_SPOT_BUILD || !session) return;
    let current = true;
    void readMode(session).then(mode => { if (current && getToken() === session) setAnswer({ token: session, mode }); });
    return () => { current = false; };
  }, [session]);
  if (!DEMO_SPOT_BUILD || !session) return 'off';
  return answer?.token === session ? answer.mode : 'silent';
}
