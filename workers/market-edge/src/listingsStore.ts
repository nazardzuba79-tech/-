/**
 * Managed listings store — one SQLite Durable Object (its own namespace and
 * its own secret; nothing shared with the deposit catalogue).
 *
 * Holds, per listing: the current draft (with a revision for optimistic
 * concurrency), the ordered published versions (append-only), and which
 * version is active. A publish is one synchronous SQLite transaction:
 * compare the draft revision, validate against the active version at server
 * time, append the version, switch the active pointer, bump the catalogue
 * revision. A repeated publish with the same key returns the first result.
 *
 * Written as a plain class (no `cloudflare:workers` import) so the Worker
 * bundle still builds for the edge-isolation tests.
 */
import {
  ListingValidationError, LISTING_ID_PATTERN, MIN_LEAD_FLOOR_MS, MIN_LEAD_MS, checkPublishable, parseListingConfig, withStableProfile, withStableSeed,
  type ListingConfig, type PublishedListing,
} from '../../../src/services/listings/listingConfig';

const MAX_BODY_BYTES = 160 * 1024;
const OBJECT_NAME = 'voltex-managed-listings-v1';
const ACTOR = /^[A-Za-z0-9_-]{1,64}$/;
const PUBLISH_KEY = /^[A-Za-z0-9-]{16,64}$/;

interface SqlStorage { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] } }
interface DurableState { storage: { sql: SqlStorage; transactionSync<T>(fn: () => T): T } }
interface Namespace { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
export interface ListingsEnv {
  LISTINGS?: Namespace;
  LISTINGS_STORE_TOKEN?: string;
  /** Test environments only: a shorter minimum lead before a first listing (floor 5 s). Unset in production = 60 s. */
  LISTINGS_MIN_LEAD_MS?: string;
  /** Test environments only: the public catalogue cache window. Unset in production = 15 s. */
  LISTINGS_PUBLIC_CACHE_MS?: string;
}

function envMs(value: string | undefined, fallback: number, floor: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? Math.max(floor, Math.floor(parsed)) : fallback;
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});

/** Backend-only: a Bearer secret compared in constant time; any browser Origin is refused. */
export async function authorizeListingsAdmin(request: Request, env: ListingsEnv): Promise<Response | null> {
  const secret = env.LISTINGS_STORE_TOKEN;
  // Not configured is not an outage: Render reports it as STORE_NOT_CONFIGURED.
  if (typeof secret !== 'string' || secret.length < 32) return reply({ error: 'store_not_configured' }, 503);
  if (request.headers.has('Origin')) return reply({ error: 'forbidden' }, 403);
  const auth = request.headers.get('Authorization') || '';
  if (auth.length > 4096) return reply({ error: 'unauthorized' }, 401);
  const digest = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(auth), digest(`Bearer ${secret}`)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0 ? null : reply({ error: 'unauthorized' }, 401);
}

async function readJson(request: Request): Promise<{ value?: any; error?: Response }> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return { error: reply({ error: 'expected_json' }, 415) };
  const reader = request.body?.getReader();
  if (!reader) return { error: reply({ error: 'invalid_body' }, 400) };
  let bytes = 0, text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); return { error: reply({ error: 'body_too_large' }, 413) }; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { value: JSON.parse(text) };
  } catch { return { error: reply({ error: 'invalid_body' }, 400) }; }
}

const validationReply = (error: unknown) => error instanceof ListingValidationError
  ? reply({ error: error.code, message: error.message }, 422)
  : reply({ error: 'store_unavailable' }, 503);

export class ManagedListingsDO {
  private readonly sql: SqlStorage;

