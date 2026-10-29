'use strict';
// driver.cjs --sustained handling against fake loopback servers (no runtime, no database): a viewer 429 with
// Retry-After defers that viewer's polls, a trader 429 is waited out and the same request sent again (same intent),
// a quote that is not live is counted, and the acceptance path (no 'sustained') still fails on a viewer 429.
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const {window} = require('./driver.cjs');

function server(handler) { return new Promise(resolve => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); }); }
const json = (res, status, body, headers = {}) => { res.writeHead(status, {'content-type': 'application/json', ...headers}); res.end(body === undefined ? '' : JSON.stringify(body)); };
const read = req => new Promise(resolve => { const parts = []; req.on('data', p => parts.push(p)); req.on('end', () => resolve(parts.length ? JSON.parse(Buffer.concat(parts)) : null)); });

async function fixture(t, {viewer429From = Infinity, viewer429Until = -Infinity, traderRefuse = new Set(), traderStale = new Set(), quoteNotLive = () => false, dropViewers = () => false} = {}) {
  let orders = 0; const open = new Map(), seen = {intents: new Map(), refused: []}, start = Date.now();
  const api = await server(async (req, res) => {
    const u = new URL(req.url, 'http://x'); await read(req);
    if (req.method === 'POST' && u.pathname === '/api/v1/demo/orders') { const id = 'o' + (++orders); open.set(id, true); return json(res, 201, {order: {id, status: 'OPEN'}}); }
    if (u.pathname === '/api/v1/demo/orders/open') return json(res, 200, [...open.keys()].map(id => ({id})));
    if (req.method === 'DELETE') { open.delete(decodeURIComponent(u.pathname.split('/').pop())); return json(res, 204); }
    return json(res, 200, {balances: []});
  });
  const gateway = await server(async (req, res) => {
    const u = new URL(req.url, 'http://x'), body = await read(req), trader = req.headers.authorization.startsWith('Bearer trader'), at = Date.now() - start;
    // As a server over its maxConnections: the connection is dropped without an answer.
    if (!trader && dropViewers(at)) return req.socket.destroy();
    if (u.pathname.endsWith('/state')) {
      if (!trader && at >= viewer429From && at < viewer429Until) return json(res, 429, {error: 'AUTH_RATE_LIMIT', retryAfterMs: 1000}, {'retry-after': '1'});
      const id = u.searchParams.get('id');
      return json(res, 200, {account: {canTrade: trader}, token: 'csrf', catalogue: [], catalogueVersion: '0123456789abcdef', errors: quoteNotLive(at, trader) ? {[id]: 'QUOTE_UNAVAILABLE'} : {}});
    }
    if (!trader) return json(res, 401, {error: 'AUTH_REQUIRED'});
    const key = u.pathname.split('/').pop() + ':' + body.id;
    if (traderRefuse.has(key) && !seen.refused.includes(key)) { seen.refused.push(key); return json(res, 429, {error: 'AUTH_RATE_LIMIT', retryAfterMs: 1000}, {'retry-after': '1'}); }
    // A command the authority rolled back for a stale quote leaves nothing behind; the same intent may come again.
    if (traderStale.has(key) && !seen.refused.includes('stale:' + key)) { seen.refused.push('stale:' + key); return json(res, 422, {error: 'QUOTE_STALE'}); }
    seen.intents.set(key, (seen.intents.get(key) ?? 0) + 1);
    return json(res, 200, {ok: true});
  });
  t.after(() => { api.close(); gateway.close(); });
  const info = {apiOrigin: 'http://127.0.0.1:' + api.address().port, stocksOrigin: 'http://127.0.0.1:' + gateway.address().port, traderTokens: ['trader-0', 'trader-1'],
    viewerTokens: Array.from({length: 50}, (_, i) => 'viewer-' + i), instruments: ['BYBIT:AAPLXUSDT', 'BYBIT:NVDAXUSDT'], stockId: 'BYBIT:AAPLXUSDT'};
  return {info, seen};
}

