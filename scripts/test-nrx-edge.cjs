// Verify the deployed-entry Worker source NEVER reactivates retired NRX from a build.
// Uses the actual bundled Worker in an edge-like runtime with all outbound IO denied.
// Historical model math is independently exercised in simulationScheduleIntegration.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('../frontend/node_modules/esbuild');
const bundled = buildSync({ entryPoints: ['workers/market-edge/src/worker.ts'], bundle: true,
  write: false, platform: 'browser', format: 'cjs', target: 'es2022' }).outputFiles[0].text;
assert.doesNotMatch(bundled, /process\.env|@prisma|node:|DATABASE_URL/);
let external = 0, calls = 0;
const moduleObject = { exports: {} };
const sandbox = {
  module: moduleObject, exports: moduleObject.exports, Request, Response, URL, URLSearchParams, Headers,
  Date, console, fetch() { external++; throw new Error('Retired market attempted external IO'); },
};
vm.runInNewContext(bundled, sandbox);
const worker = moduleObject.exports.default;
const get = path => { calls++; return worker.fetch(new Request('https://market.voltextech.net' + path)); };
(async () => {
  for (const path of [
    '/market/nrx', '/market/nrx?simulationPreviewTime=2099-01-01',
    '/market/test-assets/NRX-USDT', '/market/test-assets/NRX-USDT/candles',
    '/market/ticker/NRX-USDT', '/market/display/spot-book/NRX-USDT',
    '/market/external/trades/NRX-USDT', '/market/external/candles/NRX-USDT',
    '/market/display/futures-book/NRXUSDT',
  ]) {
    const response = await get(path);
    assert.equal(response.status, 410, path);
    assert.deepEqual(await response.json(), { error: 'market_retired', symbol: 'NRX' }, path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
  }
  const options = await worker.fetch(new Request('https://market.voltextech.net/market/nrx', { method: 'OPTIONS' }));
  assert.equal(options.status, 204);
  const head = await worker.fetch(new Request('https://market.voltextech.net/market/nrx', { method: 'HEAD' }));
  assert.equal(head.status, 410);
  assert.equal(await head.text(), '');
  assert.equal((await (await get('/health')).json()).service, 'voltex-market-edge');
  const program = await (await get('/market/simulations/status')).json();
  assert.equal(program.nrx, undefined, 'no NRX schedule advertised from a retired market');
  assert.equal(program.boundedDemoProgram, 'capped-growth-range-v1');
  assert.equal(external, 0);
  assert.ok(calls >= 11);
  console.log('Bundled Worker NRX retirement PASS: HTTP410, no public schedule, zero outbound IO');
})().catch(error => { console.error(error); process.exitCode = 1; });
