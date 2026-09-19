import { useSyncExternalStore } from 'react';
import { clearToken, getToken, onSessionChange } from './api';
import { CopyMarketplaceStore, MarketplaceFailure, type CopyMarketplaceResponse } from './copyMarketplaceStore';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

async function fetchCopyMarketplace(signal: AbortSignal): Promise<CopyMarketplaceResponse> {
  const token = getToken();
  // Say WHICH failure this is, rather than leaving the store to guess from a
  // message. See SectionDiagnosis in copyMarketplaceStore.ts.
  if (!token) throw new MarketplaceFailure('unauthenticated');
  const res = await fetch(`${API_BASE}/copy-trading/marketplace`, {
    signal,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // This request belongs to the captured session, not a later login.
    if (!signal.aborted && getToken() === token) {
      clearToken();
      if (typeof window !== 'undefined') window.location.href = '/';
    }
    throw new MarketplaceFailure('unauthenticated');
  }
  // The status code stays out of the diagnosis: it is the server's to log,
  // and a label is all the client needs to tell the cases apart.
  if (!res.ok) throw new MarketplaceFailure('http_error');
  return res.json();
}

export const copyMarketplaceStore = new CopyMarketplaceStore(fetchCopyMarketplace, getToken);
// Logout clears the session's snapshot the moment the token goes, not the
// next time the marketplace happens to be opened.
onSessionChange(copyMarketplaceStore.syncSession);
export const prefetchCopyMarketplace = () => { void copyMarketplaceStore.prefetch(); };
export function useCopyMarketplace() {
  return useSyncExternalStore(copyMarketplaceStore.subscribe, copyMarketplaceStore.getState, copyMarketplaceStore.getState);
}
