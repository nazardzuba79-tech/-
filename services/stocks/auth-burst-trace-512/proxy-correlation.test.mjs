import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import fs from 'node:fs';
import { createLocalStocksProxy } from '../../stocks-global/local-proxy.mjs';
import { TRACE_HEADER_SOURCE, transformServiceEntry } from './service-overlay.mjs';

// Execute the actual guarded gateway addition and unchanged product proxy with
// only native HTTP transport replaced. No sockets, app, identity or DB opened.
function forwarded({ url = '/__stocks_global/state', method = 'GET', requestId = 'trace_01', derived = true } = {}) {
  const req = new PassThrough();
  Object.assign(req, { url, method, socket: { remoteAddress: '127.0.0.1' }, rawHeaders: [],
    headers: { host: '127.0.0.1:4441', 'x-fixture-request-id': requestId } });
  if (derived) vm.runInNewContext(TRACE_HEADER_SOURCE, { req, requestId });
  const res = new EventEmitter();
  Object.assign(res, { headersSent: false, writableFinished: false,
    writeHead(status) { this.statusCode = status; this.headersSent = true; }, end() {} });
  let captured;
  const original = http.request;
  http.request = options => {
    assert.equal(captured, undefined, 'one outbound attempt'); captured = options;
    return new Writable({ write(_bytes, _encoding, callback) { callback(); } });
  };
  try {
    createLocalStocksProxy({ origin: () => 'http://127.0.0.1:4441', stocksOrigin: () => 'http://127.0.0.1:4442' })(req, res);
    req.emit('aborted'); // Close the fake original proxy's timer and streams.
  } finally { http.request = original; req.destroy(); }
  return { captured, req, res };
}

test('actual proxy drops fixture-only correlation; derived gateway forwards exact timed IDs through existing header', () => {
  assert.equal(forwarded({ derived: false }).captured.headers['x-fixture-request-id'], undefined);
  assert.equal(forwarded({ derived: false }).captured.headers['x-stocks-view'], undefined);
  for (const requestId of ['trace_01', 'trace_25', 'trace_50']) {
    const { captured } = forwarded({ requestId });
    assert.equal(captured.headers['x-stocks-view'], requestId);
    assert.equal(captured.headers['x-fixture-request-id'], undefined);
    assert.equal(captured.path, '/__stocks_global/state');
    assert.equal(captured.agent, false);
  }
});

test('warmup, safety, other routes, query/id and out-of-range IDs never receive trace header', () => {
  for (const options of [
    { requestId: 'warmup_01' }, { requestId: 'trace_00' }, { requestId: 'trace_51' },
    { requestId: 'trace_1' }, { url: '/__stocks_global/state?id=BYBIT%3AAAPLXUSDT' },
    { url: '/__stocks_global/portfolio' }, { url: '/__stocks_global/health' },
    { url: '/__stocks_global/orders', method: 'POST' },
  ]) assert.equal(forwarded(options).req.headers['x-stocks-view'], undefined);
});

test('tested correlation source is present exactly once in hash-guarded disposable entry', () => {
  const original = fs.readFileSync(new URL('../auth-http-fixture-512/stock-child.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const derived = transformServiceEntry(Buffer.from(original)).output.toString();
  assert.equal(derived.split(TRACE_HEADER_SOURCE).length - 1, 1);
  assert.equal(original.includes(TRACE_HEADER_SOURCE), false);
  const server = fs.readFileSync(new URL('../../stocks-global/server.mjs', import.meta.url), 'utf8');
  assert.ok(/const id=u\.searchParams\.get\('id'\);if\(id\)\{[^\r\n]*req\.headers\['x-stocks-view'\]/.test(server),
    'state lease header use must remain guarded by a selected instrument id');
});
