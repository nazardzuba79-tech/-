'use strict';
// Runs the patched ACTUAL Worker bundle only in disposable local workerd/SQLite.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const moduleRoots = [path.resolve(__dirname, '../../workers/market-edge'),
  ...(process.env.VOLTEX_QA_WORKER_PACKAGE_ROOT ? [process.env.VOLTEX_QA_WORKER_PACKAGE_ROOT] : [])];
const { Miniflare, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: moduleRoots }));
const { Dispatcher, Agent, setGlobalDispatcher } = require(require.resolve('undici', { paths: moduleRoots }));
let blockedControlPlaneRequests = 0;
const localAgent = new Agent();
class LoopbackOnly extends Dispatcher {
  dispatch(options, handler) {
    const host = new URL(String(options.origin)).hostname;
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
      blockedControlPlaneRequests++;
      handler.onError(new Error('Offline QA refused a non-loopback request'));
      return false;
    }
    return localAgent.dispatch(options, handler);
  }
}
setGlobalDispatcher(new LoopbackOnly());

async function main() {
  const script = await fs.readFile(process.argv[2], 'utf8');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voltex-nrx-retirement-'));
  const token = 'synthetic-isolated-listing-delete-only-0001';
  let outbound = 0, mf;
  const checks = [];
  // cf:false disables Miniflare's default GET workers.cloudflare.com/cf.json.
  // The dispatcher independently refuses non-loopback control-plane requests.
  const options = { ...convertV4MiniflareOptions({ cf: false, durableObjectsPersist: dir, workers: [{
    name: 'market-edge', modules: true, script, compatibilityDate: '2026-09-01',
    bindings: { LISTINGS_STORE_TOKEN: token, LISTINGS_PUBLIC_CACHE_MS: '0' },
    durableObjects: { LISTINGS: { className: 'ManagedListingsDO', useSQLite: true } },
    outboundService: () => { outbound++; throw new Error('External request forbidden'); },
  }] }), cf: false, isolatedResourcePersistencePath: dir, resourcePersistencePath: dir, telemetry: { enabled: false } };
  const admin = (p, method = 'GET', body, extra = {}) => mf.dispatchFetch('https://market.local' + p, {
    method, headers: { Authorization: 'Bearer ' + token, 'X-Voltex-Admin-Id': 'synthetic-admin-633',
      'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const list = async () => (await (await admin('/internal/listings')).json()).listings;
  const publicList = async () => (await (await mf.dispatchFetch('https://market.local/market/listings')).json());
  const cfg = (symbol, tradable = false) => ({ schemaVersion: 1, symbol, name: 'Isolated ' + symbol,
    logo: null, initialPrice: '0.0140', listingAt: new Date(Math.ceil((Date.now() + 86400000) / 1000) * 1000).toISOString(),
    displayTimeZone: 'Europe/Moscow', ownerAllocation: '0', seedMode: 'manual', seed: 'delete633-' + symbol.toLowerCase() + '-fixture', tradable });
  const save = async (id, symbol, tradable = false) => {
    const r = await admin('/internal/listings/' + id + '/draft', 'PUT', { config: cfg(symbol, tradable) }, { 'If-Match': '0' });
    assert.equal(r.status, 200, await r.clone().text()); return r.json();
  };
  const publish = async row => {
    const r = await admin('/internal/listings/' + row.id + '/publish', 'POST', {
      draftRevision: row.draftRevision, publishKey: 'delete633-' + row.id + '-publication-0001',
    }); assert.equal(r.status, 200, await r.clone().text()); return r.json();
  };
  const payload = row => ({ symbol: row.symbol, draftRevision: row.draftRevision,
    activeVersion: row.activeVersion, confirmation: 'УДАЛИТЬ ' + row.symbol });
  const del = (row, body = payload(row), headers = {}) => admin('/internal/listings/' + row.id + '/delete', 'POST', body, headers);
  try {
    mf = new Miniflare(options);
    for (const route of ['/market/nrx', '/market/test-assets/NRX-USDT', '/market/external/candles/NRX-USDT', '/market/display/spot-book/NRX-USDT', '/market/display/spot-trades/nrx_usdt', '/orderbook/NRX-USDT', '/market/ticker/%4eRX-USDT']) {
      const response = await mf.dispatchFetch('https://market.local' + route);
      assert.equal(response.status, 410, route);
      assert.deepEqual(await response.json(), { error: 'market_retired', symbol: 'NRX' });
      checks.push('retired without venue/model fallback: ' + route);
    }
    const status = await (await mf.dispatchFetch('https://market.local/market/simulations/status')).json();
    assert.equal(status.nrx, undefined); checks.push('retired schedule absent from public status');

    assert.equal((await admin('/internal/listings', 'GET', undefined, { Authorization: '' })).status, 401); checks.push('admin authentication preserved');
    await publish(await save('sibling-eqa', 'EQA'));
    await publish(await save('sibling-qvr', 'QVR'));
    await publish(await save('delete-zty', 'ZTY'));
    let row = (await list()).find(x => x.id === 'delete-zty');
    const before = await list(), siblings = before.filter(x => x.id !== row.id);
    const oldRevision = (await publicList()).revision;
    for (const [label, body, status] of [
      ['wrong symbol refused', { ...payload(row), symbol: 'BAD', confirmation: 'УДАЛИТЬ BAD' }, 409],
      ['stale revision refused', { ...payload(row), draftRevision: row.draftRevision + 1 }, 409],
      ['wrong active version refused', { ...payload(row), activeVersion: 99 }, 409],
      ['typed confirmation required', { ...payload(row), confirmation: 'no' }, 400],
    ]) { assert.equal((await del(row, body)).status, status); checks.push(label); }
    assert.equal((await del(row, payload(row), { Authorization: 'Bearer invalid' })).status, 401); checks.push('forged authorization refused');
    assert.equal((await del(row, payload(row), { Origin: 'https://voltextech.net' })).status, 403); checks.push('browser origin cannot call internal DO');
    const response = await del(row); assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { id: row.id, symbol: row.symbol, deleted: true,
      catalogueRevision: String(BigInt(oldRevision) + 1n) }); checks.push('exact published target atomically deleted');
    assert.equal((await del(row)).status, 404); checks.push('repeated deletion cannot affect another listing');
    assert.deepEqual(await list(), siblings); checks.push('siblings config/version/countdown unchanged');
    assert.equal((await publicList()).assets.some(x => x.symbol === 'ZTY'), false); checks.push('public catalogue removal');
    assert.equal((await mf.dispatchFetch('https://market.local/market/test-assets/ZTY-USDT')).status, 404); checks.push('deleted public path unavailable');
    await save('delete-ztd', 'ZTD');
    // Like the real admin UI, delete from the authoritative list row. The
    // save receipt is not a list row and does not promise symbol/activeVersion.
    const privateRow = (await list()).find(x => x.id === 'delete-ztd');
    const privateDelete = await del(privateRow);
    assert.equal(privateDelete.status, 200, await privateDelete.clone().text()); checks.push('private draft deletion');
    await save('protected-ztr', 'ZTR', true);
    row = (await list()).find(x => x.id === 'protected-ztr');
    assert.equal((await del(row)).status, 422); checks.push('tradable listing deletion refused');
    const persistedBefore = await list(), publicBefore = await publicList();
    await mf.dispose(); mf = new Miniflare(options);
    assert.deepEqual(await list(), persistedBefore); checks.push('SQLite restart persistence');
    assert.deepEqual((await publicList()).assets.map(x => [x.symbol, x.version, x.countdown]),
      publicBefore.assets.map(x => [x.symbol, x.version, x.countdown])); checks.push('sibling public timers survive restart');
    assert.equal(outbound, 0); checks.push('zero external requests');
    assert.equal(blockedControlPlaneRequests, 0); checks.push('no external control-plane request attempted');
    const report = { result: 'PASS', checks: checks.length, labels: checks, outbound, blockedControlPlaneRequests,
      workerSha256: crypto.createHash('sha256').update(script).digest('hex'), productionTouched: false };
    if (process.argv[3]) await fs.writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await mf?.dispose(); await localAgent.close(); await fs.rm(dir, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
