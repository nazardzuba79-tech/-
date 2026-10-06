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
let sharedCoreBundle;
const freshCore = () => {
  const module = { exports: {} };
  // A fresh module has a fresh simulation cache, as a restarted API would.
  new Function('module', 'exports', sharedCoreBundle)(module, module.exports);
  return module.exports;
};

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
  const shared = await build({ stdin: {
    contents: `export { defaultScenarioControls } from './src/shared/listingScenarioControls';
      export { listingScenarioPreview } from './src/services/listings/listingPreview';
      export { listingSimulationConfig } from './src/services/listings/listingConfig';
      export { testMarketCandles } from './src/services/testMarkets/testMarketService';`,
    resolveDir: new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), loader: 'ts',
  }, bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022' });
  sharedCoreBundle = shared.outputFiles[0].text;
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
  const saved = await created.json();
  assert.equal(saved.draftRevision, 1);
  assert.equal(saved.draft.simulationProfile, 'CALM_TREND');
  assert.equal(saved.draft.wickModel, 'NATURAL_V1');
  assert.equal((await saveDraft('qax', config({ name: 'Other' }), 0)).status, 409);
  const list = await (await admin('/internal/listings')).json();
  assert.equal(list.listings[0].draft.name, 'QA Example');
  assert.equal(list.listings[0].draft.wickModel, 'NATURAL_V1');
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
  const unknownModel = await saveDraft('bad', config({ wickModel: 'NATURAL_V2' }), 0);
  assert.equal(unknownModel.status, 422);
  assert.equal((await unknownModel.json()).error, 'INVALID_CONFIG');
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

test('publish: stale revision refused, past time refused, then atomic version 1; same key or an unchanged draft is idempotent', async () => {
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
  // Another tab publishing the unchanged draft with its own key: still version 1, not a duplicate.
  const other = await (await publish('qax', goodRev, 'publish-key-000000004')).json();
  assert.deepEqual([other.version, other.replayed], [1, true]);
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

const profiles = async () => Object.fromEntries((await (await admin('/internal/listings')).json()).listings
  .map((l) => [l.id, [l.draft.simulationProfile, l.active?.simulationProfile ?? null]]));
const wickModels = async () => Object.fromEntries((await (await admin('/internal/listings')).json()).listings
  .map((l) => [l.id, [l.draft.wickModel, l.active?.wickModel ?? null]]));

test('simulation profiles rotate by creation order and never change afterwards', async () => {
  // qax was listing #1 and qbx #2; the refused and duplicate attempts above spent no ordinal.
  assert.deepEqual(await profiles(), { qax: ['CALM_TREND', 'CALM_TREND'], qbx: ['IMPULSE_TREND', 'IMPULSE_TREND'] });
  assert.deepEqual(await wickModels(), { qax: ['NATURAL_V1', 'NATURAL_V1'], qbx: ['NATURAL_V1', 'NATURAL_V1'] });
  for (const [id, symbol] of [['qcx', 'QCX'], ['qdx', 'QDX'], ['qex', 'QEX']]) {
    // A request that names a profile is ignored: the rotation decides.
    assert.equal((await saveDraft(id, config({ symbol, simulationProfile: 'CALM_TREND', wickModel: 'NATURAL_V1' }), 0)).status, 200);
  }
  const listing = (await (await admin('/internal/listings')).json()).listings.find((l) => l.id === 'qcx');
  // Omitting the wick model on edit cannot remove the stored choice.
  const edit = await saveDraft('qcx', config({ symbol: 'QCX', name: 'Edited', simulationProfile: 'COMPRESSION_BREAKOUT' }), listing.draftRevision);
  assert.equal(edit.status, 200);
  const edited = await edit.json();
  assert.equal(edited.draft.wickModel, 'NATURAL_V1');
  const unknownModel = await saveDraft('qcx', config({ symbol: 'QCX', wickModel: 'NATURAL_V2' }), edited.draftRevision);
  assert.equal(unknownModel.status, 422);
  assert.equal((await unknownModel.json()).error, 'INVALID_CONFIG');
  assert.equal((await (await admin('/internal/listings')).json()).listings.find((l) => l.id === 'qcx').draftRevision, edited.draftRevision);
  assert.deepEqual(await profiles(), {
    qax: ['CALM_TREND', 'CALM_TREND'], qbx: ['IMPULSE_TREND', 'IMPULSE_TREND'],
    qcx: ['PULLBACK_TREND', null], qdx: ['COMPRESSION_BREAKOUT', null], qex: ['CALM_TREND', null],
  });
  assert.deepEqual(await wickModels(), {
    qax: ['NATURAL_V1', 'NATURAL_V1'], qbx: ['NATURAL_V1', 'NATURAL_V1'],
    qcx: ['NATURAL_V1', null], qdx: ['NATURAL_V1', null], qex: ['NATURAL_V1', null],
  });
  // The public catalogue shape is unchanged: no profile in it.
  assert.ok(!JSON.stringify(await catalogue()).includes('_TREND'));
  assert.ok(!JSON.stringify(await catalogue()).includes('wickModel'));
});

test('whole workerd restart keeps drafts, versions and the active configuration', async () => {
  const before = await (await admin('/internal/listings')).json();
  const publicBefore = (await catalogue()).assets.map((a) => [a.pair, a.version, a.name]);
  const profilesBefore = await profiles();
  const modelsBefore = await wickModels();
  await mf.dispose();
  mf = new Miniflare(options);
  const after = await (await admin('/internal/listings')).json();
  assert.deepEqual(after.listings.map((l) => [l.id, l.draftRevision, l.activeVersion]), before.listings.map((l) => [l.id, l.draftRevision, l.activeVersion]));
  assert.deepEqual((await catalogue()).assets.map((a) => [a.pair, a.version, a.name]), publicBefore);
  // Profiles survive the restart, and the rotation continues where it stopped (#6 = IMPULSE_TREND).
  assert.deepEqual(await profiles(), profilesBefore);
  assert.deepEqual(await wickModels(), modelsBefore);
  const created = await (await saveDraft('qfx', config({ symbol: 'QFX' }), 0)).json();
  assert.equal(created.draft.simulationProfile, 'IMPULSE_TREND');
  assert.equal(created.draft.wickModel, 'NATURAL_V1');
});

test('the existing NRX edge is untouched and calls out to nothing', async () => {
  const before = outbound;
  const nrx = await (await pub('/market/nrx')).json();
  assert.equal(nrx.assets[0].pair, 'NRX/USDT');
  assert.equal(outbound, before);
});

test('Render registry route returns published configs with the seed only behind the Bearer secret', async () => {
  const internal = await (await admin('/internal/listings/published')).json();
  assert.ok(internal.listings.every((l) => typeof l.config.seed === 'string'));
  assert.equal((await admin('/internal/listings/published', { headers: { Authorization: '' } })).status, 401);
  assert.ok(!JSON.stringify(await catalogue()).includes('qax-20261001-synthetic'));
});

test('bounded AITH demo stays private until publish and its program survives DO restart and UI saves', async () => {
  const program={kind:'capped-growth-range-v1',first24hGainPercent:1725,maxGainPercent:9247,peakAfterHours:168,rangeFraction:.12};
  const cfg=config({symbol:'AITH',name:'Aitheron AI',initialPrice:'0.80',tradable:false,ownerAllocation:'0',
    listingAt:'2026-10-11T15:00:00Z',simulationProgram:program});
  const saved=await saveDraft('aith-demo',cfg,0);
  assert.equal(saved.status,200);
  assert.ok(!(await catalogue()).assets.some(a=>a.symbol==='AITH'),'no draft countdown');
  let detail=await saved.json();
  assert.deepEqual(detail.draft.simulationProgram,program);
  await mf.dispose(); mf=new Miniflare(options);
  detail=(await (await admin('/internal/listings')).json()).listings.find(l=>l.id==='aith-demo');
  assert.deepEqual(detail.draft.simulationProgram,program);
  const {simulationProgram,...ui}=cfg;
  assert.equal((await saveDraft('aith-demo',{...ui,tradable:true},detail.draftRevision)).status,422);
  const revised=await (await saveDraft('aith-demo',ui,detail.draftRevision)).json();
  assert.deepEqual(revised.draft.simulationProgram,program);
  assert.equal((await publish('aith-demo',revised.draftRevision,'aith-demo-publish-test-0001')).status,200);
  const row=(await catalogue()).assets.find(a=>a.symbol==='AITH');
  assert.equal(row.listingArmed,true); assert.equal(row.isTradable,false);
  assert.equal(row.state.lastPrice,null);
  const registry=await (await admin('/internal/listings/published')).json();
  assert.deepEqual(registry.listings.find(l=>l.id==='aith-demo').config.simulationProgram,program);
});

test('v2 full persistence lifecycle: editable draft, actual preview, restart, publish and immutable canonical history', async () => {
  const initialCore = freshCore();
  const program = initialCore.defaultScenarioControls('0.80', 'WAVES');
  const cfg = config({ symbol: 'QSC', name: 'Scenario QA', initialPrice: '0.80', tradable: false,
    listingAt: new Date(Math.ceil((Date.now() + 3_600_000) / 60_000) * 60_000).toISOString(),
    ownerAllocation: '0', simulationProgram: program });
  const beforeOutbound = outbound;
  let response = await saveDraft('qsc-scenario', cfg, 0);
  assert.equal(response.status, 200, await response.clone().text());
  let saved = await response.json();
  assert.deepEqual(saved.draft.simulationProgram, program);
  assert.equal((await saveDraft('qsc-scenario', cfg, 0)).status, 409, 'repeat create cannot duplicate');
  assert.equal((await saveDraft('qsc-duplicate', cfg, 0)).status, 409, 'same ticker cannot duplicate');
  assert.ok(!(await catalogue()).assets.some(a => a.symbol === 'QSC'), 'saving never arms a countdown');

  const editedProgram = { ...program, scenario: 'LONG_WICKS',
    pullbacks: { frequency: 'often', minDepthPercent: '4', maxDepthPercent: '12', durationMinutes: 90 },
    wicks: { length: 'pronounced', longFrequency: 'often' },
    candles: { intensity: 'high', diversity: .85, pauseFrequency: 'often' } };
  response = await saveDraft('qsc-scenario', { ...cfg, simulationProgram: editedProgram }, saved.draftRevision);
  assert.equal(response.status, 200);
  saved = await response.json();
  assert.deepEqual(saved.draft.simulationProgram, editedProgram, 'old profile pinning must not discard edited controls');
  const preview = initialCore.listingScenarioPreview(saved.draft, '1h', 'growth');
  assert.ok(preview.candles.length > 24 && preview.candles.length <= 360);
  assert.ok(preview.candles.every(c => c.high <= 74.776));
  assert.equal(preview.scenarioSummary.first24hPrice, '14.6');

  await mf.dispose(); mf = new Miniflare(options);
  let detail = (await (await admin('/internal/listings')).json()).listings.find(l => l.id === 'qsc-scenario');
  assert.deepEqual(detail.draft.simulationProgram, editedProgram);
  assert.equal(detail.activeVersion, null);
  const restartedCore = freshCore();
  assert.deepEqual(restartedCore.listingScenarioPreview(detail.draft, '1h', 'growth'), preview);
  const invalid = { ...detail.draft, simulationProgram: { ...editedProgram,
    pullbacks: { ...editedProgram.pullbacks, minDepthPercent: '20', maxDepthPercent: '10' } } };
  response = await saveDraft('qsc-scenario', invalid, detail.draftRevision);
  assert.equal(response.status, 422);
  assert.equal((await (await admin('/internal/listings')).json()).listings.find(l => l.id === 'qsc-scenario').draftRevision, detail.draftRevision);
  assert.equal((await saveDraft('qsc-scenario', { ...detail.draft, tradable: true }, detail.draftRevision)).status, 422);

  const publication = await (await publish('qsc-scenario', detail.draftRevision, 'qsc-publish-fixture-0001')).json();
  assert.equal(publication.version, 1);
  const replay = await (await publish('qsc-scenario', detail.draftRevision, 'qsc-publish-fixture-0001')).json();
  assert.equal(replay.version, 1); assert.equal(replay.replayed, true);
  const published = (await (await admin('/internal/listings/published')).json()).listings.find(l => l.id === 'qsc-scenario');
  assert.deepEqual(published.config.simulationProgram, editedProgram);
  const asset = restartedCore.listingSimulationConfig(published.config);
  assert.equal(asset.isTradable, false);
  assert.deepEqual(restartedCore.testMarketCandles(asset, '1h', preview.scenarioSummary.to, preview.candles.length), preview.candles);
  assert.equal((await catalogue()).assets.find(a => a.symbol === 'QSC').isTradable, false);

  const forbiddenEdit = await saveDraft('qsc-scenario', { ...detail.draft,
    simulationProgram: { ...editedProgram, scenario: 'CALM' } }, detail.draftRevision);
  assert.equal(forbiddenEdit.status, 422);
  assert.equal((await forbiddenEdit.json()).error, 'HISTORY_LOCKED');
  detail = (await (await admin('/internal/listings')).json()).listings.find(l => l.id === 'qsc-scenario');
  assert.deepEqual(detail.draft.simulationProgram, editedProgram);
  assert.deepEqual(detail.active.simulationProgram, editedProgram);
  assert.equal(detail.versions.length, 1);
  assert.equal(outbound, beforeOutbound, 'no external/financial calls anywhere in lifecycle');
});

test('v2 automatic scenario is persisted once; missing controls cannot silently downgrade it; legacy history cannot upgrade', async () => {
  const cfg = config({ symbol: 'QAU', name: 'Automatic QA', initialPrice: '0.80', tradable: false,
    listingAt: new Date(Math.ceil((Date.now() + 3_600_000) / 60_000) * 60_000).toISOString(),
    ownerAllocation: '0', simulationProgram: freshCore().defaultScenarioControls('0.80', 'AUTO') });
  const created = await (await saveDraft('qau-scenario', cfg, 0)).json();
  assert.notEqual(created.draft.simulationProgram.scenario, 'AUTO');
  const repeated = await (await saveDraft('qau-scenario', cfg, created.draftRevision)).json();
  assert.equal(repeated.draft.simulationProgram.scenario, created.draft.simulationProgram.scenario);
  const { simulationProgram: omitted, ...without } = repeated.draft;
  assert.equal((await saveDraft('qau-scenario', without, repeated.draftRevision)).status, 422);
  const legacy = (await (await admin('/internal/listings')).json()).listings.find(l => l.id === 'qax');
  const upgrade = await saveDraft('qax', { ...legacy.draft, tradable: false,
    listingAt: new Date(Math.ceil(Date.parse(legacy.draft.listingAt) / 10_000) * 10_000).toISOString(),
    simulationProgram: freshCore().defaultScenarioControls(legacy.draft.initialPrice) }, legacy.draftRevision);
  assert.equal(upgrade.status, 422);
  assert.equal((await upgrade.json()).error, 'HISTORY_LOCKED');
  assert.equal((await (await admin('/internal/listings')).json()).listings.find(l => l.id === 'qax').draft.simulationProgram, undefined);
});

test('real public workerd candles match the saved private preview after publication and a whole-runtime restart', async () => {
  const published = (await (await admin('/internal/listings/published')).json()).listings.find(l => l.id === 'qsc-scenario');
  const preview = freshCore().listingScenarioPreview(published.config, '1h', 'afterGrowth');
  const fixedNow = preview.scenarioSummary.to;
  const outboundBefore = outbound;
  await mf.dispose();
  // Clock injection is limited to this disposable test bundle. No production
  // preview flag, endpoint or clock override is added to the actual Worker.
  const simulatedOptions = { ...options, workers: options.workers.map(worker => {
    const manifest = worker.config.manifest;
    const main = manifest.mainModule;
    return { ...worker, config: { ...worker.config, manifest: { ...manifest, modules: {
      ...manifest.modules, [main]: { ...manifest.modules[main],
        contents: `Date.now = () => ${fixedNow};\n${manifest.modules[main].contents}` },
    } } } };
  }) };
  mf = new Miniflare(simulatedOptions);
  const response = await pub(`/market/test-assets/QSC-USDT/candles?interval=1h&limit=${preview.candles.length}`);
  assert.equal(response.status, 200, await response.clone().text());
  const served = await response.json();
  assert.deepEqual(served.candles, preview.candles);
  assert.ok(served.candles.every(candle => candle.high <= 74.776));
  assert.equal(outbound, outboundBefore);
});
