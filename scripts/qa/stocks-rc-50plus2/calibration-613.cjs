'use strict';
// #613 R8: does the isolated-client method measure correctly on this runner, before any acceptance run? Reads the
// A/A calibration runs (diagnostic-run-613.cjs --after --isolated-clients --null-arm, named aa-1 … aa-N): both arms
// carry the baseline load only, so their pooled Δp95 is the method's own error (order, fresh processes, warm-up,
// runner noise). Fail-closed collection as in summarize-613.cjs, plus the placement proofs and client headroom of every
// window. Verdict METHOD_CALIBRATED only if every run is complete and the pooled A/A Δp95 is within ±THRESHOLD (the
// null alone must not decide the +5 % gate); reported beside it: per-run spread, a whole-run bootstrap of the pooled
// A/A Δp95, server and client CPU-set utilisation, steal time and memory. Exit 0 only when calibrated.
// Usage: node calibration-613.cjs <runsDir> [out.json] --runs N [--pin <sha>]
const fs = require('node:fs'), path = require('node:path');
const {percentile} = require('./policy.cjs');
const {PLAN, traceSha: TRACE_SHA} = require('./driver.cjs');
const THRESHOLD_PERCENT = 5, MIN_SAMPLES = 200, CRYPTO_JOBS = PLAN.measureMs / PLAN.cryptoPeriodMs, PG_NOT_RUNNING = 3;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1)) : null; };
const delta = (b, m) => { const pb = percentile(b, .95), pm = percentile(m, .95); return pb ? (pm - pb) / pb * 100 : null; };
const read = (file, problems, code) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { problems.push(code); return null; } };

function readArm(out, arm, problems) {
  const a = read(path.join(out, arm + '-result.json'), problems, arm.toUpperCase() + '_RESULT_MISSING_OR_CORRUPT'), tag = arm.toUpperCase();
  if (!a) return null;
  if (!Array.isArray(a.cryptoLatencies) || !a.cryptoLatencies.every(x => finite(x) && x >= 0)) { problems.push(tag + '_LATENCIES_INVALID'); return null; }
  if (a.cryptoLatencies.length < MIN_SAMPLES) problems.push(tag + '_INSUFFICIENT_SAMPLES');
  if (a.arm !== arm || a.warmup !== false || a.viewerCount !== 0 || a.traderCount !== 0) problems.push(tag + '_NOT_A_BASELINE_LOAD');
  if (arm === 'mixed' && a.nullArm !== true) problems.push(tag + '_NOT_MARKED_NULL');
  for (const k of ['timeouts', 'unexpectedErrors', 'missedJobs', 'orderLoss', 'doubleSpend', 'viewerMutations']) if (a[k] !== 0) problems.push(tag + '_' + k.toUpperCase());
  if (a.cryptoJobs !== CRYPTO_JOBS || a.traceSha !== TRACE_SHA) problems.push(tag + '_TRACE_MISMATCH');
  if (a.isolation?.proof?.ok !== true || !(a.isolation.proof.checkedThreads > 0)) problems.push(tag + '_PLACEMENT_UNPROVEN');
  if (a.isolation?.headroom?.ok !== true) problems.push(tag + '_CLIENT_HEADROOM_UNPROVEN');
  const u = a.isolation?.usage ?? {}, mem = a.isolation?.memory ?? {};
  return {latencies: a.cryptoLatencies, p95: percentile(a.cryptoLatencies, .95), serverUtilization: u.server?.utilization ?? null, serverStealMs: u.server?.stealMs ?? null,
    clientUtilization: u.client?.utilization ?? null, clientStealMs: u.client?.stealMs ?? null, driverElu: a.isolation?.headroom?.driverElu ?? null,
    serverMemoryMb: ['api', 'stocksAuthority', 'stocksGateway'].reduce((t, k) => t + (mem[k]?.hwmKb ?? 0), 0) / 1024 + (mem.postgres?.pssKb ?? mem.postgres?.rssKb ?? 0) / 1024};
}

