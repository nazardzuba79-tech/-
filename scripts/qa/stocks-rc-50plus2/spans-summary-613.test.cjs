'use strict';
// spans-summary-613.cjs on a synthetic spans run built in a temporary directory
// with the plan's exact request counts, plus the runner's refusal to stack
// instrumentations. No server, database or workload runs here.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const {summarize, markdown, partition} = require('./spans-summary-613.cjs');
const {traceSha} = require('./driver.cjs');
const PIN = require('./policy-613-after.cjs').RC;
const STATUS = {'place-limit': 201, open: 200, cancel: 204, balances: 200};
const ROUTE = {'place-limit': ['POST', '/api/v1/demo/orders'], open: ['GET', '/api/v1/demo/orders/open'], cancel: ['DELETE', '/api/v1/demo/orders/cm0order'], balances: ['GET', '/api/v1/demo/balances']};
const TRADER = ['state', 'submit-limit', 'cancel-limit', 'submit-buy', 'retry-buy', 'submit-sell', 'retry-sell'];
const close = (a, b) => Math.abs(a - b) < 1e-9;

// Each crypto handler (server 4 ms): jwt 0.5, Session read 0.75, AuditLog read
// 0.25, transaction admission 0.25 (place-limit and cancel only), trading
// Prisma 2, then uncovered time; client = server + 1 ms. In the mixed arm every
// 10th job is slow: +6 ms uncovered inside the handler and +4 ms outside it.
function arm(name) {
  const samples = [], raw = [], cryptoLatencies = []; let n = 0;
  const id = () => `${name}-measure-${++n}`;
  for (let job = 0; job < 80; job++) Object.keys(STATUS).forEach((op, k) => {
    const rid = id(), slow = name === 'mixed' && job % 10 === 0, t = job * 250 + k * 20, server = slow ? 10 : 4, client = server + (slow ? 5 : 1);
    samples.push({requestId: rid, kind: 'crypto', op, status: STATUS[op], ms: client, at: t}); cryptoLatencies.push(client);
    raw.push({name: 'http.server', start: t, ms: server, request: rid, method: ROUTE[op][0], route: ROUTE[op][1], status: STATUS[op]});
    let c = t;
    const span = (spanName, ms, more = {}) => { raw.push({name: spanName, start: c, ms, request: rid, ...more}); c += ms; };
    span('jwt.verify', 0.5);
    span('prisma.operation', 0.75, {model: 'Session', action: 'findUnique'});
    span('prisma.operation', 0.25, {model: 'AuditLog', action: 'findFirst'});
    if (op === 'place-limit' || op === 'cancel') span('pg.transaction.admission', 0.25);
    span('prisma.operation', 2, {model: 'DemoOrder', action: 'findMany'});
  });
  if (name === 'mixed') {
    for (let i = 0; i < 50; i++) for (let cycle = 0; cycle < 20; cycle++) {
      const rid = id();
      samples.push({requestId: rid, kind: 'viewer', op: 'state', status: 200, ms: 3, at: i * 20 + cycle * 1000});
      raw.push({name: 'http.server', start: 0, ms: 2.5, request: rid, route: '/__stocks_global/state'}, {name: 'http.server', start: 0, ms: 1.25, request: rid, route: '/api/v1/stocks-test-cash/identity'});
      if (cycle === 0) samples.push({requestId: id(), kind: 'viewer', op: 'deny-order', status: 401, ms: 3, at: i * 20});
    }
    for (let i = 0; i < 2; i++) for (let cycle = 0; cycle < 5; cycle++) for (const op of TRADER) if (op === 'state' || cycle % 2 === 1) samples.push({requestId: id(), kind: 'trader', op, status: 200, ms: 15, at: 500 + i * 2000 + cycle * 4000});
  }
  raw.push({name: 'gc', start: 0, ms: 99, request: null, durationMs: 1.5}, {name: 'pg.wait.sample', start: 0, ms: 1, request: null, rows: [{type: 'LWLock', event: 'WALWrite', count: 1}]});
  const result = {arm: name, warmup: false, cryptoJobs: 80, traceSha, viewerCount: name === 'mixed' ? 50 : 0, traderCount: name === 'mixed' ? 2 : 0,
    timeouts: 0, unexpectedErrors: 0, missedJobs: 0, orderLoss: 0, doubleSpend: 0, viewerMutations: 0, requests: samples.length, cryptoLatencies, samples};
  const spans = {raw, dropped: 0, elapsedMs: 20250, queueTransformHits: 1, eventLoop: {utilization: name === 'mixed' ? .6 : .2}, delay: {meanMs: 10, maxMs: 30, p95Ms: 11, p99Ms: 20}, cpu: {user: 1, system: 1}};
  return {result, spans};
}
function run(t, change = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50-spans-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const files = {'result.json': {runtimeSourceSha: PIN, scope: 'ci-diagnostic', status: 'SPANS_ONLY_NOT_A_P95_VERDICT', spans: true, comparison: {spans: true}, fullWorkloadRuns: 1, failures: [],
    allRecordedPidsStopped: true, postgresStopped: true, postgresStatusExit: 3}};
  for (const a of ['baseline', 'mixed']) { const x = arm(a); files[a + '-result.json'] = x.result; files[a + '-spans.json'] = x.spans; }
  change(files);
  for (const [name, value] of Object.entries(files)) if (value !== undefined) fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  return dir;
}
const incomplete = (s, ...codes) => { assert.equal(s.status, 'INCOMPLETE'); for (const c of codes) assert.ok(s.failures.includes(c), c + ' in ' + s.failures.join(', ')); };
const both = fn => f => { for (const a of ['baseline', 'mixed']) fn(f, a); };

