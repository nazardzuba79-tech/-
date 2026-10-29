'use strict';
// Aggregates paired #613 50+2 diagnostic runs (before/after pins) into a
// Markdown report and JSON with two separate results:
// - collection: fail-closed. Every expected run (PAIRS per pin) must exist,
//   parse, carry its pin's runtime SHA, have measured both arms with the plan's
//   sample floor and population, run the driver's exact crypto trace, keep the
//   financial invariants, record sane CPU counters, store a verdict that follows
//   from its own latencies and confirm cleanup. Anything missing, corrupt,
//   inconsistent or incomplete fails the collection.
// - capacity: the p95 verdict per pin, report only. A p95 FAIL is an honest
//   diagnostic result and never fails the collection; nothing here is acceptance.
// Usage: node summarize-613.cjs <runsDir> [out.json] [--pairs N]  (PAIRS env otherwise)
const fs = require('node:fs'), path = require('node:path');
const {percentile} = require('./policy.cjs');
const {PLAN, traceSha: TRACE_SHA} = require('./driver.cjs');

const KINDS = ['before', 'after'];
const MEASURED = ['PASS_LOCAL_DIAGNOSTIC', 'FAIL_LOCAL_DIAGNOSTIC'];
const P95_ONLY = 'CRYPTO_P95_OVER_5_PERCENT';
const THRESHOLD_PERCENT = 5, MIN_SAMPLES = 200; // policy comparison()'s threshold and floor; unchanged
const CRYPTO_JOBS = PLAN.measureMs / PLAN.cryptoPeriodMs; // 80 in the current plan
const PG_NOT_RUNNING = 3; // documented `pg_ctl status` exit code for a stopped server
const CPU = ['user', 'system']; // process.cpuUsage() counters, microseconds
const POPULATION = {baseline: [0, 0], mixed: [50, 2]};
const ZERO = ['timeouts', 'unexpectedErrors', 'missedJobs'], FINANCIAL = ['orderLoss', 'doubleSpend', 'viewerMutations'];

const pinsFromPolicies = () => ({before: require('./policy-613.cjs').RC, after: require('./policy-613-after.cjs').RC});
// Every counter present, finite, non-negative and not decreasing over the window.
const cpuMs = m => CPU.every(k => [m?.before?.cpu?.[k], m?.after?.cpu?.[k]].every(x => finite(x) && x >= 0) && m.after.cpu[k] >= m.before.cpu[k])
  ? CPU.reduce((t, k) => t + m.after.cpu[k] - m.before.cpu[k], 0) / 1000 : null;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1)) : null; };
