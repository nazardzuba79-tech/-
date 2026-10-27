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
    // The timer tests below watch a listing date pass: the lead is lowered to the 5 s floor (production keeps 60 s).
    bindings: { LISTINGS_STORE_TOKEN: token, LISTINGS_PUBLIC_CACHE_MS: '0', LISTINGS_MIN_LEAD_MS: '5000' },
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
  // A listing about to be published must be in the future. Use the existing
  // rounded-time fixture helper rather than a date that expires in CI.
  const cfg=config({symbol:'AITH',name:'Aitheron AI',initialPrice:'0.80',tradable:false,ownerAllocation:'0',
    listingAt:iso(3_600_000),simulationProgram:program});
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

/* ---- The pre-listing timer: staged → running → paused → stopped by server time; the listing date never moves with it. ---- */
const countdown = (id, action) => admin(`/internal/listings/${id}/countdown`, { method: 'POST', body: { action } });
const publishWith = (id, draftRevision, publishKey, extra) => admin(`/internal/listings/${id}/publish`, { method: 'POST', body: { draftRevision, publishKey, ...extra } });
const internalPublished = async () => (await (await admin('/internal/listings/published')).json()).listings;
const adminListing = async (id) => (await (await admin('/internal/listings')).json()).listings.find((l) => l.id === id);
const catalogueAsset = async (pair) => (await catalogue()).assets.find((a) => a.pair === pair) ?? null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('timer: a first publication with countdown=staged is validated and stored, but not public; Render knows it unarmed', async () => {
  // The previous test left a Worker with a frozen clock; the timer is about the real server clock.
  await mf.dispose();
  mf = new Miniflare(options);
  const draft = await (await saveDraft('qtm', config({ symbol: 'QTM', name: 'QA Timer', seed: 'qtm-20261026-synthetic', listingAt: iso(5 * 86_400_000), displayTimeZone: 'Europe/Moscow' }), 0)).json();
  const first = await publishWith('qtm', draft.draftRevision, 'publish-key-0000000t01', { countdown: 'staged' });
  assert.equal(first.status, 200, JSON.stringify([draft, await first.clone().text()]));
  const receipt = await first.json();
  assert.deepEqual([receipt.version, receipt.replayed, receipt.countdown.state], [1, false, 'staged']);
  // Not public: not in the catalogue, no pair path answers listing data.
  assert.equal(await catalogueAsset('QTM/USDT'), null);
  for (const path of ['/market/test-assets/QTM-USDT', '/market/test-assets/QTM-USDT/candles', '/market/ticker/QTM-USDT']) {
    const r = await pub(path);
    assert.notEqual(r.status, 200, path);
    assert.ok(!(await r.text()).includes('QA Timer'), path);
  }
  // Render's registry sees it with its timer state, so the ticker is restricted everywhere and the gate stays closed.
  const internal = (await internalPublished()).find((l) => l.id === 'qtm');
  assert.equal(internal.countdown.state, 'staged');
  assert.equal(internal.config.seed, 'qtm-20261026-synthetic');
  assert.equal((await adminListing('qtm')).countdown.state, 'staged');
  // The same publish key again is the same publication, still staged.
  const again = await (await publishWith('qtm', draft.draftRevision, 'publish-key-0000000t01', { countdown: 'staged' })).json();
  assert.deepEqual([again.version, again.replayed, again.countdown.state], [1, true, 'staged']);
  // A listing published before the timer existed has no timer state and is public at once.
  assert.equal((await adminListing('qax')).countdown, null);
  assert.ok(!('countdown' in (await internalPublished()).find((l) => l.id === 'qax')));
  assert.deepEqual([(await catalogueAsset('QAX/USDT')).listingArmed, (await catalogueAsset('QAX/USDT')).countdown], [true, 'running']);
});

