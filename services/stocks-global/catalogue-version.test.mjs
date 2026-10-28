import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from './server.mjs';
import { CATALOG } from './catalog.mjs';
import { SimError } from './engine.mjs';
import { route } from './edge-transport/protocol.mjs';

// #613: the catalogue is about 17 KB of every state answer and changes only on a reload (at most once a minute).
// Each answer names its version; a client that already holds it (?catalogue=<version>) gets the answer without it.
const ID = 'BYBIT:AAPLXUSDT';
const principals = ['synthetic-alpha', 'synthetic-beta'].map(subject => ({ issuer: 'catalogue-version-fixture', subject }));

test('the state answer leaves the catalogue out only for a client holding the current version', async t => {
  const authority = {
    runWithRequest: (_req, work) => work(),
    authenticate: async req => { if (!req.headers.authorization) throw new SimError('AUTH_REQUIRED'); return { issuer: principals[0].issuer, subject: req.headers.authorization.slice(7) }; },
    forPrincipal: async () => { throw Error('a viewer never binds a ledger'); },
    metrics: () => ({}), close: async () => {},
  };
  let rows = CATALOG.map(row => ({ ...row, online: true, exists: true }));
  const hub = { metrics: {}, catalogue: async () => rows,
    quote: async () => { const now = Date.now(); return { instrumentId: ID, timestamp: now, receivedAt: now, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '101', last: '100', prices: { USDT: { buy: '101', sell: '100' } }, fx: {} }; },
    history: async () => ({ candles: [] }) };
  const app = await createServer({ port: 0, accountAuthority: authority, tradePrincipals: principals, hub });
  t.after(() => app.close());
  const get = path => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: app.port, path: '/__stocks_global/' + path, headers: { authorization: 'Bearer synthetic-viewer' } }, response => {
      const parts = []; response.on('data', p => parts.push(p)); response.on('end', () => { const raw = Buffer.concat(parts); resolve({ status: response.statusCode, bytes: raw.length, body: JSON.parse(raw) }); });
    }).on('error', reject);
  });
  const state = query => get('state?id=' + encodeURIComponent(ID) + query);

  const first = await state('');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.match(first.body.catalogueVersion, /^[a-f0-9]{16}$/);
  assert.ok(Array.isArray(first.body.catalogue) && first.body.catalogue.length === CATALOG.length);
  const version = first.body.catalogueVersion;

  const same = await state('&catalogue=' + version);
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.equal(same.body.catalogueVersion, version);
  assert.equal(Object.hasOwn(same.body, 'catalogue'), false, 'the held version is not sent again');
  assert.ok(same.bytes < first.bytes / 3, `${same.bytes} bytes against ${first.bytes}`);
  // Everything else is the same answer.
  assert.deepEqual(Object.keys(same.body).filter(k => k !== 'catalogue' && k !== 'serverTime' && k !== 'metrics').sort(), Object.keys(first.body).filter(k => k !== 'catalogue' && k !== 'serverTime' && k !== 'metrics').sort());
  assert.deepEqual(same.body.quotes[ID].prices, first.body.quotes[ID].prices);

  for (const other of ['0000000000000000', 'not-a-version', '']) {
    const full = await state('&catalogue=' + other);
    assert.equal(full.status, 200, other + ' ' + JSON.stringify(full.body)); assert.equal(full.body.catalogue.length, CATALOG.length, 'any other value gets the full catalogue: ' + other);
  }

  // A reload that changes the catalogue changes the version; the old one then gets the full catalogue again.
  rows = rows.map(row => row.id === ID ? { ...row, online: false } : row);
  const reload = await get('catalogue'); assert.equal(reload.status, 200, JSON.stringify(reload.body));
  const changed = await state('&catalogue=' + version);
  assert.notEqual(changed.body.catalogueVersion, version);
  assert.equal(changed.body.catalogue.find(row => row.id === ID).online, false);
  assert.equal(Object.hasOwn((await state('&catalogue=' + changed.body.catalogueVersion)).body, 'catalogue'), false);
});

test('the edge accepts the catalogue version on state reads only, in its exact form', () => {
  assert.equal(route('/__stocks_global/state?id=BYBIT%3AAAPLXUSDT&catalogue=0123456789abcdef', 'GET'), '/__stocks_global/state?id=BYBIT%3AAAPLXUSDT&catalogue=0123456789abcdef');
  for (const raw of ['/__stocks_global/state?id=X&catalogue=0123456789ABCDEF', '/__stocks_global/state?id=X&catalogue=123', '/__stocks_global/state?id=X&catalogue=0123456789abcdef&catalogue=0123456789abcdef',
    '/__stocks_global/history?id=X&catalogue=0123456789abcdef', '/__stocks_global/portfolio?catalogue=0123456789abcdef'])
    assert.throws(() => route(raw, 'GET'), error => error.code === 'ROUTE_NOT_FOUND', raw);
});
