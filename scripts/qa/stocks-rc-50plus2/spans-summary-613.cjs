'use strict';
// Server-side decomposition of ONE `diagnostic-run-613.cjs --after --spans` run.
// Every measured crypto request's client latency = time outside the API handler
// (accept, queueing, transport) + the handler's wall time, and the handler's
// wall time is partitioned exactly by sweeping the request-correlated span
// intervals: instants covered by one category go to it (JWT, auth/access-gate
// reads, trading Prisma, transaction admission), instants covered by two or
// more categories go to `overlap`, uncovered instants go to `rest` (synchronous
// JS outside wrapped calls and event-loop waits). Nothing is clamped: span time
// outside the handler window (e.g. a fire-and-forget update finishing after the
// response) and concurrent spans of one category are reported, not subtracted.
// Fail-closed on the full contract: the plan's exact request counts and
// population, expected HTTP statuses, finite non-negative numbers, the inner
// spans every crypto route must produce, the spans-run status, pin and cleanup.
// The same instrumentation runs in both arms and its overhead is not removed:
// a decomposition to test hypotheses, never a p95 verdict or acceptance.
// Usage: node spans-summary-613.cjs <runOutDir> [out.json]
const fs = require('node:fs'), path = require('node:path');
const {percentile} = require('./policy.cjs');
const {PLAN, traceSha: TRACE_SHA} = require('./driver.cjs');

const ARMS = ['baseline', 'mixed'];
const STATUS = 'SPANS_ONLY_NOT_A_P95_VERDICT';
const PG_NOT_RUNNING = 3; // documented `pg_ctl status` exit code for a stopped server
const POPULATION = {baseline: [0, 0], mixed: [PLAN.viewers, PLAN.traders]};
// Requests the driver issues per measured window, and the status it expects.
const CRYPTO_OPS = {'place-limit': 201, open: 200, cancel: 204, balances: 200};
const TRADER_OPS = ['state', 'submit-limit', 'cancel-limit', 'submit-buy', 'retry-buy', 'submit-sell', 'retry-sell'];
const CRYPTO_JOBS = PLAN.measureMs / PLAN.cryptoPeriodMs;
const EXPECTED = {
  baseline: {crypto: Object.fromEntries(Object.keys(CRYPTO_OPS).map(op => [op, CRYPTO_JOBS]))},
  mixed: {crypto: Object.fromEntries(Object.keys(CRYPTO_OPS).map(op => [op, CRYPTO_JOBS])),
    viewer: {state: PLAN.viewers * PLAN.measureMs / PLAN.viewerPeriodMs, 'deny-order': PLAN.viewers},
    trader: Object.fromEntries(TRADER_OPS.map(op => [op, PLAN.traders * PLAN.measureMs / PLAN.traderPeriodMs]))}};
// The API handler span each crypto op must correlate with (driver routes).
const ROUTE = {'place-limit': ['POST', r => r === '/api/v1/demo/orders'], open: ['GET', r => r === '/api/v1/demo/orders/open'],
  cancel: ['DELETE', r => r.startsWith('/api/v1/demo/orders/') && r !== '/api/v1/demo/orders/open'], balances: ['GET', r => r === '/api/v1/demo/balances']};