test('timer: start shows the countdown publicly and is idempotent; pause keeps the date without a countdown; stop hides the market again', async () => {
  const revisionBefore = (await catalogue()).revision;
  const startResponse = await countdown('qtm', 'start');
  assert.equal(startResponse.status, 200, await startResponse.clone().text());
  const started = await startResponse.json();
  assert.deepEqual([started.changed, started.countdown.state, typeof started.countdown.startedAt], [true, 'running', 'number']);
  const running = await catalogueAsset('QTM/USDT');
  assert.ok(running, 'public after start');
  assert.deepEqual([running.listingArmed, running.countdown, running.state.phase, running.displayTimeZone], [true, 'running', 'pre-listing', 'Europe/Moscow']);
  assert.equal((await pub('/market/test-assets/QTM-USDT')).status, 200);
  assert.notEqual((await catalogue()).revision, revisionBefore);
  // A double click: the same state, nothing bumped.
  const revisionAfterStart = (await catalogue()).revision;
  const twice = await (await countdown('qtm', 'start')).json();
  assert.deepEqual([twice.changed, twice.countdown.startedAt], [false, started.countdown.startedAt]);
  assert.equal((await catalogue()).revision, revisionAfterStart);

  const paused = await (await countdown('qtm', 'pause')).json();
  assert.deepEqual([paused.changed, paused.countdown.state, paused.countdown.startedAt], [true, 'paused', started.countdown.startedAt]);
  const shown = await catalogueAsset('QTM/USDT');
  assert.deepEqual([shown.listingArmed, shown.countdown, shown.state.phase, shown.state.lastPrice], [false, 'paused', 'pre-listing', null]);
  assert.equal(shown.listingAt, running.listingAt, 'the date never moves with the timer');
  assert.equal((await pub('/market/ticker/QTM-USDT')).status, 404);
  assert.equal((await (await pub('/market/display/spot-book/QTM-USDT')).json()).available, false);

  const stopped = await (await countdown('qtm', 'stop')).json();
  assert.deepEqual([stopped.changed, stopped.countdown.state], [true, 'staged']);
  assert.equal(await catalogueAsset('QTM/USDT'), null);
  assert.equal((await internalPublished()).find((l) => l.id === 'qtm').countdown.state, 'staged');
  // Started again: the countdown is back, to the same date.
  assert.equal((await (await countdown('qtm', 'start')).json()).countdown.state, 'running');
  assert.equal((await catalogueAsset('QTM/USDT')).listingAt, running.listingAt);
});

test('timer: a passed date never activates anything — start is refused until the date is moved; an opened market keeps no timer', async () => {
  // Two listings 6 s ahead: one staged (timer never started), one published the old way (running).
  const staged = await (await saveDraft('qtp', config({ symbol: 'QTP', name: 'QA Timer Passed', seed: 'qtp-20261026-synthetic', listingAt: iso(6_000) }), 0)).json();
  assert.equal((await publishWith('qtp', staged.draftRevision, 'publish-key-0000000t02', { countdown: 'staged' })).status, 200);
  const open = await (await saveDraft('qto', config({ symbol: 'QTO', name: 'QA Timer Open', seed: 'qto-20261026-synthetic', listingAt: iso(6_000) }), 0)).json();
  assert.equal((await publish('qto', open.draftRevision, 'publish-key-0000000t03')).status, 200);
  await sleep(8_000);
  // The staged one: nothing opened, nothing is public, and starting is refused with the reason.
  const refused = await countdown('qtp', 'start');
  assert.equal(refused.status, 422);
  assert.equal((await refused.json()).error, 'LISTING_TIME_PAST');
  assert.equal(await catalogueAsset('QTP/USDT'), null);
  assert.equal((await internalPublished()).find((l) => l.id === 'qtp').countdown.state, 'staged');
  // Its date may still move (the market never opened), published as version 2; then the timer starts.
  const listing = await adminListing('qtp');
  const moved = await saveDraft('qtp', config({ symbol: 'QTP', name: 'QA Timer Passed', seed: 'qtp-20261026-synthetic', listingAt: iso(3_600_000) }), listing.draftRevision);
  assert.equal(moved.status, 200);
  const republished = await (await publishWith('qtp', (await moved.json()).draftRevision, 'publish-key-0000000t04', {})).json();
  assert.deepEqual([republished.version, republished.countdown.state], [2, 'staged']);
  assert.equal((await (await countdown('qtp', 'start')).json()).countdown.state, 'running');
  assert.equal((await catalogueAsset('QTP/USDT')).state.phase, 'pre-listing');
  // The old-way one opened at its time: live publicly, its timer cannot be paused or stopped, its date is locked.
  assert.equal((await catalogueAsset('QTO/USDT')).state.phase, 'live');
  for (const action of ['pause', 'stop']) {
    const r = await countdown('qto', action);
    assert.equal(r.status, 422);
    assert.equal((await r.json()).error, 'MARKET_OPEN');
  }
  const opened = await adminListing('qto');
  const locked = await saveDraft('qto', config({ symbol: 'QTO', name: 'QA Timer Open', seed: 'qto-20261026-synthetic', listingAt: iso(3_600_000) }), opened.draftRevision);
  assert.equal(locked.status, 200);
  const lockedPublish = await publish('qto', (await locked.json()).draftRevision, 'publish-key-0000000t05');
  assert.equal(lockedPublish.status, 422);
  assert.equal((await lockedPublish.json()).error, 'HISTORY_LOCKED');
});

