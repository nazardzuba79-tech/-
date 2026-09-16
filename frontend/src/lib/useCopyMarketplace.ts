import { useSyncExternalStore } from 'react';
import { clearToken, getToken } from './api';
import { CopyMarketplaceStore, type CopyMarketplaceResponse } from './copyMarketplaceStore';
import { readCopyMarketplaceWarmCache, writeCopyMarketplaceWarmCache } from './copyMarketplaceWarmCache';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';
let warmToken: string | null | undefined;
let warmSnapshot: CopyMarketplaceResponse | null = null;

function cachedSnapshot(token: string | null): CopyMarketplaceResponse | null {
  if (token !== warmToken) {
    warmToken = token;
    warmSnapshot = readCopyMarketplaceWarmCache(token);
  }
  return warmSnapshot;
}

async function fetchCopyMarketplace(signal: AbortSignal): Promise<CopyMarketplaceResponse> {
  const token = getToken();
  if (!token) throw new Error('Unauthenticated');
  const res = await fetch(`${API_BASE}/copy-trading/marketplace`, {
    signal,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') window.location.href = '/';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const payload = await res.json() as CopyMarketplaceResponse;
  // Preserve the last successfully validated live summary so Nazar and Ksenia
  // paint with the rest of the marketplace on a reload. The normal request
  // still runs immediately and replaces this warm first paint; no extra API
  // request or polling is introduced.
  writeCopyMarketplaceWarmCache(token, payload);
  warmToken = token;
  warmSnapshot = readCopyMarketplaceWarmCache(token);
  return payload;
}

export const copyMarketplaceStore = new CopyMarketplaceStore(fetchCopyMarketplace, getToken);
export const prefetchCopyMarketplace = () => { void copyMarketplaceStore.prefetch(); };
export function useCopyMarketplace() {
  const state = useSyncExternalStore(copyMarketplaceStore.subscribe, copyMarketplaceStore.getState, copyMarketplaceStore.getState);
  const cached = cachedSnapshot(getToken());
  if (!cached) return state;

  // The other marketplace cards are local catalogue rows and therefore paint
  // immediately. Nazar/Ksenia are live server-backed strategies; use only a
  // last-good validated snapshot until the already-existing live request wins.
  const cachedIdentities = (cached.identities?.filter(Boolean) ?? []) as typeof state.identities;
  return {
    ...state,
    nazar: state.nazar ?? cached.nazar,
    ksenia: state.ksenia ?? cached.ksenia,
    identities: state.identities.length ? state.identities : cachedIdentities,
  };
}