const pooledDelta = (base, mixed) => { const pb = percentile(base, .95), pm = percentile(mixed, .95); return pb ? (pm - pb) / pb * 100 : null; };
// Report only, never the verdict. Spread of the per-run Δp95, a seeded bootstrap of the pooled Δp95 over whole
// runs (95 % interval), and an A/A reference: the baseline arms (no Stocks load at all) of the odd-numbered runs
// against those of the even-numbered runs, on the same runner. A pooled Δp95 inside the A/A spread cannot be told
// apart from run-to-run noise with this many pairs.
function statistics(done) {
  const deltas = done.map(r => r.comparison.cryptoP95ChangePercent);
  let seed = 613; const random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const samples = [];
  if (done.length > 1) for (let b = 0; b < 2000; b++) {
    const pick = Array.from({length: done.length}, () => done[Math.floor(random() * done.length)]);
    samples.push(pooledDelta(pick.flatMap(r => r.baseline.latencies), pick.flatMap(r => r.mixed.latencies)));
  }
  const odd = done.filter((_, i) => i % 2 === 0), even = done.filter((_, i) => i % 2 === 1);
  return {runs: done.length, runDeltaPercent: deltas, meanRunDeltaPercent: mean(deltas), sdRunDeltaPercent: sd(deltas),
    minRunDeltaPercent: deltas.length ? Math.min(...deltas) : null, maxRunDeltaPercent: deltas.length ? Math.max(...deltas) : null,
    baselineP95Ms: done.map(r => r.baseline.p95), sdBaselineP95Ms: sd(done.map(r => r.baseline.p95)),
    bootstrapPooledDeltaPercent95: samples.length ? [percentile(samples, .025), percentile(samples, .975)] : null,
    aaBaselineOddVsEvenPooledDeltaPercent: odd.length && even.length ? pooledDelta(odd.flatMap(r => r.baseline.latencies), even.flatMap(r => r.baseline.latencies)) : null};
}

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
  if (a.cryptoJobs !== CRYPTO_JOBS) problems.push(tag + '_CRYPTO_JOBS_MISMATCH');
  if (a.traceSha !== TRACE_SHA) problems.push(tag + '_TRACE_MISMATCH');
  const apiCpuMs = cpuMs(a.metrics);
  if (apiCpuMs === null) problems.push(tag + '_CPU_METRICS_INVALID');
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
  Object.assign(run, {runtime: result.runtimeSourceSha, workload: result.workload ?? 'original-4s', status: typeof result.status === 'string' ? result.status : 'NO_STATUS', failures: result.failures, comparison: result.comparison});
  if (result.runtimeSourceSha !== pin) problems.push('PROVENANCE_MISMATCH');
  if (result.status === 'QUALIFICATION_OR_ADMISSION_FAILED_NOT_RUN') problems.push('ADMISSION_FAILED');
  else if (!MEASURED.includes(result.status)) problems.push('INCOMPLETE_RUN');
  if (result.fullWorkloadRuns !== 1) problems.push('WORKLOAD_NOT_RUN_ONCE');
  if (!Array.isArray(result.failures) || result.failures.length) problems.push('RUN_FAILURES_RECORDED');
  if (result.allRecordedPidsStopped !== true || result.postgresStopped !== true || result.postgresStatusExit !== PG_NOT_RUNNING || Object.hasOwn(result, 'cleanupError')) problems.push('CLEANUP_UNCONFIRMED');
  run.baseline = readArm(out, 'baseline', problems);
  run.mixed = readArm(out, 'mixed', problems);
  const c = result.comparison;
  if (!c || !finite(c.cryptoP95ChangePercent) || !Array.isArray(c.failures)) problems.push('COMPARISON_INVALID');
  else {
    if (c.failures.some(f => f !== P95_ONLY)) problems.push('COMPARISON_NOT_MEASURED');
    if (run.baseline && run.mixed) {
      // The stored verdict, its p95 values, failures and both statuses must
      // follow from the stored latencies; a p95 overrun stays a measured FAIL.
      const delta = run.baseline.p95 > 0 ? (run.mixed.p95 - run.baseline.p95) / run.baseline.p95 * 100 : null;
      const over = delta > THRESHOLD_PERCENT, verdict = over ? 'FAIL_LOCAL_DIAGNOSTIC' : 'PASS_LOCAL_DIAGNOSTIC';
      if (delta === null || Math.abs(delta - c.cryptoP95ChangePercent) > 1e-9 || c.baselineCryptoP95Ms !== run.baseline.p95 || c.mixedCryptoP95Ms !== run.mixed.p95 ||
          c.thresholdPercent !== THRESHOLD_PERCENT || c.failures.length !== (over ? 1 : 0) || over !== c.failures.includes(P95_ONLY)) problems.push('COMPARISON_INCONSISTENT');
      else if (c.status !== verdict || result.status !== verdict) problems.push('STATUS_INCONSISTENT');
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
      diagnosticP95: evaluated ? (pooled <= THRESHOLD_PERCENT ? 'DIAGNOSTIC_P95_PASS' : 'DIAGNOSTIC_P95_FAIL') : 'NOT_EVALUATED_INCOMPLETE_COLLECTION',
      statistics: statistics(done)};
  }
  const capacity = {acceptance: false, scope: 'CI_DIAGNOSTIC_NOT_CAPACITY_ACCEPTANCE', thresholdPercent: THRESHOLD_PERCENT, kinds: Object.fromEntries(KINDS.map(k => [k, kinds[k].diagnosticP95]))};
  // The load every run measured: the original 4 s order cycle is the acceptance load; a revised 8 s run is a labelled diagnostic.
  const workloads = [...new Set(runs.map(r => r.workload).filter(Boolean))];
  if (workloads.length > 1) fail('MIXED_WORKLOADS:' + workloads.join(','));
  return {collection, capacity: {...capacity, workload: workloads[0] ?? null}, kinds, runs};
}

