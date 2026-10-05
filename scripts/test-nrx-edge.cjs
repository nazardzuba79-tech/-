// Test the actual bundled Worker entry in an edge-like runtime, with ALL IO forbidden.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('../frontend/node_modules/esbuild');
const bundled = buildSync({ entryPoints: ['workers/market-edge/src/worker.ts'], bundle: true, write: false, platform: 'browser', format: 'cjs', target: 'es2022' }).outputFiles[0].text;
assert.doesNotMatch(bundled, /process\.env|@prisma|node:|DATABASE_URL/);
const listing = Date.parse('2026-10-03T13:00:00Z');
let now = listing - 1, external = 0;
const moduleObject = { exports: {} };
const sandbox = { module: moduleObject, exports: moduleObject.exports, Request, Response, URL, URLSearchParams, Headers,
  Date: class extends Date { static now() { return now; } },
  fetch() { external++; throw new Error('NRX attempted external IO'); }, console };
vm.runInNewContext(bundled, sandbox);
const worker = moduleObject.exports.default;
const get = path => worker.fetch(new Request('https://market.voltextech.net' + path));
(async () => {
  assert.equal((await (await get('/market/nrx?simulationPreviewTime=2099-01-01')).json()).assets[0].state.phase, 'pre-listing');
  now = listing;
  assert.equal((await (await get('/market/nrx')).json()).assets[0].state.lastPrice, .8);
  now += 120000;
  for (const path of ['/market/nrx', '/market/test-assets/NRX-USDT', '/market/test-assets/NRX-USDT/candles', '/market/ticker/NRX-USDT', '/market/display/spot-book/NRX-USDT', '/market/external/trades/NRX-USDT']) {
    assert.equal((await get(path)).status, 200, path);
  }
  assert.equal((await get('/market/display/futures-book/NRXUSDT')).status, 404);
  assert.equal((await (await get('/health')).json()).service, 'voltex-market-edge');
  // The live chart in the actual browser-targeted Worker bundle: the prices the
  // deployed market-edge 8de23981 serves (no scheduled plan attached).
  // Fixed instants are fixtures; no query parameter can select a future price.
  for (const [at, price] of [
    ['2026-10-03T21:00:00Z', 2.7420778],
    ['2026-10-04T09:00:00Z', 46.509268],
    ['2026-10-04T13:00:00Z', 45.828573],
    ['2026-10-06T19:00:00Z', 19415.611],
  ]) {
    now = Date.parse(at);
    const state = (await (await get('/market/nrx')).json()).assets[0].state;
    assert.equal(state.lastPrice, price, at);
    const tradesResponse = await get('/market/external/trades/NRX-USDT');
    assert.equal(tradesResponse.status, 200);
    const trades = await tradesResponse.json();
    assert.equal(Number(trades.trades[0].price), price, 'trade tape contains the same terminal price');
  }
  assert.equal(external, 0);
  console.log('Bundled NRX Worker: base routes and 4 live-chart price/tape checks PASS; zero IO; no Node runtime/DB dependency');
})().catch(error => { console.error(error); process.exitCode = 1; });
