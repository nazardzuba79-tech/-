import { useSyncExternalStore } from 'react';
import { api, getToken } from './api';
import { CopyMarketplaceStore } from './copyMarketplaceStore';

export const copyMarketplaceStore = new CopyMarketplaceStore(signal => api.getCopyMarketplace(signal), getToken);
export const prefetchCopyMarketplace = () => { void copyMarketplaceStore.prefetch(); };
export function useCopyMarketplace() {
  return useSyncExternalStore(copyMarketplaceStore.subscribe, copyMarketplaceStore.getState, copyMarketplaceStore.getState);
}
