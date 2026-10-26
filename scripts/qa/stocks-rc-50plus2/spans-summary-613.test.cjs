'use strict';
// spans-summary-613.cjs on a synthetic spans run built in a temporary directory,
// plus the runner's refusal to stack instrumentations. No server, database or
// workload runs here.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const {summarize, markdown} = require('./spans-summary-613.cjs');
const {traceSha} = require('./driver.cjs');
const PIN = require('./policy-613-after.cjs').RC;
const OPS = ['place-limit', 'open', 'cancel', 'balances'];

// Each crypto request: server 4 ms = jwt 0.5 + auth Prisma 1 + trade Prisma 2 +
// admission 0.25 + rest 0.25, client 5 ms. In the mixed arm every 10th job is
// slow: rest +6 ms inside the handler and +4 ms outside it.
function arm(name) {
  const samples = [], raw = [];
  for (let job = 0; job < 80; job++) OPS.forEach((op, k) => {
    const id = `${name}-measure-${job * 4 + k + 1}`, slow = name === 'mixed' && job % 10 === 0;
    const rest = slow ? 6.25 : 0.25, outside = slow ? 5 : 1, server = 3.75 + rest;
    samples.push({requestId: id, kind: 'crypto', op, status: 200, ms: server + outside, at: job * 250});
    raw.push({name: 'http.server', start: 0, ms: server, request: id, method: 'GET', route: '/api/v1/demo/x', status: 200},
      {name: 'jwt.verify', start: 0, ms: 0.5, request: id},
      {name: 'prisma.operation', start: 0, ms: 0.6, request: id, model: 'Session', action: 'findUnique'},
      {name: 'prisma.operation', start: 0, ms: 0.4, request: id, model: 'AuditLog', action: 'findFirst'},
      {name: 'prisma.operation', start: 0, ms: 2, request: id, model: 'DemoOrder', action: 'create'},
      {name: 'pg.transaction.admission', start: 0, ms: 0.25, request: id});
  });
  if (name === 'mixed') for (let i = 0; i < 50; i++) {
    const id = 'mixed-measure-v' + i;
    samples.push({requestId: id, kind: 'viewer', op: 'state', status: 200, ms: 3, at: i * 20});
    raw.push({name: 'http.server', start: 0, ms: 2.5, request: id, route: '/__stocks_global/state'},
      {name: 'http.server', start: 0, ms: 1.3, request: id, route: '/api/v1/stocks-test-cash/identity'});
  }
  raw.push({name: 'gc', start: 0, ms: 99, request: null, durationMs: 1.5}, {name: 'pg.wait.sample', start: 0, ms: 1, request: null, rows: [{type: 'LWLock', event: 'WALWrite', count: 1}]});
  const result = {arm: name, warmup: false, cryptoJobs: 80, traceSha, viewerCount: name === 'mixed' ? 50 : 0, traderCount: name === 'mixed' ? 2 : 0,
    timeouts: 0, unexpectedErrors: 0, missedJobs: 0, orderLoss: 0, doubleSpend: 0, viewerMutations: 0, samples};
  const spans = {raw, dropped: 0, queueTransformHits: 1, eventLoop: {utilization: name === 'mixed' ? .6 : .2}, delay: {meanMs: 10, maxMs: 30, p95Ms: 11, p99Ms: 20}, cpu: {user: 1, system: 1}};
  return {result, spans};
}
function run(t, change = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50-spans-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const files = {'result.json': {runtimeSourceSha: PIN, status: 'SPANS_ONLY_NOT_A_P95_VERDICT', spans: true, fullWorkloadRuns: 1, failures: [],
    allRecordedPidsStopped: true, postgresStopped: true, postgresStatusExit: 3}};
  for (const a of ['baseline', 'mixed']) { const x = arm(a); files[a + '-result.json'] = x.result; files[a + '-spans.json'] = x.spans; }
  change(files);
  for (const [name, value] of Object.entries(files)) if (value !== undefined) fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  return dir;
}
const incomplete = (s, ...codes) => { assert.equal(s.status, 'INCOMPLETE'); for (const c of codes) assert.ok(s.failures.includes(c), c + ' in ' + s.failures.join(', ')); };

test('a complete synthetic spans run is decomposed exactly', t => {
  const s = summarize(run(t));
  assert.equal(s.status, 'COMPLETE', s.failures.join(', '));
  const b = s.arms.baseline.crypto, m = s.arms.mixed.crypto;
  assert.deepEqual([b.client.p50, b.server.p50, b.jwt.p50, b.authDb.p50, b.tradeDb.p50, b.txAdmission.p50, b.outside.p50], [5, 4, .5, 1, 2, .25, 1]);
  assert.ok(Math.abs(b.rest.p50 - .25) < 1e-9);
  assert.equal(m.client.p95, 15);
  // 8 slow jobs x 4 requests; excess 10 ms each = 6 rest + 4 outside.
  assert.equal(s.tail.requests, 32); assert.equal(s.tail.of, 320);
  assert.ok(Math.abs(s.tail.excessMs.client - 320) < 1e-9);
  assert.ok(Math.abs(s.tail.shares.rest - .6) < 1e-9 && Math.abs(s.tail.shares.outside - .4) < 1e-9);
  for (const c of ['jwt', 'authDb', 'tradeDb', 'txAdmission']) assert.ok(Math.abs(s.tail.shares[c]) < 1e-9, c);
  assert.equal(s.arms.mixed.process.viewer.gatewayStateMs.count, 50);
  assert.equal(s.arms.mixed.process.pgWaits.waitingSamples, 1);
  assert.equal(s.arms.mixed.process.gc.totalMs, 1.5);
  assert.match(markdown(s), /never a p95 verdict/);
});

test('truncated, missing, corrupt or uninstrumented spans fail closed', t => {
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].dropped = 3; })), 'MIXED_SPANS_DROPPED');
  incomplete(summarize(run(t, f => { delete f['mixed-spans.json']; })), 'MIXED_SPANS_MISSING');
  incomplete(summarize(run(t, f => { f['baseline-spans.json'] = '{"raw":['; })), 'BASELINE_SPANS_CORRUPT');
  incomplete(summarize(run(t, f => { f['mixed-spans.json'].queueTransformHits = 0; })), 'MIXED_AUTHORITY_QUEUE_UNINSTRUMENTED');
  incomplete(summarize(run(t, f => { f['baseline-spans.json'].raw = f['baseline-spans.json'].raw.filter(x => !(x.name === 'http.server' && x.request === 'baseline-measure-7')); })), 'BASELINE_UNCORRELATED_REQUESTS:1');
});

test('only a clean spans run of the after pin is accepted', t => {
  incomplete(summarize(run(t, f => { f['result.json'].status = 'FAIL_LOCAL_DIAGNOSTIC'; })), 'NOT_A_SPANS_RUN');
  incomplete(summarize(run(t, f => { f['result.json'].runtimeSourceSha = '234437f8bb106cc576375ff7df9b817d3fbc01cc'; })), 'PROVENANCE_MISMATCH');
  incomplete(summarize(run(t, f => { f['result.json'].postgresStatusExit = 0; })), 'CLEANUP_UNCONFIRMED');
  incomplete(summarize(run(t, f => { f['result.json'].failures = ['ARM_INVARIANT_FAILED_mixed']; })), 'RUN_FAILURES_RECORDED');
  incomplete(summarize(run(t, f => { f['mixed-result.json'].traceSha = '0'.repeat(64); })), 'MIXED_TRACE_MISMATCH');
  incomplete(summarize(run(t, f => { f['mixed-result.json'].orderLoss = 1; })), 'MIXED_ORDERLOSS');
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
