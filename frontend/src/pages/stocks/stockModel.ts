/**
 * Stocks presentation model shared by the dark panel and the light overview:
 * filtering, sorting, favourites, the last opened instrument and the chart
 * periods the loaded history can actually show. No requests, no React.
 */
import type { StockCandle, StockInstrument } from '../../lib/stocks';

export type StockTab = 'all' | 'USA' | 'Russia' | 'Asia' | 'index' | 'favorites';
export const STOCK_TABS: readonly StockTab[] = ['all', 'USA', 'Russia', 'Asia', 'index', 'favorites'];
export const ASIA_MARKETS = ['Japan', 'Hong Kong', 'China', 'South Korea', 'India'] as const;

export interface StockFilters {
  tab: StockTab;
  query: string;
  asia: string;
  exchange: string;
  currency: string;
}
export const EMPTY_FILTERS: StockFilters = { tab: 'all', query: '', asia: 'all', exchange: 'all', currency: 'all' };

/** 'catalogue' keeps the catalogue's own order (largest issuers first). */
export type SortKey = 'catalogue' | 'name' | 'change';
export interface StockSort { key: SortKey; dir: 'asc' | 'desc' }

const isTab = (value: string | null): value is StockTab => STOCK_TABS.includes(value as StockTab);

/** Overview filters live in the URL so Back/Forward and reload keep them. */
export function filtersFromParams(params: URLSearchParams): StockFilters {
  const tab = params.get('tab');
  return {
    tab: isTab(tab) ? tab : 'all',
    query: (params.get('q') ?? '').slice(0, 64),
    asia: params.get('asia') ?? 'all',
    exchange: params.get('ex') ?? 'all',
    currency: params.get('cur') ?? 'all',
  };
}

export function filtersToParams(filters: StockFilters): URLSearchParams {
  const params = new URLSearchParams({ view: 'overview' });
  if (filters.tab !== 'all') params.set('tab', filters.tab);
  if (filters.query) params.set('q', filters.query);
  if (filters.tab === 'Asia' && filters.asia !== 'all') params.set('asia', filters.asia);
  if (filters.exchange !== 'all') params.set('ex', filters.exchange);
  if (filters.currency !== 'all') params.set('cur', filters.currency);
  return params;
}

export function hasActiveFilters(filters: StockFilters): boolean {
  return filters.query !== '' || filters.asia !== 'all' || filters.exchange !== 'all' || filters.currency !== 'all';
}

function inTab(item: StockInstrument, tab: StockTab, favorites: ReadonlySet<string>): boolean {
  if (tab === 'all') return true;
  if (tab === 'favorites') return favorites.has(item.instrumentId);
  if (tab === 'index') return item.type === 'index';
  return item.region === tab;
}

/** Instruments of a tab before the search and the select filters. */
export function tabInstruments(items: readonly StockInstrument[], filters: Pick<StockFilters, 'tab' | 'asia'>, favorites: ReadonlySet<string>): StockInstrument[] {
  return items.filter(item => inTab(item, filters.tab, favorites)
    && (filters.tab !== 'Asia' || filters.asia === 'all' || item.country === filters.asia));
}

export function filterInstruments(items: readonly StockInstrument[], filters: StockFilters, favorites: ReadonlySet<string>): StockInstrument[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return tabInstruments(items, filters, favorites).filter(item =>
    (!query || `${item.symbol} ${item.name} ${item.exchange}`.toLocaleLowerCase().includes(query))
    && (filters.exchange === 'all' || item.exchange === filters.exchange)
    && (filters.currency === 'all' || item.currency === filters.currency));
}

/** Instruments without a value sort last whichever the direction. */
export function sortInstruments(items: readonly StockInstrument[], sort: StockSort, locale: string): StockInstrument[] {
  if (sort.key === 'catalogue') return [...items];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sort.key === 'change') {
      const av = a.sessionChange, bv = b.sessionChange;
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      return (av - bv) * sign;
    }
    return a.name.localeCompare(b.name, locale) * sign;
  });
}

