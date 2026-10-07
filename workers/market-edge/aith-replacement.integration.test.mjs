import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('AITH SQLite replacement drains leases, survives restart, preserves v1 and rejects stale/concurrent operations', async () => {
  const token = 'aith-replacement-fixture-secret-only';
  const root = new URL('../../', import.meta.url);
  const draft = JSON.parse(await readFile(new URL('config/test-markets/aith.draft.json', root), 'utf8'));
  const at = Date.parse(draft.listingAt) - 86400000;
  const bundle = await build({ stdin: { contents: `import worker, { ManagedListingsDO } from './src/worker';
    import { DurableObject } from 'cloudflare:workers';
    export default worker;
    // Test-only RPC wrapper permits read-only SQLite inspection; every request runs the real store.
    export class InspectableListingsDO extends DurableObject {
      constructor(ctx, env) { super(ctx, env); this.store = new ManagedListingsDO(ctx, env); }
      fetch(request) { return this.store.fetch(request); }
    }`, loader: 'ts', resolveDir: new URL('./', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
  const path = await mkdtemp(join(tmpdir(), 'aith-replacement-'));
  let mf;
  let outbound = 0;
  const restart = async (clock) => {
    await mf?.dispose();
    mf = new Miniflare({ ...convertV4MiniflareOptions({ unsafeInspectDurableObjects: true, durableObjectsPersist: path, workers: [{ name: 'market-edge', modules: true,
      // Fixed clock exists only in this disposable test bundle.
      script: `Date.now = () => ${clock};\n${bundle.outputFiles[0].text}`, compatibilityDate: '2026-09-01',
      bindings: { LISTINGS_STORE_TOKEN: token, LISTINGS_PUBLIC_CACHE_MS: '0' },
      durableObjects: { LISTINGS: { className: 'InspectableListingsDO', useSQLite: true } },
      outboundService: () => { outbound++; throw new Error('External network forbidden'); },
    }] }), isolatedResourcePersistencePath: path, resourcePersistencePath: path, telemetry: { enabled: false } });
  };
  const request = (path, body, headers = {}) => mf.dispatchFetch(`https://market.local${path}`, {
    method: body ? (path.endsWith('/draft') ? 'PUT' : 'POST') : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'X-Voltex-Admin-Id': 'fixture-admin', 'Content-Type': 'application/json',
      'X-Voltex-Listing-Protocol': 'aith-prelisting-v1', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const detail = async () => (await (await request('/internal/listings')).json()).listings.find(x => x.symbol === 'AITH');
  const replace = body => request('/internal/listings/aith-existing/replace-prelisting', body);
  const key = 'aith-replacement-fixture-0001';
  const catalogue = async () => (await (await request('/market/listings')).json()).assets;
  try {
    await restart(at);
    let r = await request('/internal/listings/aith-existing/draft', { config: { ...draft, initialPrice: '0.80' } }, { 'If-Match': '0' });
    assert.equal(r.status, 200, await r.clone().text());
    const saved = await r.json();
    r = await request('/internal/listings/aith-existing/publish', { draftRevision: saved.draftRevision, publishKey: 'aith-original-fixture-0001' });
    assert.equal(r.status, 200);
    const original = await detail();
    const history = async () => {
      const sql = await mf.unsafeGetDurableObjectStorage('market-edge', 'InspectableListingsDO', { name: 'voltex-managed-listings-v1' });
      return sql.exec('SELECT * FROM listing_version WHERE listing_id = ? AND version = 1', 'aith-existing');
    };
    const immutableV1 = await history();
    const auditV1 = await (await request('/internal/listings/aith-existing/versions/1')).json();
    assert.deepEqual(auditV1.config, original.active);
    assert.equal((await mf.dispatchFetch('https://market.local/internal/listings/aith-existing/versions/1')).status, 401);
    const active = { ...original.active, initialPrice: '2.00', simulationProfile: 'COMPRESSION_BREAKOUT' };
    assert.equal((await catalogue())[0].initialPrice, .8);
    const oldPublic = (await catalogue())[0];
    assert.equal(oldPublic.readLease.generation, 1);
    assert.equal((await request('/internal/listings/aith-existing/draft', { config: active }, { 'If-Match': '1' })).status, 422);
    const prepare = { phase: 'prepare', operationKey: key, expectedVersion: 1, draftRevision: 1, config: active };
    const results = await Promise.all([replace(prepare), replace({ ...prepare, operationKey: 'aith-competing-fixture-0002' })]);
    assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
    const pending = await results[0].json();
    assert.equal(pending.phase, 'PREPARED');
    assert.ok(pending.notBefore > oldPublic.readLease.expiresAt);
    assert.equal((await catalogue()).length, 0);
    assert.equal((await request('/market/test-assets/AITH-USDT')).status, 503);
    assert.equal((await replace({ phase: 'commit', operationKey: key })).status, 409);
    await restart(pending.notBefore);
    assert.equal((await catalogue()).length, 0, 'freeze persists across restart');
    r = await replace({ phase: 'commit', operationKey: key });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).version, 2);
    const after = await detail();
    assert.equal(after.activeVersion, 2);
    assert.equal(after.versions.length, 2);
    assert.deepEqual(after.versions.find(x => x.version === 1), original.versions[0]);
    assert.deepEqual(after.active, active);
    assert.deepEqual(after.draft, active);
    assert.equal((await catalogue())[0].initialPrice, 2);
    assert.equal((await catalogue())[0].isTradable, false);
    assert.equal((await request('/market/test-assets/AITH-USDT/candles?listingVersion=1')).status, 409);
    assert.deepEqual((await (await request('/market/test-assets/AITH-USDT/candles?listingVersion=2')).json()).candles, []);
    assert.equal((await (await replace({ phase: 'commit', operationKey: key })).json()).replayed, true);
    await restart(pending.notBefore + 1);
    assert.equal((await catalogue())[0].version, 2);
    assert.equal((await detail()).versions.length, 2);
    assert.deepEqual(await history(), immutableV1, 'every original immutable history byte and audit field is retained');
    assert.deepEqual(await (await request('/internal/listings/aith-existing/versions/1')).json(), auditV1);
    assert.equal(outbound, 0);
  } finally { await mf?.dispose(); }
});