const STATUS_OF = (kind, op) => kind === 'crypto' ? CRYPTO_OPS[op] : kind === 'viewer' && op === 'deny-order' ? 401 : 200;
// Reads made by requireAuth (session, user, contact-block audit log) and by the
// demoSpot access gate (user role, demo credit audit log): one category,
// "auth and access-gate reads". Every other Prisma operation is trading.
const AUTH_ACCESS = {Session: ['findUnique', 'findFirst', 'update'], User: ['findUnique', 'findFirst'], AuditLog: ['findFirst', 'findMany']};
const CATEGORIES = ['jwt', 'authAccessDb', 'tradeDb', 'txAdmission'];
const PARTS = ['outside', ...CATEGORIES, 'overlap', 'rest'];
const COMPONENTS = ['client', 'server', ...PARTS, 'outsideWindow', 'sameCategoryConcurrency'];
// Inner spans each crypto route must produce (requireAuth -> jwt + reads,
// demoSpot gate -> reads, DemoTradingService -> trading Prisma; place and
// cancel run SpotBookTransaction -> prisma.$transaction).
const REQUIRED = op => ({jwt: 1, authAccessDb: 1, tradeDb: 1, txAdmission: ['place-limit', 'cancel'].includes(op) ? 1 : 0});
const VIEWER_ROUTES = {gateway: '/__stocks_global/state', identity: '/api/v1/stocks-test-cash/identity', identityBatch: '/api/v1/stocks-test-cash/identities'};

const finite = x => typeof x === 'number' && Number.isFinite(x);
const nonNegative = x => finite(x) && x >= 0;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sum = a => a.reduce((x, y) => x + y, 0);
const stats = a => ({count: a.length, p50: percentile(a, .5), p95: percentile(a, .95), mean: mean(a)});
const category = s => s.name === 'jwt.verify' ? 'jwt' : s.name === 'pg.transaction.admission' ? 'txAdmission'
  : s.name === 'prisma.operation' ? (AUTH_ACCESS[s.model]?.includes(s.action) ? 'authAccessDb' : 'tradeDb') : null;

function readJson(file, failures, tag) {
  if (!fs.existsSync(file)) { failures.push(tag + '_MISSING'); return null; }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { failures.push(tag + '_CORRUPT'); return null; }
}

// Exact partition of one handler window [s0, s1] by its inner span intervals.
function partition(server, inner) {
  const s0 = server.start, s1 = server.start + server.ms, parts = Object.fromEntries([...CATEGORIES, 'overlap', 'rest'].map(c => [c, 0]));
  const clipped = inner.map(x => ({c: x.category, a: Math.max(s0, x.start), b: Math.min(s1, x.start + x.ms), ms: x.ms}));
  const outsideWindow = sum(clipped.map(x => x.ms - Math.max(0, x.b - x.a)));
  const cuts = [...new Set([s0, s1, ...clipped.flatMap(x => [x.a, x.b]).filter(t => t > s0 && t < s1)])].sort((p, q) => p - q);
  const union = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1], active = new Set(clipped.filter(x => x.b > x.a && x.a <= a && x.b >= b).map(x => x.c));
    for (const c of active) union[c] += b - a;
    parts[active.size === 0 ? 'rest' : active.size === 1 ? [...active][0] : 'overlap'] += b - a;
  }
  const sameCategoryConcurrency = sum(CATEGORIES.map(c => sum(clipped.filter(x => x.c === c).map(x => Math.max(0, x.b - x.a))) - union[c]));
  return {...parts, outsideWindow, sameCategoryConcurrency};
}

// Per crypto request: the generator sample, the API handler span correlated by
// x-rc50-request and the request-correlated inner spans.
function decompose(samples, raw) {
  const byRequest = new Map();
  for (const s of raw) if (typeof s.request === 'string') (byRequest.get(s.request) || byRequest.set(s.request, []).get(s.request)).push(s);
  const rows = [], problems = {uncorrelated: 0, routeMismatch: 0, statusMismatch: 0, missingInner: 0, beforeHandler: 0, serverLongerThanClient: 0};
  for (const c of samples.filter(x => x.kind === 'crypto')) {
    const spans = byRequest.get(c.requestId) || [], server = spans.filter(s => s.name === 'http.server');
    if (server.length !== 1) { problems.uncorrelated++; continue; }
    const [method, route] = ROUTE[c.op] || [];
    if (!route || server[0].method !== method || typeof server[0].route !== 'string' || !route(server[0].route)) problems.routeMismatch++;
    if (server[0].status !== c.status) problems.statusMismatch++;
    const inner = spans.map(s => ({...s, category: category(s)})).filter(s => s.category);
    const count = Object.fromEntries(CATEGORIES.map(k => [k, inner.filter(s => s.category === k).length]));
    if (Object.entries(REQUIRED(c.op)).some(([k, n]) => count[k] < n)) problems.missingInner++;
    if (inner.some(s => s.start < server[0].start)) problems.beforeHandler++;
    if (c.ms < server[0].ms) problems.serverLongerThanClient++;
    rows.push({requestId: c.requestId, op: c.op, client: c.ms, server: server[0].ms, outside: c.ms - server[0].ms, ...partition(server[0], inner), spans: count});
  }
  return {rows, problems};
}

