'use strict';
/**
 * The pre-listing timer through the REAL path: this checkout's admin router
 * (src/api/routes/adminListings + CloudflareListingStore + registry + Spot
 * gate) against the market-edge Worker bundle in workerd (Miniflare, SQLite
 * Durable Object). No browser: these are exactly the requests the admin page
 * sends (frontend/src/pages/admin/adminListingsApi.ts) — publish with
 * `countdown: 'staged'` when «Запустить таймер сразу после публикации» is
 * unchecked, then POST …/countdown {action}. Fixture accounts, no DB, no
 * network; the synthetic ticker QTX exists nowhere in the code.
 *
 * Why it exists: qa-listing-timer.cjs renders fixtures only (no API, no
 * Worker), so it passes against any API. This one fails if the API in `src`
 * drops the staged flag or lacks the countdown route — i.e. it tells whether a
 * given API revision can run the TYVN timer safely.
 *
 *   node scripts/qa-listing-timer-api.cjs            (report: QA_OUT or docs/qa/listing-timer-api)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
process.env.JWT_SECRET = 'local-qa-only-timer-api-jwt-secret-not-for-production';
process.env.NODE_ENV = 'test';
delete process.env.LISTINGS_STORE_URL;
delete process.env.LISTINGS_STORE_TOKEN;
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });

const express = require('express');
const jwt = require('jsonwebtoken');
// The Worker may come from another checkout (QA_EDGE_ROOT), e.g. the exact commit deployed on Cloudflare,
// while the API under test is this checkout's src.
const edgeRoot = path.resolve(process.env.QA_EDGE_ROOT || root);
const edgeRequire = require('node:module').createRequire(path.join(edgeRoot, 'workers/market-edge/package.json'));
const { build } = edgeRequire('esbuild');
const { Miniflare, convertV4MiniflareOptions } = edgeRequire('miniflare');
const { adminListingsRouter } = require('../src/api/routes/adminListings');
const { CloudflareListingStore } = require('../src/services/listings/store');
const { ManagedListingRegistry } = require('../src/services/listings/registry');
const { assertSpotListing } = require('../src/services/testMarkets/nrxSpot');

const out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/listing-timer-api'));
const EDGE_PORT = Number(process.env.QA_EDGE_PORT || 8788);
const EDGE = `http://127.0.0.1:${EDGE_PORT}`;
const STORE_TOKEN = 'synthetic-local-only-listings-secret-0002';
fs.mkdirSync(out, { recursive: true });
const report = { scope: 'Local only: real admin router + store client + registry from this checkout, real Worker in workerd; fixture accounts; no DB, no network.', api: root, worker: edgeRoot, checks: [], failures: [], outbound: 0 };
const check = (name) => { report.checks.push(name); console.log('✓', name); };

async function main() {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-timer-api-qa-'));
  const bundle = await build({ entryPoints: [path.join(edgeRoot, 'workers/market-edge/src/worker.ts')], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*'] });
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ durableObjectsPersist: persist, workers: [{ name: 'market-edge', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
    bindings: { LISTINGS_STORE_TOKEN: STORE_TOKEN, LISTINGS_MIN_LEAD_MS: '5000', LISTINGS_PUBLIC_CACHE_MS: '0' },
    durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
    outboundService: () => { report.outbound++; throw new Error('QA: the Worker may not call out'); },
  }] }), isolatedResourcePersistencePath: persist, resourcePersistencePath: persist, telemetry: { enabled: false }, host: '127.0.0.1', port: EDGE_PORT });
  await mf.ready;

  const accounts = { 'qa-admin': 'ADMIN', 'qa-user': 'USER' };
  const prisma = {
    user: { findUnique: async ({ where: { id } }) => (accounts[id] ? { id, role: accounts[id] } : null) },
    session: { findUnique: async () => null, update: async () => null },
    ...Object.fromEntries(['order', 'trade', 'futuresOrder', 'futuresPosition', 'balance'].map((name) => [name, { count: async () => 0 }])),
  };
  const tokens = { admin: jwt.sign({ sub: 'qa-admin' }, process.env.JWT_SECRET), user: jwt.sign({ sub: 'qa-user' }, process.env.JWT_SECRET) };
  const store = new CloudflareListingStore(EDGE, STORE_TOKEN);
  const registry = new ManagedListingRegistry(store);
  const app = express();
  app.use(express.json({ limit: '300kb' }));
  app.use('/api/v1', adminListingsRouter(prisma, store, { hasSpotPair: (pair) => pair === 'BTC/USDT' }, registry));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, { token = tokens.admin, method = 'GET', body } = {}) => {
    const r = await fetch(`${origin}/api/v1${p}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const publicPairs = async () => ((await (await fetch(`${EDGE}/market/listings`, { cache: 'no-store' })).json()).assets || []).map((a) => ({ pair: a.pair, countdown: a.countdown ?? null }));
  const spotRefused = async () => { await registry.ensureFresh(3000); try { assertSpotListing('QTX/USDT'); return false; } catch { return true; } };
  const step = async (name, fn) => { try { await fn(); check(name); } catch (error) { const msg = error.message.replace(/\s+/g, ' ').slice(0, 400); report.failures.push(`${name}: ${msg}`); console.log('✗', name, '—', msg); } };

  try {
    // A TYVN-shaped draft (same scenario program as config/test-markets/tyvn.draft.json) on a synthetic ticker.
    const tyvn = JSON.parse(fs.readFileSync(path.join(root, 'config/test-markets/tyvn.draft.json'), 'utf8'));
    const listingAt = new Date(Math.ceil((Date.now() + 2 * 86400000) / 10000) * 10000).toISOString().replace('.000Z', 'Z');
    const config = { ...tyvn, symbol: 'QTX', name: 'QA Timer API', seed: 'qtx-qa-timer-api-v1', ownerAllocation: '0', listingAt };
    let id, draftRevision;
    await step('create: the TYVN-shaped draft (scenario-controls-v2, range, tradable:false) is accepted by the API', async () => {
      const r = await api('/admin/listings', { method: 'POST', body: { config } });
      assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 200));
      ({ id, draftRevision } = r.body);
    });
    await step('publish with «Запустить таймер» unchecked (countdown: staged) is acknowledged as staged', async () => {
      const r = await api(`/admin/listings/${encodeURIComponent(id)}/publish`, { method: 'POST', body: { draftRevision, publishKey: 'qa-timer-api-publish-key-0001', countdown: 'staged' } });
      assert.ok([200, 201].includes(r.status), `publish ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      assert.equal(r.body?.countdown?.state, 'staged', `receipt countdown ${JSON.stringify(r.body?.countdown)}`);
    });
    await step('staged: the market is NOT public (catalogue omits QTX) and Spot refuses it', async () => {
      const pairs = await publicPairs();
      assert.equal(pairs.some((a) => a.pair === 'QTX/USDT'), false, `public catalogue shows QTX: ${JSON.stringify(pairs)}`);
      assert.equal(await spotRefused(), true);
    });
    await step('admin list carries the staged timer', async () => {
      const r = await api('/admin/listings');
      assert.equal(r.status, 200);
      assert.equal(r.body.listings.find((l) => l.id === id)?.countdown?.state, 'staged');
    });
    await step('timer route refuses a USER (403) and no session (401)', async () => {
      assert.equal((await api(`/admin/listings/${encodeURIComponent(id)}/countdown`, { method: 'POST', token: tokens.user, body: { action: 'start' } })).status, 403);
      assert.equal((await api(`/admin/listings/${encodeURIComponent(id)}/countdown`, { method: 'POST', token: null, body: { action: 'start' } })).status, 401);
    });
    for (const [action, state, isPublic] of [['start', 'running', true], ['pause', 'paused', true], ['start', 'running', true], ['stop', 'staged', false]]) {
      await step(`«${action}» → ${state}: public=${isPublic}, Spot still refuses (tradable:false, before the instant)`, async () => {
        const r = await api(`/admin/listings/${encodeURIComponent(id)}/countdown`, { method: 'POST', body: { action } });
        assert.equal(r.status, 200, `countdown ${action}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        assert.equal(r.body.countdown.state, state);
        const pairs = await publicPairs();
        const row = pairs.find((a) => a.pair === 'QTX/USDT');
        assert.equal(Boolean(row), isPublic, JSON.stringify(pairs));
        // The public row carries the timer state as a string (listingPublic.publicListingAsset).
        if (row) assert.equal(row.countdown, state);
        assert.equal(await spotRefused(), true);
      });
    }
    await step('the Worker made zero outbound calls', async () => assert.equal(report.outbound, 0));
  } finally {
    server.close();
    await mf.dispose();
    fs.rmSync(persist, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures }, null, 1));
  if (report.failures.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