function calibrate(runsDir, {runs, pin = require('./policy-613-after.cjs').RC} = {}) {
  const collection = {status: 'COMPLETE', expectedRuns: runs, completeRuns: 0, failures: []}, fail = x => collection.failures.push(x);
  if (!Number.isSafeInteger(runs) || runs < 2) fail('EXPECTED_RUNS_UNKNOWN');
  let names = []; try { names = fs.readdirSync(runsDir).sort(); } catch { fail('RUNS_DIR_MISSING'); }
  const expected = Number.isSafeInteger(runs) && runs > 0 ? Array.from({length: runs}, (_, i) => 'aa-' + (i + 1)) : [];
  for (const n of names) if (!expected.includes(n)) fail('UNEXPECTED_RUN:' + n);
  const done = [], rows = [];
  for (const name of expected) {
    const problems = [], out = path.join(runsDir, name, 'out');
    if (!names.includes(name)) { fail(name + ':RUN_MISSING'); rows.push({name, complete: false, problems: ['RUN_MISSING']}); continue; }
    const r = read(path.join(out, 'result.json'), problems, 'RESULT_MISSING_OR_CORRUPT');
    let first = null, second = null;
    if (r) {
      if (r.runtimeSourceSha !== pin) problems.push('PROVENANCE_MISMATCH');
      if (r.status !== 'CALIBRATION_ONLY_NOT_A_VERDICT' || r.methodology !== 'isolated-clients' || r.nullArm !== true || r.sustained) problems.push('NOT_A_CALIBRATION_RUN');
      if (!Array.isArray(r.failures) || r.failures.length) problems.push('RUN_FAILURES_RECORDED');
      if (r.fullWorkloadRuns !== 1) problems.push('WORKLOAD_NOT_RUN_ONCE');
      if (r.qualification?.placement?.ok !== true || r.isolation?.admission?.length !== 0) problems.push('QUALIFICATION_PLACEMENT_UNPROVEN');
      if (r.allRecordedPidsStopped !== true || r.postgresStopped !== true || r.postgresStatusExit !== PG_NOT_RUNNING || Object.hasOwn(r, 'cleanupError')) problems.push('CLEANUP_UNCONFIRMED');
      first = readArm(out, 'baseline', problems); second = readArm(out, 'mixed', problems);
      if (first && second && Math.abs((r.calibration?.deltaPercent ?? NaN) - delta(first.latencies, second.latencies)) > 1e-9) problems.push('CALIBRATION_INCONSISTENT');
    }
    for (const p of problems) fail(name + ':' + p);
    const row = {name, complete: problems.length === 0, problems, deltaPercent: first && second ? delta(first.latencies, second.latencies) : null, first, second};
    rows.push(row); if (row.complete) { done.push(row); collection.completeRuns++; }
  }
  if (collection.failures.length) collection.status = 'INCOMPLETE';
  const pooled = delta(done.flatMap(r => r.first.latencies), done.flatMap(r => r.second.latencies));
  let seed = 613; const random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const boot = [];
  if (done.length > 1) for (let b = 0; b < 2000; b++) { const pick = Array.from({length: done.length}, () => done[Math.floor(random() * done.length)]); boot.push(delta(pick.flatMap(r => r.first.latencies), pick.flatMap(r => r.second.latencies))); }
  const arms = done.flatMap(r => [r.first, r.second]), of = k => arms.map(x => x[k]).filter(finite);
  const evaluated = collection.status === 'COMPLETE';
  return {collection, scope: 'METHOD_CALIBRATION_NOT_A_VERDICT', thresholdPercent: THRESHOLD_PERCENT,
    verdict: !evaluated ? 'NOT_EVALUATED_INCOMPLETE_COLLECTION' : Math.abs(pooled) <= THRESHOLD_PERCENT ? 'METHOD_CALIBRATED' : 'METHOD_NOT_CALIBRATED',
    pooledFirstP95Ms: percentile(done.flatMap(r => r.first.latencies), .95), pooledSecondP95Ms: percentile(done.flatMap(r => r.second.latencies), .95), pooledDeltaPercent: pooled,
    runDeltaPercent: done.map(r => r.deltaPercent), meanRunDeltaPercent: mean(done.map(r => r.deltaPercent)), sdRunDeltaPercent: sd(done.map(r => r.deltaPercent)),
    bootstrapPooledDeltaPercent95: boot.length ? [percentile(boot, .025), percentile(boot, .975)] : null,
    serverUtilization: {mean: mean(of('serverUtilization')), max: of('serverUtilization').length ? Math.max(...of('serverUtilization')) : null},
    clientUtilization: {mean: mean(of('clientUtilization')), max: of('clientUtilization').length ? Math.max(...of('clientUtilization')) : null},
    stealMs: {serverMean: mean(of('serverStealMs')), clientMean: mean(of('clientStealMs'))}, driverEluMax: of('driverElu').length ? Math.max(...of('driverElu')) : null,
    serverMemoryMbMax: of('serverMemoryMb').length ? Math.max(...of('serverMemoryMb')) : null,
    runs: rows.map(({first, second, ...r}) => ({...r, firstP95Ms: first?.p95 ?? null, secondP95Ms: second?.p95 ?? null}))};
}

