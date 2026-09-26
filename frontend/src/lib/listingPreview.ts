import type { MarketTicker } from './api';

/**
 * VOLTORA LISTING PREVIEW — a frozen, display-only state.
 *
 * The owner wants to see how the upcoming VOLTORA (VTA/USDT) listing looks
 * on the exchange before anything about it is real. So everything here is a
 * constant: no clock is read, no timer runs, no request is made and no
 * server takes part. The countdown shows fixed digits that never move, a
 * reload shows exactly the same thing, and nothing can turn it into a live
 * or tradable market.
 *
 * Off for everyone by default. `?listingPreview=1` turns it on in this
 * browser (remembered across reloads); `?listingPreview=0` turns it off.
 */

export const LISTING_PREVIEW_PAIR = 'VTA/USDT';

export const LISTING_PREVIEW_ASSET = {
  pair: LISTING_PREVIEW_PAIR,
  symbol: 'VTA',
  name: 'VOLTORA',
  quote: 'USDT',
  listingText: '27 Sep 2026 · 16:00 UTC',
  initialPriceText: '0.010000 USDT',
} as const;

export const LISTING_PREVIEW_STATUS = 'TEST · NOT TRADABLE';
export const LISTING_PREVIEW_MESSAGE = 'VOLTORA is a test asset and is not available for trading.';

export type ListingPreviewStage = 'before' | 'soon';

/** Fixed displays, one per look the owner asked to see. Never computed. */
export const LISTING_PREVIEW_STAGES: Record<ListingPreviewStage, { label: string; badge: string; countdown: readonly [string, string, string, string] }> = {
  before: { label: 'Before listing', badge: 'Listing soon', countdown: ['01', '06', '12', '00'] },
  soon: { label: 'Listing in 20 s', badge: 'Listing in 20 s', countdown: ['00', '00', '00', '20'] },
};

const FLAG_KEY = 'voltex_listing_preview';
const STAGE_KEY = 'voltex_listing_preview_stage';

type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The URL decides when it says something; otherwise this browser's last choice. */
export function readListingPreviewFlag(search: string, storage: FlagStorage | null): boolean {
  const value = new URLSearchParams(search).get('listingPreview');
  try {
    if (value === '1' || value === 'on') { storage?.setItem(FLAG_KEY, '1'); return true; }
    if (value === '0' || value === 'off') { storage?.removeItem(FLAG_KEY); return false; }
    return storage?.getItem(FLAG_KEY) === '1';
  } catch {
    return value === '1' || value === 'on';
  }
}

function browserStorage(): FlagStorage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function isListingPreviewEnabled(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  return readListingPreviewFlag(window.location.search, browserStorage());
}

export function readListingPreviewStage(storage: FlagStorage | null = browserStorage()): ListingPreviewStage {
  try { return storage?.getItem(STAGE_KEY) === 'soon' ? 'soon' : 'before'; } catch { return 'before'; }
}

export function saveListingPreviewStage(stage: ListingPreviewStage, storage: FlagStorage | null = browserStorage()): void {
  try { storage?.setItem(STAGE_KEY, stage); } catch { /* the look still switches, it just is not remembered */ }
}

export function isListingPreviewPair(pair: string | null | undefined): boolean {
  return typeof pair === 'string' && pair.toUpperCase() === LISTING_PREVIEW_PAIR;
}

/**
 * The pair list's row: every figure empty, which the list already renders
 * as a dash and sorts last. Never a zero price or a flat change.
 */
export function listingPreviewTicker(): MarketTicker {
  return { pair: LISTING_PREVIEW_PAIR, lastPrice: '', bidPrice: '', askPrice: '', high24h: '', low24h: '', volume24h: '', quoteVolume24h: '', changePercent24h: '' };
}

/** Added only while the preview is on, and only next to a venue list that loaded. */
export function withListingPreviewTicker<T extends MarketTicker>(tickers: Map<string, T>, enabled: boolean): Map<string, T | MarketTicker> {
  if (!enabled || tickers.size === 0) return tickers;
  const merged = new Map<string, T | MarketTicker>(tickers);
  merged.set(LISTING_PREVIEW_PAIR, listingPreviewTicker());
  return merged;
}

export function withoutListingPreview<T extends { pair: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isListingPreviewPair(row.pair));
}

export function matchesListingPreviewSearch(query: string): boolean {
  const q = query.trim().toLowerCase().replace(/[\s/_-]/g, '');
  if (!q) return true;
  return ['vtausdt', 'vta', 'voltora'].some((field) => field.includes(q));
}