test('a complete synthetic run is partitioned exactly and the tail shares sum to 1', t => {
  const s = summarize(run(t));
  assert.equal(s.status, 'COMPLETE', s.failures.join(', '));
  const b = s.arms.baseline.crypto, m = s.arms.mixed.crypto;
  assert.deepEqual([b.client.p50, b.server.p50, b.outside.p50, b.jwt.p50, b.authAccessDb.p50, b.tradeDb.p50, b.txAdmission.p95, b.overlap.p95, b.rest.p50], [5, 4, 1, .5, 1, 2, .25, 0, .25]);
  assert.equal(b.outsideWindow.p95, 0); assert.equal(b.sameCategoryConcurrency.p95, 0);
  assert.equal(m.client.p95, 15);
  // 8 slow jobs x 4 requests; 10 ms excess each = 6 ms rest + 4 ms outside.
  assert.equal(s.tail.requests, 32); assert.equal(s.tail.of, 320); assert.ok(close(s.tail.excessMs.client, 320));
  assert.ok(close(s.tail.shares.rest, .6) && close(s.tail.shares.outside, .4));
  for (const c of ['jwt', 'authAccessDb', 'tradeDb', 'txAdmission', 'overlap']) assert.ok(close(s.tail.shares[c], 0), c);
  assert.ok(close(Object.values(s.tail.shares).reduce((x, y) => x + y, 0), 1));
  assert.equal(s.arms.mixed.process.viewer.gatewayStateMs.count, 1000);
  assert.equal(s.arms.mixed.process.pgWaits.waitingSamples, 1);
  assert.match(markdown(s), /never a p95 verdict/);
});

test('overlapping and nested spans are partitioned, not subtracted or clamped', () => {
  // Handler [0,10]: jwt [0,1]; fire-and-forget Session.update [1,12] runs past
  // the response; two trading reads [3,6] and [5,8] overlap it and each other.
  const p = partition({start: 0, ms: 10}, [
    {category: 'jwt', start: 0, ms: 1}, {category: 'authAccessDb', start: 1, ms: 11},
    {category: 'tradeDb', start: 3, ms: 3}, {category: 'tradeDb', start: 5, ms: 3}]);
  assert.deepEqual({jwt: p.jwt, authAccessDb: p.authAccessDb, tradeDb: p.tradeDb, txAdmission: p.txAdmission, overlap: p.overlap, rest: p.rest},
    {jwt: 1, authAccessDb: 4, tradeDb: 0, txAdmission: 0, overlap: 5, rest: 0});
  assert.equal(p.outsideWindow, 2, 'span time after the handler is reported, not subtracted');
  assert.equal(p.sameCategoryConcurrency, 1, 'concurrent trading reads are reported');
  assert.equal(p.jwt + p.authAccessDb + p.tradeDb + p.txAdmission + p.overlap + p.rest, 10, 'the parts are exactly the handler time');
  // Summing durations would give 1 + 11 + 6 = 18 ms inside a 10 ms handler.
});

