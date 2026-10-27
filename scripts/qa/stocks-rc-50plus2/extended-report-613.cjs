'use strict';
// Report only, never a gate: the wider numbers of the paired #613 50+2 runs that
// summarize-613.cjs (the fail-closed collection gate) does not print. Per run and
// arm: crypto p50/p95/p99 and p95 per operation, viewer and trader latency, request
// and error counts, API CPU, memory, event-loop utilization and delay, and the
// synthetic market's WebSocket subscriptions/connections. Per pin: pooled numbers,
// and after vs before for the viewer path. Reads stored runs; starts no workload.
const fs = require('node:fs'), path = require('node:path');

const percentile = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.ceil(a.length * p) - 1] : null;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const delta = (after, before) => finite(after) && finite(before) ? after - before : null;
const pct = (after, before) => finite(after) && finite(before) && before > 0 ? (after - before) / before * 100 : null;
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const stats = ms => ({count: ms.length, p50: percentile(ms, .5), p95: percentile(ms, .95), p99: percentile(ms, .99), max: ms.length ? Math.max(...ms) : null});

function arm(result) {
  if (!result || !Array.isArray(result.samples)) return null;
  const of = kind => result.samples.filter(s => s.kind === kind && finite(s.ms));
  const ops = {};
  for (const s of of('crypto')) (ops[s.op] ??= []).push(s.ms);
  const b = result.metrics?.before, a = result.metrics?.after;
  const cpu = b?.cpu && a?.cpu ? (delta(a.cpu.user, b.cpu.user) + delta(a.cpu.system, b.cpu.system)) / 1000 : null;
  const elu = b?.loop?.elu && a?.loop?.elu ? {activeMs: delta(a.loop.elu.active, b.loop.elu.active), idleMs: delta(a.loop.elu.idle, b.loop.elu.idle)} : null;
  if (elu && finite(elu.activeMs) && finite(elu.idleMs) && elu.activeMs + elu.idleMs > 0) elu.utilization = elu.activeMs / (elu.activeMs + elu.idleMs);
  const market = (m, key) => Array.isArray(m?.market?.[key]) ? m.market[key].length : null;
  return {
    crypto: stats(result.cryptoLatencies ?? []), cryptoOps: Object.fromEntries(Object.entries(ops).map(([op, ms]) => [op, percentile(ms, .95)])),
    viewer: stats(of('viewer').filter(s => s.op === 'state').map(s => s.ms)), trader: stats(of('trader').map(s => s.ms)),
    requests: result.requests ?? null, timeouts: result.timeouts ?? null, unexpectedErrors: result.unexpectedErrors ?? null,
    errorRate: finite(result.requests) && result.requests > 0 ? ((result.timeouts ?? 0) + (result.unexpectedErrors ?? 0)) / result.requests : null,
    statuses: result.samples.reduce((m, s) => (m[s.status] = (m[s.status] ?? 0) + 1, m), {}),
    apiCpuMs: cpu,
    memory: a?.memory ? {rssMb: a.memory.rss / 2 ** 20, heapUsedMb: a.memory.heapUsed / 2 ** 20, rssDeltaMb: delta(a.memory.rss, b?.memory?.rss) / 2 ** 20} : null,
    elu, loopDelay: a?.loop?.delay ?? null,
    websocket: {connectionsAfter: a?.market?.connections ?? null, subscribeControls: delta(market(a, 'controls'), market(b, 'controls')), restFetches: delta(market(a, 'starts'), market(b, 'starts'))},
  };
}

function report(runsDir) {
  const runs = [];
  for (const name of (fs.existsSync(runsDir) ? fs.readdirSync(runsDir).sort() : [])) {
    const out = path.join(runsDir, name, 'out'), result = read(path.join(out, 'result.json'));
    runs.push({name, kind: name.split('-')[0], runtime: result?.runtimeSourceSha ?? null, status: result?.status ?? 'NO_RESULT',
      baseline: arm(read(path.join(out, 'baseline-result.json'))), mixed: arm(read(path.join(out, 'mixed-result.json')))});
  }
  const kinds = {};
  for (const kind of [...new Set(runs.map(r => r.kind))]) {
    const done = runs.filter(r => r.kind === kind && r.baseline && r.mixed);
    const pool = (armName, key) => done.flatMap(r => {
      const result = read(path.join(runsDir, r.name, 'out', armName + '-result.json'));
      return key === 'crypto' ? result.cryptoLatencies : result.samples.filter(s => s.kind === key && (key !== 'viewer' || s.op === 'state')).map(s => s.ms);
    });
    const meanOf = (armName, f) => mean(done.map(r => f(r[armName])).filter(finite));
    kinds[kind] = {runs: done.length, runtime: [...new Set(done.map(r => r.runtime))],
      baselineCrypto: stats(pool('baseline', 'crypto')), mixedCrypto: stats(pool('mixed', 'crypto')), mixedViewer: stats(pool('mixed', 'viewer')), mixedTrader: stats(pool('mixed', 'trader')),
      meanErrorRate: meanOf('mixed', a => a.errorRate), meanBaselineApiCpuMs: meanOf('baseline', a => a.apiCpuMs), meanMixedApiCpuMs: meanOf('mixed', a => a.apiCpuMs),
      meanBaselineElu: meanOf('baseline', a => a.elu?.utilization), meanMixedElu: meanOf('mixed', a => a.elu?.utilization),
      meanMixedLoopDelayP99Ms: meanOf('mixed', a => a.loopDelay?.p99Ms), maxMixedRssMb: Math.max(...done.map(r => r.mixed.memory?.rssMb).filter(finite), -Infinity),
      mixedWsConnections: [...new Set(done.map(r => r.mixed.websocket.connectionsAfter))]};
    const k = kinds[kind];
    k.pooledCryptoP95ChangePercent = pct(k.mixedCrypto.p95, k.baselineCrypto.p95);
    k.pooledCryptoP99ChangePercent = pct(k.mixedCrypto.p99, k.baselineCrypto.p99);
  }
  const b = kinds.before, a = kinds.after;
  const afterVsBefore = b && a ? {mixedCryptoP95Percent: pct(a.mixedCrypto.p95, b.mixedCrypto.p95), viewerStateP50Percent: pct(a.mixedViewer.p50, b.mixedViewer.p50),
    viewerStateP95Percent: pct(a.mixedViewer.p95, b.mixedViewer.p95), mixedApiCpuPercent: pct(a.meanMixedApiCpuMs, b.meanMixedApiCpuMs),
    viewerInducedApiCpuMs: {before: delta(b.meanMixedApiCpuMs, b.meanBaselineApiCpuMs), after: delta(a.meanMixedApiCpuMs, a.meanBaselineApiCpuMs)}} : null;
  return {scope: 'CI_DIAGNOSTIC_REPORT_ONLY', acceptance: false, runs, kinds, afterVsBefore};
}