function processStats(spans, raw) {
  const gc = raw.filter(s => s.name === 'gc'), waits = raw.filter(s => s.name === 'pg.wait.sample'), events = {};
  for (const w of waits) for (const r of w.rows || []) if (r.type) events[r.type + ':' + r.event] = (events[r.type + ':' + r.event] || 0) + r.count;
  const route = r => stats(raw.filter(s => s.name === 'http.server' && s.route === r).map(s => s.ms));
  return {eventLoopDelayMs: spans.delay, eventLoopUtilization: spans.eventLoop?.utilization,
    gc: {count: gc.length, totalMs: sum(gc.map(s => s.durationMs))}, cpu: spans.cpu ?? null,
    spans: {total: raw.length, dropped: spans.dropped},
    pgWaits: {samples: waits.length, errors: raw.filter(s => s.name === 'pg.wait.sample.error').length,
      waitingSamples: waits.filter(w => (w.rows || []).some(r => r.type)).length, events},
    viewer: {gatewayStateMs: route(VIEWER_ROUTES.gateway), identityMs: route(VIEWER_ROUTES.identity), identityBatchMs: route(VIEWER_ROUTES.identityBatch)},
    authorityQueueWaitMs: stats(raw.filter(s => s.name === 'authority.queue.wait').map(s => s.ms))};
}

// Counts, statuses, population, numbers and spans of one arm against the plan.
function checkArm(arm, r, s, failures) {
  const tag = arm.toUpperCase(), fail = x => failures.push(tag + '_' + x);
  if (r.arm !== arm || r.warmup !== false) fail('ARM_MISMATCH');
  if (r.viewerCount !== POPULATION[arm][0] || r.traderCount !== POPULATION[arm][1]) fail('POPULATION_MISMATCH');
  if (r.cryptoJobs !== CRYPTO_JOBS || r.traceSha !== TRACE_SHA) fail('TRACE_MISMATCH');
  for (const k of ['timeouts', 'unexpectedErrors', 'missedJobs', 'orderLoss', 'doubleSpend', 'viewerMutations']) if (r[k] !== 0) fail(k.toUpperCase());
  if (!Array.isArray(r.samples) || !Array.isArray(s.raw) || !Array.isArray(r.cryptoLatencies)) { fail('SAMPLES_OR_SPANS_INVALID'); return false; }
  const counts = {};
  for (const x of r.samples) { const k = x.kind + ':' + x.op; counts[k] = (counts[k] || 0) + 1; }
  const want = Object.fromEntries(Object.entries(EXPECTED[arm]).flatMap(([kind, ops]) => Object.entries(ops).map(([op, n]) => [kind + ':' + op, n])));
  if (Object.keys({...counts, ...want}).some(k => counts[k] !== want[k]) || r.requests !== r.samples.length) fail('REQUEST_COUNTS_MISMATCH');
  if (new Set(r.samples.map(x => x.requestId)).size !== r.samples.length) fail('REQUEST_IDS_NOT_UNIQUE');
  if (r.samples.some(x => x.status !== STATUS_OF(x.kind, x.op))) fail('HTTP_STATUS_UNEXPECTED');
  if (r.samples.some(x => !nonNegative(x.ms))) fail('SAMPLE_NUMBERS_INVALID');
  const crypto = r.samples.filter(x => x.kind === 'crypto').map(x => x.ms);
  if (crypto.length !== r.cryptoLatencies.length || crypto.some((x, i) => x !== r.cryptoLatencies[i])) fail('CRYPTO_LATENCIES_MISMATCH');
  if (s.dropped !== 0) fail('SPANS_DROPPED');
  if (!(finite(s.elapsedMs) && s.elapsedMs >= PLAN.measureMs)) fail('SPANS_WINDOW_SHORT'); // spans-start/stop bracket the measured window
  if (s.queueTransformHits !== 1) fail('AUTHORITY_QUEUE_UNINSTRUMENTED');
  if (s.raw.some(x => !finite(x.start) || !nonNegative(x.ms) || (x.name === 'gc' && !nonNegative(x.durationMs)))) fail('SPAN_NUMBERS_INVALID');
  const d = s.delay, u = s.eventLoop?.utilization;
  if (!d || !['meanMs', 'maxMs', 'p95Ms', 'p99Ms'].every(k => nonNegative(d[k])) || !(finite(u) && u >= 0 && u <= 1)) fail('PROCESS_METRICS_INVALID');
  if (!s.raw.some(x => x.name === 'pg.wait.sample') || s.raw.some(x => x.name === 'pg.wait.sample.error')) fail('PG_WAIT_SAMPLES_INVALID');
  return true;
}

