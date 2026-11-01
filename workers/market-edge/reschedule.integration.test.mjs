// Real workerd/SQLite persistence; every clock/data value confined to this disposable store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('atomic date-only reschedule: CAS, double clicks, audit, restart, public cache and history fence', async () => {
  const persist = await mkdtemp(join(tmpdir(), 'voltex-reschedule-'));
  const token = 'local-disposable-reschedule-store-0001';
  let mf;
  const start = async now => {
    const bundle = await build({ entryPoints: ['src/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'],
      define: { 'Date.now': '__qaNow' }, banner: { js: `const __qaNow=()=>${Date.parse(now)};` } });
    return new Miniflare({ ...convertV4MiniflareOptions({ durableObjectsPersist: persist, workers: [{ name: 'reschedule', modules: true, script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-09-01', bindings: { LISTINGS_STORE_TOKEN: token, LISTINGS_PUBLIC_CACHE_MS: '0' },
      durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } }, outboundService: () => { throw Error('external request forbidden'); } }] }),
      isolatedResourcePersistencePath: persist, resourcePersistencePath: persist, telemetry: { enabled: false }, host: '127.0.0.1', port: 8799 });
  };
  const call = (path, body, headers = {}) => mf.dispatchFetch('https://local/internal/listings'+path, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'X-Voltex-Admin-Id': 'qa-admin', 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const rows = async () => (await (await call('')).json()).listings;
  const create = async (id, config) => {
    const r = await mf.dispatchFetch(`https://local/internal/listings/${id}/draft`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`,
      'X-Voltex-Admin-Id': 'qa-admin', 'Content-Type': 'application/json', 'If-Match': '0' }, body: JSON.stringify({ config }) });
    assert.equal(r.status, 200, await r.clone().text());
  };
  const config = { schemaVersion: 1, symbol: 'ZZQ', name: 'QA Demo', logo: null, initialPrice: '1', listingAt: '2026-11-15T13:00:00Z',
    displayTimeZone: 'Europe/Kyiv', ownerAllocation: '0', seedMode: 'manual', seed: 'qa-reschedule-stable', tradable: false };
  try {
    mf = await start('2026-11-01T05:00:00Z');
    await create('demo-one', config);
    await create('demo-sibling', { ...config, symbol: 'ZZR', seed: 'sibling-fixed' });
    assert.equal((await call('/demo-one/publish', { draftRevision: 1, publishKey: 'reschedule-publish-0001', countdown: 'staged' })).status, 200);
    assert.equal((await call('/demo-one/countdown', { action: 'start' })).status, 200);
    const before = (await rows()).find(x => x.id === 'demo-one');
    const sibling = (await rows()).find(x => x.id === 'demo-sibling');
    const body = { days: 1, draftRevision: 1, activeVersion: 1, operationKey: 'date-operation-000001' };
    assert.equal((await call('/demo-one/reschedule', body, { Authorization: 'Bearer bad' })).status, 401);
    assert.equal((await call('/demo-one/reschedule', { ...body, days: 5 })).status, 400);
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => call('/demo-one/reschedule', body)));
    assert.ok(concurrent.every(r => r.status === 200));
    const receipts = await Promise.all(concurrent.map(r => r.json()));
    assert.equal(receipts.filter(r => !r.replayed).length, 1);
    let moved = (await rows()).find(x => x.id === 'demo-one');
    assert.equal(moved.active.listingAt, '2026-11-16T13:00:00Z');
    assert.equal(moved.activeVersion, 2); assert.equal(moved.draftRevision, 2);
    assert.deepEqual(moved.countdown, before.countdown);
    assert.deepEqual({ ...moved.active, listingAt: config.listingAt }, before.active);
    assert.equal((await call('/demo-one/reschedule', { ...body, operationKey: 'other-operation-0001' })).status, 409);
    assert.equal((await call('/demo-one/reschedule', { ...body, days: 2 })).status, 409);
    const oldVersion = await (await call('/demo-one/versions/1')).json();
    assert.deepEqual(oldVersion.config, before.active);
    for (const days of [2, 3]) {
      const r = await call('/demo-one/reschedule', { days, draftRevision: moved.draftRevision, activeVersion: moved.activeVersion, operationKey: `next-operation-0000${days}` });
      assert.equal(r.status, 200, await r.clone().text()); moved = (await rows()).find(x => x.id === 'demo-one');
    }
    assert.equal(moved.active.listingAt, '2026-11-21T13:00:00Z');
    const pub = await (await mf.dispatchFetch('https://local/market/test-assets/ZZQ-USDT')).json();
    assert.equal(Date.parse(pub.listingAt), Date.parse(moved.active.listingAt));
    assert.deepEqual((await rows()).find(x => x.id === 'demo-sibling'), sibling);
    await mf.dispose(); mf = await start('2026-11-01T06:00:00Z');
    assert.deepEqual((await rows()).find(x => x.id === 'demo-one'), moved);
    assert.equal((await (await call('/demo-one/reschedule', body)).json()).replayed, true);
    await mf.dispose(); mf = await start('2026-11-21T13:00:00Z');
    assert.equal((await call('/demo-one/reschedule', { days: 1, draftRevision: moved.draftRevision, activeVersion: moved.activeVersion, operationKey: 'too-late-operation-01' })).status, 422);
    assert.deepEqual((await rows()).find(x => x.id === 'demo-one'), moved);
  } finally { await mf?.dispose(); }
});
