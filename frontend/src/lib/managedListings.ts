import type { TestAsset } from './testMarkets';
import { isManagedPair, rememberManaged } from './managedListingRegistry';
export { isManagedPair, managedLogo, managedName } from './managedListingRegistry';

export const MANAGED_LISTINGS_BASE = String(import.meta.env.VITE_MANAGED_LISTINGS_URL || '').replace(/\/$/,'');
export function registerManagedAssets(body: unknown): {serverTime:number;assets:TestAsset[]} {
  const data = body as {serverTime:number;assets:TestAsset[]};
  if (!data || !Number.isFinite(data.serverTime) || !Array.isArray(data.assets) || data.assets.length > 50) throw new Error('invalid_listings');
  for (const raw of data.assets) {
    if (!raw.isManagedListing || raw.isTradable !== false || !/^[A-Z][A-Z0-9]{1,11}\/USDT$/.test(raw.pair)
      || ['VTA/USDT','NRX/USDT'].includes(raw.pair) || raw.symbol !== raw.pair.split('/')[0]
      || typeof raw.name !== 'string' || !raw.logo?.startsWith('data:image/') || !Number.isFinite(Date.parse(raw.listingAt))) throw new Error('invalid_listing');
  }
  for (const raw of data.assets) rememberManaged(raw.pair,raw.logo!,raw.name);
  return data;
}
export async function fetchManagedPublic<T>(path: string, signal?:AbortSignal): Promise<T> {
  if (!MANAGED_LISTINGS_BASE) throw new Error('listings_unavailable');
  const url = new URL(path,'https://path.invalid');
  const pathname = url.pathname.replace(/^\/api\/v1(?=\/)/,'');
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(`${MANAGED_LISTINGS_BASE}${pathname}${url.search}`,{signal:signal?AbortSignal.any([signal,timeout]):timeout,credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}});
  if (!response.ok) throw new Error('listings_unavailable');
  const body = await response.json();
  if (pathname === '/market/managed-listings') registerManagedAssets(body);
  return body;
}
let bootstrap:Promise<void> | undefined;
export function ensureManagedDirectory():Promise<void> {
  if (!MANAGED_LISTINGS_BASE) return Promise.resolve();
  // Deduplicate in-flight reads, not a whole browser session: a later route
  // entry must discover assets published since the previous visit.
  return bootstrap ??= fetchManagedPublic('/market/managed-listings').then(() => {}).finally(() => {bootstrap=undefined;});
}
export function managedPairFromPath(path: string) {
  const match = new URL(path,'https://path.invalid').pathname.match(/\/([A-Z0-9]+)-USDT(?:\/candles)?$/);
  return match && isManagedPair(`${match[1]}/USDT`) ? `${match[1]}/USDT` : null;
}
