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
  // Historical fixtures stay byte-identical through the prospective v5 activation.
  for (const [at, price] of [
    ['2026-10-03T21:00:00Z', 2.7420778],
    ['2026-10-04T09:00:00Z', 46.509268],
    ['2026-10-04T13:00:00Z', 45.828573],
  ]) {
    now = Date.parse(at);
    const state = (await (await get('/market/nrx')).json()).assets[0].state;
    assert.equal(state.lastPrice, price, at);
    const trades = await (await get('/market/external/trades/NRX-USDT')).json();
    assert.equal(Number(trades.trades[0].price), price, 'trade tape contains the same historical price');
  }

  // v5: stop growth at the exact activation tick, balance 48h, sell off 60%
  // over six hours, then remain in a bounded terminal balance forever.
  now = Date.parse('2026-10-05T20:00:00Z');
  const anchor = (await (await get('/market/nrx')).json()).assets[0].state.lastPrice;
  now = Date.parse('2026-10-07T20:00:00Z');
  assert.equal((await (await get('/market/nrx')).json()).assets[0].state.lastPrice, anchor, '48h balance returns to activation anchor');
  now = Date.parse('2026-10-08T02:00:00Z');
  const terminal = (await (await get('/market/nrx')).json()).assets[0].state.lastPrice;
  assert.ok(Math.abs(terminal - anchor * .4) <= Math.max(1e-8, anchor * 1e-7), 'six-hour selloff ends at the canonical 8-significant-digit -60% target');
  now += 24 * 60 * 60 * 1000;
  const balanced = (await (await get('/market/nrx')).json()).assets[0].state.lastPrice;
  assert.ok(balanced > terminal * .5 && balanced < terminal * 1.6, 'post-selloff market remains balanced');
  const trades = await (await get('/market/external/trades/NRX-USDT')).json();
  assert.equal(Number(trades.trades[0].price), balanced, 'trade tape follows the terminal balance');

  assert.equal(external, 0);
  console.log('Bundled NRX Worker: historical path + v5 balance/selloff/balance PASS; zero IO; no Node runtime/DB dependency');
})().catch(error => { console.error(error); process.exitCode = 1; });
