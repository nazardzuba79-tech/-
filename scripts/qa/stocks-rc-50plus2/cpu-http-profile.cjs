'use strict';

// Harness-only observability. No dispatcher, timeout, authentication or financial hooks.
const dc = require('node:diagnostics_channel');
const http = require('node:http');
const inspector = require('node:inspector');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { performance, monitorEventLoopDelay, PerformanceObserver } = require('node:perf_hooks');
const LIMITS = Object.freeze({ durationMs: 5000, maxEvents: 20000, maxNodes: 10000,
  maxSamples: 12000, maxBytes: 4 * 1024 * 1024, maxStopOverrunMs: 250 });

const ROUTES = new Map([
  ['/__stocks_global/state', 'stocks.state'], ['/__stocks_global/portfolio', 'stocks.portfolio'],
  ['/__stocks_global/orders', 'stocks.orders'], ['/__stocks_global/health', 'stocks.health'],
  ['/__stocks_global/history', 'stocks.history'], ['/__stocks_global/quote', 'stocks.quote'],
  ['/api/state', 'stocks.state'], ['/api/portfolio', 'stocks.portfolio'],
  ['/api/orders', 'stocks.orders'], ['/api/order', 'stocks.order'],
  ['/api/v1/me', 'identity.me'], ['/api/v1/stocks-test-cash/identity', 'identity.stocks'],
  ['/api/v1/stocks-test-cash/command', 'authority.command'],
  ['/api/v1/stocks-test-cash/wallet', 'authority.wallet'],
  ['/api/v1/orders', 'crypto.orders'], ['/api/v1/balances', 'crypto.balances'],
]);
const CHANNELS = ['request:create', 'client:sendHeaders', 'request:bodySent', 'request:headers',
  'request:trailers', 'request:error', 'client:beforeConnect', 'client:connected', 'client:connectError'];
const correlation = headers => {
  let raw;
  if (Array.isArray(headers)) {
    // Node 22's bundled Undici exposes flattened name/value pairs, unlike the
    // inbound Node HTTP header object. Do not copy/log the other header values.
    if (headers.length > 512 || headers.length % 2) return null;
    let matches = 0;
    for (let i = 0; i < headers.length; i += 2) {
      if (typeof headers[i] === 'string' && headers[i].toLowerCase() === 'x-rc50-request') {
        matches++; raw = headers[i + 1];
      }
    }
    if (matches !== 1) return null;
  } else raw = typeof headers === 'string'
    ? headers.match(/(?:^|\r\n)x-rc50-request:\s*([^\r\n]+)/i)?.[1]
    : headers?.['x-rc50-request'];
  return typeof raw === 'string' && /^(baseline|mixed)-(warm|measure)-[0-9]{1,6}$/.test(raw) ? raw : null;
};
const route = value => ROUTES.get(String(value ?? '').split('?')[0]) ?? 'other';
const errorCode = error => ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_ABORTED'].includes(error?.code) ? error.code : 'OTHER';

function safeProfile(profile, root, maxNodes = LIMITS.maxNodes, maxSamples = LIMITS.maxSamples) {
  const base = path.resolve(root) + path.sep;
  const nodes = (profile.nodes ?? []).slice(0, maxNodes);
  const ids = new Set(nodes.map(n => n.id));
  function frame(value = {}) {
    let source = 'external';
    const url = String(value.url ?? '');
    if (/^node:[a-zA-Z0-9_./-]+$/.test(url)) source = url;
    else if (url) {
      try {
        const resolved = path.resolve(url.startsWith('file:') ? fileURLToPath(url) : url);
        if (resolved.startsWith(base)) {
          const relative = path.relative(root, resolved).split(path.sep).join('/');
          if (/^[a-zA-Z0-9_@./-]+\.(?:cjs|mjs|js|ts)$/.test(relative)) source = relative;
        }
      } catch { /* Never export arbitrary URLs or absolute filesystem paths. */ }
    }
    const name = ['(root)', '(idle)', '(garbage collector)', '(program)', 'stringify', 'parse'].includes(value.functionName)
      ? value.functionName : '';
    return { source, name, line: value.lineNumber, column: value.columnNumber };
  }
  const samples = [], timeDeltas = [];
  for (let i = 0; i < Math.min(profile.samples?.length ?? 0, maxSamples); i++) {
    // Keep timing slots for omitted nodes; zero is an explicit unmapped sample.
    samples.push(ids.has(profile.samples[i]) ? profile.samples[i] : 0);
    timeDeltas.push(profile.timeDeltas?.[i] ?? 0);
  }
  return { nodes: nodes.map(n => ({ id: n.id, frame: frame(n.callFrame), hitCount: n.hitCount,
    children: (n.children ?? []).filter(id => ids.has(id)) })), samples, timeDeltas,
    droppedNodes: Math.max(0, (profile.nodes?.length ?? 0) - nodes.length),
    droppedSamples: Math.max(0, (profile.samples?.length ?? 0) - samples.length) };
}

