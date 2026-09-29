// Managed listings on the real market-edge Worker bundle, in workerd (Miniflare)
// with a persisted SQLite Durable Object. Every external request is forbidden.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const token = 'synthetic-local-only-listings-secret-0001';
const base = 'https://market.local';
let mf, options, outbound = 0;

const iso = (msFromNow) => new Date(Math.ceil((Date.now() + msFromNow) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const config = (extra = {}) => ({
  schemaVersion: 1, symbol: 'QAX', name: 'QA Example', logo: null, initialPrice: '0.25',
  listingAt: iso(3_600_000), displayTimeZone: 'Europe/Kyiv', ownerAllocation: '1000',
  seedMode: 'manual', seed: 'qax-20261001-synthetic', tradable: true, ...extra,
});
const admin = (path, { method = 'GET', body, ifMatch, headers = {} } = {}) => mf.dispatchFetch(`${base}${path}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, 'X-Voltex-Admin-Id': 'admin-qa-1', 'Content-Type': 'application/json',
    ...(ifMatch !== undefined ? { 'If-Match': String(ifMatch) } : {}), ...headers },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const saveDraft = (id, cfg, ifMatch) => admin(`/internal/listings/${id}/draft`, { method: 'PUT', body: { config: cfg }, ifMatch });
const publish = (id, draftRevision, publishKey) => admin(`/internal/listings/${id}/publish`, { method: 'POST', body: { draftRevision, publishKey } });
const pub = (path, init) => mf.dispatchFetch(`${base}${path}`, init);
const catalogue = async () => (await pub('/market/listings')).json();

before(async () => {
  const bundle = await build({ entryPoints: [new URL('./src/worker.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
  const path = await mkdtemp(join(tmpdir(), 'voltex-listings-sqlite-'));
  options = { ...convertV4MiniflareOptions({ durableObjectsPersist: path, workers: [{ name: 'market-edge', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
    bindings: { LISTINGS_STORE_TOKEN: token, LISTINGS_PUBLIC_CACHE_MS: '0' },
    durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
    outboundService: () => { outbound++; throw new Error('Unexpected external request'); },
  }] }), isolatedResourcePersistencePath: path, resourcePersistencePath: path, telemetry: { enabled: false } };
  mf = new Miniflare(options);
});
after(async () => { await mf?.dispose(); });

test('admin store API: no or wrong Bearer → 401, any browser Origin → 403 without CORS', async () => {
  for (const auth of ['', 'Bearer wrong', token]) assert.equal((await admin('/internal/listings', { headers: { Authorization: auth } })).status, 401);
  const r = await admin('/internal/listings', { headers: { Origin: 'https://voltextech.net' } });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
});

test('create requires If-Match 0; a stale revision never overwrites', async () => {
  assert.equal((await saveDraft('qax', config())).status, 428);
  const created = await saveDraft('qax', config(), 0);
  assert.equal(created.status, 200);
  assert.equal((await created.json()).draftRevision, 1);
  assert.equal((await saveDraft('qax', config({ name: 'Other' }), 0)).status, 409);
  const list = await (await admin('/internal/listings')).json();
  assert.equal(list.listings[0].draft.name, 'QA Example');
  assert.equal(list.listings[0].draftUpdatedBy, 'admin-qa-1');
});

test('twelve concurrent edits of one draft: exactly one wins, eleven conflict', async () => {
  const revision = (await (await admin('/internal/listings')).json()).listings[0].draftRevision;
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => saveDraft('qax', config({ name: `Concurrent ${i}` }), revision)));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 11);
});

test('validation: reserved ticker, bad shape, duplicate ticker across listings', async () => {
  assert.equal((await saveDraft('vta-clone', config({ symbol: 'VTA' }), 0)).status, 422);
  assert.equal((await saveDraft('bad', config({ initialPrice: '-1' }), 0)).status, 422);
  assert.equal((await saveDraft('bad', { ...config(), extra: true }, 0)).status, 422);
  const dup = await saveDraft('qax-two', config(), 0);
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).error, 'DUPLICATE_TICKER');
});

test('a draft is invisible publicly: not in the catalogue, not on any pair path', async () => {
  assert.deepEqual((await catalogue()).assets, []);
  // An unpublished pair path falls through to the existing display edge, exactly as any unknown pair
  // did before (it may ask a venue); what matters is that no draft data is ever answered.
  for (const path of ['/market/test-assets/QAX-USDT', '/market/test-assets/QAX-USDT/candles', '/market/display/spot-book/QAX-USDT', '/market/ticker/QAX-USDT']) {
    const r = await pub(path);
    const text = await r.text();
    assert.notEqual(r.status, 200, path);
    assert.ok(!text.includes('QA Example') && !text.includes('qax-20261001'), path);
  }
});

test('publish: stale revision refused, past time refused, then atomic version 1; same key is idempotent', async () => {
  const listing = (await (await admin('/internal/listings')).json()).listings.find((l) => l.id === 'qax');
  assert.equal((await publish('qax', listing.draftRevision - 1, 'publish-key-000000001')).status, 409);
  // Past listing time: save, then the publish is refused at server time.
  const past = await saveDraft('qax', config({ listingAt: iso(-60_000) }), listing.draftRevision);
  const pastRev = (await past.json()).draftRevision;
  const refused = await publish('qax', pastRev, 'publish-key-000000002');
  assert.equal(refused.status, 422);
  assert.equal((await refused.json()).error, 'LISTING_TIME_PAST');
  const good = await saveDraft('qax', config(), pastRev);
  const goodRev = (await good.json()).draftRevision;
  const first = await (await publish('qax', goodRev, 'publish-key-000000003')).json();
  assert.equal(first.version, 1);
  assert.equal(first.replayed, false);
  // Double click / lost response: the same key returns the same version, nothing appended.
  const again = await (await publish('qax', goodRev, 'publish-key-000000003')).json();
  assert.deepEqual([again.version, again.replayed], [1, true]);
  const list = await (await admin('/internal/listings')).json();
  assert.equal(list.listings.find((l) => l.id === 'qax').versions.length, 1);
});

test('published: catalogue shows the public record (no owner allocation), countdown phase, pair paths answer', async () => {
  const outboundBefore = outbound;
  const body = await catalogue();
  assert.equal(body.assets.length, 1);
  const asset = body.assets[0];
  assert.equal(asset.pair, 'QAX/USDT');
  assert.equal(asset.managed, true);
  assert.equal(asset.state.phase, 'pre-listing');
  assert.equal(asset.version, 1);
  assert.ok(!JSON.stringify(body).includes('ownerAllocation') && !JSON.stringify(body).includes('seedMode'));
  assert.equal(typeof body.serverTime, 'number');
  assert.equal((await pub('/market/test-assets/QAX-USDT')).status, 200);
  const candles = await (await pub('/market/test-assets/QAX-USDT/candles?interval=5m')).json();
  assert.deepEqual(candles.candles, []);
  const book = await (await pub('/market/display/spot-book/QAX-USDT')).json();
  assert.equal(book.available, false);
  assert.equal((await pub('/market/ticker/QAX-USDT')).status, 404);
  assert.equal((await pub('/market/listings', { method: 'POST' })).status, 405);
  assert.equal((await pub('/market/test-assets/QAX-USDT')).headers.get('access-control-allow-origin'), '*');
  // A published listing is computed on read: no venue, Render or Neon request.
  assert.equal(outbound, outboundBefore);
});

test('history is locked after publish: ticker, seed and price edits refused; a name edit publishes version 2', async () => {
  const listing = (await (await admin('/internal/listings')).json()).listings.find((l) => l.id === 'qax');
  for (const change of [{ seed: 'qax-other-seed-0001' }, { initialPrice: '0.3' }, { symbol: 'QAY' }]) {
    const r = await saveDraft('qax', config(change), listing.draftRevision);
    assert.equal(r.status, 422, JSON.stringify(change));
  }
  const renamed = await (await saveDraft('qax', config({ name: 'QA Example Renamed' }), listing.draftRevision)).json();
  const second = await (await publish('qax', renamed.draftRevision, 'publish-key-000000004')).json();
  assert.equal(second.version, 2);
  assert.equal((await catalogue()).assets[0].name, 'QA Example Renamed');
});

test('several future listings with different dates are published side by side', async () => {
  const draft = await (await saveDraft('qbx', config({ symbol: 'QBX', name: 'QB Example', seed: 'qbx-20261002-synthetic', listingAt: iso(7_200_000) }), 0)).json();
  assert.equal((await publish('qbx', draft.draftRevision, 'publish-key-000000005')).status, 200);
  const pairs = (await catalogue()).assets.map((a) => a.pair).sort();
  assert.deepEqual(pairs, ['QAX/USDT', 'QBX/USDT']);
});

test('whole workerd restart keeps drafts, versions and the active configuration', async () => {
  const before = await (await admin('/internal/listings')).json();
  const publicBefore = (await catalogue()).assets.map((a) => [a.pair, a.version, a.name]);
  await mf.dispose();
  mf = new Miniflare(options);
  const after = await (await admin('/internal/listings')).json();
  assert.deepEqual(after.listings.map((l) => [l.id, l.draftRevision, l.activeVersion]), before.listings.map((l) => [l.id, l.draftRevision, l.activeVersion]));
  assert.deepEqual((await catalogue()).assets.map((a) => [a.pair, a.version, a.name]), publicBefore);
});

test('the existing NRX edge is untouched and calls out to nothing', async () => {
  const before = outbound;
  const nrx = await (await pub('/market/nrx')).json();
  assert.equal(nrx.assets[0].pair, 'NRX/USDT');
  assert.equal(outbound, before);
});