function markdown({collection, capacity, kinds, runs}) {
  const f = (x, d = 2) => typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—';
  const lines = [`Workload: **${capacity.workload === 'revised-8s-diagnostic' ? 'revised 8 s order cycle — diagnostic only, not the acceptance load' : 'original 4 s order cycle (acceptance load)'}**`, '', `Collection: **${collection.status}** (${collection.completeRuns}/${collection.expectedRuns} complete runs)`];
  if (collection.failures.length) lines.push('', 'Collection failures: ' + collection.failures.map(x => '`' + x + '`').join(', '));
  lines.push('', '| run | runtime | status | complete | Δp95 % | baseline p95 ms | mixed p95 ms | baseline API CPU ms | mixed API CPU ms | mixed timeouts | order loss / double spend / viewer mutations |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of runs) lines.push(`| ${r.name} | ${(r.runtime || '').slice(0, 8)} | ${r.status} | ${r.complete ? 'yes' : 'no'} | ${f(r.comparison?.cryptoP95ChangePercent)} | ${f(r.baseline?.p95)} | ${f(r.mixed?.p95)} | ${f(r.baseline?.apiCpuMs, 0)} | ${f(r.mixed?.apiCpuMs, 0)} | ${r.mixed?.timeouts ?? '—'} | ${r.mixed ? [r.mixed.orderLoss, r.mixed.doubleSpend, r.mixed.viewerMutations].join(' / ') : '—'} |`);
  lines.push('', '| pin | complete runs | median run Δp95 % | pooled baseline p95 ms | pooled mixed p95 ms | pooled Δp95 % | mean viewer-induced API CPU ms | diagnostic p95 |', '|---|---|---|---|---|---|---|---|');
  for (const [kind, k] of Object.entries(kinds)) lines.push(`| ${kind} ${(k.pin || '').slice(0, 8)} | ${k.completeRuns}/${k.runs} | ${f(k.medianRunDeltaPercent)} | ${f(k.pooledBaselineP95Ms)} | ${f(k.pooledMixedP95Ms)} | ${f(k.pooledDeltaPercent)} | ${f(k.meanViewerInducedApiCpuMs, 0)} | ${k.diagnosticP95} |`);
  lines.push('', 'Statistics (report only; the verdict above is the pooled Δp95 against the threshold, unchanged):', '', '| pin | runs | per-run Δp95 % | mean ± SD % | bootstrap 95 % of pooled Δp95 % | A/A: baseline odd vs even runs, pooled Δp95 % | baseline p95 SD ms |', '|---|---|---|---|---|---|---|');
  for (const [kind, k] of Object.entries(kinds)) { const t = k.statistics; lines.push(`| ${kind} | ${t.runs} | ${t.runDeltaPercent.map(x => f(x, 1)).join(', ')} | ${f(t.meanRunDeltaPercent, 1)} ± ${f(t.sdRunDeltaPercent, 1)} | ${t.bootstrapPooledDeltaPercent95 ? f(t.bootstrapPooledDeltaPercent95[0], 1) + ' … ' + f(t.bootstrapPooledDeltaPercent95[1], 1) : '—'} | ${f(t.aaBaselineOddVsEvenPooledDeltaPercent, 1)} | ${f(t.sdBaselineP95Ms)} |`); }
  lines.push('', `Target: crypto p95 <= +${capacity.thresholdPercent}% with 50 viewers + 2 traders. CI_DIAGNOSTIC only (GitHub-hosted runner, 2 vCPUs via taskset, own PostgreSQL, synthetic users); not capacity acceptance.`);
  return lines.join('\n');
}

module.exports = {summarize, markdown};

if (require.main === module) {
  // --pins <before>:<after> judges stored runs recorded at other pins (e.g. a fixture); default: the policies.
  const argv = process.argv.slice(2), flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--pairs' || argv[i] === '--pins') flags[argv[i]] = argv[++i]; else rest.push(argv[i]);
  const pairs = Number('--pairs' in flags ? flags['--pairs'] : process.env.PAIRS);
  const [before, after] = '--pins' in flags ? String(flags['--pins']).split(':') : [];
  const [runsDir, jsonOut] = rest;
  const report = summarize(runsDir, {pairs, ...('--pins' in flags ? {pins: {before, after}} : {})});
  console.log(markdown(report));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({...report, runs: report.runs.map(({baseline, mixed, ...r}) => ({...r, baseline: baseline && {...baseline, latencies: undefined}, mixed: mixed && {...mixed, latencies: undefined}}))}, null, 2));
  process.exitCode = report.collection.status === 'COMPLETE' ? 0 : 1;
}
