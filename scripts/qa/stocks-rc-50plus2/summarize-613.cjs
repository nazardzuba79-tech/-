'use strict';
// Aggregates paired #613 50+2 diagnostic runs (before/after pins) into a
// Markdown report and JSON. Report only: a p95 verdict here is a diagnostic,
// never acceptance. Exit 1 only for admission failures or broken financial
// invariants, which make the runs themselves invalid.
// Usage: node summarize-613.cjs <runsDir> [out.json]
const fs = require('node:fs'), path = require('node:path');
const {percentile} = require('./policy.cjs');
const [runsDir, jsonOut] = process.argv.slice(2);
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const cpuMs = m => ((m.after.cpu.user - m.before.cpu.user) + (m.after.cpu.system - m.before.cpu.system)) / 1000;
const runs = [];
for (const name of fs.readdirSync(runsDir).sort()) {
  const out = path.join(runsDir, name, 'out');
  if (!fs.existsSync(path.join(out, 'result.json'))) { runs.push({name, kind: name.split('-')[0], status: 'NO_RESULT'}); continue; }
  const result = read(path.join(out, 'result.json')), run = {name, kind: name.split('-')[0], runtime: result.runtimeSourceSha, status: result.status, failures: result.failures, comparison: result.comparison};
  for (const arm of ['baseline', 'mixed']) {
    const f = path.join(out, arm + '-result.json');
    if (!fs.existsSync(f)) continue;
    const a = read(f);
    run[arm] = {latencies: a.cryptoLatencies, p50: percentile(a.cryptoLatencies, .5), p95: percentile(a.cryptoLatencies, .95), apiCpuMs: cpuMs(a.metrics), timeouts: a.timeouts, errors: a.unexpectedErrors, orderLoss: a.orderLoss, doubleSpend: a.doubleSpend, viewerMutations: a.viewerMutations};
  }
  runs.push(run);
}
const complete = r => r.baseline && r.mixed && ['PASS_LOCAL_DIAGNOSTIC', 'FAIL_LOCAL_DIAGNOSTIC'].includes(r.status);
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const kinds = {};
for (const kind of ['before', 'after']) {
  const done = runs.filter(r => r.kind === kind && complete(r));
  const base = done.flatMap(r => r.baseline.latencies), mixed = done.flatMap(r => r.mixed.latencies);
  const pb = percentile(base, .95), pm = percentile(mixed, .95);
  kinds[kind] = {runtime: done[0]?.runtime, completeRuns: done.length, runs: runs.filter(r => r.kind === kind).length,
    medianRunDeltaPercent: median(done.map(r => r.comparison.cryptoP95ChangePercent)),
    pooledBaselineP95Ms: pb, pooledMixedP95Ms: pm, pooledDeltaPercent: pb ? (pm - pb) / pb * 100 : null,
    meanBaselineApiCpuMs: mean(done.map(r => r.baseline.apiCpuMs)), meanMixedApiCpuMs: mean(done.map(r => r.mixed.apiCpuMs)),
    meanViewerInducedApiCpuMs: mean(done.map(r => r.mixed.apiCpuMs - r.baseline.apiCpuMs))};
}
const f = (x, d = 2) => typeof x === 'number' ? x.toFixed(d) : '—';
const lines = ['| run | runtime | status | Δp95 % | baseline p95 ms | mixed p95 ms | baseline API CPU ms | mixed API CPU ms | mixed timeouts | order loss / double spend / viewer mutations |', '|---|---|---|---|---|---|---|---|---|---|'];
for (const r of runs) lines.push(`| ${r.name} | ${(r.runtime || '').slice(0, 8)} | ${r.status} | ${f(r.comparison?.cryptoP95ChangePercent)} | ${f(r.baseline?.p95)} | ${f(r.mixed?.p95)} | ${f(r.baseline?.apiCpuMs, 0)} | ${f(r.mixed?.apiCpuMs, 0)} | ${r.mixed?.timeouts ?? '—'} | ${r.mixed ? [r.mixed.orderLoss, r.mixed.doubleSpend, r.mixed.viewerMutations].join(' / ') : '—'} |`);
lines.push('', '| pin | complete runs | median run Δp95 % | pooled baseline p95 ms | pooled mixed p95 ms | pooled Δp95 % | mean viewer-induced API CPU ms |', '|---|---|---|---|---|---|---|');
for (const [kind, k] of Object.entries(kinds)) lines.push(`| ${kind} ${(k.runtime || '').slice(0, 8)} | ${k.completeRuns}/${k.runs} | ${f(k.medianRunDeltaPercent)} | ${f(k.pooledBaselineP95Ms)} | ${f(k.pooledMixedP95Ms)} | ${f(k.pooledDeltaPercent)} | ${f(k.meanViewerInducedApiCpuMs, 0)} |`);
lines.push('', 'Target: crypto p95 <= +5% with 50 viewers + 2 traders. CI_DIAGNOSTIC only (GitHub-hosted runner, 2 vCPUs via taskset, own PostgreSQL, synthetic users); not capacity acceptance.');
console.log(lines.join('\n'));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({kinds, runs: runs.map(({baseline, mixed, ...r}) => ({...r, baseline: baseline && {...baseline, latencies: undefined}, mixed: mixed && {...mixed, latencies: undefined}}))}, null, 2));
const invalid = runs.some(r => r.status === 'QUALIFICATION_OR_ADMISSION_FAILED_NOT_RUN' || [r.baseline, r.mixed].some(a => a && (a.orderLoss || a.doubleSpend || a.viewerMutations)));
process.exitCode = invalid ? 1 : 0;
