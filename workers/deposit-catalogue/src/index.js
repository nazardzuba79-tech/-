import { DurableObject } from 'cloudflare:workers';
import { documentSchema } from '../../../src/services/depositCatalogue/schema.ts';
import { publicCatalogueBody, publicEntries } from '../../../src/services/depositCatalogue/publicView.ts';
import { ifNoneMatchHits } from './conditional.js';

const OBJECT_NAME = 'voltex-receiving-addresses-v1';
const MAX_BYTES = 256 * 1024;
const reply = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

async function authorize(request, env) {
  const secret = env.DEPOSIT_CATALOGUE_STORE_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) return reply({ error: 'Storage unavailable' }, 503);
  // This is a backend-only API. No CORS or browser-origin requests.
  if (request.headers.has('Origin')) return reply({ error: 'Forbidden' }, 403);
  const auth = request.headers.get('Authorization') || '';
  if (auth.length > 4096) return reply({ error: 'Unauthorized' }, 401);
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(auth), digest(`Bearer ${secret}`)]);
  let diff = 0;
  const left = new Uint8Array(a), right = new Uint8Array(b);
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0 ? null : reply({ error: 'Unauthorized' }, 401);
}

async function readDocument(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    return { error: reply({ error: 'Expected JSON' }, 415) };
  const reader = request.body?.getReader();
  if (!reader) return { error: reply({ error: 'Invalid document' }, 400) };
  let bytes = 0, text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); return { error: reply({ error: 'Document too large' }, 413) }; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed = documentSchema.safeParse(JSON.parse(text));
    return parsed.success ? { document: parsed.data } : { error: reply({ error: 'Invalid document' }, 400) };
  } catch { return { error: reply({ error: 'Invalid document' }, 400) }; }
  finally { reader.releaseLock(); }
}

export class ReceivingAddressCatalogueDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS catalogue (id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL, document TEXT NOT NULL)');
  }
  current() {
    const row = this.sql.exec('SELECT revision, document FROM catalogue WHERE id = 1').toArray()[0];
    return row ? { revision: row.revision, document: documentSchema.parse(JSON.parse(row.document)) }
      : { revision: '0', document: { schemaVersion: 1, baseline: [], overrides: [] } };
  }
  async fetch(request) {
    const denied = await authorize(request, this.env);
    if (denied) return denied;
    if (request.method === 'GET') return reply(this.current());
    if (request.method !== 'PUT') return reply({ error: 'Method not allowed' }, 405);
    const revision = request.headers.get('If-Match');
    if (!revision) return reply({ error: 'If-Match required' }, 428);
    if (!/^(0|[1-9][0-9]{0,126})$/.test(revision)) return reply({ error: 'Invalid revision' }, 400);
    const parsed = await readDocument(request);
    if (parsed.error) return parsed.error;
    // No await in the transaction: read/compare/increment/write is indivisible.
    const result = this.ctx.storage.transactionSync(() => {
      const current = this.current();
      if (current.revision !== revision) return null;
      const next = { revision: String(BigInt(current.revision) + 1n), document: parsed.document };
      this.sql.exec('INSERT INTO catalogue (id, revision, document) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, document = excluded.document',
        next.revision, JSON.stringify(next.document));
      return next;
    });
    return result ? reply(result) : reply({ error: 'Revision conflict' }, 409);
  }
}

/*
 * Public read-only view for the Deposit dialog: active destinations only, the
 * same entries and version Render serves at /api/v1/deposit-catalogue. No
 * secret leaves the Worker, nothing here can write, and a browser may read it
 * only from an allow-listed origin (PUBLIC_CATALOGUE_ORIGINS, comma-separated).
 */
const PUBLIC_PATH = '/public/deposit-catalogue';
const DEFAULT_ORIGINS = ['https://voltextech.net', 'https://www.voltextech.net'];
function allowedOrigins(env) {
  const configured = typeof env.PUBLIC_CATALOGUE_ORIGINS === 'string' ? env.PUBLIC_CATALOGUE_ORIGINS.split(',').map(o => o.trim()).filter(Boolean) : [];
  return new Set((configured.length ? configured : DEFAULT_ORIGINS).filter(o => /^https:\/\/[a-z0-9.-]+$|^http:\/\/127\.0\.0\.1:\d+$/.test(o)));
}
async function publicCatalogue(request, env) {
  const origin = request.headers.get('Origin');
  if (origin !== null && !allowedOrigins(env).has(origin)) return reply({ error: 'Forbidden' }, 403);
  const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'ETag' } : { Vary: 'Origin' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Max-Age': '86400', 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return reply({ error: 'Method not allowed' }, 405);
  const secret = env.DEPOSIT_CATALOGUE_STORE_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) return reply({ error: 'Storage unavailable' }, 503);
  // Internal read of the object with the Worker's own secret; no browser header is forwarded.
  const stub = env.RECEIVING_ADDRESS_CATALOGUE.get(env.RECEIVING_ADDRESS_CATALOGUE.idFromName(OBJECT_NAME));
  const stored = await stub.fetch('https://catalogue.internal/receiving-address-catalogue', { headers: { Authorization: `Bearer ${secret}` } });
  if (!stored.ok) return reply({ error: 'Storage unavailable' }, 503);
  const { document } = await stored.json();
  const entries = publicEntries(documentSchema.parse(document));
  const body = publicCatalogueBody(entries);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  const version = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
  // Revalidate on every open (addresses can change at any time); an unchanged catalogue costs a 304.
  const headers = { ...cors, 'Cache-Control': 'no-cache', ETag: `"${version}"`, 'X-Content-Type-Options': 'nosniff' };
  // Weak comparison (RFC 9110 §13.1.2): Cloudflare serves this ETag as W/"…" once it compresses the body,
  // and the browser revalidates with exactly that. A 304 carries the same headers and no body.
  if (ifNoneMatchHits(request.headers.get('If-None-Match'), headers.ETag)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : `{"version":"${version}","entries":${body}}`,
    { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    try {
      if (new URL(request.url).pathname === PUBLIC_PATH) {
        if (new URL(request.url).search) return reply({ error: 'Not found' }, 404);
        return await publicCatalogue(request, env);
      }
      const denied = await authorize(request, env);
      if (denied) return denied;
      const url = new URL(request.url);
      if (url.pathname !== '/receiving-address-catalogue' || url.search) return reply({ error: 'Not found' }, 404);
      if (!['GET', 'PUT'].includes(request.method)) return reply({ error: 'Method not allowed' }, 405);
      return await env.RECEIVING_ADDRESS_CATALOGUE.get(env.RECEIVING_ADDRESS_CATALOGUE.idFromName(OBJECT_NAME)).fetch(request);
    } catch {
      // Never reflect errors, request headers, addresses or the secret into logs.
      return reply({ error: 'Storage unavailable' }, 503);
    }
  },
};
