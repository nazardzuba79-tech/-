const test = require('node:test'), assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net'), path = require('node:path');
const { fixture, disposableUrl } = require('./testing/disposable-postgres.cjs');

// Separated release layout (docs/STOCKS_613_PROCESS_ISOLATION.md): the compiled dedicated authority
// (dist/stocksAuthority.js) serves the unchanged router on its private loopback listener and the unchanged
// release gateway reaches it there. The fixture only provides the synthetic rows, sessions and tokens; its own
// in-process API and gateway are not used. (With every Stocks variable unset the crypto API mounts no Stocks
// route: src/api/routes/__tests__/stocksTestCash.test.ts.) Real PostgreSQL rows, synthetic users only.
const root = path.resolve(__dirname, '../..'), authorityEntry = path.join(root, 'dist/stocksAuthority.js');
const freePort = () => new Promise(resolve => {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(STOCKS_|DATABASE_URL$|DIRECT_URL$|NODE_OPTIONS$|JWT_SECRET$)/.test(key)));
async function start(t, file, env, ready) {
  const child = spawn(process.execPath, [file], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', data => stderr += data);
  t.after(async () => {
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('START_TIMEOUT ' + stderr)), 8000);
    child.once('exit', code => { clearTimeout(timer); reject(Error('EXIT ' + code + ' ' + stderr)); });
    child.stdout.on('data', data => { if (String(data).includes(ready)) { clearTimeout(timer); resolve(); } });
  });
  return child;
}

test('separated release: dedicated compiled authority process keeps every live check behind its private listener', {
  timeout: 40000, skip: disposableUrl() ? false : 'NOT_RUN: disposable PostgreSQL required',
}, async t => {
  assert.equal(process.versions.node, '22.23.3');
  assert.equal(process.env.STOCKS_PG_COMPILED_ROUTER, 'true');
  const f = await fixture(t);
  const before = await f.rows();
  const env = { ...clean(), NODE_ENV: 'production', DATABASE_URL: f.target.raw, JWT_SECRET: process.env.JWT_SECRET,
    STOCKS_TEST_CASH_ENABLED: 'true', STOCKS_CATALOGUE_ENABLED: 'true', STOCKS_ORDER_EXECUTION_ENABLED: 'true',
    STOCKS_IDENTITY_ISSUER: f.issuer, STOCKS_TRADE_PRINCIPALS: JSON.stringify(f.principals), STOCKS_TEST_CASH_GATEWAY_KEY: f.gatewayKey };
  // Without its private port there is no listener at all; nothing sensitive is printed.
  const refused = spawnSync(process.execPath, [authorityEntry], { env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^STOCKS_AUTHORITY_PROCESS_CONFIG_INVALID$/m);
  assert.doesNotMatch(refused.stdout + refused.stderr, /postgres(?:ql)?:\/\/|synthetic-stocks-pg-/);

  const authorityPort = await freePort();
  await start(t, authorityEntry, { ...env, STOCKS_AUTHORITY_INTERNAL_PORT: String(authorityPort) }, 'STOCKS_AUTHORITY_LISTENING ' + authorityPort);
  const endpoint = `http://127.0.0.1:${authorityPort}/api/v1/stocks-test-cash`;
  let response = await fetch(endpoint + '/readiness');
  assert.equal(response.status, 403, 'private ingress: capability first');
  response = await fetch(endpoint + '/readiness', { headers: { 'x-stocks-authority-key': f.gatewayKey } });
  assert.equal(response.status, 200);
  const proof = await response.json();
  assert.equal(proof.authority, 'postgres'); assert.equal(proof.tradingEnabled, true);
  assert.deepEqual(await f.rows(), before, 'readiness binds, reserves and writes nothing');

  const gatewayPort = await freePort();
  await start(t, path.join(__dirname, 'release-entrypoint.mjs'), { ...clean(), NODE_ENV: 'production', STOCKS_TEST_CASH_AUTHORITY_URL: endpoint,
    STOCKS_IDENTITY_ISSUER: f.issuer, STOCKS_TEST_CASH_GATEWAY_KEY: f.gatewayKey, STOCKS_TRADE_PRINCIPALS: JSON.stringify(f.principals),
    STOCKS_GLOBAL_PORT: String(gatewayPort) }, 'STOCKS_RELEASE_LISTENING ' + gatewayPort);
  const gateway = `http://127.0.0.1:${gatewayPort}/__stocks_global/`;
  response = await fetch(gateway + 'health');
  assert.equal(response.status, 200); assert.equal((await response.json()).accounts, true);
  const state = index => fetch(gateway + 'state?id=' + encodeURIComponent(f.ID), { headers: { Authorization: 'Bearer ' + f.tokens[index] } });
  for (const index of [0, 1]) { response = await state(index); assert.equal(response.status, 200); await response.text(); }
  const command = (index, type) => fetch(endpoint + '/command', { method: 'POST', body: JSON.stringify({ type }),
    headers: { Authorization: 'Bearer ' + f.tokens[index], 'x-stocks-authority-key': f.gatewayKey, 'content-type': 'application/json' } });
  response = await command(0, 'readView');
  assert.equal(response.status, 200); assert.equal((await response.json()).value.authorityCash.asset, 'USDT');

  // Revocation is read live by the dedicated process, through the gateway and on a direct command; a blocked
  // binding is refused by the PostgreSQL authority's own session fence, exactly as in the API process.
  await f.other.session.update({ where: { id: f.sessions[0] }, data: { revokedAt: new Date() } });
  response = await state(0); assert.equal(response.status, 401); await response.text();
  response = await command(0, 'readView'); assert.equal(response.status, 401); await response.text();
  response = await command(1, 'readView'); assert.equal(response.status, 200); await response.text();
  await f.other.user.update({ where: { id: f.users[1] }, data: { blockedAt: new Date() } });
  response = await command(1, 'readView'); assert.equal(response.status, 401); await response.text();
  response = await fetch(endpoint + '/readiness', { headers: { 'x-stocks-authority-key': f.gatewayKey } });
  assert.equal(response.status, 503, 'bindings are checked anew'); await response.text();
  assert.deepEqual(await f.rows(), before, 'no cash, account, receipt or audit change');
});
