'use strict';
// calibration-613.cjs (#613 R8 A/A calibration of the isolated-client method) on synthetic run directories. No workload.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const {calibrate} = require('./calibration-613.cjs'), {percentile} = require('./policy.cjs'), {PLAN, traceSha} = require('./driver.cjs');
const PIN = 'a'.repeat(40), SCRIPT = path.join(__dirname, 'calibration-613.cjs');
const latencies = (n, scale) => Array.from({length: n}, (_, i) => scale * (5 + (i * 37 % 100) / 10));
const isolation = {proof: {ok: true, checkedThreads: 60, violations: []}, headroom: {ok: true, clientUtilization: 0.05, driverElu: 0.08},
  usage: {server: {utilization: 0.1, stealMs: 20}, client: {utilization: 0.03, stealMs: 5}}, memory: {api: {hwmKb: 200000}, stocksAuthority: {hwmKb: 150000}, stocksGateway: {hwmKb: 110000}, postgres: {pssKb: 60000}}};
function armResult(arm, lat) {
  return {arm, warmup: false, viewerCount: 0, traderCount: 0, cryptoLatencies: lat, cryptoJobs: PLAN.measureMs / PLAN.cryptoPeriodMs, traceSha, timeouts: 0, unexpectedErrors: 0, missedJobs: 0, orderLoss: 0, doubleSpend: 0, viewerMutations: 0, isolation, ...(arm === 'mixed' ? {nullArm: true} : {})};
}
function runs(t, scales) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50-cal-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  scales.forEach(([a, b], i) => {
    const out = path.join(dir, 'aa-' + (i + 1), 'out'); fs.mkdirSync(out, {recursive: true});
    const first = latencies(320, a), second = latencies(320, b), p = percentile(first, .95), q = percentile(second, .95);
    fs.writeFileSync(path.join(out, 'baseline-result.json'), JSON.stringify(armResult('baseline', first)));
    fs.writeFileSync(path.join(out, 'mixed-result.json'), JSON.stringify(armResult('mixed', second)));
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({runtimeSourceSha: PIN, status: 'CALIBRATION_ONLY_NOT_A_VERDICT', methodology: 'isolated-clients', nullArm: true, sustained: false, failures: [], fullWorkloadRuns: 1,
      qualification: {placement: {ok: true}}, isolation: {admission: []}, allRecordedPidsStopped: true, postgresStopped: true, postgresStatusExit: 3, calibration: {deltaPercent: (q - p) / p * 100}}));
  });
  return dir;
}
const edit = (dir, run, file, fn) => { const f = path.join(dir, run, 'out', file), j = JSON.parse(fs.readFileSync(f, 'utf8')); fn(j); fs.writeFileSync(f, JSON.stringify(j)); };

test('complete A/A runs within ±5 % calibrate the method; the pooled and per-run numbers are reported', t => {
  const c = calibrate(runs(t, [[1, 1.02], [1, 0.98], [1, 1.01]]), {runs: 3, pin: PIN});
  assert.deepEqual(c.collection, {status: 'COMPLETE', expectedRuns: 3, completeRuns: 3, failures: []});
  assert.equal(c.verdict, 'METHOD_CALIBRATED');
  assert.ok(Math.abs(c.pooledDeltaPercent) < 2.5, String(c.pooledDeltaPercent));
  assert.equal(c.runDeltaPercent.length, 3); assert.ok(c.bootstrapPooledDeltaPercent95[0] <= c.bootstrapPooledDeltaPercent95[1]);
  assert.ok(Math.abs(c.serverUtilization.mean - 0.1) < 1e-12); assert.equal(c.serverMemoryMbMax, (200000 + 150000 + 110000 + 60000) / 1024);
});

test('a null that by itself moves p95 more than 5 % does not calibrate (exit 1)', t => {
  const dir = runs(t, [[1, 1.08], [1, 1.07]]), c = calibrate(dir, {runs: 2, pin: PIN});
  assert.equal(c.collection.status, 'COMPLETE'); assert.equal(c.verdict, 'METHOD_NOT_CALIBRATED');
  assert.equal(cp.spawnSync(process.execPath, [SCRIPT, dir, '--runs', '2', '--pin', PIN]).status, 1);
  assert.equal(cp.spawnSync(process.execPath, [SCRIPT, runs(t, [[1, 1], [1, 1]]), '--runs', '2', '--pin', PIN]).status, 0);
});

test('fail-closed: missing runs, wrong pin, a placement, headroom or cleanup gap, a loaded second arm or a stale stored delta', t => {
  const cases = [
    [dir => fs.rmSync(path.join(dir, 'aa-2'), {recursive: true}), 'aa-2:RUN_MISSING'],
    [dir => edit(dir, 'aa-1', 'result.json', j => { j.runtimeSourceSha = 'b'.repeat(40); }), 'aa-1:PROVENANCE_MISMATCH'],
    [dir => edit(dir, 'aa-1', 'mixed-result.json', j => { j.isolation = {...j.isolation, proof: {ok: false, checkedThreads: 60}}; }), 'aa-1:MIXED_PLACEMENT_UNPROVEN'],
    [dir => edit(dir, 'aa-1', 'baseline-result.json', j => { j.isolation = {...j.isolation, headroom: {ok: false}}; }), 'aa-1:BASELINE_CLIENT_HEADROOM_UNPROVEN'],
    [dir => edit(dir, 'aa-1', 'result.json', j => { j.qualification.placement.ok = false; }), 'aa-1:QUALIFICATION_PLACEMENT_UNPROVEN'],
    [dir => edit(dir, 'aa-1', 'result.json', j => { j.postgresStatusExit = 0; }), 'aa-1:CLEANUP_UNCONFIRMED'],
    [dir => edit(dir, 'aa-1', 'mixed-result.json', j => { j.viewerCount = 50; }), 'aa-1:MIXED_NOT_A_BASELINE_LOAD'],
    [dir => edit(dir, 'aa-1', 'result.json', j => { j.calibration.deltaPercent += 1; }), 'aa-1:CALIBRATION_INCONSISTENT'],
    [dir => edit(dir, 'aa-1', 'result.json', j => { j.status = 'PASS_LOCAL_DIAGNOSTIC'; }), 'aa-1:NOT_A_CALIBRATION_RUN'],
    [dir => fs.mkdirSync(path.join(dir, 'aa-9')), 'UNEXPECTED_RUN:aa-9'],
  ];
  for (const [damage, code] of cases) {
    const dir = runs(t, [[1, 1], [1, 1]]); damage(dir);
    const c = calibrate(dir, {runs: 2, pin: PIN});
    assert.equal(c.collection.status, 'INCOMPLETE', code); assert.ok(c.collection.failures.includes(code), code + ' in ' + c.collection.failures.join(', '));
    assert.equal(c.verdict, 'NOT_EVALUATED_INCOMPLETE_COLLECTION');
  }
  assert.ok(calibrate(runs(t, [[1, 1]]), {runs: undefined, pin: PIN}).collection.failures.includes('EXPECTED_RUNS_UNKNOWN'));
});
