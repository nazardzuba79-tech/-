import { ListingError, type ManagedListing } from './schema';

export class ListingsStore {
  constructor(private base: string, private token: string, private transport: typeof fetch = fetch) {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid listings store configuration');
  }
  async call<T = ManagedListing>(path: string, method = 'GET', body?: unknown, revision?: string, key?: string, adminId?: string): Promise<T> {
    if (!path.startsWith('/admin/listings')) throw new ListingError('invalid_store_path');
    const response = await this.transport(new URL(path,this.base), { method, redirect:'error', signal:AbortSignal.timeout(8000),
      headers:{ Authorization:`Bearer ${this.token}`, 'Content-Type':'application/json',
        ...(revision ? {'If-Match':revision} : {}), ...(key ? {'Idempotency-Key':key} : {}), ...(adminId ? {'X-Admin-Id':adminId} : {}) },
      ...(body !== undefined ? {body:JSON.stringify(body)} : {}) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as {error?:string};
      const code = typeof result.error === 'string' && /^[a-z_]{1,64}$/.test(result.error) ? result.error : 'listings_unavailable';
      throw new ListingError(code,response.status >= 500 ? 503 : response.status);
    }
    return response.json() as Promise<T>;
  }
}
export function listingsStore(): ListingsStore {
  const { LISTINGS_STORE_URL:url, LISTINGS_STORE_TOKEN:token } = process.env;
  if (!url || !token || token.length < 32) throw new ListingError('listings_not_configured',503);
  return new ListingsStore(url,token);
}

/** Account operations only, never a public market poll. Empty config preserves
 * legacy operation. When enabled, an unavailable registry fails closed. */
export async function assertNotManagedExecution(pair: string) {
  if (!process.env.LISTINGS_STORE_URL) return;
  const symbol = pair.split('/')[0].toUpperCase();
  if (!/^[A-Z0-9]{1,32}$/.test(symbol)) throw new ListingError('invalid_pair');
  const result = await listingsStore().call<{managed:boolean}>(`/admin/listings/lookup/${symbol}`);
  if (result.managed) throw new ListingError('Этот актив доступен только для просмотра рынка.');
}
