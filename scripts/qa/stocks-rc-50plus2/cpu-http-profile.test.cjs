'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const dc = require('node:diagnostics_channel');
const { setTimeout: wait } = require('node:timers/promises');
const { createProfiler, safeProfile, correlation, route } = require('./cpu-http-profile.cjs');

test('default-off installs no HTTP hook or diagnostics subscription', async () => {
  const original = http.Server.prototype.emit, channel = dc.channel('undici:request:create');
  const before = channel.hasSubscribers;
  const p = createProfiler();
  assert.deepEqual(await p.start(), { enabled: false });
  assert.deepEqual(await p.stop(), { enabled: false });
  assert.equal(http.Server.prototype.emit, original);
  assert.equal(channel.hasSubscribers, before);
});

test('explicit role, event and duration bounds cannot be silently exceeded', () => {
  for (const opts of [{ role: 'prod' }, { role: 'api', maxEvents: 20001 },
    { role: 'api', durationMs: 45001 }, { role: 'api', maxEvents: 0 }]) {
    assert.throws(() => createProfiler({ enabled: true, ...opts }), /PROFILE_(ROLE|BOUND)_REQUIRED/);
  }
});

test('correlation and route classification never export arbitrary identities, URLs or queries', () => {
  assert.equal(correlation({ 'x-rc50-request': 'mixed-measure-15' }), 'mixed-measure-15');
  assert.equal(correlation('authorization: Bearer SECRET\r\nx-rc50-request: baseline-warm-1\r\n'), 'baseline-warm-1');
  assert.equal(correlation({ 'x-rc50-request': 'private-user-subject' }), null);
  assert.equal(correlation(['authorization', 'Bearer SECRET', 'x-rc50-request', 'mixed-measure-7']), 'mixed-measure-7');
  assert.equal(correlation(['x-rc50-request', 'mixed-measure-7', 'x-rc50-request', 'mixed-measure-8']), null);
  assert.equal(route('/__stocks_global/state?token=SECRET'), 'stocks.state');
  assert.equal(route('/api/orders/private-identity?key=SECRET'), 'other');
});

test('CPU profile excludes absolute paths, arbitrary function names and URLs; truncation stays explicit', () => {
  const input = { nodes: [
    { id: 1, callFrame: { url: 'https://user:SECRET@host/a?token=SECRET', functionName: 'PRIVATE_NAME' }, children: [2, 3] },
    { id: 2, callFrame: { url: 'node:internal/deps/undici/undici', functionName: 'parse', lineNumber: 4 } },
    { id: 3, callFrame: { url: '/private/SECRET.js' } }], samples: [1, 2, 3, 1], timeDeltas: [1, 2, 3, 4] };
  const result = safeProfile(input, __dirname, 2, 3);
  assert.equal(/SECRET|PRIVATE_NAME/.test(JSON.stringify(result)), false);
  assert.equal(result.droppedNodes, 1); assert.equal(result.droppedSamples, 1);
  assert.deepEqual(result.samples, [1, 2, 0]); assert.deepEqual(result.timeDeltas, [1, 2, 3]);
  assert.equal(result.nodes[1].frame.source, 'node:internal/deps/undici/undici');
  assert.deepEqual(result.nodes[0].children, [2]);
});

test('events are bounded, errors sanitized and stop restores hooks/subscriptions exactly once', async () => {
  const original = http.Server.prototype.emit, channel = dc.channel('undici:request:error');
  const before = channel.hasSubscribers;
  const p = createProfiler({ enabled: true, role: 'test', cpu: false, maxEvents: 2 });
  await p.start();
  const request = { path: '/secret/path?password=SECRET', headers: 'authorization: Bearer SECRET' };
  for (let i = 0; i < 3; i++) channel.publish({ request, error: { code: 'SECRET', message: 'SECRET' } });
  const [a, b] = await Promise.all([p.stop(), p.stop()]);
  assert.equal(a, b); assert.equal(a.events.length, 2); assert.equal(a.droppedEvents, 1);
  assert.equal(/SECRET/.test(JSON.stringify(a)), false);
  assert.equal(a.events[0].code, 'OTHER'); assert.equal(a.events[0].request, a.events[1].request);
  assert.equal(http.Server.prototype.emit, original); assert.equal(channel.hasSubscribers, before);
  channel.publish({ request }); assert.equal(a.events.length, 2);
  await assert.rejects(p.start(), /PROFILE_SINGLE_USE/);
});

test('automatic deadline stops collection and unhooks without changing the server', async () => {
  const original = http.Server.prototype.emit;
  const p = createProfiler({ enabled: true, role: 'test', cpu: false, durationMs: 10 });
  await p.start(); await wait(30);
  assert.equal(http.Server.prototype.emit, original);
  assert.equal((await p.stop()).reason, 'deadline');
});

test('local inspector CPU capture produces sanitized bounded samples without opening an inspector port', async () => {
  const inspector = require('node:inspector'), before = inspector.url();
  const p = createProfiler({ enabled: true, role: 'test', root: __dirname });
  await p.start(); await wait(35);
  const result = await p.stop();
  assert.equal(result.profileError, undefined);
  assert.ok(result.profile.nodes.length > 0);
  assert.ok(result.profile.samples.length <= 60000);
  assert.ok(result.elapsedMs > 0); assert.equal(inspector.url(), before);
});

test('native fetch trace distinguishes advertised 2 s connection churn from 5 s reuse', async () => {
  for (const [timeout, expectedConnections] of [[2000, 3], [5000, 1]]) {
    const server = http.createServer((req, res) => res.end('ok'));
    server.keepAliveTimeout = timeout;
    const p = createProfiler({ enabled: true, role: 'test', cpu: false });
    await p.start();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      for (let i = 1; i <= 3; i++) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/__stocks_global/health`,
          { headers: { 'x-rc50-request': `baseline-measure-${i}` } });
        assert.equal(response.status, 200); await response.text(); await wait(30);
      }
      const result = await p.stop();
      assert.equal(result.events.filter(e => e.kind === 'server.accept').length, expectedConnections);
      const sent = result.events.filter(e => e.kind === 'undici:client:sendHeaders');
      assert.equal(sent.length, 3); assert.equal(new Set(sent.map(e => e.socket)).size, expectedConnections);
      assert.deepEqual(sent.map(e => e.correlation), ['baseline-measure-1', 'baseline-measure-2', 'baseline-measure-3']);
      const callbacks = result.events.filter(e => e.kind === 'server.callback');
      assert.deepEqual(callbacks.map(e => e.correlation), ['baseline-measure-1', 'baseline-measure-2', 'baseline-measure-3']);
      assert.equal(result.events.filter(e => e.kind === 'undici:request:trailers').length, 3);
      assert.ok(sent.every(e => e.request !== null));
      assert.equal(result.droppedEvents, 0);
    } finally { await p.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});
