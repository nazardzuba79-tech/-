import { z } from 'zod';
import { DEPOSIT_RAILS, railKey, validAddress } from './registry';

export class CatalogueError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export const entrySchema = z.object({
  assetId: z.string().max(80), networkId: z.string().max(40),
  address: z.string().trim().max(256), enabled: z.boolean(),
  memo: z.string().trim().max(128).regex(/^[^<>\x00-\x1f]*$/).default(''),
  memoLabel: z.string().trim().max(40).regex(/^[\p{L}\p{N} ._/-]*$/u).default(''),
}).strict().superRefine((entry, ctx) => {
  const rail = DEPOSIT_RAILS.find(r => railKey(r) === railKey(entry));
  if (!rail) ctx.addIssue({ code: 'custom', message: 'Unknown asset/network' });
  if (entry.address && !validAddress(entry.networkId, entry.address)) ctx.addIssue({ code: 'custom', message: 'Invalid address format' });
  if (entry.enabled && !entry.address) ctx.addIssue({ code: 'custom', message: 'Enabled address is required' });
  if ((entry.memo || entry.memoLabel) && !rail?.memoAllowed) ctx.addIssue({ code: 'custom', message: 'Memo not supported on this network' });
  if (entry.networkId === 'xrp' && entry.memo && (!/^\d+$/.test(entry.memo) || BigInt(entry.memo) > 4294967295n))
    ctx.addIssue({ code: 'custom', message: 'Invalid destination tag' });
});
export type AddressEntry = z.infer<typeof entrySchema>;
export const documentSchema = z.object({
  schemaVersion: z.literal(1),
  // Verified one-time snapshot of existing resolved addresses, including DB
  // overrides. Runtime NEVER reads TreasuryWallet to construct this snapshot.
  baseline: z.array(entrySchema).max(200),
  overrides: z.array(entrySchema).max(200),
}).strict().superRefine((doc, ctx) => {
  for (const list of [doc.baseline, doc.overrides]) if (new Set(list.map(railKey)).size !== list.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate asset/network' });
});
export type CatalogueDocument = z.infer<typeof documentSchema>;
export interface StoredCatalogue { revision: string; document: CatalogueDocument }
/** One full-document read, atomic compare-and-swap write. No DB dependency.
 * A production adapter must provide durable, strongly consistent CAS. */
export interface CatalogueStore {
  read(): Promise<StoredCatalogue>;
  replace(document: CatalogueDocument, expectedRevision: string): Promise<StoredCatalogue>;
}
export class UnconfiguredCatalogueStore implements CatalogueStore {
  async read(): Promise<StoredCatalogue> { throw new CatalogueError(503, 'Address catalogue storage is not configured'); }
  async replace(): Promise<StoredCatalogue> { return this.read(); }
}

/** Server-only adapter contract for a separately provisioned Cloudflare config
 * endpoint backed by one Durable Object. No browser sees its bearer token.
 * Not a KV read/modify/write: KV lacks the required cross-instance CAS. */
export class CloudflareCatalogueStore implements CatalogueStore {
  constructor(private endpoint: string, private token: string, private transport: typeof fetch = fetch) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !token)
      throw new Error('Invalid catalogue storage configuration');
  }
  private async call(method: string, document?: CatalogueDocument, revision?: string): Promise<StoredCatalogue> {
    const response = await this.transport(this.endpoint, {
      method, redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(revision ? { 'If-Match': revision } : {}) },
      ...(document ? { body: JSON.stringify(documentSchema.parse(document)) } : {}),
    });
    if (response.status === 409 || response.status === 412) throw new CatalogueError(409, 'Catalogue changed; refresh before saving');
    if (!response.ok) throw new CatalogueError(503, 'Address catalogue storage unavailable');
    const body = await response.json() as StoredCatalogue;
    if (!body || typeof body.revision !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.revision)) throw new CatalogueError(503, 'Invalid catalogue revision');
    return { revision: body.revision, document: documentSchema.parse(body.document) };
  }
  read() { return this.call('GET'); }
  replace(document: CatalogueDocument, revision: string) { return this.call('PUT', document, revision); }
}
export function catalogueStoreFromEnvironment(): CatalogueStore {
  const endpoint = process.env.DEPOSIT_CATALOGUE_STORE_URL;
  const token = process.env.DEPOSIT_CATALOGUE_STORE_TOKEN;
  return endpoint && token ? new CloudflareCatalogueStore(endpoint, token) : new UnconfiguredCatalogueStore();
}
