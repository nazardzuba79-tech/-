import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from './server.mjs';
import { CATALOG } from './catalog.mjs';
import { SimError } from './engine.mjs';

const ID = 'BYBIT:AAPLXUSDT';
const principals = ['synthetic-alpha', 'synthetic-beta'].map(subject => ({ issuer: 'execution-off-fixture', subject }));

test('default OFF rejects forged financial POSTs for both admitted principals and a viewer before ledger access', async t => {
  const calls = { authenticate: 0, ledger: 0, quote: 0 };
  const authority = {
    runWithRequest: (_req, work) => work(),
    authenticate: async req => {
      calls.authenticate++;
      if (!req.headers.authorization) throw new SimError('AUTH_REQUIRED');
      return { issuer: principals[0].issuer, subject: req.headers.authorization.slice(7) };
    },
    forPrincipal: async () => { calls.ledger++; throw Error('OFF must not even bind/read a financial ledger'); },
    metrics: () => ({}), close: async () => {},
  };
  const hub = { metrics: {}, catalogue: async () => CATALOG,
    quote: async () => { calls.quote++; const now = Date.now(); return { instrumentId: ID, timestamp: now, receivedAt: now,
      provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '101', last: '100', prices: { USDT: { buy: '101', sell: '100' } }, fx: {} }; },
    history: async () => ({ candles: [] }) };
  // Omitted financialEnabled is intentional: this is the real constructor default.
  const app = await createServer({ port: 0, accountAuthority: authority, tradePrincipals: principals, hub });
  t.after(() => app.close());
  const send = (route, subject, method = 'GET', token = '', body = {}) => new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: app.port, path: '/__stocks_global/' + route, method,
      headers: { ...(subject ? { authorization: 'Bearer ' + subject } : {}), 'content-type': 'application/json', 'x-stocks-token': token } }, response => {
      const parts = []; response.on('data', p => parts.push(p)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(parts)) }));
    }); request.on('error', reject); request.end(method === 'POST' ? JSON.stringify(body) : undefined);
  });
  for (const subject of [...principals.map(p => p.subject), 'synthetic-viewer']) {
    const initial = await send('state?id=' + encodeURIComponent(ID), subject);
    assert.equal(initial.status, 200); assert.equal(initial.body.account.canTrade, false);
    assert.deepEqual(initial.body.orders, []);
    for (const type of ['MARKET', 'LIMIT']) for (const side of ['BUY', 'SELL']) {
      const result = await send('orders', subject, 'POST', initial.body.token, { id: 'synthetic-direct-' + type + side,
        instrumentId: ID, side, type, quantity: '1', limitPrice: '100', currency: 'USDT' });
      assert.deepEqual(result, { status: 403, body: { error: 'ACCOUNT_TRADING_DISABLED' } });
    }
    for (const route of ['cancel', 'balances', 'refresh']) {
      const result = await send(route, subject, 'POST', initial.body.token);
      assert.equal(result.status, 403); assert.equal(result.body.error, 'ACCOUNT_TRADING_DISABLED');
    }
    assert.equal((await send('portfolio', subject)).status, 200);
    assert.equal((await send('history?id=' + encodeURIComponent(ID), subject)).status, 200);
  }
  assert.equal((await send('orders', null, 'POST')).status, 401);
  assert.equal(calls.ledger, 0); assert.ok(calls.quote > 0);
});

test('truthy non-boolean server options cannot turn execution on', async () => {
  for (const financialEnabled of ['true', 1, {}]) await assert.rejects(
    createServer({ financialEnabled, dataPath: 'must-not-open.json' }), /AUTH_CONFIG_INVALID/);
});