test('the four reported passes fail closed', t => {
  incomplete(summarize(run(t, both((f, a) => { f[a + '-result.json'].samples = f[a + '-result.json'].samples.filter(x => x.kind !== 'crypto' || x.op === 'place-limit'); }))),
    'BASELINE_REQUEST_COUNTS_MISMATCH', 'MIXED_REQUEST_COUNTS_MISMATCH', 'BASELINE_CRYPTO_LATENCIES_MISMATCH');
  incomplete(summarize(run(t, both((f, a) => { f[a + '-spans.json'].raw = f[a + '-spans.json'].raw.filter(x => !['jwt.verify', 'prisma.operation', 'pg.transaction.admission'].includes(x.name)); }))),
    'BASELINE_MISSING_INNER:320', 'MIXED_MISSING_INNER:320');
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].raw.find(x => x.name === 'jwt.verify').ms = -5; })), 'MIXED_SPAN_NUMBERS_INVALID');
  incomplete(summarize(run(t, f => { const m = f['mixed-result.json']; m.viewerCount = 0; m.traderCount = 0; m.samples.find(x => x.kind === 'crypto').status = 500; })),
    'MIXED_POPULATION_MISMATCH', 'MIXED_HTTP_STATUS_UNEXPECTED');
});

test('counts, numbers and spans: every gap fails closed', t => {
  incomplete(summarize(run(t, f => { f['mixed-result.json'].samples = f['mixed-result.json'].samples.filter((x, i) => !(x.kind === 'viewer' && i % 100 === 0)); })), 'MIXED_REQUEST_COUNTS_MISMATCH');
  incomplete(summarize(run(t, f => { f['mixed-result.json'].samples[3].requestId = f['mixed-result.json'].samples[2].requestId; })), 'MIXED_REQUEST_IDS_NOT_UNIQUE');
  incomplete(summarize(run(t, f => { f['baseline-result.json'].cryptoLatencies[7] += 1; })), 'BASELINE_CRYPTO_LATENCIES_MISMATCH');
  incomplete(summarize(run(t, f => { f['baseline-result.json'].samples[0].ms = 'NaN'; })), 'BASELINE_SAMPLE_NUMBERS_INVALID');
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].raw.find(x => x.name === 'prisma.operation').start = null; })), 'MIXED_SPAN_NUMBERS_INVALID');
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].dropped = 3; })), 'MIXED_SPANS_DROPPED');
  incomplete(summarize(run(t, f => { delete f['mixed-spans.json']; })), 'MIXED_SPANS_MISSING');
  incomplete(summarize(run(t, f => { f['baseline-spans.json'] = '{"raw":['; })), 'BASELINE_SPANS_CORRUPT');
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].queueTransformHits = 0; })), 'MIXED_AUTHORITY_QUEUE_UNINSTRUMENTED');
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].eventLoop.utilization = 1.5; })), 'MIXED_PROCESS_METRICS_INVALID');
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].raw.push({name: 'pg.wait.sample.error', start: 0, ms: 0, request: null}); })), 'MIXED_PG_WAIT_SAMPLES_INVALID');
  incomplete(summarize(run(t, f => { f['baseline-spans.json'].raw = f['baseline-spans.json'].raw.filter(x => !(x.name === 'http.server' && x.request === 'baseline-measure-7')); })), 'BASELINE_UNCORRELATED:1');
  incomplete(summarize(run(t, f => { f['baseline-spans.json'].raw.find(x => x.name === 'jwt.verify').start -= 1; })), 'BASELINE_BEFORE_HANDLER:1');
  incomplete(summarize(run(t, f => { f['baseline-result.json'].samples[0].ms = 3; f['baseline-result.json'].cryptoLatencies[0] = 3; })), 'BASELINE_SERVER_LONGER_THAN_CLIENT:1');
  incomplete(summarize(run(t, f => { const raw = f['mixed-spans.json'].raw, i = raw.findIndex(x => x.request === 'mixed-measure-1' && x.name === 'pg.transaction.admission'); raw.splice(i, 1); })), 'MIXED_MISSING_INNER:1');
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].raw.find(x => x.request === 'mixed-measure-3' && x.name === 'http.server').method = 'GET'; })), 'MIXED_ROUTE_MISMATCH:1');
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].raw.find(x => x.request === 'mixed-measure-2' && x.name === 'http.server').route = '/api/v1/demo/orders/history'; })), 'MIXED_ROUTE_MISMATCH:1');
  incomplete(summarize(run(t, f => { f['baseline-spans.json'].raw.find(x => x.request === 'baseline-measure-4' && x.name === 'http.server').status = 500; })), 'BASELINE_STATUS_MISMATCH:1');
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].elapsedMs = 12000; })), 'MIXED_SPANS_WINDOW_SHORT');
  incomplete(summarize(run(t, f => { f['baseline-result.json'].samples[0].op = 'place-market'; })), 'BASELINE_REQUEST_COUNTS_MISMATCH', 'BASELINE_HTTP_STATUS_UNEXPECTED', 'BASELINE_ROUTE_MISMATCH:1');
});

