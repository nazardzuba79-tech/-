// Disposable fixture wrapper. Product server, proxy, identity and SQLite worker are unmodified.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { ISSUER, SUBJECTS, SEED, LIMITS, sha256, verifyImageClosure, servePrivateStdio, assertSafety } from './plan.mjs';

const SOURCE = '/source', DATA = '/data/accounts.sqlite';
const mono = () => process.hrtime.bigint().toString();
export function validateSeedState(state) {
  assert.equal(state.schema, SEED.schema); assert.equal(state.revision, 0); assert.equal(state.settings.feeBps, 0);
  assert.deepEqual(state.wallets, SEED.wallets); assert.deepEqual(state.positions, {}); assert.deepEqual(state.quotes, {});
  for (const name of ['orders', 'fills', 'adjustments']) assert.deepEqual(state[name], []);
  assert.deepEqual(state.realized, { USDT: '0.00000000', USDC: '0.00000000' });
}
export function validateSeedAccounts(rows) {
  assert.equal(rows.length, SUBJECTS.length);
  assert.deepEqual(rows.map(row => row.id).sort(), SUBJECTS.map(subject => sha256(JSON.stringify([ISSUER, subject]))).sort(), 'seed principal set changed');
  for (const row of rows) validateSeedState(JSON.parse(row.ledger));
}
export async function ledgerProof(file = DATA) {
  assert.equal(file, DATA); assert.ok(!fs.existsSync(file + '-journal'), 'SQLite must be quiesced with no journal');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    const rows = db.prepare('SELECT id, ledger FROM paper_accounts ORDER BY id').all(); validateSeedAccounts(rows);
    return { sha256: sha256(fs.readFileSync(file)), accounts: rows.map(row => ({ id: row.id, ledgerSha256: sha256(row.ledger) })), integrity: 'ok',
      journal: db.prepare('PRAGMA journal_mode').get().journal_mode,
      synchronousEvidence: { configured: 2, basis: 'frozen unchanged openAccounts source executes PRAGMA synchronous=FULL', observedOnWorkerConnection: 'UNMEASURED' } };
  } finally { db.close(); }
}
export function validateInit(input) {
  assert.equal(input.issuer, ISSUER); assert.match(input.authority, /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/);
  for (const port of [input.gatewayPort, input.servicePort, Number(new URL(input.authority).port)]) assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535);
  assert.equal(new Set([input.gatewayPort, input.servicePort, Number(new URL(input.authority).port)]).size, 3);
}
export function trackedHandler(handler, metrics) {
  return async function (req, res) {
    metrics.activeHandlers++; metrics.handlerStarts++;
    try { return await handler(req, res); }
    catch (error) { metrics.handlerFailures++; throw error; }
    finally { metrics.activeHandlers--; metrics.handlerTerminals++; }
  };
}
export async function createStockFixture() {
  assert.equal(process.platform, 'linux'); assert.equal(process.version, 'v24.21.0');
  assert.equal(process.env.AUTH_HTTP_FIXTURE_512, 'true'); assert.ok(process.getuid() > 0);
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET', 'NODE_OPTIONS', 'NODE_PATH']) assert.equal(process.env[key], undefined);
  const runtime = relative => import(pathToFileURL(path.join(SOURCE, relative)).href);
  let app, gateway, enabled = false, modules, authority, current = null, active = 0, booted = false, stopped = false;
  const events = [], metrics = { nativeProviderStarts: 0, localCatalogueReads: 0, deniedNetwork: 0, requests: 0, health: 0,
    activeHandlers: 0, handlerStarts: 0, handlerTerminals: 0, handlerFailures: 0 };
  const ports = new Set(), connect = net.Socket.prototype.connect, originalFetch = globalThis.fetch;
  net.Socket.prototype.connect = function (...args) {
    const a = Array.isArray(args[0]) ? args[0] : args, o = typeof a[0] === 'object' ? a[0] : { port: a[0], host: a[1] };
    if (o.path || (o.host || o.hostname) !== '127.0.0.1' || !ports.has(Number(o.port))) { metrics.deniedNetwork++; throw Error('FIXTURE_NETWORK_DENIED'); }
    return connect.apply(this, args);
  };
  globalThis.fetch = (input, options) => {
    const url = new URL(String(input));
    if (!authority || url.origin !== authority || url.pathname !== '/api/v1/me' || url.search || options?.method !== 'GET') {
      metrics.deniedNetwork++; return Promise.reject(Error('FIXTURE_NETWORK_DENIED'));
    }
    return originalFetch(input, options);
  };
  const trap = async () => { metrics.nativeProviderStarts++; throw Error('NO_MARKET_DATA_IN_IDENTITY_FIXTURE'); };
  const hub = { metrics: {}, catalogue: async () => { metrics.localCatalogueReads++; return []; }, quote: trap, history: trap, withUsdcPrices: trap };
  const delay = monitorEventLoopDelay({ resolution: 20 }); delay.enable();
  const snapshot = () => ({ ...metrics, active, events: [...events], accounts: app?.accountMetrics() ?? null,
    cpu: process.cpuUsage(), rss: process.memoryUsage().rss, eventLoop: { meanNs: Number.isFinite(delay.mean) ? delay.mean : null,
      maxNs: delay.max, p95Ns: delay.percentile(95) }, fsync: { status: 'UNMEASURED' }, observedMonoNs: mono() });
  async function command(op, input = {}) {
    assert.ok(!stopped, 'fixture stopped');
    if (op === 'bootstrap') {
      assert.ok(!app && !booted && !fs.existsSync(DATA), 'fresh bootstrap only');
      verifyImageClosure(input.contextSha256);
      assert.ok(Number.isSafeInteger(input.seedTimeMs) && input.seedTimeMs > 0);
      const { openAccountWorker } = await runtime('services/stocks-global/account-worker.mjs');
      const worker = await openAccountWorker(DATA, { diagnostics: true, now: () => input.seedTimeMs });
      try { for (const subject of SUBJECTS) await worker.forPrincipal({ issuer: ISSUER, subject }); }
      finally { await worker.close(); }
      const proof = await ledgerProof();
      return { ...proof, subjects: SUBJECTS, seedTimeMs: input.seedTimeMs, closed: true, api: SEED.api,
        synchronous: 2, synchronousClaim: 'SOURCE_CONFIGURED_NOT_INDEPENDENTLY_PROBED' };
    }
    if (op === 'init') {
      assert.ok(!booted && !app); validateInit(input); const closure = verifyImageClosure(input.contextSha256); assert.ok(fs.existsSync(DATA), 'pre-frozen closed seed required');
      current = await ledgerProof(); assert.equal(current.sha256, input.seedSha256, 'seed bytes changed');
      modules = { ...await runtime('services/stocks-global/server.mjs'), ...await runtime('services/stocks-global/identity.mjs'), ...await runtime('services/stocks-global/local-proxy.mjs') };
      authority = input.authority; ports.add(Number(new URL(authority).port)); ports.add(input.servicePort);
      const originalCreateServer = http.createServer; let wrapped = 0;
      http.createServer = function (handler) { assert.equal(typeof handler, 'function'); assert.equal(handler.constructor.name, 'AsyncFunction');
        assert.equal(++wrapped, 1); return originalCreateServer.call(this, trackedHandler(handler, metrics)); };
      try { app = await modules.createServer({ port: input.servicePort, accountsPath: DATA, authenticate: modules.identityResolver({ endpoint: authority + '/api/v1/me', issuer: ISSUER }),
        ownerOnlyMode: true, tradeOwnerSubject: 'alice', hub, autoPoll: false, accountDiagnostics: true, dist: '/no-static-fixture' }); }
      finally { http.createServer = originalCreateServer; }
      assert.equal(wrapped, 1, 'actual service handler must be tracked');
      const origin = 'http://127.0.0.1:' + input.gatewayPort;
      const proxy = modules.createLocalStocksProxy({ origin: () => origin, stocksOrigin: () => enabled ? 'http://127.0.0.1:' + app.port : null });
      gateway = http.createServer((req, res) => {
        const health = req.url === '/__stocks_global/health', requestId = req.headers['x-fixture-request-id'];
        if (!health && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId))) { res.writeHead(400); res.end('{}'); return; }
        if (events.length >= LIMITS.maxRecords * 2) { res.writeHead(503); res.end('{}'); return; }
        health ? metrics.health++ : metrics.requests++; active++;
        const event = { requestId: health ? null : requestId, health, startedMonoNs: mono(), status: null, completed: false };
        events.push(event); let finished = false;
        const end = complete => { if (finished) return; finished = true; active--; event.endedMonoNs = mono(); event.completed = complete; event.status = res.headersSent ? res.statusCode : null; };
        res.once('finish', () => end(true)); res.once('close', () => end(res.writableFinished)); proxy(req, res);
      });
      gateway.listen(input.gatewayPort, '127.0.0.1'); await once(gateway, 'listening'); enabled = true; booted = true;
      return { gatewayOrigin: origin, seed: current, providerStarts: 0, node: process.version, closure };
    }
    if (op === 'audit' || op === 'drain') return snapshot();
    if (op === 'enabled') { assert.equal(typeof input.value, 'boolean'); enabled = input.value; return { enabled }; }
    if (op === 'quiesce') {
      assert.equal(active, 0); assert.equal(metrics.activeHandlers, 0); assert.equal(metrics.handlerFailures, 0);
      assert.equal(app?.accountMetrics().queue.pending, 0); assert.equal(app?.accountMetrics().queue.active, 0);
      enabled = false; await app?.close(); app = null;
      assertSafety(sha256(fs.readFileSync(DATA)) === current.sha256, 'SAFETY_LEDGER_CHANGED');
      const after = await ledgerProof(); assertSafety(after.sha256 === current.sha256 && JSON.stringify(after.accounts) === JSON.stringify(current.accounts), 'SAFETY_LEDGER_CHANGED');
      return { ...after, closed: true };
    }
    if (op === 'stop') {
      enabled = false; if (app) { await app.close(); app = null; }
      if (gateway) { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); }
      delay.disable(); stopped = true; net.Socket.prototype.connect = connect; globalThis.fetch = originalFetch;
      return { ...snapshot(), stopped: true };
    }
    throw Error('FIXTURE_COMMAND_DENIED');
  }
  return { command };
}
async function main() {
  const fixture = await createStockFixture(); servePrivateStdio(fixture.command);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
