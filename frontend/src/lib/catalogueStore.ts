import { useEffect, useState } from 'react';
import { api } from './api';
import type { AssetCatalogueResponse, CanonicalAsset } from './api';

/**
 * The crypto catalogue, loaded ONCE per tab.
 *
 * The shape of the problem: 500+ assets, a search box, six sortable
 * columns, a tradable filter and pagination. The naive build issues a
 * request per keystroke and another per sort click. This does the
 * opposite — one request pulls the whole catalogue, and every subsequent
 * interaction is a pure function over data already in memory.
 *
 *   - ONE request per tab, shared by every subscriber and refcounted.
 *   - Search, sort, filter and paging cost ZERO further requests.
 *   - No per-row anything: not a request, not a timer, not a subscription.
 *
 * That is affordable because the catalogue is slow-moving by nature — the
 * backend caches the market half for 20 minutes and the identity/category
 * half for 6 hours — so a long client refresh interval loses nothing. Live
 * tick-by-tick prices are a different dataset with a different store
 * (`lib/marketDataStore`, 3-5s); they are not mixed, because they are not
 * the same kind of data. See §14 of docs/MARKET_DATA_ARCHITECTURE.md.
 *
 * Nothing here converts a failure into a number. A failed refresh keeps
 * the last good catalogue on screen and flags the status; an asset with no
 * reported market cap keeps `null`, which the table renders as a dash.
 */

/** Matches the backend ceiling, so the whole catalogue arrives at once. */
const FULL_PAGE_LIMIT = 1000;
/**
 * 10 minutes. The server's market half is cached 20 minutes, so polling
 * faster cannot return fresher data — this exists to pick up a refresh
 * reasonably soon after one becomes available, not to stream anything.
 */
const REFRESH_INTERVAL_MS = 10 * 60_000;

export interface CatalogueMeta {
  source: string;
  fetchedAt: number;
  stale: boolean;
}

export interface CatalogueState {
  status: 'loading' | 'ready' | 'error' | 'unavailable';
  assets: CanonicalAsset[];
  /** Total catalogue size as the server reports it. */
  catalogueTotal: number;
  tradableCount: number;
  /** Tickers claimed by more than one catalogue entry. */
  collisions: string[];
  /** False when the catalogue was built from the venue's pair list alone
   *  because the metadata provider was unavailable. */
  metadataComplete: boolean;
  meta: CatalogueMeta | null;
  /** Why the catalogue is unavailable, when it is. */
  reason: string | null;
  loaded: boolean;
}

const EMPTY: CatalogueState = {
  status: 'loading',
  assets: [],
  catalogueTotal: 0,
  tradableCount: 0,
  collisions: [],
  metadataComplete: true,
  meta: null,
  reason: null,
  loaded: false,
};

type Listener = (state: CatalogueState) => void;

class CatalogueStore {
  private state: CatalogueState = EMPTY;
  private listeners = new Map<symbol, Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  getState(): CatalogueState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    const key = Symbol('catalogue-subscriber');
    this.listeners.set(key, listener);

    // A late subscriber renders from memory, with no request.
    if (this.state.loaded) listener(this.state);

    if (this.timer === null) this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    if (!this.state.loaded) void this.refresh();