test('timer: refusals — an unknown action, a draft that was never published, an unknown listing', async () => {
  assert.equal((await countdown('qtm', 'restart')).status, 400);
  await saveDraft('qtd', config({ symbol: 'QTD', name: 'QA Timer Draft', seed: 'qtd-20261026-synthetic' }), 0);
  const draft = await countdown('qtd', 'start');
  assert.equal(draft.status, 422);
  assert.equal((await draft.json()).error, 'NOT_PUBLISHED');
  assert.equal((await countdown('nope', 'start')).status, 404);
  assert.equal((await publishWith('qtd', 1, 'publish-key-0000000t06', { countdown: 'later' })).status, 400);
  assert.equal(await catalogueAsset('QTD/USDT'), null);
});

test('timer: a whole workerd restart keeps every timer state, and the public catalogue is the same afterwards', async () => {
  const before = Object.fromEntries((await internalPublished()).map((l) => [l.id, l.countdown ?? null]));
  const publicBefore = (await catalogue()).assets.map((a) => [a.pair, a.listingArmed, a.countdown]).sort();
  await mf.dispose();
  mf = new Miniflare(options);
  assert.deepEqual(Object.fromEntries((await internalPublished()).map((l) => [l.id, l.countdown ?? null])), before);
  assert.deepEqual((await catalogue()).assets.map((a) => [a.pair, a.listingArmed, a.countdown]).sort(), publicBefore);
  assert.deepEqual([before.qtm.state, before.qtp.state, before.qto], ['running', 'running', null]);
});

test('delete one published market and draft, reject stale identity, preserve siblings after Worker restart', async () => {
  const id='zty-delete';
  const cfg=config({symbol:'ZTY',name:'Temporary',seed:'zty-delete-synthetic',tradable:false,ownerAllocation:'0'});
  const saved=await(await saveDraft(id,cfg,0)).json();
  assert.equal((await publish(id,saved.draftRevision,'publish-delete-0000001')).status,200);
  const row=(await(await admin('/internal/listings')).json()).listings.find(x=>x.id===id);
  const oldRevision=(await catalogue()).revision;
  const body={symbol:'ZTY',draftRevision:row.draftRevision,activeVersion:1,confirmation:'УДАЛИТЬ ZTY'};
  const url=`/internal/listings/${id}/delete`;
  assert.equal((await admin(url,{method:'POST',body:{...body,symbol:'BAD',confirmation:'УДАЛИТЬ BAD'}})).status,409);
  assert.equal((await admin(url,{method:'POST',body:{...body,draftRevision:99}})).status,409);
  assert.equal((await admin(url,{method:'POST',body:{...body,confirmation:'no'}})).status,400);
  assert.equal((await admin(url,{method:'POST',body,headers:{Authorization:'Bearer wrong'}})).status,401);
  const siblings=(await(await admin('/internal/listings')).json()).listings.filter(x=>x.id!==id)
    .map(x=>[x.id,x.symbol,x.draftRevision,x.activeVersion,x.countdown]);
  const result=await admin(url,{method:'POST',body});
  assert.equal(result.status,200,await result.clone().text());
  assert.deepEqual(await result.json(),{id,symbol:'ZTY',deleted:true,catalogueRevision:String(BigInt(oldRevision)+1n)});
  assert.equal((await admin(url,{method:'POST',body})).status,404);
  assert.equal((await catalogue()).assets.some(x=>x.pair==='ZTY/USDT'),false);
  assert.equal((await pub('/market/test-assets/ZTY-USDT')).status,404);
  assert.deepEqual((await(await admin('/internal/listings')).json()).listings
    .map(x=>[x.id,x.symbol,x.draftRevision,x.activeVersion,x.countdown]),siblings);
  await mf.dispose();mf=new Miniflare(options);
  assert.equal((await(await admin('/internal/listings')).json()).listings.some(x=>x.symbol==='ZTY'),false);
  assert.equal((await catalogue()).assets.some(x=>x.pair==='ZTY/USDT'),false);
});
