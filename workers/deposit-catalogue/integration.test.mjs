import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CloudflareCatalogueStore } = require('../../dist/services/depositCatalogue/store.js');
const { DepositCatalogue } = require('../../dist/services/depositCatalogue/service.js');
const token = 'synthetic-local-only-catalogue-secret-0001';
const endpoint = 'https://local/receiving-address-catalogue';
const eth = { assetId: 'ethereum', networkId: 'ethereum', address: '0x' + '1'.repeat(40), enabled: true, memo: '', memoLabel: '' };
const document = (entry = eth) => ({ schemaVersion: 1, baseline: [entry], overrides: [] });
let mf, options, bundle, outbound = 0, calls = 0;
const request = (method = 'GET', data, revision, headers = {}) => {
  calls++;
  return mf.dispatchFetch(endpoint, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    ...(revision !== undefined ? { 'If-Match': revision } : {}), ...headers }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
};
const current = async () => (await request()).json();
before(async () => {
  bundle = await build({ entryPoints: [new URL('./src/index.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
    bundle: true, write: false, format: 'esm', external: ['cloudflare:*'] });
  const path = await mkdtemp(join(tmpdir(), 'voltex-catalogue-sqlite-'));
  options = { ...convertV4MiniflareOptions({ durableObjectsPersist: path, workers: [{ name: 'catalogue', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01', bindings: { DEPOSIT_CATALOGUE_STORE_TOKEN: token },
    durableObjects: { RECEIVING_ADDRESS_CATALOGUE: { className: 'ReceivingAddressCatalogueDO', useSQLite: true } },
    outboundService: () => { outbound++; throw new Error('Unexpected external request'); },
  }] }), isolatedResourcePersistencePath: path, resourcePersistencePath: path, telemetry: { enabled: false } };
  mf = new Miniflare(options);
});
after(async () => { await mf?.dispose(); });

test('GET returns an unseeded revision 0 and empty canonical document', async () => {
  assert.deepEqual(await current(), { revision: '0', document: { schemaVersion: 1, baseline: [], overrides: [] } });
});
test('missing and incorrect Bearer are refused; no Origin/CORS browser access', async () => {
  for (const auth of ['', 'Bearer wrong', token]) assert.equal((await request('GET', undefined, undefined, { Authorization: auth })).status, 401);
  const r = await request('GET', undefined, undefined, { Origin: 'https://voltextech.net' });
  assert.equal(r.status, 403); assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await request('OPTIONS')).status, 405);
});
test('PUT requires a valid If-Match and accepts no wildcard', async () => {
  assert.equal((await request('PUT', document())).status, 428);
  for (const revision of ['*', '01', '-1', '"0"']) assert.equal((await request('PUT', document(), revision)).status, 400);
});
test('matching PUT atomically creates revision 1; stale PUT does not mutate', async () => {
  assert.deepEqual(await (await request('PUT', document(), '0')).json(), { revision: '1', document: document() });
  assert.equal((await request('PUT', document({ ...eth, address: '0x' + '2'.repeat(40) }), '0')).status, 409);
  assert.deepEqual(await current(), { revision: '1', document: document() });
});
test('whole workerd restart retains document and revision in SQLite', async () => {
  const before = await current();
  await mf.dispose(); mf = new Miniflare(options);
  assert.deepEqual(await current(), before);
  const r = await request('PUT', { ...document(), overrides: [{ ...eth, enabled: false }] }, before.revision);
  assert.equal(r.status, 200); assert.equal((await r.json()).revision, '2');
});
test('twelve concurrent writers: exactly one commit, eleven conflicts, winner preserved', async () => {
  const revision = (await current()).revision;
  const docs = Array.from({ length: 12 }, (_, i) => document({ ...eth, address: '0x' + String(i + 10).repeat(20) }));
  const results = await Promise.all(docs.map(d => request('PUT', d, revision)));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 11);
  assert.deepEqual(await current(), await results.find(r => r.status === 200).json());
});
test('unknown fields, unknown rails, duplicates, invalid addresses/memos rejected without mutation', async () => {
  const before = await current();
  const invalid = [ { ...document(), extra: true }, document({ ...eth, extra: true }),
    { ...document(), baseline: [eth, eth] }, { ...document(), overrides: [eth, eth] },
    document({ ...eth, networkId: 'made-up' }), document({ ...eth, address: 'bad' }), document({ ...eth, memo: 'x' }) ];
  for (const d of invalid) assert.equal((await request('PUT', d, before.revision)).status, 400);
  assert.deepEqual(await current(), before);
});
test('bounded body and malformed JSON refused; unsupported route/method cannot mutate', async () => {
  const revision = (await current()).revision;
  assert.equal((await request('PUT', { junk: 'a'.repeat(270000) }, revision)).status, 413);
  const bad = await mf.dispatchFetch(endpoint, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': revision }, body: '{' });
  assert.equal(bad.status, 400);
  assert.equal((await request('DELETE')).status, 405);
  assert.equal((await mf.dispatchFetch('https://local/other', { headers: { Authorization: `Bearer ${token}` } })).status, 404);
  assert.equal((await current()).revision, revision);
});
const transport = async (url, init) => { calls++; return mf.dispatchFetch(url, init); };
test('backend shared inflight, 30-second cache, warm customer open and expiry use real DO', async () => {
  let now = 0;
  const service = new DepositCatalogue(new CloudflareCatalogueStore(endpoint, token, transport), async () => [], () => now);
  let before = calls;
  await Promise.all(Array.from({ length: 20 }, () => service.publicCatalogue()));
  assert.equal(calls - before, 1);
  await service.adminCatalogue(); now = 29999; await service.publicCatalogue(); assert.equal(calls - before, 1);
  now = 30000; await service.publicCatalogue(); assert.equal(calls - before, 2);
});
test('two independent backend admins cannot overwrite using the same revision', async () => {
  const create = () => new DepositCatalogue(new CloudflareCatalogueStore(endpoint, token, transport), async () => []);
  const a = create(), b = create(), revision = (await a.adminCatalogue()).revision;
  const results = await Promise.allSettled([a.save(eth, revision), b.save({ ...eth, enabled: false }, revision)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});
test('commit then lost response: force GET, no PUT retry, report uncertain and refresh persisted result', async () => {
  const methods = [];
  const adapter = new CloudflareCatalogueStore(endpoint, token, async (url, init) => {
    methods.push(init.method); const response = await transport(url, init);
    if (init.method === 'PUT') { assert.equal(response.status, 200); throw new Error('Synthetic response loss'); }
    return response;
  });
  const service = new DepositCatalogue(adapter, async () => []);
  const revision = (await service.adminCatalogue()).revision;
  methods.length = 0;
  await assert.rejects(service.save(eth, revision), /Save outcome unknown/);
  assert.deepEqual(methods, ['GET', 'PUT', 'GET']);
  const refreshed = await service.adminCatalogue();
  assert.equal(refreshed.revision, String(BigInt(revision) + 1n));
  assert.equal(refreshed.entries.find(e => e.assetId === eth.assetId).address, eth.address);
});
test('failure before commit plus reconciliation outage remains unknown and never retries PUT', async () => {
  let reads = 0, puts = 0;
  const store = { read: async () => { if (++reads > 1) throw new Error('offline'); return current(); }, replace: async () => { puts++; throw new Error('offline'); } };
  const service = new DepositCatalogue(store, async () => []), revision = (await current()).revision;
  await assert.rejects(service.save(eth, revision), /Save outcome unknown/);
  assert.equal(reads, 2); assert.equal(puts, 1); assert.equal((await current()).revision, revision);
});
test('public/admin responses never include store token, storage URL or baseline metadata', async () => {
  const service = new DepositCatalogue(new CloudflareCatalogueStore(endpoint, token, transport), async () => []);
  for (const body of [await service.publicCatalogue(), await service.adminCatalogue()]) {
    const json = JSON.stringify(body); assert.ok(!json.includes(token)); assert.ok(!json.includes(endpoint)); assert.ok(!json.includes('baseline'));
  }
});
test('missing Worker secret fails closed before using the Durable Object binding', async () => {
  const m = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
    durableObjects: { RECEIVING_ADDRESS_CATALOGUE: { className: 'ReceivingAddressCatalogueDO', useSQLite: true } } }), telemetry: { enabled: false } });
  try { assert.equal((await m.dispatchFetch(endpoint)).status, 503); } finally { await m.dispose(); }
});
const publicUrl = 'https://local/public/deposit-catalogue';
const tron = { assetId: 'tether', networkId: 'tron', address: 'T' + 'A'.repeat(33), enabled: true, memo: '', memoLabel: '' };
const btcOff = { assetId: 'bitcoin', networkId: 'bitcoin', address: 'bc1q' + 'a'.repeat(38), enabled: false, memo: '', memoLabel: '' };
test('public read: active entries only, byte-identical to the Render answer, no secret, no write path', async () => {
  const revision = (await current()).revision;
  const doc = { schemaVersion: 1, baseline: [eth, tron, btcOff], overrides: [{ ...tron, enabled: false, address: '' }] };
  assert.equal((await request('PUT', doc, revision)).status, 200);
  const r = await mf.dispatchFetch(publicUrl);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'no-cache');
  const text = await r.text(), body = JSON.parse(text);
  assert.deepEqual(body.entries.map(e => `${e.asset}/${e.networkId}`), ['ETH/ethereum']);
  const render = await new DepositCatalogue(new CloudflareCatalogueStore(endpoint, token, transport), async () => []).publicCatalogue();
  assert.deepEqual(body, render);
  assert.equal(r.headers.get('ETag'), `"${render.version}"`);
  for (const secret of [token, 'baseline', 'overrides', 'status', 'bc1q', 'revision']) assert.ok(!text.includes(secret), secret);
  // Conditional re-open: unchanged catalogue costs a 304.
  assert.equal((await mf.dispatchFetch(publicUrl, { headers: { 'If-None-Match': `"${render.version}"` } })).status, 304);
  // Nothing on the public path writes, even with the store secret.
  for (const method of ['PUT', 'POST', 'DELETE', 'PATCH']) {
    const w = await mf.dispatchFetch(publicUrl, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': revision }, body: JSON.stringify(doc) });
    assert.equal(w.status, 405, method);
  }
  assert.equal((await mf.dispatchFetch(`${publicUrl}?all=1`)).status, 404);
  assert.equal((await current()).revision, String(BigInt(revision) + 1n));
});
test('public read CORS: allow-listed origins only; the private store stays secret-only and CORS-free', async () => {
  const allowed = await mf.dispatchFetch(publicUrl, { headers: { Origin: 'https://voltextech.net' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://voltextech.net');
  assert.match(allowed.headers.get('Vary'), /Origin/);
  for (const origin of ['https://evil.example', 'null', 'https://voltextech.net.evil.example', 'http://voltextech.net']) {
    const denied = await mf.dispatchFetch(publicUrl, { headers: { Origin: origin } });
    assert.equal(denied.status, 403, origin); assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  }
  const preflight = await mf.dispatchFetch(publicUrl, { method: 'OPTIONS', headers: { Origin: 'https://www.voltextech.net', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET');
  const privateRead = await mf.dispatchFetch(endpoint, { headers: { Origin: 'https://voltextech.net' } });
  assert.equal(privateRead.status, 403); assert.equal(privateRead.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await mf.dispatchFetch(endpoint)).status, 401);
});
test('public read: configured origin list replaces the defaults; missing secret fails closed', async () => {
  const m = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
    bindings: { PUBLIC_CATALOGUE_ORIGINS: 'http://127.0.0.1:4173, https://staging.voltextech.net' },
    durableObjects: { RECEIVING_ADDRESS_CATALOGUE: { className: 'ReceivingAddressCatalogueDO', useSQLite: true } } }), telemetry: { enabled: false } });
  try {
    assert.equal((await m.dispatchFetch(publicUrl, { headers: { Origin: 'https://voltextech.net' } })).status, 403);
    assert.equal((await m.dispatchFetch(publicUrl, { headers: { Origin: 'http://127.0.0.1:4173' } })).status, 503);
  } finally { await m.dispose(); }
});
test('no egress, idle triggers, financial/Prisma dependency or secret in frontend', async () => {
  assert.equal(outbound, 0);
  const source = await readFile(new URL('./src/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:alarm|scheduled|setInterval|setTimeout|Prisma|Balance|DepositEvent)\b/);
  assert.doesNotMatch(bundle.outputFiles[0].text, /@prisma\/client|Neon|DepositService/);
  const frontend = await readFile(new URL('../../frontend/src/lib/depositCatalogue.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(frontend, /DEPOSIT_CATALOGUE_STORE_TOKEN|VITE_.*TOKEN/);
  assert.match(frontend, /Не удалось подтвердить сохранение/);
});