test('sustained: viewer 429s defer that viewer, a refused trader request is sent again once, quotes not live are counted', async t => {
  const {info, seen} = await fixture(t, {viewer429From: 1500, viewer429Until: 2500, traderRefuse: new Set(['orders:rc50-mixed-0-0-sell']), quoteNotLive: (at, trader) => !trader && at >= 3500 && at < 3700});
  const r = await window(info, {arm: 'mixed', mixed: true, sustained: true, sustainedMs: 6000});
  assert.equal(r.unexpectedErrors, 0, JSON.stringify(r.errors)); assert.equal(r.timeouts, 0);
  assert.ok(r.viewerRateLimited >= 40, String(r.viewerRateLimited)); assert.equal(r.viewerRateLimitedWithoutRetryAfter, 0);
  assert.ok(r.viewerPollsDeferred > 0, 'a refused viewer skips its polls until Retry-After');
  assert.equal(r.traderRateLimited, 1); assert.equal(r.traderRateLimitedWithoutRetryAfter, 0);
  // The refused submit is accepted on its retry, then the scenario's own exact replay follows: two accepted sends of
  // the same intent, as for the buy, and one refusal recorded.
  assert.deepEqual(seen.refused, ['orders:rc50-mixed-0-0-sell']);
  assert.equal(seen.intents.get('orders:rc50-mixed-0-0-sell'), 2);
  assert.equal(seen.intents.get('orders:rc50-mixed-0-0-buy'), 2);
  assert.ok(Object.values(r.viewerQuoteNotLive).reduce((a, b) => a + b, 0) > 0);
  assert.equal(r.viewerDenials + r.samples.filter(s => s.op === 'deny-order' && s.status === 429).length, 50);
  assert.equal(r.viewerMutations, 0);
  const refused = r.samples.filter(s => s.kind === 'trader' && s.status === 429);
  assert.deepEqual(refused.map(s => [s.op, s.retryAfter, s.error]), [['submit-sell', '1', 'AUTH_RATE_LIMIT']]);
});

test('acceptance path unchanged: a viewer 429 or a quote that is not live is an error that stops the window', async t => {
  const {info} = await fixture(t, {viewer429From: 0, viewer429Until: 5000});
  const r = await window(info, {arm: 'mixed', mixed: true, sustained: false});
  assert.ok(r.unexpectedErrors >= 1); assert.match(r.errors[0].error, /HTTP_429_state/);
  const q = await fixture(t, {quoteNotLive: (at, trader) => !trader});
  const s = await window(q.info, {arm: 'mixed', mixed: true});
  assert.ok(s.unexpectedErrors >= 1); assert.match(s.errors[0].error, /VIEWER_QUOTE_QUOTE_UNAVAILABLE/);
});

test('sustained: an order step refused for a stale quote is sent again after a fresh read; outside --sustained it fails', async t => {
  const {info, seen} = await fixture(t, {traderStale: new Set(['orders:rc50-mixed-1-0-buy'])});
  const r = await window(info, {arm: 'mixed', mixed: true, sustained: true, sustainedMs: 5000});
  assert.equal(r.unexpectedErrors, 0, JSON.stringify(r.errors));
  assert.deepEqual(r.traderQuoteRefusals, {QUOTE_STALE: 1});
  assert.equal(seen.intents.get('orders:rc50-mixed-1-0-buy'), 2, 'accepted on its second send, then the scenario replay');
  assert.equal(r.samples.filter(s => s.op === 'state-refresh').length, 1);
  const strict = await fixture(t, {traderStale: new Set(['orders:rc50-mixed-1-0-buy'])});
  const a = await window(strict.info, {arm: 'mixed', mixed: true});
  assert.match(a.errors[0].error, /HTTP_422_submit-buy_"QUOTE_STALE"/);
});

test('sustained: a viewer read whose connection is dropped is sent once more, then counted as refused; the run goes on', async t => {
  const {info} = await fixture(t, {dropViewers: at => at >= 1500 && at < 2000});
  const r = await window(info, {arm: 'mixed', mixed: true, sustained: true, sustainedMs: 4000});
  assert.equal(r.unexpectedErrors, 0, JSON.stringify(r.errors));
  assert.ok(r.networkRetries > 0 && r.viewerConnectionsRefused > 0, JSON.stringify([r.networkRetries, r.viewerConnectionsRefused]));
  assert.ok(r.connectionErrors.length > 0 && r.connectionErrors.every(e => typeof e.cause === 'string'));
  assert.ok(r.samples.some(s => s.kind === 'viewer' && s.status === 200 && s.at > 2100), 'viewers are answered again after the drop');
  const strict = await fixture(t, {dropViewers: at => at >= 500 && at < 1500});
  const a = await window(strict.info, {arm: 'mixed', mixed: true});
  assert.ok(a.unexpectedErrors >= 1); assert.match(a.errors[0].error, /fetch failed/);
});
