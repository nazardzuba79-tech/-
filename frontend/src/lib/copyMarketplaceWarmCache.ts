import { validStrategy, type CopyMarketplaceResponse } from './copyMarketplaceStore';

const CACHE_PREFIX = 'voltex_copy_marketplace_v2:';
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

function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validIdentities(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value.every((item, index) => item === null || (record(item)
    && item.traderId === ['VX-001', 'VX-KSENIA'][index]
    && typeof item.displayName === 'string'
    && typeof item.verified === 'boolean'
    && typeof item.premium === 'boolean'
    && (item.avatarUrl === null || (typeof item.avatarUrl === 'string' && item.avatarUrl.length <= 300_000))
    && (item.avatarVersion === null || typeof item.avatarVersion === 'string')));
}

function sanitize(payload: unknown): CopyMarketplaceResponse | null {
  if (!record(payload) || typeof payload.generatedAt !== 'string' || !Number.isFinite(Date.parse(payload.generatedAt))) return null;
  const nazar = validStrategy(payload.nazar, 'VX-001') ? payload.nazar : null;
  const ksenia = validStrategy(payload.ksenia, 'VX-KSENIA') ? payload.ksenia : null;
  const identities = validIdentities(payload.identities) ? payload.identities : null;
  if (!nazar && !ksenia && !identities) return null;
  return { nazar, ksenia, identities, generatedAt: payload.generatedAt, errors: {} };
}

export function readCopyMarketplaceWarmCache(token: string | null): CopyMarketplaceResponse | null {
  if (!token || typeof localStorage === 'undefined') return null;
  try {
    const storageKey = key(token);
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; payload?: unknown };
    if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt)
      || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(storageKey);
      return null;
    }
    const payload = sanitize(parsed.payload);
    if (!payload) localStorage.removeItem(storageKey);
    return payload;
  } catch {
    return null;
  }
}

export function writeCopyMarketplaceWarmCache(token: string | null, payload: unknown): void {
  if (!token || typeof localStorage === 'undefined') return;
  try {
    const incoming = sanitize(payload);
    if (!incoming) return;
    const previous = readCopyMarketplaceWarmCache(token);
    const merged: CopyMarketplaceResponse = {
      nazar: incoming.nazar ?? previous?.nazar ?? null,
      ksenia: incoming.ksenia ?? previous?.ksenia ?? null,
      identities: incoming.identities ?? previous?.identities ?? null,
      generatedAt: incoming.generatedAt,
      errors: {},
    };
    localStorage.setItem(key(token), JSON.stringify({ savedAt: Date.now(), payload: merged }));
  } catch {
    // Warm cache is optional; storage pressure/privacy modes must never break
    // the live marketplace request.
  }
}
