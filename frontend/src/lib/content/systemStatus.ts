/**
 * «Статус системы»: one light check per service, made only when the page is
 * opened — never on a timer. The API answer covers trading, deposits,
 * withdrawals and sign-in; the public market Worker covers market data.
 *
 * While an answer is on its way nothing is shown (owner, 2026-10-01): a
 * sleeping free-plan server can take a while to wake, and a «waiting» line
 * would only alarm. No timeout either — the answer is shown when it comes.
 */

export type ProbeResult = 'ok' | 'problem';

export const API_COMPONENTS = ['trading', 'deposits', 'withdrawals', 'auth'];
export const MARKET_COMPONENTS = ['market-data'];

/** `/health` at the root of the API host: https://api.voltextech.net/health. */
export function apiHealthUrl(apiBase: string, origin: string): string {
  return new URL('/health', new URL(apiBase, origin)).toString();
}

export function edgeHealthUrl(edgeBase: string): string {
  return `${edgeBase.replace(/\/+$/, '')}/health`;
}

export async function probe(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<ProbeResult> {
  try {
    const response = await fetchImpl(url, { cache: 'no-store', credentials: 'omit', signal });
    return response.status === 200 ? 'ok' : 'problem';
  } catch (error) {
    if (signal.aborted) throw error;
    return 'problem';
  }
}
