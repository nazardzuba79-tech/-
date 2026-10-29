import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createAuthorityAdapter } from './authority-adapter.mjs';
import { accountId } from './accounts.mjs';
import { createServer } from './server.mjs';
import { createViewerStream } from './viewer-stream.mjs';
import { CATALOG } from './catalog.mjs';
import { SimError } from './engine.mjs';

// #613 R9 prototype (viewer-stream.mjs): public quote events for viewers instead of a state poll each. These cases pin
// what it may never become: a way to receive personal data, a delivery without a live judgement after the previous
// one, an unbounded buffer, or something the release turns on by itself.
const ISSUER = 'viewer-stream-fixture', KEY = 'synthetic-viewer-stream-capability-00000';
const bearer = letter => 'Bearer ' + letter.repeat(32);
const SUBJECTS = { A: 'trader-a', V: 'viewer-v', W: 'viewer-w' };
const X = CATALOG.find(i => i.provider === 'bybit').id;
function authorityDouble() {
  const batches = [], revoked = new Set(), renamed = new Map();
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/identities')) {
      const tokens = JSON.parse(options.body).tokens; batches.push(tokens.map(token => token[0]).sort().join(''));
      return new Response(JSON.stringify({ results: tokens.map(token => revoked.has(token[0]) ? { error: 'AUTH_REQUIRED' } : { issuer: ISSUER, subject: renamed.get(token[0]) ?? SUBJECTS[token[0]] }) }));
    }
    return new Response(JSON.stringify({ error: 'UNEXPECTED_COMMAND' }), { status: 500 });
  };
  return { batches, revoked, renamed, adapter: createAuthorityAdapter({ endpoint: 'http://127.0.0.1:1/api/v1/stocks-test-cash', issuer: ISSUER, gatewayKey: KEY, fetchImpl }) };
}
const quoteOf = id => ({ instrumentId: id, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100.5', timestamp: Date.now(), receivedAt: Date.now(), verified: true, marketOpen: true, eventId: 'stream-' + Date.now(), capacity: '1.00000000', prices: { USDT: { buy: '100.5', sell: '100' }, USDC: { buy: '100.5', sell: '100' } }, fx: {} });
async function gateway(t, { viewerStream = true, quote = async id => quoteOf(id) } = {}) {
  const double = authorityDouble();
  const app = await createServer({ port: 0, autoPoll: false, financialEnabled: true, accountAuthority: double.adapter, viewerStream,
    tradePrincipals: [{ issuer: ISSUER, subject: 'trader-a' }, { issuer: ISSUER, subject: 'trader-b' }],
    hub: { metrics: {}, close() {}, catalogue: async () => CATALOG.map(asset => ({ ...asset, online: true, exists: true })), quote } });
  t.after(async () => { await app.close(); await double.adapter.close(); });
  return { app, ...double };
}
// An event-stream client: every event as {event, data}, and the raw text received.
function subscribe(port, letter) {
  const client = { events: [], raw: '', status: null, headers: null, ended: false };
  client.request = http.get({ host: '127.0.0.1', port, path: '/__stocks_global/stream?id=' + encodeURIComponent(X), agent: false, headers: { authorization: bearer(letter) } }, res => {
    client.status = res.statusCode; client.headers = res.headers; let buffer = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { client.raw += chunk; buffer += chunk; let i; while ((i = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0, i); buffer = buffer.slice(i + 2); const event = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.+)$/m.exec(block)?.[1]; if (event) client.events.push({ event, data: JSON.parse(data) }); } });
    res.on('end', () => { client.ended = true; });
  });
  client.request.on('error', () => {});
  return client;
}
const until = async (condition, ms = 6000) => { const end = Date.now() + ms; while (!condition() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(condition(), 'condition not met in time'); };

test('a viewer stream carries the public quote only, each delivery after its own live check, the checks of a period in one batch', async t => {
  const { app, batches } = await gateway(t);
  const v = subscribe(app.port, 'V'), w = subscribe(app.port, 'W');
  await until(() => v.events.filter(e => e.event === 'quote').length >= 2 && w.events.filter(e => e.event === 'quote').length >= 2);
  assert.equal(v.status, 200); assert.equal(v.headers['content-type'], 'text/event-stream'); assert.equal(v.headers['cache-control'], 'no-store');
  for (const { event, data } of [...v.events, ...w.events].filter(e => e.event === 'quote')) {
    assert.deepEqual(Object.keys(data).sort(), ['instrumentId', 'quote', 'serverTime']);
    assert.equal(data.instrumentId, X); assert.equal(data.quote.instrumentId, X);
  }
  // Nothing personal on the wire: no account, wallet, position, order, fill or CSRF token.
  for (const word of ['account', 'wallets', 'positions', 'orders', 'fills', 'token', 'canTrade']) assert.equal(v.raw.includes('"' + word + '"'), false, word);
  // After the two opening checks (one per request), every period judged both bearers again, together.
  assert.ok(batches.filter(b => b === 'VW').length >= 2, JSON.stringify(batches));
  assert.equal(app.streamMetrics().streams, 2);
});

test('signed out or switched to another account: the stream is told and closed at the next delivery; the others go on', async t => {
  const { app, revoked, renamed } = await gateway(t);
  const v = subscribe(app.port, 'V'), w = subscribe(app.port, 'W');
  await until(() => v.events.some(e => e.event === 'quote') && w.events.some(e => e.event === 'quote'));
  revoked.add('V');
  await until(() => v.ended);
  assert.equal(v.events.at(-1).event, 'revoked');
  const quotesBefore = w.events.length;
  await until(() => w.events.length >= quotesBefore + 2);
  assert.ok(w.events.slice(quotesBefore).every(e => e.event === 'quote'), 'W keeps its quotes');
  // The same bearer now answers for another principal (account switch on that device): no event for anyone else.
  renamed.set('W', 'viewer-other');
  await until(() => w.ended);
  assert.equal(w.events.at(-1).event, 'revoked');
  assert.equal(app.streamMetrics().streams, 0);
});

test('no live quote: the event says so and carries no price', async t => {
  const { app } = await gateway(t, { quote: async () => { throw new SimError('QUOTE_UNAVAILABLE'); } });
  const v = subscribe(app.port, 'V');
  await until(() => v.events.some(e => e.event === 'unavailable'));
  assert.deepEqual(v.events.find(e => e.event === 'unavailable').data, { instrumentId: X, error: 'QUOTE_UNAVAILABLE' });
  assert.equal(v.events.some(e => e.event === 'quote'), false);
});

test('off unless the gateway is created with viewerStream: the release has no stream route', async t => {
  const { app } = await gateway(t, { viewerStream: false });
  const v = subscribe(app.port, 'V');
  await until(() => v.ended);
  assert.notEqual(v.status, 200); assert.notEqual(v.headers['content-type'], 'text/event-stream');
  assert.equal(app.streamMetrics(), null);
});

// The module alone, with stand-in responses: the bounds.
const fakeResponse = () => Object.assign(new EventEmitter(), { writableLength: 0, destroyed: false, written: [], writeHead() {}, write(chunk) { this.written.push(chunk); return true; }, end(chunk) { if (chunk) this.written.push(chunk); this.ended = true; }, destroy() { this.destroyed = true; this.emit('close'); } });
const moduleStream = (options = {}) => createViewerStream({ authorize: async authorization => accountId({ issuer: ISSUER, subject: authorization }), readQuote: async id => quoteOf(id), project: (id, q) => ({ instrumentId: id, bid: q.bid }), timers: { setInterval: () => ({}), clearInterval() {} }, ...options });

test('bounded: at most maxStreams streams, a subscriber that does not read is closed, a quota refusal only skips a period', async () => {
  const s = moduleStream({ maxStreams: 2, maxBufferedBytes: 100 });
  const a = fakeResponse(), b = fakeResponse();
  s.open(a, { authorization: 'a', principalId: accountId({ issuer: ISSUER, subject: 'a' }), instrumentId: X });
  s.open(b, { authorization: 'b', principalId: accountId({ issuer: ISSUER, subject: 'b' }), instrumentId: X });
  assert.throws(() => s.open(fakeResponse(), { authorization: 'c', principalId: 'c', instrumentId: X }), error => error.code === 'SOURCE_BUSY' && error.retryAfterMs === 1000);
  b.writableLength = 101; // b's client stopped reading
  await s.tick();
  assert.equal(b.destroyed, true); assert.equal(s.metrics().slow, 1); assert.equal(s.metrics().streams, 1);
  assert.ok(a.written.at(-1).startsWith('event: quote'));
  const limited = moduleStream({ authorize: async () => { throw Object.assign(new SimError('AUTH_RATE_LIMIT'), { retryAfterMs: 2000 }); } }), c = fakeResponse();
  limited.open(c, { authorization: 'c', principalId: 'c', instrumentId: X });
  await limited.tick();
  assert.equal(c.written.at(-1), 'event: wait\ndata: {"retryAfterMs":2000}\n\n'); assert.equal(c.ended, undefined, 'the stream stays');
  assert.equal(c.written.some(chunk => chunk.startsWith('event: quote')), false, 'no price without a live judgement');
});
