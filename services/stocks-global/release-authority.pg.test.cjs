const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net'), path = require('node:path');
const { fixture, disposableUrl } = require('./testing/disposable-postgres.cjs');

test('Node22 release starts only after compiled router verifies actual PostgreSQL bindings/schema', {
  timeout: 30000, skip: disposableUrl() ? false : 'NOT_RUN: disposable PostgreSQL required',
}, async t => {
  assert.equal(process.versions.node, '22.23.3');
  assert.equal(process.env.STOCKS_PG_COMPILED_ROUTER, 'true');
  const f = await fixture(t, { releaseRouter: true });
  const endpoint = f.apiOrigin + '/api/v1/stocks-test-cash';
  let response = await fetch(endpoint + '/readiness');
  assert.equal(response.status, 401);
  const before = await f.rows();
  response = await fetch(endpoint + '/readiness', {headers:{'x-stocks-authority-key':f.gatewayKey}});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const proof = await response.json();
  assert.equal(proof.authority, 'postgres');
  assert.equal(proof.tradingEnabled, true, 'both server gates are on in this fixture');
  assert.deepEqual(await f.rows(), before, 'readiness cannot bind, reserve or issue a receipt');
  await f.other.user.update({where:{id:f.users[1]},data:{blockedAt:new Date()}});
  response = await fetch(endpoint + '/readiness', {headers:{'x-stocks-authority-key':f.gatewayKey}});
  assert.equal(response.status, 503, 'bindings are checked anew');
  await f.other.user.update({where:{id:f.users[1]},data:{blockedAt:null}});

  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0,'127.0.0.1',resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(STOCKS_|DATABASE_URL$|DIRECT_URL$|NODE_OPTIONS$|JWT_SECRET$)/.test(key)));
  Object.assign(env, {NODE_ENV:'production', STOCKS_TEST_CASH_AUTHORITY_URL:endpoint,
    STOCKS_IDENTITY_ISSUER:f.issuer, STOCKS_TEST_CASH_GATEWAY_KEY:f.gatewayKey,
    STOCKS_TRADE_PRINCIPALS:JSON.stringify(f.principals), STOCKS_GLOBAL_PORT:String(port)});
  const child = spawn(process.execPath,[path.join(__dirname,'release-entrypoint.mjs')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stderr = '';
  child.stderr.on('data', data => stderr += data);
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit',resolve));
      child.kill(); await exited;
    }
  });
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(Error('RELEASE_START_TIMEOUT '+stderr)),5000);
    child.once('exit',code=>{clearTimeout(timer);reject(Error('RELEASE_EXIT '+code+' '+stderr));});
    child.stdout.on('data',data=>{if(String(data).includes('STOCKS_RELEASE_LISTENING '+port)){clearTimeout(timer);resolve();}});
  });
  response = await fetch(`http://127.0.0.1:${port}/__stocks_global/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).accounts, true);
  assert.deepEqual(await f.rows(), before);
  // Ready is not an authorization cache: current revocation still reaches the
  // compiled API through the actual gateway/adapter after startup.
  await f.other.session.update({where:{id:f.sessions[0]},data:{revokedAt:new Date()}});
  response = await fetch(`http://127.0.0.1:${port}/__stocks_global/state?id=${encodeURIComponent(f.ID)}`,
    {headers:{Authorization:'Bearer '+f.tokens[0]}});
  assert.equal(response.status, 401);
  assert.deepEqual(await f.rows(), before);
});

test('readiness reports no trading while the order execution gate is OFF, so the gateway grants nobody canTrade', {
  timeout: 30000, skip: disposableUrl() ? false : 'NOT_RUN: disposable PostgreSQL required',
}, async t => {
  const f = await fixture(t, { releaseRouter: true, orderExecutionEnabled: false });
  const before = await f.rows();
  const response = await fetch(f.apiOrigin + '/api/v1/stocks-test-cash/readiness', {headers:{'x-stocks-authority-key':f.gatewayKey}});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tradingEnabled, false);
  for (const index of [0, 1]) {
    const state = await f.request('state?id=' + encodeURIComponent(f.ID), { index });
    assert.equal(state.status, 200);
    assert.equal(state.data.account.canTrade, false, 'a bound trader must read as a viewer');
    const forged = await f.request('orders', { index, body: { id: 'forged-' + index + '-0001', instrumentId: f.ID, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.10000000' } });
    assert.notEqual(forged.status, 200, 'a forged gateway order must be refused');
  }
  assert.deepEqual(await f.rows(), before, 'nothing was reserved, written or received');
});
