import { DurableObject } from 'cloudflare:workers';
import { validateListing, ListingError } from '../../../src/services/managedListings/schema.ts';
import { listingMetadata, listingMarket } from '../../../src/services/managedListings/public.ts';

const NAME = 'managed-listings-v1';
const json = (body, status = 200, publicRead = false) => Response.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  ...(publicRead ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' } : {}),
} });
const validKey = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
async function authorized(request, env) {
  if (request.headers.has('Origin')) return false;
  const secret = env.LISTINGS_STORE_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const digest = v => crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  const supplied = request.headers.get('Authorization') || '';
  if (supplied.length > 4096) return false;
  const [a,b] = await Promise.all([digest(supplied), digest(`Bearer ${secret}`)]);
  return new Uint8Array(a).reduce((diff, n, i) => diff | (n ^ new Uint8Array(b)[i]), 0) === 0;
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ListingError('expected_json',415);
  const reader = request.body?.getReader();
  if (!reader) throw new ListingError('invalid_json');
  let length = 0, chunks = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 100_000) { await reader.cancel(); throw new ListingError('body_too_large',413); }
    chunks.push(value);
  }
  const all = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { all.set(chunk,offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all)); }
  catch { throw new ListingError('invalid_json'); }
}
const route = path => {
  const patterns = [
    [/^\/market\/test-assets\/([A-Z0-9]+)-USDT$/, 'asset'],
    [/^\/market\/test-assets\/([A-Z0-9]+)-USDT\/candles$/, 'candles'],
    [/^\/market\/(?:external|display)\/(?:candles|spot-candles)\/([A-Z0-9]+)-USDT$/, 'candles'],
    [/^\/(?:market\/(?:external|display)\/(?:orderbook|spot-book)|orderbook)\/([A-Z0-9]+)-USDT$/, 'book'],
    [/^\/market\/(?:external|display)\/(?:trades|spot-trades)\/([A-Z0-9]+)-USDT$/, 'trades'],
    [/^\/market\/(?:external\/tickers|ticker)\/([A-Z0-9]+)-USDT$/, 'ticker'],
  ];
  for (const [pattern,kind] of patterns) { const match = path.match(pattern); if (match) return [match[1],kind]; }
  return null;
};
export class ManagedListingsDO extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env); this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, ticker TEXT UNIQUE NOT NULL, pair TEXT UNIQUE NOT NULL, status TEXT NOT NULL, document TEXT NOT NULL, request TEXT NOT NULL, publish_key TEXT, publish_revision INTEGER)');
  }
  read(id) { return this.sql.exec('SELECT * FROM listings WHERE id = ?',id).toArray()[0]; }
  async fetch(request) {
    const url = new URL(request.url), path = url.pathname, now = Date.now();
    const publicRead = path.startsWith('/market/') || path.startsWith('/orderbook/');
    try {
      if (publicRead) {
        if (request.method === 'OPTIONS') return json({},200,true);
        if (!['GET','HEAD'].includes(request.method)) return json({error:'method_not_allowed'},405,true);
        // No query can expose a draft or override the authoritative clock.
        if (path === '/market/managed-listings') {
          const rows = this.sql.exec("SELECT document FROM listings WHERE status = 'published' ORDER BY ticker").toArray();
          return json({serverTime:now, assets:rows.map(r => listingMetadata(JSON.parse(r.document),now))},200,true);
        }
        const match = route(path);
        if (!match) return json({error:'not_found'},404,true);
        const row = this.sql.exec("SELECT document FROM listings WHERE ticker = ? AND status = 'published'",match[0]).toArray()[0];
        if (!row) return json({error:'not_found'},404,true);
        return json(listingMarket(JSON.parse(row.document),match[1],url,now),200,true);
      }
      if (!await authorized(request,this.env)) return json({error:'unauthorized'},401);
      const lookup = path.match(/^\/admin\/listings\/lookup\/([A-Z0-9]{1,32})$/);
      if (lookup && request.method === 'GET') return json({managed:this.sql.exec('SELECT id FROM listings WHERE ticker = ?',lookup[1]).toArray().length > 0});
      if (path === '/admin/listings' && request.method === 'GET')
        return json(this.sql.exec('SELECT document FROM listings ORDER BY ticker').toArray().map(r => JSON.parse(r.document)));
      if (path === '/admin/listings' && request.method === 'POST') {
        const input = await body(request), key = request.headers.get('Idempotency-Key');
        if (!validKey(key)) throw new ListingError('idempotency_key_required');
        const data = validateListing(input,now,false);
        const canonical = JSON.stringify(data);
        return this.ctx.storage.transactionSync(() => {
          const prior = this.read(key);
          if (prior) return prior.request === canonical ? json(JSON.parse(prior.document)) : json({error:'idempotency_conflict'},409);
          validateListing(input,now);
          if (this.sql.exec('SELECT id FROM listings WHERE ticker = ? OR pair = ?',data.ticker,`${data.ticker}/USDT`).toArray().length)
            return json({error:'duplicate_ticker_or_pair'},409);
          if (this.sql.exec('SELECT count(*) AS n FROM listings').toArray()[0].n >= 50) return json({error:'listing_capacity'},409);
          const listing = {...data, id:key, pair:`${data.ticker}/USDT`, seed:data.seed || crypto.randomUUID(), revision:1, version:1,
            status:'draft', createdBy:request.headers.get('X-Admin-Id') || 'admin', createdAt:new Date(now).toISOString()};
          this.sql.exec('INSERT INTO listings (id,ticker,pair,status,document,request) VALUES (?,?,?,?,?,?)',
            key,data.ticker,listing.pair,'draft',JSON.stringify(listing),canonical);
          return json(listing,201);
        });
      }
      const match = path.match(/^\/admin\/listings\/([a-zA-Z0-9_-]{16,80})(?:\/(preview|publish))?$/);
      if (!match) return json({error:'not_found'},404);
      const [,id,action] = match;
      const row = this.read(id); if (!row) return json({error:'not_found'},404);
      const listing = JSON.parse(row.document);
      if (request.method === 'GET' && !action) return json(listing);
      if (request.method === 'GET' && action === 'preview') {
        return json({listing, serverTime:now, asset:listingMetadata(listing,now),
          // Preview is admin-only, explicit future simulation; no state mutation.
          liveSample:listingMarket(listing,'candles',new URL('?interval=5m&limit=36',url),Date.parse(listing.listingAt)+3*3600_000)});
      }
      if (request.method !== (action === 'publish' ? 'POST' : 'PUT') || action === 'preview') return json({error:'method_not_allowed'},405);
      const revision = Number(request.headers.get('If-Match'));
      if (!Number.isSafeInteger(revision) || revision < 1) throw new ListingError('revision_required',428);
      const input = action === 'publish' ? null : validateListing(await body(request),now);
      const key = request.headers.get('Idempotency-Key');
      if (action === 'publish' && !validKey(key)) throw new ListingError('idempotency_key_required');
      return this.ctx.storage.transactionSync(() => {
        const current = this.read(id), value = JSON.parse(current.document);
        if (action === 'publish' && current.publish_key === key && current.publish_revision === revision) return json(value);
        if (value.revision !== revision) return json({error:'revision_conflict'},409);
        if (value.status === 'published') return json({error:'published_immutable'},409);
        if (input && (input.ticker !== value.ticker || (input.seed && input.seed !== value.seed))) return json({error:'identity_immutable'},409);
        if (action === 'publish' && Date.parse(value.listingAt) <= now) return json({error:'listing_date_elapsed'},409);
        const next = action === 'publish' ? {...value, status:'published', publishedAt:new Date(now).toISOString(), revision:revision+1}
          : {...value,...input,seed:value.seed,revision:revision+1};
        this.sql.exec('UPDATE listings SET status=?,document=?,publish_key=?,publish_revision=? WHERE id=?',
          next.status,JSON.stringify(next),action === 'publish' ? key : null,action === 'publish' ? revision : null,id);
        return json(next);
      });
    } catch(error) {
      return json({error:error instanceof ListingError ? error.code : 'listing_request_failed'},error instanceof ListingError ? error.status : 400,publicRead);
    }
  }
}
export default { async fetch(request,env) {
  try { return await env.MANAGED_LISTINGS.get(env.MANAGED_LISTINGS.idFromName(NAME)).fetch(request); }
  catch { return json({error:'listings_unavailable'},503,true); }
} };
