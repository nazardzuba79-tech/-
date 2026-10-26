'use strict';
// Aggregates paired #613 50+2 diagnostic runs (before/after pins) into a
// Markdown report and JSON with two separate results:
// - collection: fail-closed. Every expected run (PAIRS per pin) must exist,
//   parse, carry its pin's runtime SHA, have measured both arms with the plan's
//   sample floor and population, keep the financial invariants and confirm
//   cleanup. Anything missing, corrupt or incomplete fails the collection.
// - capacity: the p95 verdict per pin, report only. A p95 FAIL is an honest
//   diagnostic result and never fails the collection; nothing here is acceptance.
// Usage: node summarize-613.cjs <runsDir> [out.json] [--pairs N]  (PAIRS env otherwise)
const fs = require('node:fs'), path = require('node:path');
const {percentile} = require('./policy.cjs');

const KINDS = ['before', 'after'];
const MEASURED = ['PASS_LOCAL_DIAGNOSTIC', 'FAIL_LOCAL_DIAGNOSTIC'];
const P95_ONLY = 'CRYPTO_P95_OVER_5_PERCENT';
const MIN_SAMPLES = 200; // the plan's floor in policy comparison(); unchanged
const POPULATION = {baseline: [0, 0], mixed: [50, 2]};
const ZERO = ['timeouts', 'unexpectedErrors', 'missedJobs'], FINANCIAL = ['orderLoss', 'doubleSpend', 'viewerMutations'];

const pinsFromPolicies = () => ({before: require('./policy-613.cjs').RC, after: require('./policy-613-after.cjs').RC});
const cpuMs = m => ((m.after.cpu.user - m.before.cpu.user) + (m.after.cpu.system - m.before.cpu.system)) / 1000;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const finite = x => typeof x === 'number' && Number.isFinite(x);

function readJson(file, problems, missing, corrupt) {
  if (!fs.existsSync(file)) { problems.push(missing); return null; }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { problems.push(corrupt); return null; }
}

function readArm(out, arm, problems) {
  const a = readJson(path.join(out, arm + '-result.json'), problems, arm.toUpperCase() + '_RESULT_MISSING', arm.toUpperCase() + '_RESULT_CORRUPT');
  if (!a) return null;
  const tag = arm.toUpperCase();
  if (!Array.isArray(a.cryptoLatencies) || !a.cryptoLatencies.every(x => finite(x) && x >= 0)) { problems.push(tag + '_LATENCIES_INVALID'); return null; }
  if (a.cryptoLatencies.length < MIN_SAMPLES) problems.push(tag + '_INSUFFICIENT_SAMPLES');
  if (a.arm !== arm || a.warmup !== false) problems.push(tag + '_ARM_MISMATCH');
  if (a.viewerCount !== POPULATION[arm][0] || a.traderCount !== POPULATION[arm][1]) problems.push(tag + '_POPULATION_MISMATCH');
  for (const k of ZERO) if (a[k] !== 0) problems.push(tag + '_' + k.toUpperCase());
  for (const k of FINANCIAL) if (a[k] !== 0) problems.push(tag + '_FINANCIAL_' + k.toUpperCase());
  let apiCpuMs = null; try { apiCpuMs = cpuMs(a.metrics); } catch { problems.push(tag + '_METRICS_MISSING'); }
  return {latencies: a.cryptoLatencies, cryptoJobs: a.cryptoJobs, traceSha: a.traceSha, p50: percentile(a.cryptoLatencies, .5), p95: percentile(a.cryptoLatencies, .95),
    apiCpuMs, timeouts: a.timeouts, errors: a.unexpectedErrors, orderLoss: a.orderLoss, doubleSpend: a.doubleSpend, viewerMutations: a.viewerMutations};
}

