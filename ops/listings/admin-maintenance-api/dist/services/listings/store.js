"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudflareListingStore = exports.UnconfiguredListingStore = exports.adminListingSchema = exports.ListingStoreError = void 0;
exports.validStoreBase = validStoreBase;
exports.listingStoreFromEnvironment = listingStoreFromEnvironment;
/**
 * Render's client for the managed-listings Durable Object (market-edge
 * `/internal/listings`). Server-only: the Bearer secret never reaches a
 * browser. Every call is one bounded HTTPS request; nothing here touches Neon.
 */
const zod_1 = require("zod");
const listingConfig_1 = require("./listingConfig");
class ListingStoreError extends Error {
    constructor(status, code, message, details = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
exports.ListingStoreError = ListingStoreError;
const versionSchema = zod_1.z.object({ version: zod_1.z.number().int().positive(), publishedAt: zod_1.z.string(), publishedBy: zod_1.z.string() });
exports.adminListingSchema = zod_1.z.object({
    id: zod_1.z.string(), symbol: zod_1.z.string(),
    draft: listingConfig_1.listingConfigSchema, draftRevision: zod_1.z.number().int().positive(),
    draftUpdatedAt: zod_1.z.string(), draftUpdatedBy: zod_1.z.string(),
    activeVersion: zod_1.z.number().int().positive().nullable(), active: listingConfig_1.listingConfigSchema.nullable(),
    versions: zod_1.z.array(versionSchema),
    /** The pre-listing timer; null until the listing has one (published before the timer existed, or never staged). */
    countdown: listingConfig_1.listingCountdownSchema.nullable().optional(),
});
const adminListSchema = zod_1.z.object({ revision: zod_1.z.string(), serverTime: zod_1.z.number(), listings: zod_1.z.array(exports.adminListingSchema) });
const publishedSchema = zod_1.z.object({ revision: zod_1.z.string(), listings: zod_1.z.array(listingConfig_1.publishedListingSchema) });
const publishReceiptSchema = zod_1.z.object({ id: zod_1.z.string(), version: zod_1.z.number(), replayed: zod_1.z.boolean(), publishedAt: zod_1.z.string(), countdown: listingConfig_1.listingCountdownSchema.nullable().optional() });
const countdownReceiptSchema = zod_1.z.object({ id: zod_1.z.string(), countdown: listingConfig_1.listingCountdownSchema, changed: zod_1.z.boolean() });
const deleteReceiptSchema = zod_1.z.object({ id: zod_1.z.string(), symbol: zod_1.z.string(), deleted: zod_1.z.literal(true), catalogueRevision: zod_1.z.string() });
class UnconfiguredListingStore {
    constructor(problem = 'not_set') {
        this.problem = problem;
    }
    fail() {
        throw new ListingStoreError(503, 'STORE_NOT_CONFIGURED', 'Listing storage is not configured on the server (LISTINGS_STORE_URL / LISTINGS_STORE_TOKEN)', { problem: this.problem });
    }
    async list() { this.fail(); }
    async published() { this.fail(); }
    async saveDraft() { this.fail(); }
    async publish() { this.fail(); }
    async countdown() { this.fail(); }
}
exports.UnconfiguredListingStore = UnconfiguredListingStore;
/** https only; plain http is accepted for a loopback test Worker outside production. */
function validStoreBase(base, production) {
    const url = new URL(base);
    const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !production;
    if ((url.protocol !== 'https:' && !loopback) || url.username || url.password || url.search || url.hash) {
        throw new Error('Invalid listing storage URL');
    }
    return url;
}
class CloudflareListingStore {
    constructor(base, token, transport = fetch, production = process.env.NODE_ENV === 'production') {
        this.token = token;
        this.transport = transport;
        if (!token || token.length < 32)
            throw new Error('Invalid listing storage token');
        this.base = validStoreBase(base, production).toString().replace(/\/$/, '');
    }
    async call(path, schema, init = {}) {
        let response;
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
        }
        catch {
            throw new ListingStoreError(503, 'STORE_UNAVAILABLE', 'Listing storage is unavailable');
        }
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const code = typeof body?.error === 'string' ? body.error : 'STORE_UNAVAILABLE';
            const message = typeof body?.message === 'string' ? body.message : code;
            if ([404, 409, 422].includes(response.status))
                throw new ListingStoreError(response.status, code, message, body ?? {});
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
        if (!parsed.success)
            throw new ListingStoreError(503, 'STORE_INVALID_RESPONSE', 'Listing storage answered with an unexpected shape');
        return parsed.data;
    }
    list() { return this.call('', adminListSchema); }
    published() { return this.call('/published', publishedSchema); }
    saveDraft(id, config, ifMatch, actor) {
        return this.call(`/${encodeURIComponent(id)}/draft`, zod_1.z.object({ id: zod_1.z.string(), draftRevision: zod_1.z.number(), draft: listingConfig_1.listingConfigSchema }), { method: 'PUT', body: { config }, ifMatch, actor });
    }
    publish(id, draftRevision, publishKey, actor, countdown) {
        return this.call(`/${encodeURIComponent(id)}/publish`, publishReceiptSchema, { method: 'POST', body: { draftRevision, publishKey, ...(countdown ? { countdown } : {}) }, actor });
    }
    countdown(id, action, actor) {
        return this.call(`/${encodeURIComponent(id)}/countdown`, countdownReceiptSchema, { method: 'POST', body: { action }, actor });
    }
    deleteListing(id, symbol, draftRevision, activeVersion, actor) {
        return this.call(`/${encodeURIComponent(id)}/delete`, deleteReceiptSchema, {
            method: 'POST', body: { symbol, draftRevision, activeVersion, confirmation: `УДАЛИТЬ ${symbol}` }, actor,
        });
    }
    replacePrelisting(id, body, actor) {
        return this.call(`/${encodeURIComponent(id)}/replace-prelisting`, zod_1.z.object({ id: zod_1.z.string(), phase: zod_1.z.enum(['PREPARED', 'COMMITTED', 'CANCELLED']) }).passthrough(), { method: 'POST', body, actor });
    }
}
exports.CloudflareListingStore = CloudflareListingStore;
/**
 * The store Render uses. Missing or invalid settings never stop the server:
 * the store is "not configured" (every admin call answers 503
 * STORE_NOT_CONFIGURED) and the reason is logged once, by name only.
 */
function listingStoreFromEnvironment(env = process.env, log = console.warn) {
    const base = env.LISTINGS_STORE_URL?.trim();
    const token = env.LISTINGS_STORE_TOKEN?.trim();
    const unconfigured = (problem) => {
        if (problem !== 'not_set')
            log(`[listings] store not configured: ${problem} (LISTINGS_STORE_URL / LISTINGS_STORE_TOKEN)`);
        return new UnconfiguredListingStore(problem);
    };
    if (!base && !token)
        return unconfigured('not_set');
    if (!base)
        return unconfigured('missing_url');
    if (!token)
        return unconfigured('missing_token');
    if (token.length < 32)
        return unconfigured('invalid_token');
    try {
        return new CloudflareListingStore(base, token, fetch, env.NODE_ENV === 'production');
    }
    catch {
        return unconfigured('invalid_url');
    }
}
//# sourceMappingURL=store.js.map