    return () => {
      this.listeners.delete(key);
      // Reference-counted: navigating away from Markets stops the timer.
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** Fetch once, shared. Concurrent callers join the in-flight promise. */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = api
      // No search/sort/filter: the WHOLE catalogue, once. Every subsequent
      // interaction is client-side, which is what makes the search instant
      // and costs the backend nothing per keystroke.
      .getAssetCatalogue({ limit: FULL_PAGE_LIMIT })
      .then((response) => this.apply(response))
      .catch(() => {
        // Keep the last known good catalogue on screen; never blank it.
        this.emit({ ...this.state, status: 'error', loaded: true });
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private apply(response: AssetCatalogueResponse): void {
    if (!response.available) {
      // Unavailable is unavailable — not an empty catalogue, which would
      // read as "this exchange lists nothing".
      this.emit({
        ...this.state,
        status: 'unavailable',
        reason: response.reason,
        loaded: true,
      });
      return;
    }
    this.emit({
      status: 'ready',
      assets: response.value.assets,
      catalogueTotal: response.value.catalogueTotal,
      tradableCount: response.value.tradableCount,
      collisions: response.value.collisions,
      metadataComplete: response.value.metadataComplete,
      meta: { source: response.source, fetchedAt: response.fetchedAt, stale: response.stale },
      reason: null,
      loaded: true,
    });
  }

  private emit(state: CatalogueState): void {
    this.state = state;
    for (const listener of this.listeners.values()) listener(state);
  }

  private stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test seams. */
  _resetForTests(): void {
    this.stop();
    this.listeners.clear();
    this.state = EMPTY;
    this.inFlight = null;
  }
  get _timerCount(): number {
    return this.timer === null ? 0 : 1;
  }
  get _subscriberCount(): number {
    return this.listeners.size;
  }
}

export const catalogueStore = new CatalogueStore();

export function useCatalogue(): CatalogueState & { refresh: () => void } {
  const [state, setState] = useState<CatalogueState>(() => catalogueStore.getState());
  useEffect(() => catalogueStore.subscribe(setState), []);
  return { ...state, refresh: () => void catalogueStore.refresh() };
}

// ── Client-side query, over data already loaded ──────────────────────
//
// Deliberately mirrors the server's `AssetRegistry.query` semantics so the
// two cannot drift: same search fields, same sort keys, and the same
// nulls-last rule. Running it here is what makes typing in the search box
// instant and free.

export type CatalogueSortKey = 'rank' | 'marketCap' | 'volume24h' | 'price' | 'change24h' | 'symbol' | 'name';

export interface CatalogueFilter {
  search?: string;
  tradableOnly?: boolean;
  /** The VOLTEX PAIRS the user has starred — the same shared set the spot
   *  and futures pair lists write, keyed "BTC/USDT". Applied only when
   *  `favoritesOnly`. */
  favorites?: Set<string>;
  favoritesOnly?: boolean;
  sort?: CatalogueSortKey;
  direction?: 'asc' | 'desc';
}

/** Nulls sort last in BOTH directions. Treating a missing market cap as 0
 *  would float unpriced assets to the top of an ascending sort — the same
 *  fake-zero mistake in a different costume. */
function nullsLast(a: number | null | undefined, b: number | null | undefined, direction: number): number {
  const av = a ?? null;
  const bv = b ?? null;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return (av - bv) * direction;
}

export function filterAndSortAssets(assets: CanonicalAsset[], filter: CatalogueFilter): CanonicalAsset[] {
  const needle = filter.search?.trim().toLowerCase() ?? '';
  const direction = filter.direction === 'asc' ? 1 : -1;
  const sort = filter.sort ?? 'rank';

  let out = assets;
  if (filter.tradableOnly) out = out.filter((a) => a.tradable);
  if (filter.favoritesOnly) {
    const favorites = filter.favorites ?? new Set<string>();
    // An asset is "favourited" when any of its real listed markets is
    // starred — so a pair starred in the spot terminal surfaces its asset
    // here, and a data-only asset (no markets) can never match, because
    // there is nothing about it to have starred.
    out = out.filter((a) => a.tradingPairs.some((pair) => favorites.has(pair)));
  }
  if (needle) {
    // Symbol AND name, so both "BTC" and "Bitcoin" find Bitcoin.
    out = out.filter(
      (a) => a.symbol.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle)
    );
  }

  return [...out].sort((a, b) => {
    switch (sort) {
      case 'marketCap':
        return nullsLast(a.market?.marketCapUsd, b.market?.marketCapUsd, direction) || a.symbol.localeCompare(b.symbol);
      case 'volume24h':
        return nullsLast(a.market?.volume24hUsd, b.market?.volume24hUsd, direction) || a.symbol.localeCompare(b.symbol);
      case 'price':
        return nullsLast(a.market?.priceUsd, b.market?.priceUsd, direction) || a.symbol.localeCompare(b.symbol);
      case 'change24h':
        return nullsLast(a.market?.changePercent24h, b.market?.changePercent24h, direction) || a.symbol.localeCompare(b.symbol);
      case 'symbol':
        return a.symbol.localeCompare(b.symbol) * direction;
      case 'name':
        return a.name.localeCompare(b.name) * direction;
      case 'rank':
      default:
        // Rank ascends naturally (1 is the biggest), so the default 'desc'
        // still has to mean "best first" — inverted here so the default
        // produces the ordering a market table expects.
        return nullsLast(a.rank, b.rank, -direction) || a.symbol.localeCompare(b.symbol);
    }
  });
}

/**
 * The VOLTEX pair a "Trade" action should open, or `null` when the asset
 * has no executable market.
 *
 * Mirrors `AssetRegistry.defaultTradingPair`: chosen from the asset's REAL
 * `tradingPairs` under a documented quote priority, never by appending
 * "/USDT" to a ticker — that would link to a market that may not exist.
 */
export const QUOTE_PRIORITY = ['USDT', 'USD', 'USDC', 'EUR', 'BTC', 'ETH'];

export function defaultTradingPair(asset: Pick<CanonicalAsset, 'tradingPairs'>): string | null {
  if (asset.tradingPairs.length === 0) return null;
  return [...asset.tradingPairs].sort((a, b) => {
    const qa = QUOTE_PRIORITY.indexOf(a.split('/')[1] ?? '');
    const qb = QUOTE_PRIORITY.indexOf(b.split('/')[1] ?? '');
    const ra = qa === -1 ? QUOTE_PRIORITY.length : qa;
    const rb = qb === -1 ? QUOTE_PRIORITY.length : qb;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  })[0];
}
