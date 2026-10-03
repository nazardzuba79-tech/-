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

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
function configShape(value: unknown): boolean {
  if (!object(value) || value.schemaVersion !== 1 || !instant(value.listingAt)
    || !['symbol', 'name', 'initialPrice', 'displayTimeZone', 'ownerAllocation', 'seed'].every(key => typeof value[key] === 'string')
    || !['auto', 'manual'].includes(String(value.seedMode)) || typeof value.tradable !== 'boolean'
    || !(value.logo === null || typeof value.logo === 'string')) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: String(value.displayTimeZone) }); return true; }
  catch { return false; }
}

async function call<T>(path: string, init: { method?: string; body?: unknown; ifMatch?: number; signal?: AbortSignal } = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new ListingApiError('Сессия администратора недоступна', 401, null);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET', cache: 'no-store', signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
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
  // A 2xx without a recognizable receipt is an UNKNOWN outcome, not success.
  // Keep the caller's form/confirmation (and the same publish key) for recovery.
  let valid = object(body);
  if (valid && path.endsWith('/publish')) {
    valid = typeof body!.id === 'string' && path === `/admin/listings/${encodeURIComponent(body!.id)}/publish`
      && revision(body!.version) && typeof body!.replayed === 'boolean' && instant(body!.publishedAt);
  } else if (valid && (init.method === 'POST' || init.method === 'PUT')) {
    valid = typeof body!.id === 'string' && revision(body!.draftRevision) && configShape(body!.draft)
      && (init.method === 'POST' || path === `/admin/listings/${encodeURIComponent(body!.id)}/draft`);
  } else if (valid && path === '/admin/listings') {
    valid = Array.isArray(body!.listings) && body!.listings.every(item => object(item) && typeof item.id === 'string'
      && revision(item.draftRevision) && configShape(item.draft)
      && (item.activeVersion === null ? item.active === null : revision(item.activeVersion) && configShape(item.active))
      && Array.isArray(item.versions) && item.versions.every(version => object(version) && revision(version.version)
        && instant(version.publishedAt) && typeof version.publishedBy === 'string'));
  } else if (valid && path.includes('/preview?')) {
    valid = typeof body!.listingId === 'string' && revision(body!.draftRevision) && object(body!.asset)
      && object(body!.asset.state) && Array.isArray(body!.candles) && object(body!.book) && Array.isArray(body!.trades);
  }
  if (!valid) throw new ListingApiError('Нет подтверждения от сервера. Проверьте результат операции.', 0, 'UNKNOWN_RESPONSE');
  return body as T;
}

export const adminListingsApi = {
  list: (signal?: AbortSignal) => call<{ revision: string; serverTime: number; listings: AdminListing[] }>('/admin/listings', { signal }),
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