function summarize(dir, {pin = require('./policy-613-after.cjs').RC} = {}) {
  const failures = [], result = readJson(path.join(dir, 'result.json'), failures, 'RESULT');
  if (result) {
    if (result.status !== STATUS || result.spans !== true || result.comparison?.spans !== true) failures.push('NOT_A_SPANS_RUN');
    if (result.runtimeSourceSha !== pin) failures.push('PROVENANCE_MISMATCH');
    if (result.scope !== 'ci-diagnostic') failures.push('SCOPE_MISMATCH');
    if (result.fullWorkloadRuns !== 1) failures.push('WORKLOAD_NOT_RUN_ONCE');
    if (!Array.isArray(result.failures) || result.failures.length) failures.push('RUN_FAILURES_RECORDED');
    if (result.allRecordedPidsStopped !== true || result.postgresStopped !== true || result.postgresStatusExit !== PG_NOT_RUNNING || Object.hasOwn(result, 'cleanupError')) failures.push('CLEANUP_UNCONFIRMED');
  }
  const arms = {}, rows = {};
  for (const arm of ARMS) {
    const tag = arm.toUpperCase();
    const r = readJson(path.join(dir, arm + '-result.json'), failures, tag + '_RESULT');
    const s = readJson(path.join(dir, arm + '-spans.json'), failures, tag + '_SPANS');
    if (!r || !s || !checkArm(arm, r, s, failures)) continue;
    const d = decompose(r.samples, s.raw);
    for (const [k, n] of Object.entries(d.problems)) if (n) failures.push(`${tag}_${k.replace(/[A-Z]/g, m => '_' + m).toUpperCase()}:${n}`);
    rows[arm] = d.rows;
    arms[arm] = {crypto: Object.fromEntries(COMPONENTS.map(c => [c, stats(d.rows.map(x => x[c]))])),
      requestsWithOverlap: d.rows.filter(x => x.overlap > 0).length, requestsWithSpanTimeOutsideHandler: d.rows.filter(x => x.outsideWindow > 0).length,
      process: processStats(s, s.raw)};
  }
  // Tail excess: mixed crypto requests slower than the baseline client p95;
  // each part's excess over the baseline mean of the same operation. The parts
  // partition the client time, so the shares sum to 1.
  let tail = null;
  if (rows.baseline?.length && rows.mixed?.length) {
    const threshold = percentile(rows.baseline.map(x => x.client), .95), base = {};
    for (const op of new Set(rows.baseline.map(x => x.op))) {
      const own = rows.baseline.filter(x => x.op === op);
      base[op] = Object.fromEntries(['client', ...PARTS].map(c => [c, mean(own.map(x => x[c]))]));
    }
    const slow = rows.mixed.filter(x => x.client > threshold && base[x.op]);
    const excess = Object.fromEntries(['client', ...PARTS].map(c => [c, sum(slow.map(x => x[c] - base[x.op][c]))]));
    tail = {thresholdMs: threshold, requests: slow.length, of: rows.mixed.length, excessMs: excess,
      shares: Object.fromEntries(PARTS.map(c => [c, excess.client > 0 ? excess[c] / excess.client : null]))};
  }
  return {status: failures.length ? 'INCOMPLETE' : 'COMPLETE', failures, scope: 'SPANS_DIAGNOSTIC_NOT_A_P95_VERDICT', pin, arms, tail};
}