function readRun(runsDir, name, kind, pin) {
  const out = path.join(runsDir, name, 'out'), problems = [];
  const run = {name, kind, status: 'NO_RESULT', problems};
  const exitFile = path.join(runsDir, name, 'exit-code');
  if (fs.existsSync(exitFile)) run.exitCode = fs.readFileSync(exitFile, 'utf8').trim();
  const result = readJson(path.join(out, 'result.json'), problems, 'RESULT_MISSING', 'RESULT_CORRUPT');
  if (!result) return run;
  Object.assign(run, {runtime: result.runtimeSourceSha, status: typeof result.status === 'string' ? result.status : 'NO_STATUS', failures: result.failures, comparison: result.comparison});
  if (result.runtimeSourceSha !== pin) problems.push('PROVENANCE_MISMATCH');
  if (result.status === 'QUALIFICATION_OR_ADMISSION_FAILED_NOT_RUN') problems.push('ADMISSION_FAILED');
  else if (!MEASURED.includes(result.status)) problems.push('INCOMPLETE_RUN');
  if (result.fullWorkloadRuns !== 1) problems.push('WORKLOAD_NOT_RUN_ONCE');
  if (result.allRecordedPidsStopped !== true || result.postgresStopped !== true || result.postgresStatusExit === 0 || result.cleanupError) problems.push('CLEANUP_UNCONFIRMED');
  run.baseline = readArm(out, 'baseline', problems);
  run.mixed = readArm(out, 'mixed', problems);
  const c = result.comparison;
  if (!c || !finite(c.cryptoP95ChangePercent) || !Array.isArray(c.failures)) problems.push('COMPARISON_INVALID');
  else {
    if (c.failures.some(f => f !== P95_ONLY)) problems.push('COMPARISON_NOT_MEASURED');
    if (run.baseline && run.mixed) {
      if (run.baseline.cryptoJobs !== run.mixed.cryptoJobs || run.baseline.traceSha !== run.mixed.traceSha) problems.push('UNMATCHED_CRYPTO_TRACE');
      // The stored verdict must follow from the stored latencies.
      const delta = run.baseline.p95 > 0 ? (run.mixed.p95 - run.baseline.p95) / run.baseline.p95 * 100 : null;
      if (delta === null || Math.abs(delta - c.cryptoP95ChangePercent) > 1e-9 || (delta > 5) !== c.failures.includes(P95_ONLY)) problems.push('COMPARISON_INCONSISTENT');
    }
  }
  return run;
}

function summarize(runsDir, {pairs, pins = pinsFromPolicies()} = {}) {
  const collection = {status: 'COMPLETE', expectedRuns: 0, completeRuns: 0, failures: []};
  const fail = x => collection.failures.push(x);
  if (!Number.isSafeInteger(pairs) || pairs < 1) fail('EXPECTED_PAIRS_UNKNOWN');
  for (const k of KINDS) if (typeof pins[k] !== 'string' || !/^[0-9a-f]{40}$/.test(pins[k])) fail('PIN_UNKNOWN:' + k);
  let names = [];
  try { names = fs.readdirSync(runsDir).sort(); } catch { fail('RUNS_DIR_MISSING'); }
  const expected = Number.isSafeInteger(pairs) && pairs > 0 ? KINDS.flatMap(k => Array.from({length: pairs}, (_, i) => k + '-' + (i + 1))) : [];
  collection.expectedRuns = expected.length;
  for (const n of names) if (!expected.includes(n)) fail('UNEXPECTED_RUN:' + n);
  const runs = [];
  for (const name of expected) {
    const kind = name.split('-')[0];
    if (!names.includes(name)) { runs.push({name, kind, status: 'MISSING', problems: ['RUN_MISSING']}); fail(name + ':RUN_MISSING'); continue; }
    const run = readRun(runsDir, name, kind, pins[kind]);
    for (const p of run.problems) fail(name + ':' + p);
    run.complete = run.problems.length === 0;
    if (run.complete) collection.completeRuns++;
    runs.push(run);
  }
  if (collection.failures.length) collection.status = 'INCOMPLETE';

  const kinds = {};
  for (const kind of KINDS) {
    const all = runs.filter(r => r.kind === kind), done = all.filter(r => r.complete);
    const base = done.flatMap(r => r.baseline.latencies), mixed = done.flatMap(r => r.mixed.latencies);
    const pb = percentile(base, .95), pm = percentile(mixed, .95), pooled = pb ? (pm - pb) / pb * 100 : null;
    const evaluated = collection.status === 'COMPLETE' && done.length === pairs;
    kinds[kind] = {pin: pins[kind], completeRuns: done.length, runs: all.length,
      medianRunDeltaPercent: median(done.map(r => r.comparison.cryptoP95ChangePercent)),
      pooledBaselineP95Ms: pb, pooledMixedP95Ms: pm, pooledDeltaPercent: pooled,
      meanBaselineApiCpuMs: mean(done.map(r => r.baseline.apiCpuMs)), meanMixedApiCpuMs: mean(done.map(r => r.mixed.apiCpuMs)),
      meanViewerInducedApiCpuMs: mean(done.map(r => r.mixed.apiCpuMs - r.baseline.apiCpuMs)),
      diagnosticP95: evaluated ? (pooled <= 5 ? 'DIAGNOSTIC_P95_PASS' : 'DIAGNOSTIC_P95_FAIL') : 'NOT_EVALUATED_INCOMPLETE_COLLECTION'};
  }
  const capacity = {acceptance: false, scope: 'CI_DIAGNOSTIC_NOT_CAPACITY_ACCEPTANCE', thresholdPercent: 5, kinds: Object.fromEntries(KINDS.map(k => [k, kinds[k].diagnosticP95]))};
  return {collection, capacity, kinds, runs};
}

