import type { MarketTicker } from './api';

/**
 * TEST MARKETS — the pure half (no network, no React).
 *
 * A test asset (today only VOLTORA, VTA/USDT) is a simulated, read-only
 * market: it is listed in Markets, Search, Favorites and the terminal rail,
 * it opens the Spot terminal, and it can never trade. The server owns the
 * simulation and the clock (src/services/testMarkets); this file only
 * reads what it serves and formats it. The network half is
 * lib/testMarketStore.
 */

export const TEST_ASSET_NOT_TRADABLE_MESSAGE = 'VOLTORA is a test asset and is not available for trading.';
export const TEST_ASSET_STATUS_LABEL = 'TEST · NOT TRADABLE';

/** Known before the first response, so a deep link or a starred pair is
 *  recognised as a test market without waiting on the network. */
export const TEST_MARKET_PAIRS: readonly string[] = ['VTA/USDT'];

export interface TestMarketState {
  phase: 'pre-listing' | 'live';
  lastPrice: number | null;
  openPrice24h: number | null;
  change24hPercent: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  quoteVolume24h: number | null;
  serverTime: number;
}

export interface TestAsset {
  pair: string;
  symbol: string;
  name: string;
  quote: string;
  isTestAsset: true;
  isTradable: false;
  status: string;
  listingArmed: boolean;
  listingAt: string;
  initialPrice: number;
  state: TestMarketState;
}

export interface TestMarketsSnapshot {
  serverTime: number;
  assets: TestAsset[];
}

export function isTestMarketPair(pair: string | null | undefined): boolean {
  return typeof pair === 'string' && TEST_MARKET_PAIRS.includes(pair.toUpperCase());
}

const finiteOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Accepts only the shape the server serves; anything else is `null`, never a guess. */
export function parseTestMarkets(payload: unknown): TestMarketsSnapshot | null {
  const body = payload as { serverTime?: unknown; assets?: unknown } | null;
  if (!body || typeof body.serverTime !== 'number' || !Array.isArray(body.assets)) return null;
  const assets: TestAsset[] = [];
  for (const raw of body.assets as any[]) {
    if (!raw || typeof raw.pair !== 'string' || !isTestMarketPair(raw.pair) || raw.isTestAsset !== true || raw.isTradable !== false) continue;
    const listingAt = typeof raw.listingAt === 'string' ? Date.parse(raw.listingAt) : NaN;
    const state = raw.state ?? {};
    if (!Number.isFinite(listingAt) || (state.phase !== 'pre-listing' && state.phase !== 'live')) continue;
    assets.push({
      pair: raw.pair.toUpperCase(),
      symbol: String(raw.symbol ?? raw.pair.split('/')[0]),
      name: String(raw.name ?? raw.symbol),
      quote: String(raw.quote ?? raw.pair.split('/')[1]),
      isTestAsset: true,
      isTradable: false,
      status: typeof raw.status === 'string' ? raw.status : TEST_ASSET_STATUS_LABEL,
      listingArmed: typeof raw.listingArmed === 'boolean' ? raw.listingArmed : true,
      listingAt: raw.listingAt,
      initialPrice: finiteOrNull(raw.initialPrice) ?? 0,
      state: {
        phase: state.phase,
        lastPrice: finiteOrNull(state.lastPrice),
        openPrice24h: finiteOrNull(state.openPrice24h),
        change24hPercent: finiteOrNull(state.change24hPercent),
        high24h: finiteOrNull(state.high24h),
        low24h: finiteOrNull(state.low24h),
        volume24h: finiteOrNull(state.volume24h),
        quoteVolume24h: finiteOrNull(state.quoteVolume24h),
        serverTime: finiteOrNull(state.serverTime) ?? body.serverTime,
      },
    });
  }
  return { serverTime: body.serverTime, assets };
}

export type TestMarketTicker = MarketTicker & { isTestAsset: true };

/**
 * The asset as a row of the shared ticker map, so the terminal rail lists
 * it with no change of its own. Before the listing every figure is an
 * empty string, which the rail already renders as a dash and sorts last —
 * never a zero price or a flat change.
 */
