import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createAuthorityAdapter } from './authority-adapter.mjs';
import { accountId } from './accounts.mjs';
import { createServer } from './server.mjs';

// #613 R9: past maxConnections (128, unchanged) Node closes a new connection without any answer; the CI sustained
// run saw viewer polls and once a trader request lost that way. Before that bound the gateway now answers a new API
// request 503 SOURCE_BUSY with Retry-After and closes its connection after the answer; a trader's request (a bearer
// the authority confirmed for trading) keeps the remaining connections.
const ISSUER = 'connection-admission-fixture', KEY = 'synthetic-connection-admission-capability';
const bearer = letter => 'Bearer ' + letter.repeat(32);
const SUBJECTS = { A: 'trader-a', V: 'viewer-v' };
function authorityDouble() {
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/identities')) return new Response(JSON.stringify({ results: JSON.parse(options.body).tokens.map(token => ({ issuer: ISSUER, subject: SUBJECTS[token[0]] })) }));
    const subject = SUBJECTS[options.headers.Authorization[7]], body = JSON.parse(options.body);
    const value = body.type === 'ensure' ? { id: accountId({ issuer: ISSUER, subject }) } : { schema: 2, revision: 1, serverTime: 1, wallets: { USDT: { cash: '0', reserved: '0' }, USDC: { cash: '0', reserved: '0' } }, positions: {}, orders: [], fills: [], quotes: {} };
    return new Response(JSON.stringify({ value, metrics: {}, actor: { issuer: ISSUER, subject } }));
  };
  return createAuthorityAdapter({ endpoint: 'http://127.0.0.1:1/api/v1/stocks-test-cash', issuer: ISSUER, gatewayKey: KEY, fetchImpl });
}
// One request on its own new connection, as a client whose pooled connections are all busy.
const fresh = (port, letter) => new Promise((resolve, reject) => {
  const request = http.get({ host: '127.0.0.1', port, path: '/__stocks_global/state', agent: false, headers: { authorization: bearer(letter) } }, response => {
    let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) }));
  });
  request.on('error', reject);
});
const until = async condition => { for (let i = 0; i < 400 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(condition()); };

test('a busy gateway answers 503 with Retry-After and closes instead of dropping the connection; a trader keeps its slot', async t => {
  const adapter = authorityDouble();
  const gateway = await createServer({ port: 0, autoPoll: false, financialEnabled: true, accountAuthority: adapter,
    tradePrincipals: [{ issuer: ISSUER, subject: 'trader-a' }, { issuer: ISSUER, subject: 'trader-b' }], hub: { metrics: {}, close() {}, catalogue: async () => [] } });
  const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.destroy(); await gateway.close(); await adapter.close(); });
  // The trader is confirmed live once (its bearer remembered); the viewer is served while the gateway is not busy.
  assert.equal((await fresh(gateway.port, 'A')).status, 200);
  assert.equal((await fresh(gateway.port, 'V')).status, 200);
  const { busyAt, max } = gateway.connectionMetrics();
  assert.deepEqual([busyAt, max], [112, 128]);
  // Idle connections up to the busy bound (clients' pooled sockets, slow clients).
  const open = n => new Promise(resolve => { const socket = net.connect(gateway.port, '127.0.0.1', resolve); sockets.push(socket); });
  while (sockets.length < busyAt) await open();
  await until(() => gateway.connectionMetrics().open >= busyAt);
  const viewer = await fresh(gateway.port, 'V');
  assert.equal(viewer.status, 503);
  assert.deepEqual(viewer.body, { error: 'SOURCE_BUSY', retryAfterMs: 1000 });
  assert.equal(viewer.headers['retry-after'], '1');
  assert.equal(viewer.headers.connection, 'close', 'the refused connection is closed after its answer and frees its slot');
  // The trader's request is still served on the remaining connections.
  const trader = await fresh(gateway.port, 'A');
  assert.equal(trader.status, 200);
  assert.equal(trader.body.account.canTrade, true);
  const after = gateway.connectionMetrics();
  assert.equal(after.dropped, 0, 'no connection was closed without an answer');
  assert.ok(after.shed >= 1);
  // When the idle connections go away the viewer is served again.
  for (const socket of sockets.splice(0)) socket.destroy();
  await until(() => gateway.connectionMetrics().open < busyAt);
  assert.equal((await fresh(gateway.port, 'V')).status, 200);
});
