import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.mjs';
import { CATALOG } from './catalog.mjs';
import { SimError } from './engine.mjs';

const NOW = 1791569400000, ID = 'BYBIT:AAPLXUSDT';
const quote = {
  instrumentId: ID, provider: 'bybit', nativeCurrency: 'USDT',
  bid: '100', ask: '100', timestamp: NOW, receivedAt: NOW,
  verified: true, marketOpen: true, eventId: 'owner-usdt-1',
  capacity: '1.00000000', prices: { USDT: { buy: '100', sell: '100' } }, fx: {},
};
const order = (currency = 'USDT', id = 'owner-usdt-order-001') => ({
  id, instrumentId: ID, currency, side: 'BUY', type: 'MARKET', quantity: '0.1',
});

test('owner-only mode cannot start with a missing or malformed trusted owner ID', async () => {
  await assert.rejects(
    createServer({ port: 0, accountsPath: '/unused.sqlite', authenticate: async () => ({ issuer: 'test', subject: 'alice' }), ownerOnlyMode: true }),
    /AUTH_CONFIG_INVALID/,
  );
  await assert.rejects(
    createServer({ port: 0, accountsPath: '/unused.sqlite', authenticate: async () => ({ issuer: 'test', subject: 'alice' }), ownerOnlyMode: true, tradeOwnerSubject: 'bad owner ID' }),
    /AUTH_CONFIG_INVALID/,
  );
});

test('only the trusted account may trade; USDC submissions and manual refresh bypasses are denied', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stocks-owner-usdt-'));
  let quoteCalls = 0;
  const app = await createServer({
    port: 0, accountsPath: join(dir, 'owner.sqlite'), ownerOnlyMode: true, tradeOwnerSubject: 'alice',
    now: () => NOW, autoPoll: false,
    authenticate: async req => {
      const token = req.headers.authorization;
      if (token !== 'Bearer test-alice' && token !== 'Bearer test-bob') throw new SimError('AUTH_REQUIRED');
      return { issuer: 'owner-usdt-fixture', subject: token === 'Bearer test-alice' ? 'alice' : 'bob' };
    },
    hub: {
      metrics: {}, catalogue: async () => CATALOG.map(x => ({ ...x, exists: true, online: true })),
      quote: async () => { quoteCalls++; return structuredClone(quote); },
      history: async () => ({ instrumentId: ID, interval: '15m', candles: [] }),
    },
  });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const url = 'http://127.0.0.1:' + app.port + '/__stocks_global/';
  const send = async (path, { user = 'alice', body, csrf } = {}) => {
    const response = await fetch(url + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer test-' + user, ...(body ? { 'Content-Type': 'application/json', 'X-Stocks-Token': csrf } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(4000),
    });
    return { status: response.status, data: await response.json() };
  };
  const [alice, bob] = await Promise.all([send('state'), send('state', { user: 'bob' })]);
  assert.equal(alice.status, 200); assert.equal(bob.status, 200);
  assert.equal(alice.data.account.canTrade, true);
  assert.equal(bob.data.account.canTrade, false);
  const read = await send('history?id=' + encodeURIComponent(ID), { user: 'bob' });
  assert.equal(read.status, 200, 'catalogue/history reading stays available');

  for (const [path, body] of [
    ['orders', order()],
    ['cancel', { id: order().id }],
    ['balances', { id: 'owner-usdt-balance', balances: { USDT: '10000', USDC: '10000' } }],
    ['refresh', { id: ID }],
  ]) {
    const response = await send(path, { user: 'bob', csrf: bob.data.token, body });
    assert.equal(response.status, 401, 'a non-owner cannot mutate ' + path);
    assert.equal(response.data.error, 'AUTH_REQUIRED');
  }
  assert.equal(quoteCalls, 0, 'unapproved manual refresh never fetches a quote');
  const afterBob = await send('state', { user: 'bob' });
  assert.equal(afterBob.data.orders.length, 0);
  assert.equal(afterBob.data.fills.length, 0);
  assert.equal((await send('orders', { csrf: alice.data.token, body: order('USDC') })).data.error, 'INVALID_ORDER');
  assert.equal((await send('refresh', { csrf: alice.data.token, body: { id: ID } })).status, 200);
  assert.equal(quoteCalls, 1);
  assert.equal((await send('orders', { csrf: alice.data.token, body: order() })).status, 200);
  const [ownerFinal, bobFinal] = await Promise.all([send('state'), send('state', { user: 'bob' })]);
  assert.equal(ownerFinal.data.fills.length, 1);
  assert.equal(bobFinal.data.fills.length, 0);
  assert.equal(bobFinal.data.account.mode, 'viewer');
  assert.equal(bobFinal.data.wallets.USDT.cash, '0.00000000', 'viewer projection is not a funded paper account');
});
