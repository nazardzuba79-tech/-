/**
 * «Статус системы»: one light check per service, made only when the page is
 * opened — never on a timer. Each check proves exactly one thing: whether
 * that endpoint answered. The API `/health` is a liveness answer; it does
 * not prove that trading, deposits, withdrawals or sign-in succeed, so the
 * page reports the API and the market-data Worker, not those operations.
 *
 * While an answer is on its way nothing is shown (owner, 2026-10-01): a
 * sleeping free-plan server can take a while to wake, and a «waiting» line
 * would only alarm. No timeout either — the answer is shown when it comes.
 */

/** `ok`: answered 200. `error`: answered, but not 200. `unreachable`: the
 * browser got no answer — that can be the visitor's network, a blocker or
 * CORS, so it is never presented as a confirmed outage. */
export type ProbeResult = 'ok' | 'error' | 'unreachable';

export const PROBES = ['api', 'market'] as const;
export type ProbeId = (typeof PROBES)[number];

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
    return response.status === 200 ? 'ok' : 'error';
  } catch (error) {
    if (signal.aborted) throw error;
    return 'unreachable';
  }
}
