'use strict';
// Collection gate of summarize-613.cjs on real CI_DIAGNOSTIC results
// (fixtures/summarize-613, see SOURCE.txt) and on corrupted temporary copies.
// No benchmark runs here.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const {summarize, markdown} = require('./summarize-613.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'summarize-613', 'runs');
const SCRIPT = path.join(__dirname, 'summarize-613.cjs');
const copy = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50-613-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true})); fs.cpSync(FIXTURE, dir, {recursive: true}); return dir; };
const file = (dir, run, name) => path.join(dir, run, 'out', name);
const edit = (dir, run, name, fn) => { const f = file(dir, run, name), j = JSON.parse(fs.readFileSync(f, 'utf8')); fn(j); fs.writeFileSync(f, JSON.stringify(j)); };
const failures = r => r.collection.failures;
const incomplete = (r, ...codes) => { assert.equal(r.collection.status, 'INCOMPLETE'); for (const c of codes) assert.ok(failures(r).includes(c), c + ' in ' + failures(r).join(', ')); };
const cli = (dir, args, env = {}) => cp.spawnSync(process.execPath, [SCRIPT, dir, ...args], {encoding: 'utf8', env: {PATH: process.env.PATH, ...env}});

test('real paired results: collection COMPLETE, p95 verdict stays a separate diagnostic FAIL', () => {
  const r = summarize(FIXTURE, {pairs: 1});
  assert.deepEqual(r.collection, {status: 'COMPLETE', expectedRuns: 2, completeRuns: 2, failures: []});
  assert.deepEqual(r.capacity.kinds, {before: 'DIAGNOSTIC_P95_FAIL', after: 'DIAGNOSTIC_P95_FAIL'});
  assert.equal(r.capacity.acceptance, false);
  assert.ok(r.kinds.before.pooledDeltaPercent > 5 && r.kinds.after.pooledDeltaPercent > 5);
  assert.match(markdown(r), /Collection: \*\*COMPLETE\*\* \(2\/2 complete runs\)/);
});

test('CLI: a p95 FAIL with complete collection exits 0; JSON keeps both results', t => {
  const out = path.join(copy(t), 'summary.json'), res = cli(FIXTURE, [out, '--pairs', '1']);
  assert.equal(res.status, 0, res.stderr);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(j.collection.status, 'COMPLETE'); assert.equal(j.capacity.kinds.before, 'DIAGNOSTIC_P95_FAIL');
  assert.equal(cli(FIXTURE, [], {PAIRS: '1'}).status, 0, 'PAIRS from the environment');
});

test('empty, missing or unspecified run sets never pass', t => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50-613-empty-')); t.after(() => fs.rmSync(empty, {recursive: true, force: true}));
  incomplete(summarize(empty, {pairs: 1}), 'before-1:RUN_MISSING', 'after-1:RUN_MISSING');
  incomplete(summarize(path.join(empty, 'absent'), {pairs: 1}), 'RUNS_DIR_MISSING');
  incomplete(summarize(FIXTURE, {}), 'EXPECTED_PAIRS_UNKNOWN');
  const out = path.join(empty, 'summary.json'), res = cli(empty, [out, '--pairs', '1']);
  assert.equal(res.status, 1); assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).collection.status, 'INCOMPLETE', 'the JSON report is written on failure too');
  assert.equal(cli(FIXTURE, []).status, 1, 'no --pairs and no PAIRS');
});

test('both arms and the expected count are required; extra runs are rejected', t => {
  const dir = copy(t); fs.rmSync(path.join(dir, 'after-1'), {recursive: true});
  const r = summarize(dir, {pairs: 1});
  incomplete(r, 'after-1:RUN_MISSING');
  assert.equal(r.capacity.kinds.after, 'NOT_EVALUATED_INCOMPLETE_COLLECTION');
  assert.equal(r.capacity.kinds.before, 'NOT_EVALUATED_INCOMPLETE_COLLECTION', 'no verdict from a partial collection');
  incomplete(summarize(FIXTURE, {pairs: 2}), 'before-2:RUN_MISSING', 'after-2:RUN_MISSING');
  const extra = copy(t); fs.cpSync(path.join(extra, 'before-1'), path.join(extra, 'before-9'), {recursive: true});
  incomplete(summarize(extra, {pairs: 1}), 'UNEXPECTED_RUN:before-9');
});

test('missing or corrupt result files and wrong provenance fail the collection', t => {
  let dir = copy(t); fs.rmSync(file(dir, 'before-1', 'result.json'));
  const r = summarize(dir, {pairs: 1}); incomplete(r, 'before-1:RESULT_MISSING');
  assert.equal(r.runs.find(x => x.name === 'before-1').status, 'NO_RESULT', 'the failed run is still listed');
  dir = copy(t); fs.writeFileSync(file(dir, 'after-1', 'result.json'), '{"status":"FAIL_LOCAL_DIAG');
  incomplete(summarize(dir, {pairs: 1}), 'after-1:RESULT_CORRUPT');
  dir = copy(t); fs.rmSync(file(dir, 'after-1', 'mixed-result.json'));
  incomplete(summarize(dir, {pairs: 1}), 'after-1:MIXED_RESULT_MISSING');
  dir = copy(t); fs.writeFileSync(file(dir, 'before-1', 'baseline-result.json'), '[');
  incomplete(summarize(dir, {pairs: 1}), 'before-1:BASELINE_RESULT_CORRUPT');
  dir = copy(t); edit(dir, 'after-1', 'result.json', j => { j.runtimeSourceSha = '234437f8bb106cc576375ff7df9b817d3fbc01cc'; });
  incomplete(summarize(dir, {pairs: 1}), 'after-1:PROVENANCE_MISMATCH');
  incomplete(summarize(FIXTURE, {pairs: 1, pins: {before: 'x', after: 'y'}}), 'PIN_UNKNOWN:before', 'PIN_UNKNOWN:after');
});

