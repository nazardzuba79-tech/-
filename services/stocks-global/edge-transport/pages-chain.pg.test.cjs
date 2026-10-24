const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, disposableUrl } = require('../testing/disposable-postgres.cjs');

test('real PG: normal VOLTEX password/session -> actual Pages Function -> Nginx TLS -> private gateway; finance OFF', { timeout: 60000, skip: disposableUrl() ? false : 'NOT_RUN: confirmed disposable local PG required, never production' }, async t => {
  assert.equal(process.env.STOCKS_EDGE_NGINX_TEST, 'true', 'this acceptance requires actual Nginx/TLS, never a stand-in');
  const { pagesWorker, originProxy, APP, API, KEY } = await import('./test-support.mjs');
  const { createPagesTransport } = await import('./verifier.mjs'); const { createHostedIngress } = await import('../hosted-ingress.mjs');
  const { createReleaseMarket } = await import('../release-market.mjs');
  const f = await fixture(t, { normalLogin: true, releaseRouter: true, wallClock: true, financialEnabled: false, hub: createReleaseMarket({}) });
  const ingress = await createHostedIngress({ origin: APP, gatewayPort: f.gateway.port, port: 0, transport: createPagesTransport({ publicOrigin: APP, apiOrigin: API, key: KEY }) }); t.after(() => ingress.close());
  const proxy = await originProxy(t, ingress.port,{apiOrigin:f.apiOrigin}); assert.ok(proxy.mode.startsWith('real Nginx TLS'));
  const mf = await pagesWorker(t, { outbound: proxy.outbound });
  const before = await f.rows(), tokens = [];
  for (const id of f.users) {
    const response = await proxy.tlsFetch(new Request(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: id + '@example.invalid', password: f.loginPassword }) }));
    assert.equal(response.status, 200); tokens.push((await response.json()).token);
  }
  const viewer = await f.newViewer('pages-chain');
  const direct=await proxy.tlsFetch(new Request(API+'/__stocks_global/catalogue',{headers:{authorization:'Bearer '+tokens[0],origin:APP}}));
  assert.equal(direct.status,403,'ordinary valid JWT cannot bypass edge transport proof');
  const privateAuthority=await proxy.tlsFetch(new Request(API+'/api/v1/stocks-test-cash/identity',{headers:{authorization:'Bearer '+tokens[0]}}));
  assert.equal(privateAuthority.status,404,'private PG authority must not be a public API route');
  const send = (token, path = 'catalogue', init = {}) => mf.dispatchFetch(APP + '/__stocks_global/' + path, { ...init, headers: { host: new URL(APP).host, authorization: 'Bearer ' + token, ...init.headers } });
  for (const token of [...tokens, viewer.token]) {
    const response = await send(token); assert.equal(response.status, 200); const body = await response.json(); assert.ok(body.catalogue.every(row => !row.online && row.display === null));
    const state = await (await send(token, 'state?id=BYBIT%3AAAPLXUSDT')).json(); assert.equal(state.account.canTrade, false); assert.deepEqual(state.quotes, {});
    for (const path of ['orders', 'cancel', 'balances', 'refresh']) {
      const result = await send(token, path, { method: 'POST', headers: { origin: APP } }); assert.equal(result.status, 403);
    }
  }
  const jwt = require('jsonwebtoken');
  const mismatched = jwt.sign({ sub: f.users[1], sid: f.sessions[0] }, process.env.JWT_SECRET, { expiresIn: '1h' });
  for (const token of [tokens[0].slice(0, -4) + 'xxxx', mismatched]) assert.equal((await send(token)).status, 401);
  const logout = await proxy.tlsFetch(new Request(API + '/api/v1/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + tokens[0] } })); assert.equal(logout.status, 200);
  assert.equal((await send(tokens[0])).status, 401); assert.equal((await send(tokens[1])).status, 200);
  assert.deepEqual(await f.rows(), before, 'cash, orders, accounts, receipts and audit must remain identical');
  t.diagnostic(JSON.stringify({ runtime: 'Wrangler Pages router/workerd + actual Nginx TLS + PG authority', production: false, allFinancialWrites: 0, ordinaryLoginUnchanged: true, dataRights: 'UNVERIFIED/no prices' }));
});
