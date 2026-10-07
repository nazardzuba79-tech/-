/**
 * Render's client for the managed-listings Durable Object (market-edge
 * `/internal/listings`). Server-only: the Bearer secret never reaches a
 * browser. Every call is one bounded HTTPS request; nothing here touches Neon.
 */
import { z } from 'zod';
import { listingConfigSchema, publishedListingSchema, type ListingConfig, type PublishedListing } from './listingConfig';

export class ListingStoreError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); }
}

const versionSchema = z.object({ version: z.number().int().positive(), publishedAt: z.string(), publishedBy: z.string() });
export const adminListingSchema = z.object({
  id: z.string(), symbol: z.string(),
  draft: listingConfigSchema, draftRevision: z.number().int().positive(),
  draftUpdatedAt: z.string(), draftUpdatedBy: z.string(),
  activeVersion: z.number().int().positive().nullable(), active: listingConfigSchema.nullable(),
  versions: z.array(versionSchema),
});
export type AdminListing = z.infer<typeof adminListingSchema>;
const adminListSchema = z.object({ revision: z.string(), serverTime: z.number(), listings: z.array(adminListingSchema) });
const publishedSchema = z.object({ revision: z.string(), listings: z.array(publishedListingSchema) });

export interface ListingStore {
  list(): Promise<z.infer<typeof adminListSchema>>;
  published(): Promise<{ revision: string; listings: PublishedListing[] }>;
  saveDraft(id: string, config: ListingConfig, ifMatch: number, actor: string): Promise<{ id: string; draftRevision: number; draft: ListingConfig }>;
  publish(id: string, draftRevision: number, publishKey: string, actor: string): Promise<{ id: string; version: number; replayed: boolean; publishedAt: string }>;
  replacePrelisting?(id: string, body: Record<string, unknown>, actor: string): Promise<Record<string, unknown>>;
}

/** Why Render has no listing store. Names only — never a value. */
export type ListingStoreProblem = 'missing_url' | 'missing_token' | 'invalid_url' | 'invalid_token';

export class UnconfiguredListingStore implements ListingStore {
  constructor(readonly problem: ListingStoreProblem | 'not_set' = 'not_set') {}
  private fail(): never {
    throw new ListingStoreError(503, 'STORE_NOT_CONFIGURED', 'Listing storage is not configured on the server (LISTINGS_STORE_URL / LISTINGS_STORE_TOKEN)', { problem: this.problem });
  }
  async list(): Promise<never> { this.fail(); }
  async published(): Promise<never> { this.fail(); }
  async saveDraft(): Promise<never> { this.fail(); }
  async publish(): Promise<never> { this.fail(); }
}

/** https only; plain http is accepted for a loopback test Worker outside production. */
export function validStoreBase(base: string, production: boolean): URL {
  const url = new URL(base);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !production;
  if ((url.protocol !== 'https:' && !loopback) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid listing storage URL');
  }
  return url;
}

export class CloudflareListingStore implements ListingStore {
  private readonly base: string;
  constructor(base: string, private readonly token: string, private readonly transport: typeof fetch = fetch, production = process.env.NODE_ENV === 'production') {
    if (!token || token.length < 32) throw new Error('Invalid listing storage token');
    this.base = validStoreBase(base, production).toString().replace(/\/$/, '');
  }

  private async call<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, init: { method?: string; body?: unknown; ifMatch?: number; actor?: string } = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(`${this.base}/internal/listings${path}`, {
        method: init.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json',
          'X-Voltex-Listing-Protocol': 'aith-prelisting-v1',
          ...(init.ifMatch !== undefined ? { 'If-Match': String(init.ifMatch) } : {}),
          ...(init.actor ? { 'X-Voltex-Admin-Id': init.actor } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new ListingStoreError(503, 'STORE_UNAVAILABLE', 'Listing storage is unavailable');
    }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const code = typeof body?.error === 'string' ? body.error : 'STORE_UNAVAILABLE';
      const message = typeof body?.message === 'string' ? body.message : code;
      if ([404, 409, 422].includes(response.status)) throw new ListingStoreError(response.status, code, message, body ?? {});
      // Configuration faults are reported as such, so a half-finished rollout never reads as an outage or a success.
      if (response.status === 503 && code === 'store_not_configured') {
        throw new ListingStoreError(503, 'STORE_NOT_CONFIGURED', 'The market-edge Worker has no LISTINGS_STORE_TOKEN', { problem: 'worker_token_missing' });
      }
      if (response.status === 401 || response.status === 403) {
        throw new ListingStoreError(503, 'STORE_AUTH_FAILED', 'LISTINGS_STORE_TOKEN differs between Render and the market-edge Worker');
      }
      throw new ListingStoreError(503, 'STORE_UNAVAILABLE', 'Listing storage is unavailable');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ListingStoreError(503, 'STORE_INVALID_RESPONSE', 'Listing storage answered with an unexpected shape');
    return parsed.data;
  }

  list() { return this.call('', adminListSchema); }
  published() { return this.call('/published', publishedSchema); }
  saveDraft(id: string, config: ListingConfig, ifMatch: number, actor: string) {
    return this.call(`/${encodeURIComponent(id)}/draft`, z.object({ id: z.string(), draftRevision: z.number(), draft: listingConfigSchema }),
      { method: 'PUT', body: { config }, ifMatch, actor });
  }
  publish(id: string, draftRevision: number, publishKey: string, actor: string) {
    return this.call(`/${encodeURIComponent(id)}/publish`, z.object({ id: z.string(), version: z.number(), replayed: z.boolean(), publishedAt: z.string() }),
      { method: 'POST', body: { draftRevision, publishKey }, actor });
  }
  replacePrelisting(id: string, body: Record<string, unknown>, actor: string) {
    return this.call(`/${encodeURIComponent(id)}/replace-prelisting`, z.object({ id: z.string(), phase: z.enum(['PREPARED', 'COMMITTED', 'CANCELLED']) }).passthrough(),
      { method: 'POST', body, actor });
  }
}

/**
 * The store Render uses. Missing or invalid settings never stop the server:
 * the store is "not configured" (every admin call answers 503
 * STORE_NOT_CONFIGURED) and the reason is logged once, by name only.
 */
export function listingStoreFromEnvironment(env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = console.warn): ListingStore {
  const base = env.LISTINGS_STORE_URL?.trim();
  const token = env.LISTINGS_STORE_TOKEN?.trim();
  const unconfigured = (problem: ListingStoreProblem | 'not_set') => {
    if (problem !== 'not_set') log(`[listings] store not configured: ${problem} (LISTINGS_STORE_URL / LISTINGS_STORE_TOKEN)`);
    return new UnconfiguredListingStore(problem);
  };
  if (!base && !token) return unconfigured('not_set');
  if (!base) return unconfigured('missing_url');
  if (!token) return unconfigured('missing_token');
  if (token.length < 32) return unconfigured('invalid_token');
  try {
    return new CloudflareListingStore(base, token, fetch, env.NODE_ENV === 'production');
  } catch {
    return unconfigured('invalid_url');
  }
}