function markdown(c) {
  const f = (x, d = 2) => finite(x) ? x.toFixed(d) : '—';
  const lines = ['### Isolated-client method: A/A calibration (not a verdict)', '', `Collection: **${c.collection.status}** (${c.collection.completeRuns}/${c.collection.expectedRuns} complete runs)`];
  if (c.collection.failures.length) lines.push('', 'Collection failures: ' + c.collection.failures.map(x => '`' + x + '`').join(', '));
  lines.push('', '| run | complete | first p95 ms | second p95 ms | A/A Δp95 % |', '|---|---|---|---|---|');
  for (const r of c.runs) lines.push(`| ${r.name} | ${r.complete ? 'yes' : 'no'} | ${f(r.firstP95Ms)} | ${f(r.secondP95Ms)} | ${f(r.deltaPercent)} |`);
  lines.push('', `Pooled A/A: ${f(c.pooledFirstP95Ms)} → ${f(c.pooledSecondP95Ms)} ms, Δp95 **${f(c.pooledDeltaPercent)} %** (per run ${f(c.meanRunDeltaPercent, 1)} ± ${f(c.sdRunDeltaPercent, 1)} %; bootstrap 95 % ${c.bootstrapPooledDeltaPercent95 ? f(c.bootstrapPooledDeltaPercent95[0], 1) + ' … ' + f(c.bootstrapPooledDeltaPercent95[1], 1) : '—'} %).`,
    `Server CPU set utilisation mean/max ${f(c.serverUtilization.mean, 3)}/${f(c.serverUtilization.max, 3)}; client set ${f(c.clientUtilization.mean, 3)}/${f(c.clientUtilization.max, 3)}; driver ELU max ${f(c.driverEluMax, 3)}; steal per window server ${f(c.stealMs.serverMean, 0)} ms, client ${f(c.stealMs.clientMean, 0)} ms; server memory max ${f(c.serverMemoryMbMax, 0)} MB.`,
    '', `Verdict: **${c.verdict}** (|pooled A/A Δp95| ≤ ${c.thresholdPercent} %).`);
  return lines.join('\n');
}

module.exports = {calibrate, markdown};

if (require.main === module) {
  const argv = process.argv.slice(2), flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--runs' || argv[i] === '--pin') flags[argv[i]] = argv[++i]; else rest.push(argv[i]);
  const c = calibrate(rest[0], {runs: Number(flags['--runs']), ...(flags['--pin'] ? {pin: flags['--pin']} : {})});
  console.log(markdown(c));
  if (rest[1]) fs.writeFileSync(rest[1], JSON.stringify(c, null, 2));
  process.exitCode = c.verdict === 'METHOD_CALIBRATED' ? 0 : 1;
}
