import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from '../../stocks-global/server.mjs';
import { identityResolver } from '../../stocks-global/identity.mjs';
import { MarketHub } from '../../stocks-global/market.mjs';
import { CATALOG } from '../../stocks-global/catalog.mjs';
import { fixtureBody } from '../cx23-model/stocks-fixture.mjs';
const errorCode = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code || error?.message || '') ? error.code || error.message : 'FIXTURE_ERROR';
export async function startFixture({ port, controlPort, authPort, path, nonce }) {
  if (!path || !/^[a-f0-9]{32}$/.test(nonce || '')) throw Error('DISPOSABLE_CONFIG_REQUIRED');
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0], host = typeof first === 'object' ? first.host : args[1], destination = typeof first === 'object' ? first.port : first;
    if (host !== '127.0.0.1' || Number(destination) !== authPort) throw Error('EXTERNAL_NETWORK_FORBIDDEN');
    return connect.apply(this, args);
  };
  const transport = { starts: 0, completed: 0, failed: 0, cancelled: 0, inflight: 0, bytes: 0, startsByHost: {}, startsByEndpoint: {} }, logical = { requested: 0, completed: 0, failed: 0, errors: {} };
  const trace = [], context = new AsyncLocalStorage(); const origin = performance.now(); let traceSerial = 0;
  const event = (kind, url, fields = {}) => { if (trace.length >= 10000) throw Error('TRACE_BUDGET_EXHAUSTED'); const u = new URL(url); trace.push({ sequence: ++traceSerial, kind, atMs: performance.now() - origin, wallMs: Date.now(), requestTag: context.getStore() || null, host: u.hostname, path: u.pathname, symbol: u.searchParams.get('symbol'), interval: u.searchParams.get('interval'), end: u.searchParams.get('end') || u.searchParams.get('endTime'), flight: createHash('sha256').update(u.href).digest('hex'), ...fields }); };
  let nativeRelease = null, nativeGate = null, holds = [], maxRss = 0;
  const hub = new MarketHub({ fetchImpl: async (url, options) => {
    if (options?.method !== 'GET' || options?.redirect !== 'error') throw Error('FIXTURE_READ_ONLY_TRANSPORT');
    const u = new URL(url); const value = fixtureBody(u); transport.starts++; transport.inflight++;
    event('admission-observed-at-fetch', u); event('native-start', u, { providerTimestamp: value.result?.ts ?? value[0]?.time ?? value.closeTime ?? value.time ?? null, providerEventId: value.result?.u ?? value[0]?.id ?? null });
    transport.startsByHost[u.hostname] = (transport.startsByHost[u.hostname] || 0) + 1;
    const key = u.hostname + u.pathname + (u.searchParams.get('symbol') === 'USDCUSDT' ? ':USDCUSDT' : '');
    transport.startsByEndpoint[key] = (transport.startsByEndpoint[key] || 0) + 1;
    let finished = false; const finish = outcome => { if (!finished) { finished = true; transport.inflight--; transport[outcome]++; event('native-' + outcome, u); } };
    try {
      if (nativeGate && /\/klines?$/.test(u.pathname)) await nativeGate;
      const bytes = Buffer.from(JSON.stringify(value)); let sent = false;
      return new Response(new ReadableStream({ pull(controller) { if (!sent) { sent = true; transport.bytes += bytes.length; controller.enqueue(bytes); } else { finish('completed'); controller.close(); } }, cancel() { finish('cancelled'); } }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) { finish('failed'); throw error; }
  } });
  const request = hub.request.bind(hub); hub.request = async (...args) => { logical.requested++; event('requested', args[0], { existingFlight: hub.inflight.has(args[0]), cachedAt: hub.cache.get(args[0])?.at ?? null }); try { const value = await request(...args); logical.completed++; event('completed', args[0]); return value; } catch (e) { logical.failed++; const code = errorCode(e); logical.errors[code] = (logical.errors[code] || 0) + 1; event('error', args[0], { code }); throw e; } };
  hub.catalogue = async () => CATALOG.map(i => { if (i.provider !== 'moex') hub.verified.set(i.id, { exists: true, online: true, multiplier: null, checkedAt: Date.now() }); return { ...i, exists: i.provider !== 'moex', online: i.provider !== 'moex', fixture: true }; });
  const app = await createServer({ port, accountsPath: path, hub, autoPoll: true, accountDiagnostics: true,
    ownerOnlyMode: true, tradeOwnerSubject: 'owner', authenticate: identityResolver({ endpoint: `http://127.0.0.1:${authPort}/api/v1/me`, issuer: 'targeted-http-fixture' }) });
  const listeners = app.server.listeners('request'); app.server.removeAllListeners('request');
  app.server.on('request', (req, res) => context.run(req.headers['x-fixture-request'], () => { for (const listener of listeners) listener.call(app.server, req, res); }));
  const closed = new Set(); app.server.on('request', (req, res) => { const tag = req.headers['x-fixture-request']; if (typeof tag === 'string' && /^[a-z0-9-]{1,80}$/.test(tag)) res.once('close', () => { if (closed.size >= 2000) throw Error('FIXTURE_TAG_BUDGET'); closed.add(tag); }); });
  const read = name => { try { return readFileSync('/sys/fs/cgroup/' + name, 'utf8'); } catch { return null; } };
  const timer = setInterval(() => { maxRss = Math.max(maxRss, process.memoryUsage().rss); }, 250); timer.unref();
  const metrics = () => { const cpu = process.cpuUsage(); return { wallMs:Date.now(), elapsedMs:performance.now()-origin, cpuMs: (cpu.user + cpu.system) / 1000, memory: process.memoryUsage(), maxRss:Math.max(maxRss,process.memoryUsage().rss),
    transport: structuredClone(transport), logical: structuredClone(logical), hub: { ...hub.metrics }, accounts: app.accountMetrics(),
    live: { nativeInflight: transport.inflight, flights: hub.historyFlights.size, active: hub.historyActive, queued: hub.historyQueue.length, quoteFlights: hub.inflight.size },
    cgroup: { cpuMax: read('cpu.max'), memoryMax: read('memory.max'), swapMax: read('memory.swap.max'), ioMax: read('io.max'), cpuStat: read('cpu.stat'), ioStat: read('io.stat'), memoryPeak: read('memory.peak'), memoryEvents: read('memory.events') }, catalogueCount: CATALOG.length }; };
  const control = http.createServer(async (req, res) => {
    if (req.headers['x-fixture-control'] !== nonce) { res.writeHead(403); res.end('{}'); return; }
    try {
      const url = new URL(req.url, 'http://127.0.0.1'); let result;
      if (url.pathname === '/metrics') result = metrics();
      else if (url.pathname === '/trace') result = { schema: 1, trace, interpretation: 'admission is observed at injected fetch entry, after unchanged adapter budget check; no syscall timing or independent earlier admission timestamp' };
      else if (url.pathname === '/ledger-proof') {
        const db = new DatabaseSync(path, { readOnly: true });
        try { const rows = db.prepare('SELECT id, ledger FROM paper_accounts ORDER BY id').all(); result = { accounts: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), proofSqlQueries: 1, includes:'entire durable ledger, including used capacity and financial history' }; } finally { db.close(); }
      }
      else if (url.pathname === '/closed') result = { closed: closed.has(url.searchParams.get('id')) };
      else if (req.method === 'POST' && url.pathname === '/hold-slots') {
        if (holds.length || hub.historyActive) throw Error('SLOTS_NOT_IDLE');
        holds = Array.from({ length: 2 }, () => { let release; const promise = hub.historySlot(() => new Promise(ok => { release = ok; })); return { promise, release }; }); result = { ok: true };
      } else if (req.method === 'POST' && url.pathname === '/release-slots') { for (const h of holds) h.release(); await Promise.all(holds.map(h => h.promise)); holds = []; result = { ok: true }; }
      else if (req.method === 'POST' && url.pathname === '/hold-native') { if (nativeGate) throw Error('NATIVE_ALREADY_HELD'); nativeGate = new Promise(ok => { nativeRelease = ok; }); result = { ok: true }; }
      else if (req.method === 'POST' && url.pathname === '/release-native') { nativeRelease?.(); nativeGate = null; nativeRelease = null; result = { ok: true }; }
      else throw Error('CONTROL_NOT_ALLOWED');
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (e) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: errorCode(e) })); }
  });
  await new Promise(ok => control.listen(controlPort, '127.0.0.1', ok));
  return { app, metrics, close: async () => { clearInterval(timer); for (const h of holds) h.release(); nativeRelease?.(); await app.close(); control.closeAllConnections(); await new Promise(ok => control.close(ok)); net.Socket.prototype.connect = connect; } };
}
if (process.argv[1]?.endsWith('/fixture.mjs') || process.argv[1]?.endsWith('\\fixture.mjs')) {
  if (process.env.TARGETED_DISPOSABLE !== 'true') throw Error('DISPOSABLE_FIXTURE_REQUIRED');
  const f = await startFixture({ port: Number(process.env.TARGETED_PORT), controlPort: Number(process.env.TARGETED_CONTROL_PORT), authPort: Number(process.env.TARGETED_AUTH_PORT), path: '/data/accounts.sqlite', nonce: process.env.TARGETED_NONCE });
  process.once('SIGTERM', () => { void f.close().then(() => process.exit(0)); });
}
