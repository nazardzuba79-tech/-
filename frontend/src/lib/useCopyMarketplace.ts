import { useSyncExternalStore } from 'react';
import { clearToken, getToken } from './api';
import { CopyMarketplaceStore, type CopyMarketplaceResponse } from './copyMarketplaceStore';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

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
  return res.json();
}

export const copyMarketplaceStore = new CopyMarketplaceStore(fetchCopyMarketplace, getToken);
export const prefetchCopyMarketplace = () => { void copyMarketplaceStore.prefetch(); };
export function useCopyMarketplace() {
  return useSyncExternalStore(copyMarketplaceStore.subscribe, copyMarketplaceStore.getState, copyMarketplaceStore.getState);
}