function markdown(r) {
  const f = (x, d = 2) => finite(x) ? x.toFixed(d) : '—';
  const lines = ['### Extended numbers (report only, not a gate)', '',
    '| run | runtime | arm | crypto p50/p95/p99 ms | viewer state p50/p95/p99 ms | trader p95 ms | requests | errors+timeouts | API CPU ms | ELU | loop delay p99 ms | RSS MB | WS subscribe / connections |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const run of r.runs) for (const name of ['baseline', 'mixed']) {
    const x = run[name]; if (!x) { lines.push(`| ${run.name} | ${(run.runtime || '').slice(0, 8)} | ${name} | — | — | — | — | — | — | — | — | — | — |`); continue; }
    lines.push(`| ${run.name} | ${(run.runtime || '').slice(0, 8)} | ${name} | ${f(x.crypto.p50)}/${f(x.crypto.p95)}/${f(x.crypto.p99)} | ${f(x.viewer.p50)}/${f(x.viewer.p95)}/${f(x.viewer.p99)} | ${f(x.trader.p95)} | ${x.requests ?? '—'} | ${(x.unexpectedErrors ?? 0) + (x.timeouts ?? 0)} | ${f(x.apiCpuMs, 0)} | ${f(x.elu?.utilization, 3)} | ${f(x.loopDelay?.p99Ms)} | ${f(x.memory?.rssMb, 0)} | ${x.websocket.subscribeControls ?? '—'} / ${x.websocket.connectionsAfter ?? '—'} |`);
  }
  lines.push('', '| pin | runs | pooled crypto p50/p95/p99 baseline → mixed ms | Δp95 % | Δp99 % | mixed viewer p50/p95/p99 ms | mean API CPU ms base → mixed | mean ELU base → mixed | mean loop p99 ms | max RSS MB | mean error rate |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [kind, k] of Object.entries(r.kinds)) lines.push(`| ${kind} ${k.runtime.map(x => (x || '').slice(0, 8)).join(',')} | ${k.runs} | ${f(k.baselineCrypto.p50)}/${f(k.baselineCrypto.p95)}/${f(k.baselineCrypto.p99)} → ${f(k.mixedCrypto.p50)}/${f(k.mixedCrypto.p95)}/${f(k.mixedCrypto.p99)} | ${f(k.pooledCryptoP95ChangePercent)} | ${f(k.pooledCryptoP99ChangePercent)} | ${f(k.mixedViewer.p50)}/${f(k.mixedViewer.p95)}/${f(k.mixedViewer.p99)} | ${f(k.meanBaselineApiCpuMs, 0)} → ${f(k.meanMixedApiCpuMs, 0)} | ${f(k.meanBaselineElu, 3)} → ${f(k.meanMixedElu, 3)} | ${f(k.meanMixedLoopDelayP99Ms)} | ${f(k.maxMixedRssMb, 0)} | ${f(k.meanErrorRate, 4)} |`);
  if (r.afterVsBefore) {
    const v = r.afterVsBefore;
    lines.push('', `After vs before (mixed arm): crypto p95 ${f(v.mixedCryptoP95Percent)} %, viewer state p50 ${f(v.viewerStateP50Percent)} % / p95 ${f(v.viewerStateP95Percent)} %, mean API CPU ${f(v.mixedApiCpuPercent)} %; viewer-induced API CPU ${f(v.viewerInducedApiCpuMs.before, 0)} → ${f(v.viewerInducedApiCpuMs.after, 0)} ms.`);
  }
  lines.push('', 'CI_DIAGNOSTIC on a shared GitHub-hosted runner: not capacity acceptance. The +5 % verdict is the collection gate\'s.');
  return lines.join('\n');
}

module.exports = {report, markdown};

if (require.main === module) {
  const [runsDir, jsonOut] = process.argv.slice(2);
  const r = report(runsDir);
  console.log(markdown(r));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(r, null, 2));
}
