import type { CopyMarketplaceState } from './copyMarketplaceStore';

/**
 * THE LAST CONFIRMED MARKETPLACE SNAPSHOT, SO A RELOAD IS NOT A BLANK PAGE.
 *
 * The store already keeps a per-section last-good value in memory and already
 * refuses to clear one section because another failed. What it could not do
 * was survive a reload, so every hard refresh and every return to the page
 * started from nothing and painted skeletons over data the browser had
 * already been told was true.
 *
 * Three rules make this safe to show:
 *
 *  1. ONLY REAL, ALREADY-VALIDATED DATA IS WRITTEN. The caller persists a
 *     section only after it has passed the same network-boundary validator
 *     the live response passes. Nothing is synthesised, defaulted or filled.
 *  2. IT IS READ BACK THROUGH THAT SAME VALIDATOR. A snapshot written by an
 *     older build, hand-edited, or truncated by a full disk is rejected
 *     rather than trusted because it is ours.
 *  3. IT IS PARTITIONED BY SESSION. The key carries a digest of the session
 *     token, so a snapshot taken under one login can never be read under
 *     another. The token itself is never written.
 *
 * What is restored is presented as what it is: real figures this browser
 * previously received, with the live request already in flight behind them.
 */

const VERSION = 'v1';
const PREFIX = 'voltex.copy.marketplace';

/**
 * Partition key, not a secret.
 *
 * FNV-1a over the session token. This exists to keep one login's snapshot
 * away from another's, so what it needs is to differ whenever the token
 * differs — not to resist inversion. The token is never stored; only this
 * digest is, and it is written beside a token the app already keeps in the
 * same storage, so it adds no exposure that was not there.
 */
export function sessionFingerprint(session: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < session.length; index++) {
    hash ^= session.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function cacheKey(session: string): string {
  return `${PREFIX}.${VERSION}.${sessionFingerprint(session)}`;
}

/** What is worth keeping between visits: the confirmed sections and when
 *  each was confirmed. Never `refreshing`/`settled`, which describe a
 *  request that is over. */
export interface CachedSnapshot {
  nazar: unknown;
  ksenia: unknown;
  identities: unknown;
  fetchedAt: CopyMarketplaceState['fetchedAt'];
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The browser's store, or null wherever there isn't one (SSR, tests, a
 *  locked-down profile). Every caller treats null as "no cache", never as
 *  an error. */
export function defaultStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Storage access throws outright under some privacy settings.
    return null;
  }
}

export function readSnapshot(session: string, storage: Storage | null = defaultStorage()): CachedSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(cacheKey(session));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const fetchedAt = (parsed as any).fetchedAt;
    if (!fetchedAt || typeof fetchedAt !== 'object') return null;
    // Section payloads are NOT trusted here — the caller re-validates each
    // one through the live validator before any of it reaches the screen.
    return {
      nazar: (parsed as any).nazar ?? null,
      ksenia: (parsed as any).ksenia ?? null,
      identities: (parsed as any).identities ?? null,
      fetchedAt: {
        nazar: numberOrNull(fetchedAt.nazar),
        ksenia: numberOrNull(fetchedAt.ksenia),
        identities: numberOrNull(fetchedAt.identities),
      },
    };
  } catch {
    // Unparseable is the same as absent: show nothing rather than guess.
    return null;
  }
}

export function writeSnapshot(session: string, snapshot: CachedSnapshot,
  storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(cacheKey(session), JSON.stringify(snapshot));
  } catch {
    // A full or disabled quota must never break the page it was meant to
    // speed up. The live request is already on its way regardless.
  }
}

export function clearSnapshot(session: string, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try { storage.removeItem(cacheKey(session)); } catch { /* see writeSnapshot */ }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