const FAVORITES_KEY = 'voltex.stockFavorites';
const LAST_KEY = 'voltex.stockLastInstrument';
const OVERVIEW_KEY = 'voltex.stockOverviewQuery';
const PANEL_FILTER_KEY = 'voltex.stockPanelFilter';
const ID = /^[A-Z0-9]{4}:[A-Za-z0-9._-]{1,24}$/;

export function readFavorites(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && ID.test(id)).slice(0, 250) : [];
  } catch {
    return [];
  }
}

export function writeFavorites(ids: readonly string[]): void {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids.slice(0, 250))); } catch { /* storage unavailable */ }
}

export function readLastInstrument(): string | null {
  try {
    const id = localStorage.getItem(LAST_KEY);
    return id && ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function writeLastInstrument(id: string): void {
  try { if (ID.test(id)) localStorage.setItem(LAST_KEY, id); } catch { /* storage unavailable */ }
}

/** The overview's last query string, so the panel can return to it. */
export function readOverviewQuery(): string {
  try {
    const saved = sessionStorage.getItem(OVERVIEW_KEY);
    return saved && saved.startsWith('view=overview') ? saved : 'view=overview';
  } catch {
    return 'view=overview';
  }
}

export function writeOverviewQuery(query: string): void {
  try { sessionStorage.setItem(OVERVIEW_KEY, query); } catch { /* storage unavailable */ }
}

export function readPanelFilter(): Pick<StockFilters, 'tab' | 'query'> {
  try {
    const value = JSON.parse(sessionStorage.getItem(PANEL_FILTER_KEY) ?? 'null');
    if (value && isTab(value.tab) && typeof value.query === 'string') return { tab: value.tab, query: value.query.slice(0, 64) };
  } catch { /* fall through */ }
  return { tab: 'all', query: '' };
}

export function writePanelFilter(filter: Pick<StockFilters, 'tab' | 'query'>): void {
  try { sessionStorage.setItem(PANEL_FILTER_KEY, JSON.stringify(filter)); } catch { /* storage unavailable */ }
}

/** Close time of the newest candle in the catalogue: the data's own time, not the browser's. */
export function newestClose(items: readonly StockInstrument[]): number | null {
  let newest: number | null = null;
  for (const item of items) if (item.latest && (newest === null || item.latest.closeTimeUtc > newest)) newest = item.latest.closeTimeUtc;
  return newest;
}

export type ChartPeriod = '1D' | '5D' | '1M' | 'all';

export interface PeriodRange { from: number; to: number }

/** Exchange-local calendar day of a candle, e.g. "2026-10-07". */
function sessionDay(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

/**
 * Periods the loaded candles fully cover, with the time range each shows.
 * 1D and 5D are the last one and five exchange-local trading days present;
 * 1M only when the first loaded candle is at least a calendar month before
 * the last close, so a 300-candle page is never presented as a month.
 */
export function chartPeriods(candles: readonly StockCandle[], timeZone: string): Map<ChartPeriod, PeriodRange> {
  const periods = new Map<ChartPeriod, PeriodRange>();
  if (!candles.length) return periods;
  const first = candles[0].openTimeUtc, last = candles[candles.length - 1];
  periods.set('all', { from: first, to: last.closeTimeUtc });
  const dayStarts: number[] = [];
  let previous = '';
  for (const candle of candles) {
    const day = sessionDay(candle.openTimeUtc, timeZone);
    if (day !== previous) { dayStarts.push(candle.openTimeUtc); previous = day; }
  }
  if (dayStarts.length > 1) periods.set('1D', { from: dayStarts[dayStarts.length - 1], to: last.closeTimeUtc });
  if (dayStarts.length > 5) periods.set('5D', { from: dayStarts[dayStarts.length - 5], to: last.closeTimeUtc });
  const monthAgo = new Date(last.closeTimeUtc);
  monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
  if (first <= monthAgo.getTime()) periods.set('1M', { from: monthAgo.getTime(), to: last.closeTimeUtc });
  return periods;
}