export function testAssetTicker(asset: TestAsset): TestMarketTicker {
  const live = asset.state.phase === 'live' && asset.state.lastPrice !== null;
  const text = (value: number | null) => (live && value !== null ? String(value) : '');
  const last = text(asset.state.lastPrice);
  return {
    pair: asset.pair,
    lastPrice: last,
    bidPrice: last,
    askPrice: last,
    high24h: text(asset.state.high24h),
    low24h: text(asset.state.low24h),
    volume24h: text(asset.state.volume24h),
    quoteVolume24h: text(asset.state.quoteVolume24h),
    changePercent24h: text(asset.state.change24hPercent),
    isTestAsset: true,
  };
}

/**
 * The venue tickers plus the test rows. Only added once the venue snapshot
 * has rows: a feed that is down must still read as down, not as a list
 * holding one simulated market.
 */
export function withTestMarketTickers<T extends MarketTicker>(tickers: Map<string, T>, assets: readonly TestAsset[]): Map<string, T | TestMarketTicker> {
  if (tickers.size === 0 || assets.length === 0) return tickers;
  const merged = new Map<string, T | TestMarketTicker>(tickers);
  for (const asset of assets) merged.set(asset.pair, testAssetTicker(asset));
  return merged;
}

export function withoutTestMarkets<T extends { pair: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isTestMarketPair(row.pair));
}

export function matchesTestAssetSearch(asset: Pick<TestAsset, 'pair' | 'symbol' | 'name'>, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/[\s/_-]/g, '');
  if (!q) return true;
  return [asset.pair.replace('/', ''), asset.symbol, asset.name].some((field) => field.toLowerCase().includes(q));
}

// ── Formatting ──────────────────────────────────────────────────────────

/** "+55,134.60%": grouped, always signed, two decimals — a four- or
 *  five-digit move must stay readable in a 90px column. */
export function formatTestPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(2));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/** Six decimals below 1 USDT (0.010000), four up to 10, two above. */
export function formatTestPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return '—';
  const decimals = value >= 10 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Chart axis and crosshair: the same magnitude rule, no dash (the axis always has a value). */
export function formatTestAxisPrice(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  const decimals = abs >= 10 ? 2 : abs >= 1 ? 4 : 6;
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A signed price move, at the decimals of the price it moved from. Zero is "0.000000", never a dash. */
export function formatTestPriceChange(change: number | null, reference: number | null): string {
  if (change === null || reference === null || !Number.isFinite(change) || !Number.isFinite(reference) || reference <= 0) return '—';
  const decimals = reference >= 10 ? 2 : reference >= 1 ? 4 : 6;
  const rounded = Number(change.toFixed(decimals));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** Percent change of `price` against the listing price: the asset's whole run. */
export function sinceListingPercent(asset: Pick<TestAsset, 'initialPrice' | 'state'>): number | null {
  const last = asset.state.lastPrice;
  if (asset.state.phase !== 'live' || last === null || !(asset.initialPrice > 0)) return null;
  return (last / asset.initialPrice - 1) * 100;
}

/** 12,345,678 → "12.35M"; the volume column's compact form. */
export function formatTestCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const [div, suffix] = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
  return `${(value / div).toLocaleString('en-US', { minimumFractionDigits: suffix ? 2 : 0, maximumFractionDigits: 2 })}${suffix}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27 Sep 2026 · 16:00 UTC" — always UTC, whatever the viewer's zone. */
export function formatListingTime(listingAt: string | number): string {
  const date = new Date(listingAt);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} · ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

export interface CountdownParts { days: number; hours: number; minutes: number; seconds: number; done: boolean }

export function countdownParts(msLeft: number): CountdownParts {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
    done: msLeft <= 0,
  };
}

/**
 * Appends the dev-only preview clock. The caller decides whether preview is
 * allowed at all (a build flag); the server honours it only outside
 * production with its own explicit flag, so this can never move the real
 * market's clock.
 */
export const SIMULATION_PREVIEW_PARAM = 'simulationPreviewTime';

export function withSimulationPreview(url: string, previewTime: string | null): string {
  if (!previewTime) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${SIMULATION_PREVIEW_PARAM}=${encodeURIComponent(previewTime)}`;
}

export function testMarketSlug(pair: string): string {
  return pair.toUpperCase().replace('/', '-');
}
