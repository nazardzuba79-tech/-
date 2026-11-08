/**
 * «Обменники» (/exchangers, Issue #694): the page's two public reads.
 *
 * Plain `fetch`, not `api.ts`'s request(): these reads need no session,
 * so no Authorization header and no cookies are ever sent (a stale stored
 * token can therefore never turn into a 401 that signs the visitor out),
 * and api.ts stays untouched (its source is pinned). One AbortController per
 * request is owned by the caller; nothing here polls or retries on its own.
 *
 * Every body is validated in pages/exchangers/model.ts before the page sees
 * it. A network failure or a body that does not match the contract is
 * reported as `{ kind: 'error' }`; an abort is re-thrown so the caller can
 * ignore it.
 */
import { API_BASE } from './api';
import {
  validateDirectoryBody,
  validateOffersBody,
  type DirectoryResult,
  type OffersResult,
} from '../pages/exchangers/model';
import type { OffersQuery } from '../../../src/shared/exchangers/types';

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

async function readJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  // Every contract answer (200, 400, 429, 503) carries a JSON status body.
  return response.json();
}

export async function fetchExchangersDirectory(signal: AbortSignal): Promise<DirectoryResult> {
  try {
    return validateDirectoryBody(await readJson('/exchangers/directory', signal));
  } catch (error) {
    if (isAbort(error) || signal.aborted) throw error;
    return { kind: 'error' };
  }
}

export function offersPath(query: OffersQuery): string {
  const params = new URLSearchParams({
    method: query.method,
    asset: query.asset,
    network: query.network,
    amount: String(query.amount),
  });
  return `/exchangers/offers?${params.toString()}`;
}

export async function fetchExchangerOffers(query: OffersQuery, signal: AbortSignal): Promise<OffersResult> {
  try {
    return validateOffersBody(await readJson(offersPath(query), signal), query);
  } catch (error) {
    if (isAbort(error) || signal.aborted) throw error;
    return { kind: 'error' };
  }
}