  constructor(private readonly state: DurableState, private readonly env: ListingsEnv) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS listing (
      id TEXT PRIMARY KEY, symbol TEXT NOT NULL UNIQUE,
      draft TEXT NOT NULL, draft_revision INTEGER NOT NULL, draft_updated_at INTEGER NOT NULL, draft_updated_by TEXT NOT NULL,
      active_version INTEGER, created_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS listing_version (
      listing_id TEXT NOT NULL, version INTEGER NOT NULL, config TEXT NOT NULL,
      publish_key TEXT NOT NULL, published_at INTEGER NOT NULL, published_by TEXT NOT NULL,
      PRIMARY KEY (listing_id, version), UNIQUE (listing_id, publish_key))`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }

  private catalogueRevision(): string {
    return String(this.sql.exec("SELECT v FROM meta WHERE k = 'catalogue_revision'").toArray()[0]?.v ?? '0');
  }

  /** How many listings have been created with a simulation profile: the next one's ordinal. */
  private profileOrdinal(): number {
    return Number(this.sql.exec("SELECT v FROM meta WHERE k = 'simulation_profile_ordinal'").toArray()[0]?.v ?? '0');
  }

  private version(id: string, version: number) {
    return this.sql.exec('SELECT version, config, published_at, published_by FROM listing_version WHERE listing_id = ? AND version = ?', id, version).toArray()[0];
  }

  /** Every active version, as the public catalogue and Render's trading registry read it. */
  published(): { revision: string; listings: PublishedListing[] } {
    const rows = this.sql.exec(`SELECT l.id, v.version, v.config, v.published_at FROM listing l
      JOIN listing_version v ON v.listing_id = l.id AND v.version = l.active_version ORDER BY v.published_at, l.id`).toArray();
    return {
      revision: this.catalogueRevision(),
      listings: rows.map((row) => ({ id: String(row.id), version: Number(row.version), publishedAt: new Date(Number(row.published_at)).toISOString(),
        config: JSON.parse(String(row.config)) as ListingConfig })),
    };
  }

  /** The admin view: drafts, active configuration and version history. */
  private adminList() {
    const listings = this.sql.exec('SELECT * FROM listing ORDER BY created_at, id').toArray().map((row) => {
      const id = String(row.id);
      const active = row.active_version === null ? null : this.version(id, Number(row.active_version));
      const versions = this.sql.exec('SELECT version, published_at, published_by FROM listing_version WHERE listing_id = ? ORDER BY version DESC', id).toArray()
        .map((v) => ({ version: Number(v.version), publishedAt: new Date(Number(v.published_at)).toISOString(), publishedBy: String(v.published_by) }));
      return {
        id, symbol: String(row.symbol),
        draft: JSON.parse(String(row.draft)) as ListingConfig,
        draftRevision: Number(row.draft_revision),
        draftUpdatedAt: new Date(Number(row.draft_updated_at)).toISOString(),
        draftUpdatedBy: String(row.draft_updated_by),
        activeVersion: row.active_version === null ? null : Number(row.active_version),
        active: active ? JSON.parse(String(active.config)) as ListingConfig : null,
        versions,
      };
    });
    return { revision: this.catalogueRevision(), serverTime: Date.now(), listings };
  }

  private saveDraft(id: string, ifMatch: string, input: unknown, actor: string, now: number): Response {
    let config: ListingConfig;
    try { config = parseListingConfig(input); } catch (error) { return validationReply(error); }
    return this.state.storage.transactionSync(() => {
      const row = this.sql.exec('SELECT * FROM listing WHERE id = ?', id).toArray()[0];
      const current = row ? String(row.draft_revision) : '0';
      if (current !== ifMatch) return reply({ error: 'revision_conflict', draftRevision: Number(current) }, 409);
      const previous = row ? JSON.parse(String(row.draft)) as ListingConfig : null;
      const active = row && row.active_version !== null ? JSON.parse(String(this.version(id, Number(row.active_version))!.config)) as ListingConfig : null;
      // A new listing takes the next profile in the rotation; an existing one keeps what it has.
      const ordinal = row ? null : this.profileOrdinal();
      let next: ListingConfig;
      try {
        next = withStableProfile(withStableSeed(config, previous), previous, ordinal);
      } catch (error) {
        return validationReply(error);
      }
      if (active && (next.symbol !== active.symbol || next.seed !== active.seed || next.initialPrice !== active.initialPrice)) {
        return reply({ error: 'HISTORY_LOCKED', message: 'The ticker, seed and initial price of a published listing cannot change' }, 422);
      }
      const clash = this.sql.exec('SELECT id FROM listing WHERE symbol = ? AND id <> ?', next.symbol, id).toArray()[0];
      if (clash) return reply({ error: 'DUPLICATE_TICKER', message: `Ticker ${next.symbol} is already used by another listing` }, 409);
      const revision = Number(current) + 1;
      if (row) {
        this.sql.exec('UPDATE listing SET symbol = ?, draft = ?, draft_revision = ?, draft_updated_at = ?, draft_updated_by = ? WHERE id = ?',
          next.symbol, JSON.stringify(next), revision, now, actor, id);
      } else {
        this.sql.exec('INSERT INTO listing (id, symbol, draft, draft_revision, draft_updated_at, draft_updated_by, active_version, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
          id, next.symbol, JSON.stringify(next), revision, now, actor, now);
        // Same transaction as the insert: an ordinal is spent only by a listing that exists.
        this.sql.exec("INSERT INTO meta (k, v) VALUES ('simulation_profile_ordinal', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String((ordinal as number) + 1));
      }
      return reply({ id, draftRevision: revision, draft: next });
    });
  }

  private publish(id: string, draftRevision: unknown, publishKey: unknown, actor: string, now: number): Response {
    if (!Number.isSafeInteger(draftRevision) || typeof publishKey !== 'string' || !PUBLISH_KEY.test(publishKey)) return reply({ error: 'invalid_publish_request' }, 400);
    return this.state.storage.transactionSync(() => {
      const row = this.sql.exec('SELECT * FROM listing WHERE id = ?', id).toArray()[0];
      if (!row) return reply({ error: 'not_found' }, 404);
      const replay = this.sql.exec('SELECT version, published_at FROM listing_version WHERE listing_id = ? AND publish_key = ?', id, publishKey).toArray()[0];
      if (replay) return reply({ id, version: Number(replay.version), replayed: true, publishedAt: new Date(Number(replay.published_at)).toISOString() });
      if (Number(row.draft_revision) !== draftRevision) return reply({ error: 'revision_conflict', draftRevision: Number(row.draft_revision) }, 409);
      let config: ListingConfig;
      try {
        config = parseListingConfig(JSON.parse(String(row.draft)));
        const active = row.active_version === null ? null : JSON.parse(String(this.version(id, Number(row.active_version))!.config)) as ListingConfig;
        // Publishing what is already live (a second confirmation, another admin's tab) is a replay, not a new version.
        if (active && JSON.stringify(config) === JSON.stringify(active)) {
          const current = this.version(id, Number(row.active_version))!;
          return reply({ id, version: Number(row.active_version), replayed: true, publishedAt: new Date(Number(current.published_at)).toISOString() });
        }
        checkPublishable(config, active, now, envMs(this.env.LISTINGS_MIN_LEAD_MS, MIN_LEAD_MS, MIN_LEAD_FLOOR_MS));
      } catch (error) { return validationReply(error); }
      const version = (row.active_version === null ? 0 : Number(this.sql.exec('SELECT MAX(version) AS v FROM listing_version WHERE listing_id = ?', id).toArray()[0].v)) + 1;
      this.sql.exec('INSERT INTO listing_version (listing_id, version, config, publish_key, published_at, published_by) VALUES (?, ?, ?, ?, ?, ?)',
        id, version, JSON.stringify(config), publishKey, now, actor);
      this.sql.exec('UPDATE listing SET active_version = ? WHERE id = ?', version, id);
      const revision = String(BigInt(this.catalogueRevision()) + 1n);
      this.sql.exec("INSERT INTO meta (k, v) VALUES ('catalogue_revision', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", revision);
      return reply({ id, version, replayed: false, publishedAt: new Date(now).toISOString(), catalogueRevision: revision });
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      // Published configurations are public data; the Worker adds its own read cache.
      if (url.pathname === '/published' && request.method === 'GET') return reply(this.published());
      const denied = await authorizeListingsAdmin(request, this.env);
      if (denied) return denied;
      const actor = request.headers.get('X-Voltex-Admin-Id') ?? '';
      if (url.pathname === '/internal/listings' && request.method === 'GET') return reply(this.adminList());
      // Render's trading registry: published configurations INCLUDING the seed (never served publicly).
      if (url.pathname === '/internal/listings/published' && request.method === 'GET') return reply(this.published());
      const match = /^\/internal\/listings\/([^/]+)\/(draft|publish)$/.exec(url.pathname);
      if (!match || !LISTING_ID_PATTERN.test(match[1])) return reply({ error: 'not_found' }, 404);
      if (!ACTOR.test(actor)) return reply({ error: 'actor_required' }, 400);
      const body = await readJson(request);
      if (body.error) return body.error;
      if (match[2] === 'draft' && request.method === 'PUT') {
        const ifMatch = request.headers.get('If-Match');
        if (!ifMatch) return reply({ error: 'if_match_required' }, 428);
        if (!/^(0|[1-9]\d{0,15})$/.test(ifMatch)) return reply({ error: 'invalid_revision' }, 400);
        return this.saveDraft(match[1], ifMatch, body.value?.config, actor, Date.now());
      }
      if (match[2] === 'publish' && request.method === 'POST') {
        return this.publish(match[1], body.value?.draftRevision, body.value?.publishKey, actor, Date.now());
      }
      return reply({ error: 'method_not_allowed' }, 405);
    } catch {
      return reply({ error: 'store_unavailable' }, 503);
    }
  }
}

/** The single store object (one namespace per Worker environment). */
export function listingsStub(env: ListingsEnv) {
  if (!env.LISTINGS) return null;
  return env.LISTINGS.get(env.LISTINGS.idFromName(OBJECT_NAME));
}

/**
 * Published configurations for public reads, cached per isolate for
 * PUBLISHED_CACHE_MS. The rule: a publish is visible on the public edge
 * within that window; a store outage keeps serving the last good catalogue
 * rather than dropping listed markets.
 */
export const PUBLISHED_CACHE_MS = 15_000;
let cache: { at: number; revision: string; listings: PublishedListing[] } | null = null;
let inFlight: Promise<{ revision: string; listings: PublishedListing[] } | null> | null = null;

export async function publishedListings(env: ListingsEnv, now = Date.now()): Promise<{ revision: string; listings: PublishedListing[] } | null> {
  if (cache && now - cache.at < envMs(env.LISTINGS_PUBLIC_CACHE_MS, PUBLISHED_CACHE_MS, 0)) return cache;
  const stub = listingsStub(env);
  if (!stub) return cache;
  if (!inFlight) {
    inFlight = stub.fetch(new Request('https://listings.internal/published'))
      .then(async (response) => {
        if (!response.ok) throw new Error(`store ${response.status}`);
        const body = await response.json() as { revision: string; listings: PublishedListing[] };
        // Validate before serving: a malformed row is dropped, never shown.
        const listings = body.listings.filter((item) => { try { parseListingConfig(item.config); return true; } catch { return false; } });
        cache = { at: Date.now(), revision: String(body.revision), listings };
        return cache;
      })
      .catch(() => cache)
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** Test hook: forget the isolate cache. */
export function resetPublishedCache() { cache = null; inFlight = null; }