function markdown(s) {
  const f = (x, d = 2) => finite(x) ? x.toFixed(d) : '—';
  const lines = [`Spans decomposition: **${s.status}**${s.failures.length ? ' — ' + s.failures.map(x => '`' + x + '`').join(', ') : ''}`, '',
    '| arm | component | p50 ms | p95 ms | mean ms |', '|---|---|---|---|---|'];
  for (const [arm, a] of Object.entries(s.arms)) for (const c of COMPONENTS) lines.push(`| ${arm} | ${c} | ${f(a.crypto[c].p50)} | ${f(a.crypto[c].p95)} | ${f(a.crypto[c].mean)} |`);
  lines.push('', '| arm | requests with overlap / span time after handler | event-loop delay p95/p99/max ms | ELU | GC count / ms | spans (dropped) | PG waiting samples | viewer gateway / identity p95 ms |', '|---|---|---|---|---|---|---|---|');
  for (const [arm, a] of Object.entries(s.arms)) {
    const p = a.process, d = p.eventLoopDelayMs || {};
    lines.push(`| ${arm} | ${a.requestsWithOverlap} / ${a.requestsWithSpanTimeOutsideHandler} | ${f(d.p95Ms)} / ${f(d.p99Ms)} / ${f(d.maxMs)} | ${f(p.eventLoopUtilization, 3)} | ${p.gc.count} / ${f(p.gc.totalMs, 1)} | ${p.spans.total} (${p.spans.dropped}) | ${p.pgWaits.waitingSamples}/${p.pgWaits.samples} | ${f(p.viewer.gatewayStateMs.p95)} / ${f(p.viewer.identityMs.p95)} |`);
  }
  if (s.tail) lines.push('', `Mixed tail: ${s.tail.requests}/${s.tail.of} crypto requests above the baseline client p95 ${f(s.tail.thresholdMs)} ms; excess ${f(s.tail.excessMs.client, 1)} ms split: ` +
    PARTS.map(c => `${c} ${f(s.tail.shares[c] === null ? null : s.tail.shares[c] * 100, 1)} %`).join(', ') + '.');
  lines.push('', 'Handler time is partitioned by span intervals: `overlap` = two or more categories at once; `rest` = no wrapped call in progress. Server-side spans of one CI_DIAGNOSTIC run with the same instrumentation in both arms, overhead not removed: a decomposition to test hypotheses, never a p95 verdict or capacity acceptance.');
  return lines.join('\n');
}

module.exports = {summarize, markdown, decompose, partition};

if (require.main === module) {
  const [dir, jsonOut] = process.argv.slice(2);
  if (!dir) { console.error('usage: node spans-summary-613.cjs <runOutDir> [out.json]'); process.exit(2); }
  const s = summarize(dir);
  console.log(markdown(s));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(s, null, 2));
  process.exitCode = s.status === 'COMPLETE' ? 0 : 1;
}
