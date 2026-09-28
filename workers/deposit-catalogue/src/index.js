import { DurableObject } from 'cloudflare:workers';
import { documentSchema } from '../../../src/services/depositCatalogue/schema.ts';

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

export default {
  async fetch(request, env) {
    try {
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
