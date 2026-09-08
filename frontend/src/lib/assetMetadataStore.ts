import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Batched asset display metadata — the thing that lets a 500-row market
 * table render real logos and names without 500 requests.
 *
 * How it works, and why it is a store rather than a hook per component:
 *
 *   - Components declare which symbols they are about to render. Symbols
 *     already known are answered from memory with no network at all.
 *   - Unknown symbols are collected across every component that asked in
 *     the same tick and flushed as ONE `/market/assets/icons?symbols=…`
 *     request. Ten table sections mounting together produce one request,
 *     not ten.
 *   - A symbol the catalogue does not cover is remembered as "asked and
 *     not found", so it is never re-requested on every scroll. That miss
 *     is not an error: the icon pipeline falls through to its next tier.
 *
 * This holds display metadata only — a name and a logo URL. It is not an
 * identity source for anything that matters financially, and nothing here
 * decides whether an asset is tradable; that comes from the catalogue's
 * `tradable` flag, which is derived from the venue's real pair list.
 */

export interface AssetMeta {
  /** Canonical, namespaced id (`cg:bitcoin`). Not a ticker. */
  id: string;
  name: string;
  logoUrl: string | null;
}

/** Batch window. One animation frame's worth of mounting components lands
 *  in the same flush; long enough to coalesce a page render, short enough
 *  that icons do not visibly lag in. */
const BATCH_WINDOW_MS = 50;
/** The endpoint caps at 500 symbols; stay under it per request. */
const MAX_PER_REQUEST = 400;

type Listener = () => void;

class AssetMetadataStore {
  private known = new Map<string, AssetMeta>();
  /** Symbols we asked about and the catalogue did not have. Remembered so
   *  a miss costs one request ever, not one per render. */
  private missing = new Set<string>();
  private pending = new Set<string>();
  private listeners = new Set<Listener>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = 0;

  get(symbol: string): AssetMeta | null {
    return this.known.get(symbol.toUpperCase()) ?? null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Declare the symbols about to be rendered. Cheap and idempotent: only
   * genuinely unknown symbols are queued, and the queue is flushed once
   * per batch window.
   */
  request(symbols: string[]): void {
    let queued = false;
    for (const raw of symbols) {
      const symbol = raw.toUpperCase();
      if (!symbol || this.known.has(symbol) || this.missing.has(symbol) || this.pending.has(symbol)) continue;
      this.pending.add(symbol);
      queued = true;
    }
    if (queued) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, BATCH_WINDOW_MS);
  }

  private async flush(): Promise<void> {
    const batch = Array.from(this.pending).slice(0, MAX_PER_REQUEST);
    if (batch.length === 0) return;
    for (const symbol of batch) this.pending.delete(symbol);
    this.inFlight += 1;
    try {
      const { assets } = await api.getAssetIcons(batch);
      for (const symbol of batch) {
        const meta = assets[symbol];
        if (meta) this.known.set(symbol, meta);
        // Absent from the response means the catalogue does not cover it.
        // Recorded so it is not asked for again; the caller's own
        // deterministic fallback renders it perfectly well.
        else this.missing.add(symbol);
      }
      this.emit();
    } catch {
      // A metadata failure must never break a price row. The symbols go
      // back to unknown so a later render can retry, and every affected
      // icon simply uses its fallback in the meantime.
    } finally {
      this.inFlight -= 1;
      // Anything queued while this batch was in flight.
      if (this.pending.size > 0) this.scheduleFlush();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Test seam. */
  _resetForTests(): void {
    this.known.clear();
    this.missing.clear();
    this.pending.clear();
    this.listeners.clear();
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.inFlight = 0;
  }

  get _knownCount(): number {
    return this.known.size;
  }
}

export const assetMetadataStore = new AssetMetadataStore();

/**
 * Resolve display metadata for a list of symbols, batched.
 *
 * Returns a plain lookup object. A symbol with no catalogue entry is
 * simply absent — callers fall through to the icon pipeline's later
 * tiers rather than showing a gap.
 */
export function useAssetMetadata(symbols: string[]): Record<string, AssetMeta> {
  // Join, not the array: a new array identity every render must not
  // re-trigger the effect.
  const key = symbols.join(',');
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const unsubscribe = assetMetadataStore.subscribe(() => forceUpdate((n) => n + 1));
    assetMetadataStore.request(key ? key.split(',') : []);
    return unsubscribe;
  }, [key]);

  const out: Record<string, AssetMeta> = {};
  for (const symbol of key ? key.split(',') : []) {
    const meta = assetMetadataStore.get(symbol);
    if (meta) out[symbol.toUpperCase()] = meta;
  }
  return out;
}