function captureValidity(result, durationMs = LIMITS.durationMs) {
  const reasons = [];
  if (result.droppedEvents || result.profile?.droppedNodes || result.profile?.droppedSamples) reasons.push('DROPPED_DATA');
  if (result.profileError) reasons.push('CPU_PROFILE_ERROR');
  if (!Number.isFinite(result.elapsedMs) || result.elapsedMs > durationMs + LIMITS.maxStopOverrunMs ||
      (result.captureStopElapsedMs !== undefined && (!Number.isFinite(result.captureStopElapsedMs) ||
        result.captureStopElapsedMs > durationMs + LIMITS.maxStopOverrunMs))) reasons.push('STOP_OVERRUN');
  if (!Number.isFinite(result.clockDriftMs) || Math.abs(result.clockDriftMs) > 5) reasons.push('CLOCK_DRIFT');
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > LIMITS.maxBytes) reasons.push('BYTE_CAP');
  return { valid: reasons.length === 0, reasons, observedBytes: bytes, limits: LIMITS };
}
function createProfiler({ enabled = false, role, root = __dirname, maxEvents = LIMITS.maxEvents,
  durationMs = LIMITS.durationMs, cpu = true } = {}) {
  if (!enabled) return { start: async () => ({ enabled: false }), stop: async () => ({ enabled: false }) };
  if (!['api', 'generator', 'test'].includes(role)) throw Error('PROFILE_ROLE_REQUIRED');
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > LIMITS.maxEvents ||
      !Number.isInteger(durationMs) || durationMs < 1 || durationMs > LIMITS.durationMs) throw Error('PROFILE_BOUND_REQUIRED');
  let state = 'new', stopPromise, timer, session, baseline, cpuBefore, eluBefore, delay, gc;
  let requestSequence = 0, socketSequence = 0, dropped = 0, gcCount = 0, gcMs = 0;
  const requests = new WeakMap(), sockets = new WeakMap(), events = [], unsubscribers = [], listeners = new Set();
  const anchor = () => ({ monotonicMs: performance.now(), epochMs: Date.now() });
  const record = (kind, data = {}) => {
    if (state !== 'active') return;
    if (events.length >= maxEvents) { dropped++; return; }
    events.push({ kind, ms: performance.now() - baseline.monotonicMs, ...data });
  };
  const requestId = r => {
    if (!r || typeof r !== 'object') return null;
    if (!requests.has(r)) requests.set(r, ++requestSequence);
    return requests.get(r);
  };
  const socketId = s => {
    if (!s || typeof s !== 'object') return null;
    if (!sockets.has(s)) sockets.set(s, ++socketSequence);
    return sockets.get(s);
  };
  function once(target, event, fn) {
    // Bound pending listeners as well as exported events, even with stalled peers.
    if (listeners.size >= maxEvents) { dropped++; return; }
    const entry = { target, event, wrapped: (...args) => { listeners.delete(entry); fn(...args); } };
    listeners.add(entry); target.once(event, entry.wrapped);
  }
  const post = (method, params = {}) => new Promise((resolve, reject) =>
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  function subscribe() {
    for (const suffix of CHANNELS) {
      const name = 'undici:' + suffix;
      const listener = message => {
        const r = message.request;
        const data = { request: requestId(r), socket: socketId(message.socket),
          correlation: correlation(r?.headers), route: route(r?.path) };
        if (message.response) data.status = message.response.statusCode;
        if (message.error) data.code = errorCode(message.error);
        record(name, data);
      };
      dc.subscribe(name, listener); unsubscribers.push(() => dc.unsubscribe(name, listener));
    }
    const original = http.Server.prototype.emit;
    function emit(event, ...args) {
      if (state === 'active' && event === 'connection') {
        const socket = args[0], id = socketId(socket);
        record('server.accept', { socket: id });
        once(socket, 'close', () => record('server.close', { socket: id }));
      } else if (state === 'active' && event === 'request') {
        const [req, res] = args, data = { request: requestId(req), socket: socketId(req.socket),
          correlation: correlation(req.headers), route: route(req.url) };
        record('server.callback', data);
        once(res, 'finish', () => record('server.finish', { ...data, status: res.statusCode }));
      }
      return Reflect.apply(original, this, [event, ...args]);
    }
    http.Server.prototype.emit = emit;
    // Do not overwrite instrumentation installed by somebody else after us.
    unsubscribers.push(() => { if (http.Server.prototype.emit === emit) http.Server.prototype.emit = original; });
  }
  async function stop(reason = 'requested') {
    if (stopPromise) return stopPromise;
    if (state === 'new') return { enabled: true, started: false };
    if (state === 'starting') throw Error('PROFILE_START_IN_PROGRESS');
    if (!baseline) return { enabled: true, started: false, profileError: 'CPU_HTTP_PROFILE_START_FAILED' };
    stopPromise = (async () => {
      state = 'stopped'; clearTimeout(timer);
      for (const fn of unsubscribers.splice(0).reverse()) fn();
      for (const l of listeners) l.target.removeListener(l.event, l.wrapped);
      listeners.clear();
      const end = anchor(), usage = process.cpuUsage(cpuBefore), elu = performance.eventLoopUtilization(eluBefore);
      const gcPending = gc?.takeRecords() ?? [];
      for (const e of gcPending) { gcCount++; gcMs += e.duration; }
      gc?.disconnect(); delay?.disable();
      let profile, profileError;
      if (session) {
        try { profile = safeProfile((await post('Profiler.stop')).profile, root); }
        catch { profileError = 'CPU_PROFILE_STOP_FAILED'; }
        finally { session.disconnect(); session = null; }
      }
      const result = { enabled: true, schema: 1, role, node: process.version,
        reason: reason === 'deadline' ? 'deadline' : 'requested', start: baseline, end,
        clockDriftMs: (end.epochMs - baseline.epochMs) - (end.monotonicMs - baseline.monotonicMs),
        cpuMicroseconds: usage, elapsedMs: end.monotonicMs - baseline.monotonicMs,
        captureStopElapsedMs: performance.now() - baseline.monotonicMs,
        memory: process.memoryUsage(), elu, gc: { count: gcCount, durationMs: gcMs },
        eventLoopDelayMs: delay ? { p50: delay.percentile(50) / 1e6, p95: delay.percentile(95) / 1e6,
          max: delay.max / 1e6 } : null, events, droppedEvents: dropped, profile, profileError,
        limitations: ['Opt-in instrumentation adds CPU and memory overhead; no acceptance evidence.',
          'CPU samples exclude PostgreSQL and Prisma engine processes.',
          'Cross-process inference requires the separate valid IPC clock brackets from withProfiles.',
          'Undici create-to-send includes dispatcher wait and connection setup; it is not pure network latency.',
          'The timer deadline is cooperative; a blocked JS loop can delay capture shutdown.',
          'Socket IDs are process-local. No identity, authorization result, body or headers are exported.'] };
      result.validity = captureValidity(result, durationMs);
      // Reject oversized evidence, never silently present a truncated capture as valid.
      if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.maxBytes) {
        if (!result.validity.reasons.includes('BYTE_CAP')) result.validity.reasons.push('BYTE_CAP');
        result.validity.valid = false;
        result.events = []; delete result.profile;
      }
      return result;
    })();
    return stopPromise;
  }
  async function start() {
    if (state !== 'new') throw Error('PROFILE_SINGLE_USE');
    state = 'starting';
    try {
      if (cpu) {
        session = new inspector.Session(); session.connect();
        await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 1000 });
        await post('Profiler.start');
      }
      baseline = anchor(); cpuBefore = process.cpuUsage(); eluBefore = performance.eventLoopUtilization();
      delay = monitorEventLoopDelay({ resolution: 20 }); delay.enable();
      gc = new PerformanceObserver(list => { for (const e of list.getEntries()) { gcCount++; gcMs += e.duration; } });
      gc.observe({ entryTypes: ['gc'] }); state = 'active'; subscribe();
      timer = setTimeout(() => { void stop('deadline'); }, durationMs); timer.unref();
      return { enabled: true, role, start: baseline, maxEvents, durationMs, samplingIntervalUs: cpu ? 1000 : null };
    } catch {
      state = 'stopped';
      for (const fn of unsubscribers.splice(0).reverse()) fn();
      gc?.disconnect(); delay?.disable(); session?.disconnect(); session = null;
      throw Error('CPU_HTTP_PROFILE_START_FAILED');
    }
  }
  return { start, stop };
}

module.exports = { createProfiler, safeProfile, correlation, route, captureValidity, LIMITS };
