import type { Asset } from './types';
import { isExactStocksProviderIdentity } from '../../../lib/stocksIdentity';

export type CatalogueTab = 'all' | 'US' | 'RU' | 'Asia' | 'index' | 'favorites';
export type CatalogueFilters = { tab: CatalogueTab; query: string; provider: string; currency: string; descending: boolean };
export const STOCKS_FAVORITES_KEY = 'voltex.stocks.global.favorites';

export function readCatalogueFavorites(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(STOCKS_FAVORITES_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

export function filterCatalogue(assets: Asset[], filters: CatalogueFilters, favorites: string[], locale: string) {
  const query = filters.query.trim().toLocaleLowerCase(locale);
  return assets.filter(asset => (filters.tab === 'all' ||
    (filters.tab === 'favorites' ? favorites.includes(asset.id) :
      filters.tab === 'index' ? asset.kind === 'index' : asset.region === filters.tab)) &&
    (filters.provider === 'all' || asset.provider === filters.provider) &&
    (filters.currency === 'all' || asset.currency === filters.currency) &&
    `${asset.name} ${asset.ticker} ${asset.asset} ${asset.provider} ${asset.sourceSymbol}`.toLocaleLowerCase(locale).includes(query))
    .sort((a, b) => (a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id)) * (filters.descending ? -1 : 1));
}

/** Display only: a last quote is never turned into OHLC or an execution price. */
export function catalogueObservation(asset: Asset, now: number) {
  const display = asset.display;
  if (asset.provider === 'moex' || !display || !Number.isFinite(Number(display.price)) || Number(display.price) <= 0 ||
      !Number.isFinite(display.timestamp) || display.timestamp <= 0 || display.timestamp > now) return null;
  return { price: display.price, change: Number.isFinite(display.change24h) ? display.change24h : null,
    timestamp: display.timestamp, ageSeconds: Math.floor((now - display.timestamp) / 1000) };
}

export function isAssetCatalogue(value: unknown): value is { catalogue: Asset[] } {
  if (!value || typeof value !== 'object' || !('catalogue' in value) || !Array.isArray(value.catalogue)) return false;
  const assets = value.catalogue;
  return assets.length <= 250 && assets.every(asset => asset &&
    ['id', 'ticker', 'asset', 'name', 'provider', 'sourceSymbol', 'region', 'kind', 'currency'].every(key => typeof asset[key] === 'string') &&
    Array.isArray(asset.timeframes) && asset.timeframes.every((value: unknown) => typeof value === 'string') &&
    isExactStocksProviderIdentity(asset)) &&
    new Set(assets.map(asset => asset.id)).size === assets.length;
}
