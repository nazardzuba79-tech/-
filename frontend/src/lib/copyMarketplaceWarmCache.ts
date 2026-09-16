import type { CopyMarketplaceResponse } from './copyMarketplaceStore';

const CACHE_PREFIX = 'voltex_copy_marketplace_v1:';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function fingerprint(value: string): string {
  // Cache partition only, never an auth/security primitive. Keep the bearer
  // token itself out of storage keys while ensuring another login cannot
  // reuse a previous session's marketplace snapshot.
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function key(token: string): string {
  return `${CACHE_PREFIX}${fingerprint(token)}`;
}

export function readCopyMarketplaceWarmCache(token: string | null): CopyMarketplaceResponse | null {
  if (!token || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; payload?: unknown };
    if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)
      || Date.now() - parsed.savedAt > MAX_AGE_MS || !parsed.payload || typeof parsed.payload !== 'object') {
      localStorage.removeItem(key(token));
      return null;
    }
    return parsed.payload as CopyMarketplaceResponse;
  } catch {
    return null;
  }
}

export function writeCopyMarketplaceWarmCache(token: string | null, payload: CopyMarketplaceResponse): void {
  if (!token || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key(token), JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {
    // Warm cache is optional; storage pressure/privacy modes must never break
    // the live marketplace request.
  }
}
