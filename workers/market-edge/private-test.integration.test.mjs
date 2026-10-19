// History20 private test listings on the real market-edge Worker bundle, in
// workerd (Miniflare) with a persisted SQLite Durable Object: default off,
// never in the public catalogue or on a public pair path, only in Render's
// Bearer registry. Synthetic windows only; every external request is forbidden.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const token = 'synthetic-local-only-listings-secret-0002';
const base = 'https://market.local';
let mf, script, path, core, outbound = 0;

const at = (msFromNow) => new Date(Math.ceil((Date.now() + msFromNow) / 10_000) * 10_000).toISOString().replace('.000Z', 'Z');
const listingAt = at(3_600_000);
const start = (flag) => new Miniflare({ ...convertV4MiniflareOptions({ durableObjectsPersist: path, workers: [{ name: 'market-edge', modules: true, script,
  compatibilityDate: '2026-09-01',
  bindings: { LISTINGS_STORE_TOKEN: token, LISTINGS_PUBLIC_CACHE_MS: '0', ...(flag ? { HISTORY20_PRIVATE_SPOT_ENABLED: flag } : {}) },
  durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
  outboundService: () => { outbound++; throw new Error('Unexpected external request'); },
}] }), isolatedResourcePersistencePath: path, resourcePersistencePath: path, telemetry: { enabled: false } });
const admin = (p, { method = 'GET', body, ifMatch } = {}) => mf.dispatchFetch(`${base}${p}`, {
  method, headers: { Authorization: `Bearer ${token}`, 'X-Voltex-Admin-Id': 'admin-qa-1', 'Content-Type': 'application/json',
    ...(ifMatch !== undefined ? { 'If-Match': String(ifMatch) } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const saveDraft = (id, config, ifMatch) => admin(`/internal/listings/${id}/draft`, { method: 'PUT', body: { config }, ifMatch });
const publish = (id, draftRevision, publishKey) => admin(`/internal/listings/${id}/publish`, { method: 'POST', body: { draftRevision, publishKey } });
const pub = (p, init) => mf.dispatchFetch(`${base}${p}`, init);

function walk(days) {
  let x = 9, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
    const open = d ? price * (1 + (random() - .5) * .004) : 100, close = open * Math.exp(Math.log(80) / days + (random() - .5) * .1);
    price = close;
    return { date, open, high: Math.max(open, close) * 1.02, low: Math.min(open, close) * .98, close };
  });
}
const windowConfig = (symbol, seed, extra = {}) => {
  const growth = core.buildHistoricalGrowthProgram({ scenarioId: 'VHX-07-SOL', targetPeakGrowthPercent: '9348', rows: walk(40),
    source: { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'b'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } });
  return {
    schemaVersion: 1, symbol, name: `Window ${symbol}`, logo: null, initialPrice: '2', listingAt, displayTimeZone: 'UTC',
    ownerAllocation: '0', seedMode: 'manual', seed, tradable: false,
    simulationProgram: { ...core.defaultScenarioControls('2', 'CALM'), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
      historicalGrowth: growth, maxPrice: core.historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent) },
    ...extra,
  };
};
const privateTest = { settlement: 'SIMUSDT', funding: { base: '100', quote: '1000' } };
const draftRevision = async (id) => (await (await admin('/internal/listings')).json()).listings.find((l) => l.id === id).draftRevision;

before(async () => {
  const bundle = await build({ entryPoints: [new URL('./src/worker.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
  script = bundle.outputFiles[0].text;
  const shared = await build({ stdin: {
    contents: `export { defaultScenarioControls } from './src/shared/listingScenarioControls';
      export { buildHistoricalGrowthProgram, historicalGrowthMaxPrice } from './src/shared/listingHistoricalGrowth';`,
    resolveDir: new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), loader: 'ts',
  }, bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022' });
  const module = { exports: {} };
  new Function('module', 'exports', shared.outputFiles[0].text)(module, module.exports);
  core = module.exports;
  path = await mkdtemp(join(tmpdir(), 'voltex-private-listings-sqlite-'));
  mf = start(null);
});
after(async () => { await mf?.dispose(); });

test('default off: a private History20 draft saves, but its publish is refused without the Worker switch', async () => {
  assert.equal((await saveDraft('pvx-private', windowConfig('PVX', 'pvx-private-synthetic', { privateTest }), 0)).status, 200);
  const refused = await publish('pvx-private', await draftRevision('pvx-private'), 'publish-key-private-0001');
  assert.equal(refused.status, 422);
  assert.equal((await refused.json()).error, 'PRIVATE_TEST_DISABLED');
  assert.equal((await (await admin('/internal/listings/published')).json()).listings.length, 0);
});

test('switched on: the private listing publishes; the same window in public stays HISTORICAL_RIGHTS_UNVERIFIED', async () => {
  await mf.dispose(); mf = start('true');
  const first = await publish('pvx-private', await draftRevision('pvx-private'), 'publish-key-private-0002');
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal((await first.json()).version, 1);
  assert.equal((await saveDraft('pwx-public', windowConfig('PWX', 'pwx-public-synthetic'), 0)).status, 200);
  const refused = await publish('pwx-public', await draftRevision('pwx-public'), 'publish-key-public-00001');
  assert.equal((await refused.json()).error, 'HISTORICAL_RIGHTS_UNVERIFIED');
  // A legacy USDT listing publishes beside it as before.
  const legacy = { schemaVersion: 1, symbol: 'QAX', name: 'QA Example', logo: null, initialPrice: '0.25', listingAt, displayTimeZone: 'UTC',
    ownerAllocation: '1000', seedMode: 'manual', seed: 'qax-20261001-synthetic', tradable: true };
  assert.equal((await saveDraft('qax', legacy, 0)).status, 200);
  assert.equal((await publish('qax', await draftRevision('qax'), 'publish-key-legacy-00001')).status, 200);
});

test('never public: the catalogue and pair paths do not know it; Render\'s Bearer registry does', async () => {
  const catalogue = await (await pub('/market/listings')).json();
  assert.deepEqual(catalogue.assets.map((a) => a.pair), ['QAX/USDT']);
  assert.ok(!JSON.stringify(catalogue).includes('PVX') && !JSON.stringify(catalogue).includes('SIMUSDT'));
  for (const p of ['/market/test-assets/PVX-SIMUSDT', '/market/test-assets/PVX-SIMUSDT/candles', '/market/ticker/PVX-SIMUSDT',
    '/market/display/spot-book/PVX-SIMUSDT', '/market/test-assets/PVX-USDT', '/market/ticker/PVX-USDT']) {
    const r = await pub(p);
    const text = await r.text();
    assert.notEqual(r.status, 200, p);
    assert.ok(!text.includes('Window PVX') && !text.includes('pvx-private-synthetic'), p);
  }
  assert.equal((await pub('/market/test-assets/QAX-USDT')).status, 200);
  const registry = await (await admin('/internal/listings/published')).json();
  const entry = registry.listings.find((l) => l.id === 'pvx-private');
  assert.deepEqual(entry.config.privateTest, privateTest);
  assert.equal(entry.config.seed, 'pvx-private-synthetic');
  assert.equal((await pub('/internal/listings/published')).status, 401);
});

test('the mode is fixed once published: the private window cannot become public, nor change its funding', async () => {
  const { privateTest: _p, ...asPublic } = windowConfig('PVX', 'pvx-private-synthetic');
  const toPublic = await saveDraft('pvx-private', asPublic, await draftRevision('pvx-private'));
  assert.equal(toPublic.status, 422);
  const funding = await saveDraft('pvx-private', windowConfig('PVX', 'pvx-private-synthetic', { privateTest: { settlement: 'SIMUSDT', funding: { base: '100', quote: '9000' } } }), await draftRevision('pvx-private'));
  assert.equal(funding.status, 422);
  assert.equal((await funding.json()).error, 'HISTORY_LOCKED');
  // A whole-runtime restart keeps it private.
  await mf.dispose(); mf = start('true');
  assert.deepEqual((await (await pub('/market/listings')).json()).assets.map((a) => a.pair), ['QAX/USDT']);
});
