import { browserFetch as fetch } from '../../lib/browserActivity';
import { API_BASE, getToken } from '../../lib/api';

/** Admin → Listings calls (Render, ADMIN only; Render forwards to the Cloudflare store). */

export interface ListingConfig {
  schemaVersion: 1;
  symbol: string;
  name: string;
  logo: string | null;
  initialPrice: string;
  listingAt: string;
  displayTimeZone: string;
  ownerAllocation: string;
  seedMode: 'auto' | 'manual';
  seed: string;
  tradable: boolean;
  /** Candle character, assigned by the store at creation (by creation order) and never changed. Absent on older listings. */
  simulationProfile?: 'CALM_TREND' | 'IMPULSE_TREND' | 'PULLBACK_TREND' | 'COMPRESSION_BREAKOUT';
}

/** What the form sends. The server fills schemaVersion and an automatic seed; the store assigns the profile. */
export type ListingForm = Omit<ListingConfig, 'schemaVersion' | 'seed' | 'simulationProfile'> & { seed?: string };

export interface AdminListing {
  id: string;
  symbol: string;
  draft: ListingConfig;
  draftRevision: number;
  draftUpdatedAt: string;
  draftUpdatedBy: string;
  activeVersion: number | null;
  active: ListingConfig | null;
  versions: { version: number; publishedAt: string; publishedBy: string }[];
}

export interface ListingPreview {
  listingId: string;
  draftRevision: number;
  previewAt: number;
  serverTime: number;
  asset: { pair: string; name: string; listingAt: string; initialPrice: number; logo: string | null; displayTimeZone: string;
    state: { phase: 'pre-listing' | 'live'; lastPrice: number | null; change24hPercent: number | null; high24h: number | null; low24h: number | null; quoteVolume24h: number | null } };
  candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
  book: { available: boolean; bids: { price: string; quantity: string }[]; asks: { price: string; quantity: string }[] };
  trades: { id: string; price: string; quantity: string; side: 'BUY' | 'SELL'; time: number }[];
}

export class ListingApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null, readonly draftRevision: number | null = null) { super(message); }
}

async function call<T>(path: string, init: { method?: string; body?: unknown; ifMatch?: number } = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new ListingApiError('Сессия администратора недоступна', 401, null);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET', cache: 'no-store', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.ifMatch !== undefined ? { 'If-Match': String(init.ifMatch) } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new ListingApiError('Нет связи с сервером. Повторите попытку.', 0, 'NETWORK');
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof body?.error === 'string' ? body.error : null;
    const message = typeof body?.message === 'string' ? body.message : `Ошибка запроса (${response.status})`;
    throw new ListingApiError(message, response.status, code, typeof body?.draftRevision === 'number' ? body.draftRevision : null);
  }
  return body as T;
}

export const adminListingsApi = {
  list: () => call<{ revision: string; serverTime: number; listings: AdminListing[] }>('/admin/listings'),
  create: (config: ListingForm) => call<{ id: string; draftRevision: number; draft: ListingConfig }>('/admin/listings', { method: 'POST', body: { config } }),
  saveDraft: (id: string, config: ListingForm, draftRevision: number) =>
    call<{ id: string; draftRevision: number; draft: ListingConfig }>(`/admin/listings/${encodeURIComponent(id)}/draft`, { method: 'PUT', body: { config }, ifMatch: draftRevision }),
  preview: (id: string, at: string | null, interval = '5m') =>
    call<ListingPreview>(`/admin/listings/${encodeURIComponent(id)}/preview?${new URLSearchParams({ interval, ...(at ? { at } : {}) })}`),
  publish: (id: string, draftRevision: number, publishKey: string) =>
    call<{ id: string; version: number; replayed: boolean; publishedAt: string }>(`/admin/listings/${encodeURIComponent(id)}/publish`, { method: 'POST', body: { draftRevision, publishKey } }),
};

/** One key per opened publish confirmation: a double click or a retry after a lost answer is the same publish. */
export function newPublishKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export { LISTING_TIME_ZONES, utcOffsetLabel, utcToZonedWallTime, zonedWallTimeToUtc, zoneOffsetMs } from './adminListingsTime';
