import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { stocksPages } from '../../../frontend/edge/stocks-pages.mjs';
import { createPagesTransport } from './verifier.mjs';
import { PROOF, canonical, keyBytes, route } from './protocol.mjs';
import { createHostedIngress } from '../hosted-ingress.mjs';

export const APP = 'https://app.example.invalid', API = 'https://api.example.invalid';
// Public synthetic fixture only, never used by a deployment.
export const KEY = 'ab'.repeat(32), TOKEN = 'Bearer synthetic.header.signature';
export const ENV = { STOCKS_PAGES_PROXY_ENABLED: 'true', STOCKS_PUBLIC_ORIGIN: APP, STOCKS_API_INGRESS_ORIGIN: API, STOCKS_EDGE_TRANSPORT_KEY: KEY };
const request = (path = 'catalogue', init = {}) => new Request(APP + '/__stocks_global/' + path, { ...init, headers: { authorization: TOKEN, ...init.headers } });
export function signed(path = '/__stocks_global/catalogue', { method = 'GET', authorization = TOKEN, time = String(Date.now()), nonce = randomUUID(), csrf = '', view = '' } = {}) {
  const digest = createHash('sha256').update('').digest('hex');
  const signature = createHmac('sha256', keyBytes(KEY)).update(canonical({ time, nonce, publicOrigin: APP, apiOrigin: API, method, path, authorization, csrf, view, digest })).digest('hex');
  return { host: new URL(API).host, origin: APP, authorization, 'x-stocks-token': csrf, 'x-stocks-view': view, ...Object.fromEntries(Object.entries({ time, nonce, digest, signature }).map(([k, v]) => [PROOF + k, v])) };
}
const raw = (headers, url = '/__stocks_global/catalogue', method = 'GET') => ({ headers: { ...headers }, rawHeaders: Object.entries(headers).flat(), socket: { remoteAddress: '127.0.0.1' }, url, method });

test('Pages proxy is literal default OFF and never fetches without complete operator config', async () => {
  const previous = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw Error('unexpected fetch'); };
  try {
    for (const value of [undefined, 'false', 'TRUE', '1']) assert.equal((await stocksPages(request(), { ...ENV, STOCKS_PAGES_PROXY_ENABLED: value })).status, 503);
    for (const config of [{ STOCKS_EDGE_TRANSPORT_KEY: '' }, { STOCKS_API_INGRESS_ORIGIN: APP }, { STOCKS_PUBLIC_ORIGIN: 'http://app.invalid' }, { STOCKS_API_INGRESS_ORIGIN: API + '/api' }]) assert.equal((await stocksPages(request(), { ...ENV, ...config })).status, 503);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});

test('Pages keeps one origin, drops platform forwarding/cookies, binds ordinary bearer and never relays financial methods', async () => {
  const previous = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, init) => { requests.push({ url, init }); return Response.json({ catalogue: [] }, { headers: { 'set-cookie': 'never=forward', 'x-stocks-authority-key': 'never=forward' } }); };
  try {
    const response = await stocksPages(request('state?id=BYBIT%3AAAPLXUSDT', { headers: { cookie: 'not-forwarded', 'x-forwarded-for': 'untrusted', 'x-forwarded-proto': 'https', 'x-stocks-authority-key': 'forged', 'x-stocks-view': 'view-one', 'x-stocks-token': 'csrf-one' } }), ENV);
    assert.equal(response.status, 200); assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('x-stocks-authority-key'), null); assert.equal(response.headers.get('cache-control'), 'no-store');
    const sent = requests[0]; assert.equal(sent.url, API + '/__stocks_global/state?id=BYBIT%3AAAPLXUSDT'); assert.equal(sent.init.redirect, 'manual');
    assert.equal(sent.init.headers.get('authorization'), TOKEN);
    for (const name of ['cookie', 'forwarded', 'x-forwarded-for', 'x-forwarded-proto', 'x-stocks-authority-key', 'cf-connecting-ip']) assert.equal(sent.init.headers.get(name), null);
    const verifier = createPagesTransport({ publicOrigin: APP, apiOrigin: API, key: KEY });
    const headers = Object.fromEntries(sent.init.headers); headers.host = new URL(API).host;
    const req = raw(headers, '/__stocks_global/state?id=BYBIT%3AAAPLXUSDT'); verifier(req, Buffer.alloc(0)); assert.equal(req.headers.host, new URL(APP).host);
    for (const path of ['orders', 'cancel', 'balances', 'refresh']) {
      const denied = await stocksPages(request(path, { method: 'POST', headers: { origin: APP } }), ENV);
      assert.equal(denied.status, 403); assert.equal((await denied.json()).error, 'ACCOUNT_TRADING_DISABLED');
    }
    assert.equal(requests.length, 1);
  } finally { globalThis.fetch = previous; }
});

