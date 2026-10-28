'use strict';
// Report only, never a gate: the wider numbers of the paired #613 50+2 runs that
// summarize-613.cjs (the fail-closed collection gate) does not print. Per run and
// arm: crypto p50/p95/p99 and p95 per operation, viewer and trader latency, request
// and error counts, API CPU, memory, event-loop utilization and delay, and the
// synthetic market's WebSocket subscriptions/connections; per process of the run's
// topology (crypto API, Stocks authority, Stocks gateway) CPU, RSS, ELU and loop delay;
// the load driver's and the PostgreSQL cluster's CPU; server-side crypto time and the
// client-minus-server gap. Per pin: pooled numbers, and after vs before for the viewer
// path. Reads stored runs; starts no workload.
const fs = require('node:fs'), path = require('node:path');
const {delayMs} = require('./sched.cjs');
// Runnable-but-waiting time (schedstat) of each process over the measured window, all threads; PostgreSQL summed
// over the backends alive at the end (a backend that connected during the window counts from zero).
function waiting(result) {
  const b = result.metrics?.before, a = result.metrics?.after, hb = result.metrics?.host?.before, ha = result.metrics?.host?.after;
  const out = {api: delayMs(b?.sched, a?.sched)?.all ?? null};
  for (const [name, x] of Object.entries(a?.processes ?? {})) if (name !== 'api') out[name] = delayMs(b?.processes?.[name]?.sched, x?.sched)?.all ?? null;
  out.driver = delayMs(hb?.driver?.sched, ha?.driver?.sched)?.all ?? null;
  const backends = ha?.postgres?.backends;
  out.postgres = backends ? Object.entries(backends).reduce((t, [pid, x]) => x ? t + (x.delayNs - (hb?.postgres?.backends?.[pid]?.delayNs ?? 0)) / 1e6 : t, 0) : null;
  return out;
}

