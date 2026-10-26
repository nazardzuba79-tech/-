'use strict';
// Server-side decomposition of ONE `diagnostic-run-613.cjs --after --spans` run.
// For every measured crypto request it splits the client latency into: time
// outside the API handler (accept/queueing/transport), and inside the handler
// JWT verification, Prisma on the auth models (session, user, contact-block
// audit log), other Prisma, transaction admission (pool + BEGIN) and the rest
// (synchronous JS and event-loop waits between continuations). It also reports
// process event-loop delay, ELU, GC and PostgreSQL wait samples, and how much of
// the mixed-arm tail excess each component carries.
// Fail-closed: missing, corrupt, truncated or uncorrelated spans, a run that is
// not a spans run, wrong provenance or unconfirmed cleanup -> INCOMPLETE, exit 1.
// The same instrumentation runs in both arms and its overhead is not removed:
// this is a diagnostic decomposition, never a p95 verdict or acceptance.
// Usage: node spans-summary-613.cjs <runOutDir> [out.json]
const fs = require('node:fs'), path = require('node:path');
const {percentile} = require('./policy.cjs');
const {PLAN, traceSha: TRACE_SHA} = require('./driver.cjs');

const ARMS = ['baseline', 'mixed'];
const STATUS = 'SPANS_ONLY_NOT_A_P95_VERDICT';
const PG_NOT_RUNNING = 3; // documented `pg_ctl status` exit code for a stopped server
const CRYPTO_JOBS = PLAN.measureMs / PLAN.cryptoPeriodMs;
const AUTH_MODELS = new Set(['Session', 'User', 'AuditLog']); // requireAuth reads on the crypto routes
const PARTS = ['outside', 'jwt', 'authDb', 'tradeDb', 'txAdmission', 'rest'];
const COMPONENTS = ['client', 'server', ...PARTS];
const VIEWER_ROUTES = {gateway: '/__stocks_global/state', identity: '/api/v1/stocks-test-cash/identity'};

const finite = x => typeof x === 'number' && Number.isFinite(x);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sum = a => a.reduce((x, y) => x + y, 0);
const stats = a => ({count: a.length, p50: percentile(a, .5), p95: percentile(a, .95), mean: mean(a)});

function readJson(file, failures, tag) {
  if (!fs.existsSync(file)) { failures.push(tag + '_MISSING'); return null; }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { failures.push(tag + '_CORRUPT'); return null; }
}

// Per crypto request: client time from the generator sample, the API handler
// span correlated by x-rc50-request, and the request-correlated inner spans.
function decompose(samples, raw) {
  const byRequest = new Map();
  for (const s of raw) if (typeof s.request === 'string') (byRequest.get(s.request) || byRequest.set(s.request, []).get(s.request)).push(s);
  const rows = [], uncorrelated = [];
  for (const c of samples.filter(x => x.kind === 'crypto')) {
    const spans = byRequest.get(c.requestId) || [], server = spans.filter(s => s.name === 'http.server');
    if (server.length !== 1 || !finite(server[0].ms) || !finite(c.ms)) { uncorrelated.push(c.requestId); continue; }
    const ms = name => sum(spans.filter(s => s.name === name).map(s => s.ms));
    const prisma = spans.filter(s => s.name === 'prisma.operation');
    const row = {requestId: c.requestId, op: c.op, client: c.ms, server: server[0].ms, jwt: ms('jwt.verify'),
      authDb: sum(prisma.filter(s => AUTH_MODELS.has(s.model)).map(s => s.ms)),
      tradeDb: sum(prisma.filter(s => !AUTH_MODELS.has(s.model)).map(s => s.ms)),
      txAdmission: ms('pg.transaction.admission')};
    row.outside = row.client - row.server;
    row.rest = Math.max(0, row.server - row.jwt - row.authDb - row.tradeDb - row.txAdmission);
    rows.push(row);
  }
  return {rows, uncorrelated};
}

function processStats(spans, raw) {
  const gc = raw.filter(s => s.name === 'gc'), waits = raw.filter(s => s.name === 'pg.wait.sample');
  const events = {};
  for (const w of waits) for (const r of w.rows || []) if (r.type) events[r.type + ':' + r.event] = (events[r.type + ':' + r.event] || 0) + r.count;
  const route = r => stats(raw.filter(s => s.name === 'http.server' && s.route === r).map(s => s.ms));
  return {eventLoopDelayMs: spans.delay ?? null, eventLoopUtilization: spans.eventLoop?.utilization ?? null,
    gc: {count: gc.length, totalMs: sum(gc.map(s => s.durationMs || 0))}, cpu: spans.cpu ?? null,
    spans: {total: raw.length, dropped: spans.dropped},
    pgWaits: {samples: waits.length, waitingSamples: waits.filter(w => (w.rows || []).some(r => r.type)).length, events},
    viewer: {gatewayStateMs: route(VIEWER_ROUTES.gateway), identityMs: route(VIEWER_ROUTES.identity)},
    authorityQueueWaitMs: stats(raw.filter(s => s.name === 'authority.queue.wait').map(s => s.ms))};
}