test('foreign/missing session, encoded paths, duplicate selectors, origin/header forgery and methods never cross Pages', async () => {
  const previous = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({}); };
  try {
    const cases = [
      [request('catalogue', { headers: { authorization: '' } }), 401],
      [new Request('https://foreign.invalid/__stocks_global/catalogue', { headers: { authorization: TOKEN } }), 403],
      [request('catalogue', { headers: { host: 'foreign.invalid' } }), 403],
      [request('catalogue', { headers: { origin: 'https://foreign.invalid' } }), 403],
      [request('catalogue', { headers: { 'sec-fetch-site': 'cross-site' } }), 403],
      [request('catalogue', { headers: { forwarded: 'host=forged' } }), 403],
      [request('catalogue', { headers: { 'x-forwarded-host': new URL(APP).host } }), 403],
      [request('catalogue', { headers: { [PROOF + 'signature']: '0'.repeat(64) } }), 403],
      [request('%63atalogue'), 404], [request('history?id=a&id=b'), 404],
      [request('history?token=private'), 404], [request('catalogue', { method: 'HEAD', headers: { origin: APP } }), 404],
      [request('lease?id=a', { method: 'DELETE' }), 403],
      [request('lease?id=a', { method: 'DELETE', headers: { origin: APP }, body: '{}' }), 403],
    ];
    for (const [req, status] of cases) assert.equal((await stocksPages(req, ENV)).status, status, req.url);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});

test('Pages refuses redirected or HTML/SPA upstreams, preserves real authorization failure', async () => {
  const previous = globalThis.fetch;
  try {
    for (const response of [new Response('', { status: 302, headers: { location: 'https://foreign.invalid' } }), new Response('<html/>', { headers: { 'content-type': 'text/html' } })]) {
      globalThis.fetch = async () => response; assert.equal((await stocksPages(request(), ENV)).status, 503);
    }
    globalThis.fetch = async () => Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 }); assert.equal((await stocksPages(request(), ENV)).status, 401);
  } finally { globalThis.fetch = previous; }
});

test('transport rejects invalid/mismatched signatures, body/session/host/view changes, stale proof, duplicates and replay', () => {
  const verifier = () => createPagesTransport({ publicOrigin: APP, apiOrigin: API, key: KEY });
  const valid = signed();
  for (const change of [{ host: 'other.invalid' }, { origin: 'https://foreign.invalid' }, { authorization: 'Bearer other.user.signature' }, { 'x-stocks-token': 'changed' }, { 'x-stocks-view': 'changed' }, { 'x-forwarded-host': new URL(APP).host }, { [PROOF + 'signature']: '0'.repeat(64) }]) assert.throws(() => verifier()(raw({ ...valid, ...change }), Buffer.alloc(0)));
  assert.throws(() => verifier()(raw(valid, '/__stocks_global/state'), Buffer.alloc(0)));
  assert.throws(() => verifier()(raw(valid), Buffer.from('unexpected')));
  assert.throws(() => verifier()(raw(signed(undefined, { time: String(Date.now() - 20000) })), Buffer.alloc(0)));
  const duplicate = raw(valid); duplicate.rawHeaders.push('Authorization', TOKEN); assert.throws(() => verifier()(duplicate, Buffer.alloc(0)));
  const foreign = raw(valid); foreign.socket.remoteAddress = '192.0.2.1'; assert.throws(() => verifier()(foreign, Buffer.alloc(0)));
  const v = verifier(); v(raw(valid), Buffer.alloc(0)); assert.throws(() => v(raw(valid), Buffer.alloc(0)), /EDGE_PROOF_REPLAY/);
  for (const name of ['orders', 'cancel', 'balances', 'refresh']) assert.throws(() => verifier()(raw(signed('/__stocks_global/' + name, { method: 'POST' }), '/__stocks_global/' + name, 'POST'), Buffer.alloc(0)), /ACCOUNT_TRADING_DISABLED/);
});

test('nonce admission is bounded, never evicts a live proof; no replay window from future timestamps', () => {
  let now = Date.now(); const v = createPagesTransport({ publicOrigin: APP, apiOrigin: API, key: KEY, now: () => now, maxNonces: 1 });
  const first = signed(undefined, { time: String(now + 9000) }); v(raw(first), Buffer.alloc(0));
  now += 11000; assert.throws(() => v(raw(first), Buffer.alloc(0)), /EDGE_PROOF_REPLAY/);
  assert.throws(() => v(raw(signed(undefined, { time: String(now) })), Buffer.alloc(0)), /ACCOUNT_BUSY/);
  now += 10000; v(raw(signed(undefined, { time: String(now) })), Buffer.alloc(0));
});

test('actual signed ingress reuses the unchanged exact-origin/loopback gateway contract', async t => {
  const received = []; const backend = http.createServer((req, res) => { received.push({ host: req.headers.host, origin: req.headers.origin, auth: req.headers.authorization, proof: Object.keys(req.headers).some(k => k.startsWith(PROOF)) }); res.setHeader('content-type', 'application/json'); res.end('{"catalogue":[]}'); });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve)); t.after(() => { backend.closeAllConnections(); return new Promise(resolve => backend.close(resolve)); });
  const ingress = await createHostedIngress({ origin: APP, gatewayPort: backend.address().port, port: 0, transport: createPagesTransport({ publicOrigin: APP, apiOrigin: API, key: KEY }) }); t.after(() => ingress.close());
  assert.equal(ingress.server.address().address, '127.0.0.1');
  const send = headers => new Promise((resolve, reject) => { const req = http.request({ host: '127.0.0.1', port: ingress.port, path: '/__stocks_global/catalogue', headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); });
  const headers = signed(); assert.equal(await send(headers), 200); assert.equal(await send(headers), 403);
  assert.equal(await send({ host: new URL(API).host, origin: APP, authorization: TOKEN }), 403);
  assert.deepEqual(received, [{ host: '127.0.0.1:' + backend.address().port, origin: 'http://127.0.0.1:' + backend.address().port, auth: TOKEN, proof: false }]);
});