test('incomplete, admission-failed and unclean runs fail the collection', t => {
  let dir = copy(t); edit(dir, 'before-1', 'result.json', j => { j.status = 'FAIL_OR_INCOMPLETE_LOCAL_DIAGNOSTIC'; delete j.comparison; });
  incomplete(summarize(dir, {pairs: 1}), 'before-1:INCOMPLETE_RUN', 'before-1:COMPARISON_INVALID');
  dir = copy(t); edit(dir, 'before-1', 'result.json', j => { j.status = 'QUALIFICATION_OR_ADMISSION_FAILED_NOT_RUN'; j.fullWorkloadRuns = 0; });
  incomplete(summarize(dir, {pairs: 1}), 'before-1:ADMISSION_FAILED', 'before-1:WORKLOAD_NOT_RUN_ONCE');
  // Recorded PIDs alive, PostgreSQL still running, stop not recorded, stop error.
  for (const change of [j => { j.allRecordedPidsStopped = false; }, j => { j.postgresStatusExit = 0; }, j => { delete j.postgresStopped; }, j => { j.cleanupError = 'pg_ctl stop timed out'; }]) {
    dir = copy(t); edit(dir, 'after-1', 'result.json', change);
    incomplete(summarize(dir, {pairs: 1}), 'after-1:CLEANUP_UNCONFIRMED');
  }
});

test('measurement validity: samples, population, errors and financial invariants', t => {
  let dir = copy(t); edit(dir, 'before-1', 'baseline-result.json', j => { j.cryptoLatencies = j.cryptoLatencies.slice(0, 150); });
  incomplete(summarize(dir, {pairs: 1}), 'before-1:BASELINE_INSUFFICIENT_SAMPLES');
  dir = copy(t); edit(dir, 'before-1', 'mixed-result.json', j => { j.cryptoLatencies[3] = 'NaN'; });
  incomplete(summarize(dir, {pairs: 1}), 'before-1:MIXED_LATENCIES_INVALID');
  dir = copy(t); edit(dir, 'after-1', 'mixed-result.json', j => { j.viewerCount = 49; });
  incomplete(summarize(dir, {pairs: 1}), 'after-1:MIXED_POPULATION_MISMATCH');
  dir = copy(t); edit(dir, 'after-1', 'mixed-result.json', j => { j.timeouts = 2; });
  incomplete(summarize(dir, {pairs: 1}), 'after-1:MIXED_TIMEOUTS');
  dir = copy(t); edit(dir, 'after-1', 'mixed-result.json', j => { j.orderLoss = 1; });
  incomplete(summarize(dir, {pairs: 1}), 'after-1:MIXED_FINANCIAL_ORDERLOSS');
  dir = copy(t); edit(dir, 'after-1', 'baseline-result.json', j => { j.cryptoJobs = 79; });
  incomplete(summarize(dir, {pairs: 1}), 'after-1:UNMATCHED_CRYPTO_TRACE');
});

test('the stored verdict must follow from the stored latencies and be a p95-only outcome', t => {
  let dir = copy(t); edit(dir, 'before-1', 'result.json', j => { j.comparison.cryptoP95ChangePercent = 3; });
  incomplete(summarize(dir, {pairs: 1}), 'before-1:COMPARISON_INCONSISTENT');
  dir = copy(t); edit(dir, 'before-1', 'result.json', j => { j.comparison.failures = ['mixed:insufficient_crypto_samples', 'CRYPTO_P95_OVER_5_PERCENT']; });
  incomplete(summarize(dir, {pairs: 1}), 'before-1:COMPARISON_NOT_MEASURED');
  dir = copy(t); edit(dir, 'before-1', 'result.json', j => { j.comparison.failures = []; });
  incomplete(summarize(dir, {pairs: 1}), 'before-1:COMPARISON_INCONSISTENT');
});

test('a measured p95 PASS is reported as such; collection does not depend on the p95 verdict', t => {
  const dir = copy(t);
  edit(dir, 'after-1', 'mixed-result.json', j => { j.cryptoLatencies = JSON.parse(fs.readFileSync(file(dir, 'after-1', 'baseline-result.json'), 'utf8')).cryptoLatencies; });
  edit(dir, 'after-1', 'result.json', j => { Object.assign(j, {status: 'PASS_LOCAL_DIAGNOSTIC'}); Object.assign(j.comparison, {status: 'PASS_LOCAL_DIAGNOSTIC', mixedCryptoP95Ms: j.comparison.baselineCryptoP95Ms, cryptoP95ChangePercent: 0, failures: []}); });
  const r = summarize(dir, {pairs: 1});
  assert.equal(r.collection.status, 'COMPLETE');
  assert.deepEqual(r.capacity.kinds, {before: 'DIAGNOSTIC_P95_FAIL', after: 'DIAGNOSTIC_P95_PASS'});
});