const percentile = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.ceil(a.length * p) - 1] : null;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const delta = (after, before) => finite(after) && finite(before) ? after - before : null;
const pct = (after, before) => finite(after) && finite(before) && before > 0 ? (after - before) / before * 100 : null;
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const stats = ms => ({count: ms.length, p50: percentile(ms, .5), p95: percentile(ms, .95), p99: percentile(ms, .99), max: ms.length ? Math.max(...ms) : null});
const cpuOf = (b, a) => b?.cpu && a?.cpu ? (delta(a.cpu.user, b.cpu.user) + delta(a.cpu.system, b.cpu.system)) / 1000 : null;
const eluOf = (b, a) => { const active = delta(a?.active, b?.active), idle = delta(a?.idle, b?.idle); return finite(active) && finite(idle) && active + idle > 0 ? active / (active + idle) : null; };
// Each process of the run's topology; a single-process run has only 'api' (or nothing recorded).
function processes(b, a) {
  const after = a?.processes ?? {};
  return Object.fromEntries(Object.entries(after).map(([name, x]) => [name, {cpuMs: cpuOf(b?.processes?.[name], x), rssMb: finite(x?.memory?.rss) ? x.memory.rss / 2 ** 20 : null,
    elu: eluOf(b?.processes?.[name]?.loop?.elu, x?.loop?.elu), loopDelayP99Ms: x?.loop?.delay?.p99Ms ?? null}]));
}

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
    topology: a?.topology ?? null, processes: processes(b, a),
    driver: {cpuMs: cpuOf(result.metrics?.host?.before?.driver, result.metrics?.host?.after?.driver), elu: eluOf(result.metrics?.host?.before?.driver?.elu, result.metrics?.host?.after?.driver?.elu),
      loopDelayP99Ms: result.metrics?.host?.after?.driver?.delay?.p99Ms ?? null},
    postgresCpuMs: delta(result.metrics?.host?.after?.postgres?.cpuMs, result.metrics?.host?.before?.postgres?.cpuMs),
    serverCrypto: stats(of('crypto').map(s => result.serverTimings?.[s.requestId]).filter(finite)),
    clientMinusServerCrypto: stats(of('crypto').filter(s => finite(result.serverTimings?.[s.requestId])).map(s => s.ms - result.serverTimings[s.requestId])),
    runQueueWaitMs: waiting(result),
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
      mixedWsConnections: [...new Set(done.map(r => r.mixed.websocket.connectionsAfter))],
      topology: [...new Set(done.map(r => r.mixed.topology).filter(Boolean))],
      meanProcessCpuMs: Object.fromEntries(['baseline', 'mixed'].map(armName => [armName, Object.fromEntries([...new Set(done.flatMap(r => Object.keys(r[armName].processes)))]
        .map(name => [name, meanOf(armName, x => x.processes[name]?.cpuMs)]))])),
      maxMixedProcessRssMb: Object.fromEntries([...new Set(done.flatMap(r => Object.keys(r.mixed.processes)))].map(name => [name, Math.max(...done.map(r => r.mixed.processes[name]?.rssMb).filter(finite), -Infinity)])),
      meanDriverCpuMs: {baseline: meanOf('baseline', x => x.driver.cpuMs), mixed: meanOf('mixed', x => x.driver.cpuMs)},
      meanPostgresCpuMs: {baseline: meanOf('baseline', x => x.postgresCpuMs), mixed: meanOf('mixed', x => x.postgresCpuMs)},
      serverCryptoP95Ms: {baseline: meanOf('baseline', x => x.serverCrypto.p95), mixed: meanOf('mixed', x => x.serverCrypto.p95)},
      clientMinusServerCryptoP95Ms: {baseline: meanOf('baseline', x => x.clientMinusServerCrypto.p95), mixed: meanOf('mixed', x => x.clientMinusServerCrypto.p95)},
      meanRunQueueWaitMs: Object.fromEntries(['baseline', 'mixed'].map(armName => [armName, Object.fromEntries([...new Set(done.flatMap(r => Object.keys(r[armName].runQueueWaitMs ?? {})))]
        .map(name => [name, meanOf(armName, x => x.runQueueWaitMs?.[name])]))]))};
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
  lines.push('', '| pin | topology | mean CPU ms per process, baseline → mixed | max mixed RSS MB per process | driver CPU ms base → mixed | PostgreSQL CPU ms base → mixed | mean server-side crypto p95 ms base → mixed | mean client−server crypto p95 ms base → mixed |', '|---|---|---|---|---|---|---|---|');
  for (const [kind, k] of Object.entries(r.kinds)) {
    const names = Object.keys(k.meanProcessCpuMs.mixed);
    lines.push(`| ${kind} | ${k.topology.join(',') || '—'} | ${names.map(n => `${n} ${f(k.meanProcessCpuMs.baseline[n], 0)} → ${f(k.meanProcessCpuMs.mixed[n], 0)}`).join('; ') || '—'} | ${names.map(n => `${n} ${f(k.maxMixedProcessRssMb[n], 0)}`).join('; ') || '—'} | ${f(k.meanDriverCpuMs.baseline, 0)} → ${f(k.meanDriverCpuMs.mixed, 0)} | ${f(k.meanPostgresCpuMs.baseline, 0)} → ${f(k.meanPostgresCpuMs.mixed, 0)} | ${f(k.serverCryptoP95Ms.baseline)} → ${f(k.serverCryptoP95Ms.mixed)} | ${f(k.clientMinusServerCryptoP95Ms.baseline)} → ${f(k.clientMinusServerCryptoP95Ms.mixed)} |`);
  }
  lines.push('', 'Time runnable but waiting for a CPU per measured window (schedstat, all threads, mean ms; growth from baseline to mixed is CPU contention):', '', '| pin | baseline | mixed |', '|---|---|---|');
  for (const [kind, k] of Object.entries(r.kinds)) { const w = k.meanRunQueueWaitMs ?? {}; const row = armName => Object.entries(w[armName] ?? {}).map(([n, x]) => `${n} ${f(x, 0)}`).join('; ') || '—'; lines.push(`| ${kind} | ${row('baseline')} | ${row('mixed')} |`); }
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