function markdown({collection, capacity, kinds, runs}) {
  const f = (x, d = 2) => typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—';
  const lines = [`Collection: **${collection.status}** (${collection.completeRuns}/${collection.expectedRuns} complete runs)`];
  if (collection.failures.length) lines.push('', 'Collection failures: ' + collection.failures.map(x => '`' + x + '`').join(', '));
  lines.push('', '| run | runtime | status | complete | Δp95 % | baseline p95 ms | mixed p95 ms | baseline API CPU ms | mixed API CPU ms | mixed timeouts | order loss / double spend / viewer mutations |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of runs) lines.push(`| ${r.name} | ${(r.runtime || '').slice(0, 8)} | ${r.status} | ${r.complete ? 'yes' : 'no'} | ${f(r.comparison?.cryptoP95ChangePercent)} | ${f(r.baseline?.p95)} | ${f(r.mixed?.p95)} | ${f(r.baseline?.apiCpuMs, 0)} | ${f(r.mixed?.apiCpuMs, 0)} | ${r.mixed?.timeouts ?? '—'} | ${r.mixed ? [r.mixed.orderLoss, r.mixed.doubleSpend, r.mixed.viewerMutations].join(' / ') : '—'} |`);
  lines.push('', '| pin | complete runs | median run Δp95 % | pooled baseline p95 ms | pooled mixed p95 ms | pooled Δp95 % | mean viewer-induced API CPU ms | diagnostic p95 |', '|---|---|---|---|---|---|---|---|');
  for (const [kind, k] of Object.entries(kinds)) lines.push(`| ${kind} ${(k.pin || '').slice(0, 8)} | ${k.completeRuns}/${k.runs} | ${f(k.medianRunDeltaPercent)} | ${f(k.pooledBaselineP95Ms)} | ${f(k.pooledMixedP95Ms)} | ${f(k.pooledDeltaPercent)} | ${f(k.meanViewerInducedApiCpuMs, 0)} | ${k.diagnosticP95} |`);
  lines.push('', `Target: crypto p95 <= +${capacity.thresholdPercent}% with 50 viewers + 2 traders. CI_DIAGNOSTIC only (GitHub-hosted runner, 2 vCPUs via taskset, own PostgreSQL, synthetic users); not capacity acceptance.`);
  return lines.join('\n');
}

module.exports = {summarize, markdown};

if (require.main === module) {
  const argv = process.argv.slice(2), at = argv.indexOf('--pairs');
  const pairs = Number(at >= 0 ? argv[at + 1] : process.env.PAIRS);
  const [runsDir, jsonOut] = at >= 0 ? argv.filter((_, i) => i !== at && i !== at + 1) : argv;
  const report = summarize(runsDir, {pairs});
  console.log(markdown(report));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({...report, runs: report.runs.map(({baseline, mixed, ...r}) => ({...r, baseline: baseline && {...baseline, latencies: undefined}, mixed: mixed && {...mixed, latencies: undefined}}))}, null, 2));
  process.exitCode = report.collection.status === 'COMPLETE' ? 0 : 1;
}