test('only a clean spans run of the after pin is accepted', t => {
  incomplete(summarize(run(t, f => { f['result.json'].status = 'FAIL_LOCAL_DIAGNOSTIC'; })), 'NOT_A_SPANS_RUN');
  incomplete(summarize(run(t, f => { delete f['result.json'].comparison; })), 'NOT_A_SPANS_RUN');
  incomplete(summarize(run(t, f => { f['result.json'].runtimeSourceSha = '234437f8bb106cc576375ff7df9b817d3fbc01cc'; })), 'PROVENANCE_MISMATCH');
  incomplete(summarize(run(t, f => { f['result.json'].scope = 'local-diagnostic'; })), 'SCOPE_MISMATCH');
  incomplete(summarize(run(t, f => { f['result.json'].postgresStatusExit = 0; })), 'CLEANUP_UNCONFIRMED');
  incomplete(summarize(run(t, f => { f['result.json'].failures = ['ARM_INVARIANT_FAILED_mixed']; })), 'RUN_FAILURES_RECORDED');
  incomplete(summarize(run(t, f => { f['mixed-result.json'].traceSha = '0'.repeat(64); })), 'MIXED_TRACE_MISMATCH');
  incomplete(summarize(run(t, f => { f['mixed-result.json'].orderLoss = 1; })), 'MIXED_ORDERLOSS');
  incomplete(summarize(run(t, f => { f['baseline-result.json'].warmup = true; })), 'BASELINE_ARM_MISMATCH');
});

test('CLI exit code follows completeness and the JSON is written either way', t => {
  const cli = dir => cp.spawnSync(process.execPath, [path.join(__dirname, 'spans-summary-613.cjs'), dir, path.join(dir, 'spans-summary.json')], {encoding: 'utf8', env: {PATH: process.env.PATH}});
  let dir = run(t), r = cli(dir);
  assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'spans-summary.json'), 'utf8')).status, 'COMPLETE');
  dir = run(t, f => { f['mixed-spans.json'].dropped = 1; }); r = cli(dir);
  assert.equal(r.status, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'spans-summary.json'), 'utf8')).status, 'INCOMPLETE');
});

test('the runner refuses spans together with a CPU profile before any admission', () => {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'diagnostic-run-613.cjs'), '--after', '--spans', '--cpu-prof'], {encoding: 'utf8', env: {PATH: process.env.PATH}, timeout: 30000});
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.fullWorkloadRuns, 0); assert.deepEqual(out.failures, ['ONE_INSTRUMENTATION_PER_RUN']);
});
