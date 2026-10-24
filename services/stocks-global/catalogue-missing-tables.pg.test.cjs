// Permanent Claude regression: real compiled PG router + actual release child.
// DESTRUCTIVE only in a separately named, explicitly acknowledged disposable database.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net'), path = require('node:path');
const { fixture, disposableUrl } = require('./testing/disposable-postgres.cjs');
test('catalogue-only release works on real PG without Stocks tables; finance stays refused', { timeout: 60000 }, async t => {
  const target = disposableUrl();
  assert.equal(target?.name, 'stocks_disposable_catalogue', 'dedicated destructive fixture database required');
  assert.equal(process.env.STOCKS_PG_COMPILED_ROUTER, 'true', 'actual compiled router required');
  const f = await fixture(t, { releaseRouter: true, financialEnabled: false });
  const endpoint = f.apiOrigin + '/api/v1/stocks-test-cash';
  const cash = () => f.other.demoBalance.findMany({ where: { userId: { in: f.users } }, orderBy: [{ userId: 'asc' }, { asset: 'asc' }] });
  const before = await cash();
  assert.equal((await f.other.$queryRawUnsafe('SELECT current_database() AS name'))[0].name, target.name);
  assert.equal(await f.other.user.count(), 2, 'no unrelated users in destructive fixture');
  assert.equal(await f.other.user.count({ where: { id: { in: f.users } } }), 2);
  assert.equal((await f.other.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "StocksFixtureSchemaProof"'))[0].n, 1);
  await f.other.$executeRawUnsafe('DROP TABLE "StocksTestAudit", "StocksTestReceipt", "StocksTestAccount"');
  const tables = await f.other.$queryRawUnsafe(`SELECT to_regclass('public."StocksTestAccount"')::text a, to_regclass('public."StocksTestReceipt"')::text r, to_regclass('public."StocksTestAudit"')::text u`);
  assert.deepEqual(tables[0], { a: null, r: null, u: null });
  let response = await fetch(endpoint + '/readiness', { headers: { 'x-stocks-authority-key': f.gatewayKey } });
  assert.equal(response.status, 200, 'catalogue readiness without trading DDL');
  assert.equal((await response.json()).tradingEnabled, false);
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(STOCKS_|DATABASE_URL$|DIRECT_URL$|NODE_OPTIONS$|JWT_SECRET$)/.test(k)));
  Object.assign(env, { NODE_ENV: 'production', STOCKS_TEST_CASH_AUTHORITY_URL: endpoint, STOCKS_IDENTITY_ISSUER: f.issuer, STOCKS_TEST_CASH_GATEWAY_KEY: f.gatewayKey,
    STOCKS_TRADE_PRINCIPALS: JSON.stringify(f.principals), STOCKS_GLOBAL_PORT: String(port), STOCKS_MARKET_DATA_ENABLED: 'false', STOCKS_WS_ENABLED: 'false' });
  const child = spawn(process.execPath, [path.join(__dirname, 'release-entrypoint.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', d => stderr += d);
  t.after(async () => { if (child.exitCode === null) { const e = new Promise(r => child.once('exit', r)); child.kill(); await e; } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('RELEASE_START_TIMEOUT ' + stderr)), 8000);
    child.once('exit', code => { clearTimeout(timer); reject(Error('RELEASE_EXIT ' + code + ' ' + stderr)); });
    child.stdout.on('data', d => { if (String(d).includes('STOCKS_RELEASE_LISTENING ' + port)) { clearTimeout(timer); resolve(); } });
  });
  const base = `http://127.0.0.1:${port}/__stocks_global/`;
  response = await fetch(base + 'health'); assert.equal(response.status, 200);
  for (const i of [0, 1]) {
    response = await fetch(base + 'state?id=' + encodeURIComponent(f.ID), { headers: { Authorization: 'Bearer ' + f.tokens[i] } });
    const body = await response.json();
    assert.equal(response.status, 200, 'state read for bound trader ' + i + ': ' + JSON.stringify(body).slice(0, 300));
    assert.notEqual(body.account?.canTrade, true);
    response = await fetch(base + 'catalogue', { headers: { Authorization: 'Bearer ' + f.tokens[i] } });
    assert.equal(response.status, 200, 'catalogue read ' + i);
    response = await fetch(base + 'orders', { method: 'POST', headers: { Authorization: 'Bearer ' + f.tokens[i], 'content-type': 'application/json', 'x-stocks-token': body.token ?? '' }, body: JSON.stringify({ instrumentId: f.ID, side: 'BUY', type: 'MARKET', quantity: '1' }) });
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'ACCOUNT_TRADING_DISABLED');
  }
  for (const route of ['wallet', 'command']) {
    response = await fetch(endpoint + '/' + route, { method: route === 'command' ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + f.tokens[0], 'x-stocks-authority-key': f.gatewayKey, 'content-type': 'application/json' }, body: route === 'command' ? JSON.stringify({ type: 'ensure' }) : undefined });
    assert.equal(response.status, 403, route);
  }
  await f.other.session.update({ where: { id: f.sessions[0] }, data: { revokedAt: new Date() } });
  response = await fetch(base + 'state?id=' + encodeURIComponent(f.ID), { headers: { Authorization: 'Bearer ' + f.tokens[0] } });
  assert.equal(response.status, 401, 'revocation still enforced');
  assert.deepEqual(await cash(), before, 'DemoBalance unchanged');
  assert.equal(child.exitCode, null, 'release still running: ' + stderr);
});