function summarize(dir, {pin = require('./policy-613-after.cjs').RC} = {}) {
  const failures = [], result = readJson(path.join(dir, 'result.json'), failures, 'RESULT');
  if (result) {
    if (result.status !== STATUS || result.spans !== true) failures.push('NOT_A_SPANS_RUN');
    if (result.runtimeSourceSha !== pin) failures.push('PROVENANCE_MISMATCH');
    if (result.fullWorkloadRuns !== 1) failures.push('WORKLOAD_NOT_RUN_ONCE');
    if (!Array.isArray(result.failures) || result.failures.length) failures.push('RUN_FAILURES_RECORDED');
    if (result.allRecordedPidsStopped !== true || result.postgresStopped !== true || result.postgresStatusExit !== PG_NOT_RUNNING || Object.hasOwn(result, 'cleanupError')) failures.push('CLEANUP_UNCONFIRMED');
  }
  const arms = {}, rows = {};
  for (const arm of ARMS) {
    const tag = arm.toUpperCase();
    const r = readJson(path.join(dir, arm + '-result.json'), failures, tag + '_RESULT');
    const s = readJson(path.join(dir, arm + '-spans.json'), failures, tag + '_SPANS');
    if (!r || !s) continue;
    if (r.cryptoJobs !== CRYPTO_JOBS || r.traceSha !== TRACE_SHA) failures.push(tag + '_TRACE_MISMATCH');
    for (const k of ['timeouts', 'unexpectedErrors', 'missedJobs', 'orderLoss', 'doubleSpend', 'viewerMutations']) if (r[k] !== 0) failures.push(tag + '_' + k.toUpperCase());
    if (!Array.isArray(r.samples) || !Array.isArray(s.raw)) { failures.push(tag + '_SAMPLES_OR_SPANS_INVALID'); continue; }
    if (s.dropped !== 0) failures.push(tag + '_SPANS_DROPPED');
    if (s.queueTransformHits !== 1) failures.push(tag + '_AUTHORITY_QUEUE_UNINSTRUMENTED');
    const d = decompose(r.samples, s.raw);
    if (d.uncorrelated.length) failures.push(tag + '_UNCORRELATED_REQUESTS:' + d.uncorrelated.length);
    if (d.rows.length < CRYPTO_JOBS) failures.push(tag + '_TOO_FEW_CRYPTO_REQUESTS');
    rows[arm] = d.rows;
    arms[arm] = {crypto: Object.fromEntries(COMPONENTS.map(c => [c, stats(d.rows.map(x => x[c]))])), process: processStats(s, s.raw)};
  }
  // Tail excess: mixed crypto requests slower than the baseline client p95; each
  // component's excess over the baseline mean of the same operation.
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
  lines.push('', '| arm | event-loop delay p95/p99/max ms | ELU | GC count / ms | spans (dropped) | PG waiting samples | viewer gateway / identity p95 ms |', '|---|---|---|---|---|---|---|');
  for (const [arm, a] of Object.entries(s.arms)) {
    const p = a.process, d = p.eventLoopDelayMs || {};
    lines.push(`| ${arm} | ${f(d.p95Ms)} / ${f(d.p99Ms)} / ${f(d.maxMs)} | ${f(p.eventLoopUtilization, 3)} | ${p.gc.count} / ${f(p.gc.totalMs, 1)} | ${p.spans.total} (${p.spans.dropped}) | ${p.pgWaits.waitingSamples}/${p.pgWaits.samples} | ${f(p.viewer.gatewayStateMs.p95)} / ${f(p.viewer.identityMs.p95)} |`);
  }
  if (s.tail) lines.push('', `Mixed tail: ${s.tail.requests}/${s.tail.of} crypto requests above the baseline client p95 ${f(s.tail.thresholdMs)} ms; excess ${f(s.tail.excessMs.client, 1)} ms split: ` +
    PARTS.map(c => `${c} ${f(s.tail.shares[c] === null ? null : s.tail.shares[c] * 100, 1)} %`).join(', ') + '.');
  lines.push('', 'Server-side spans of one CI_DIAGNOSTIC run; the same instrumentation in both arms, overhead not removed. A decomposition for hypotheses, never a p95 verdict or capacity acceptance.');
  return lines.join('\n');
}

module.exports = {summarize, markdown, decompose};

if (require.main === module) {
  const [dir, jsonOut] = process.argv.slice(2);
  const s = summarize(dir);
  console.log(markdown(s));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(s, null, 2));
  process.exitCode = s.status === 'COMPLETE' ? 0 : 1;
}
