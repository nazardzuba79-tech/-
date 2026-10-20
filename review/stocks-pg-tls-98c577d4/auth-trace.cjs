'use strict';
// Isolated smoke-only preload. Never copy into the application image.
const http = require('node:http');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const dc = require('node:diagnostics_channel');
const assert = require('node:assert/strict');

const APP = '98c577d4241ce527f7bfca3b78dd7bb78255e300';
const HEADER = 'x-smoke-correlation-id';
const ROLES = new Set(['api', 'finance-off', 'gateway']);
const COMMANDS = new Set(['ensure', 'readView', 'portfolioView', 'observe', 'observeFailed',
  'observeBackground', 'observeFailedBackground', 'submitObserved', 'cancel']);
const ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ABORT_ERR',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
function fixtureScope(env, config) {
  assert.equal(env.STOCKS_SMOKE_TRACE, 'isolated-v1', 'SMOKE_TRACE_SCOPE_INVALID');
  assert.equal(env.STOCKS_SMOKE_TRACE_APP, APP, 'SMOKE_TRACE_SCOPE_INVALID');
  assert.ok(ROLES.has(env.STOCKS_SMOKE_TRACE_ROLE), 'SMOKE_TRACE_SCOPE_INVALID');
  const url = new URL(config.databaseUrl);
  assert.ok(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' &&
    url.port === '5432' && /^\/stocks_disposable_pg_tls_[0-9]+$/.test(url.pathname),
  'SMOKE_TRACE_SCOPE_INVALID');
  assert.equal(config.issuer, 'stocks-isolated-smoke', 'SMOKE_TRACE_SCOPE_INVALID');
  assert.deepEqual(config.principals, ['stocks-smoke-trader-a', 'stocks-smoke-trader-b']
    .map(subject => ({ issuer: config.issuer, subject })), 'SMOKE_TRACE_SCOPE_INVALID');
}
function route(raw) {
  const path = String(raw || '').split('?')[0];
  const map = {
    '/api/v1/stocks-test-cash/identity': 'identity',
    '/api/v1/stocks-test-cash/command': 'command',
    '/api/v1/stocks-test-cash/readiness': 'readiness',
    '/__stocks_global/orders': 'orders', '/__stocks_global/cancel': 'cancel',
    '/__stocks_global/state': 'state', '/__stocks_global/history': 'history',
  };
  return map[path] || 'other';
}
function safeCode(error) {
  const value = error?.cause?.code || error?.code;
  return ERROR_CODES.has(value) ? value : error?.name === 'AbortError' ? 'ABORTED' : 'OTHER';
}
function media(value) {
  return /^application\/json\b/i.test(String(value || '')) ? 'json' :
    /^text\//i.test(String(value || '')) ? 'text' : 'other';
}
function numeric(value) {
  return /^\d{1,9}$/.test(String(value ?? '')) ? Number(value) : null;
}
function installTrace({ role, write = line => console.log(line), authorityPort = 3000,
  gatewayPort = 4437, maxEvents = 4000 } = {}) {
  assert.ok(ROLES.has(role), 'SMOKE_TRACE_SCOPE_INVALID');
  const context = new AsyncLocalStorage(), requests = new WeakMap();
  const originalEmit = http.Server.prototype.emit, originalRequest = http.request;
  const originalFetch = globalThis.fetch;
  let emitted = 0, inbound = 0, outbound = 0;
  function emit(data) {
    // Never serialize errors, headers, URLs, bodies, identities, JWTs or cookies.
    // The only strings passed here are constants, enums and generated UUIDs.
    if (emitted++ >= maxEvents) {
      if (emitted === maxEvents + 1) {
        try { write(JSON.stringify({ smokeTrace: 'auth-v1', role, stage: 'trace-limit' })); } catch {}
      }
      return;
    }
    try { write(JSON.stringify({ smokeTrace: 'auth-v1', role, ...data })); } catch { /* observability only */ }
  }
  function externalContext(req) {
    // Only internally generated UUIDv4 values may cross this fixture boundary.
    const supplied = req.headers?.[HEADER];
    return typeof supplied === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(supplied)
      ? supplied : randomUUID();
  }
  http.Server.prototype.emit = function (event, ...args) {
    if (event !== 'request') return originalEmit.call(this, event, ...args);
    const [req, res] = args, kind = route(req.url);
    if (kind === 'other') return originalEmit.call(this, event, ...args);
    const ctx = { id: externalContext(req), kind, sequence: ++inbound, identityCalls: 0,
      orderSent: 0, orderAck: 0 }, started = performance.now();
    emit({ stage: 'http-start', id: ctx.id, route: kind, sequence: ctx.sequence });
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      emit({ stage: 'http-end', id: ctx.id, route: kind, sequence: ctx.sequence,
        status: res.statusCode, completed: res.writableFinished, requestAborted: req.aborted,
        elapsedMs: Math.round(performance.now() - started), identityCalls: ctx.identityCalls,
        orderCommandSent: ctx.orderSent,
        requestedOrderCommit: role === 'gateway' && req.socket.localPort === gatewayPort
          ? (ctx.orderSent === 0 ? 'NOT_SUBMITTED' : ctx.orderAck === ctx.orderSent ? 'ACK_AFTER_COMMIT' : 'UNKNOWN')
          : 'NOT_OBSERVED',
        rateLimit: numeric(res.getHeader('ratelimit-limit')),
        rateRemaining: numeric(res.getHeader('ratelimit-remaining')),
        retryAfter: numeric(res.getHeader('retry-after')) });
    };
    res.once('finish', finish); res.once('close', finish);
    return context.run(ctx, () => originalEmit.call(this, event, ...args));
  };
  // The unchanged hosted ingress deliberately filters headers. Propagate only
  // this diagnostic UUID across its loopback hop, not any authorization decision.
  http.request = function (options, ...args) {
    const ctx = context.getStore();
    if (ctx && options && typeof options === 'object' && options.host === '127.0.0.1' &&
      Number(options.port) === gatewayPort && route(options.path) !== 'other') {
      options = { ...options, headers: { ...options.headers, [HEADER]: ctx.id } };
    }
    return originalRequest.call(this, options, ...args);
  };
  globalThis.fetch = async function (input, init) {
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); } catch {}
    const kind = route(url?.pathname);
    if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      Number(url.port) !== authorityPort || !['identity', 'command', 'readiness'].includes(kind))
      return originalFetch.call(this, input, init);
    const parent = context.getStore(), id = parent?.id || randomUUID(), call = ++outbound;
    let command = null;
    if (kind === 'command' && typeof init?.body === 'string') {
      try { const type = JSON.parse(init.body).type; if (COMMANDS.has(type)) command = type; } catch {}
    }
    const mutation = ['submitObserved', 'cancel'].includes(command);
    if (parent && kind === 'identity') parent.identityCalls++;
    if (parent && mutation) parent.orderSent++;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(HEADER, id);
    const started = performance.now(), trace = { id, call, route: kind, command,
      identityOrdinal: kind === 'identity' ? parent?.identityCalls ?? null : null };
    emit({ stage: 'authority-start', ...trace });
    try {
      // Preserve original timeout signal, method, body and all security headers.
      // No retries or eager/parallel response-body reads.
      const response = await context.run({ ...parent, ...trace, outboundTrace: trace },
        () => originalFetch.call(this, input, { ...init, headers }));
      if (parent && mutation && response.status === 200) parent.orderAck++;
      emit({ stage: 'authority-headers', ...trace, status: response.status,
        elapsedMs: Math.round(performance.now() - started),
        media: media(response.headers.get('content-type')),
        contentLength: numeric(response.headers.get('content-length')),
        rateLimit: numeric(response.headers.get('ratelimit-limit')),
        rateRemaining: numeric(response.headers.get('ratelimit-remaining')),
        retryAfter: numeric(response.headers.get('retry-after')) });
      if (kind === 'identity' && response.body) {
        const body = response.body, iterate = body[Symbol.asyncIterator].bind(body);
        // Observe the iterator actually consumed by the unchanged adapter, without
        // cloning, prefetching or retaining unbounded data. Never log the bytes.
        body[Symbol.asyncIterator] = async function* (...args) {
          let bytes = 0, complete = false, prefix = [];
          try {
            for await (const chunk of { [Symbol.asyncIterator]: () => iterate(...args) }) {
              bytes += chunk.byteLength;
              if (bytes <= 8192) prefix.push(Buffer.from(chunk)); else prefix = null;
              yield chunk;
            }
            complete = true;
          } catch (error) {
            emit({ stage: 'authority-body-error', ...trace, errorCode: safeCode(error),
              signalAborted: Boolean(init?.signal?.aborted), bytes,
              elapsedMs: Math.round(performance.now() - started) });
            throw error;
          } finally {
            let json = 'NOT_INSPECTED';
            if (complete && prefix) {
              try { JSON.parse(Buffer.concat(prefix).toString('utf8')); json = 'VALID'; }
              catch { json = 'INVALID'; }
            }
            emit({ stage: 'authority-body-end', ...trace, bytes, complete, json,
              exceedsAdapterLimit: bytes > 8 * 1024 * 1024,
              elapsedMs: Math.round(performance.now() - started) });
          }
        };
      }
      return response;
    } catch (error) {
      emit({ stage: 'authority-fetch-error', ...trace, errorCode: safeCode(error),
        signalAborted: Boolean(init?.signal?.aborted), elapsedMs: Math.round(performance.now() - started) });
      throw error;
    }
  };
  const onCreate = ({ request }) => {
    const trace = context.getStore()?.outboundTrace;
    if (trace) requests.set(request, { ...trace, started: performance.now() });
  };
  const onError = ({ request, error }) => {
    const trace = requests.get(request); if (!trace) return;
    const { started, ...fields } = trace;
    emit({ stage: 'authority-stream-error', ...fields, errorCode: safeCode(error),
      elapsedMs: Math.round(performance.now() - started) });
  };
  dc.channel('undici:request:create').subscribe(onCreate);
  dc.channel('undici:request:error').subscribe(onError);
  return () => {
    http.Server.prototype.emit = originalEmit; http.request = originalRequest;
    globalThis.fetch = originalFetch;
    dc.channel('undici:request:create').unsubscribe(onCreate);
    dc.channel('undici:request:error').unsubscribe(onError);
  };
}

module.exports = { fixtureScope, installTrace };
if (process.env.STOCKS_SMOKE_TRACE) {
  try {
    const config = JSON.parse(require('node:fs').readFileSync('/smoke-private/config.json', 'utf8'));
    fixtureScope(process.env, config);
    installTrace({ role: process.env.STOCKS_SMOKE_TRACE_ROLE });
  } catch { throw new Error('SMOKE_TRACE_SCOPE_INVALID'); }
}
