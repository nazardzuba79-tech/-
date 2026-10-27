'use strict';
// extended-report-613.cjs on a synthetic run set: exact percentiles, rates and
// metric deltas. Report only; no benchmark runs here.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {report, markdown} = require('./extended-report-613.cjs');

const metrics = (cpuMs, activeMs, idleMs, rssMb, controls, connections) => ({
  cpu: {user: cpuMs * 1000, system: 0}, memory: {rss: rssMb * 2 ** 20, heapUsed: 2 ** 20},
  loop: {elu: {active: activeMs, idle: idleMs, utilization: 0}, delay: {count: 10, minMs: 10, meanMs: 11, p50Ms: 10.5, p99Ms: 12, maxMs: 15}},
  market: {starts: [], controls: Array.from({length: controls}, () => ({})), connections}});
const armResult = (base, extra) => ({cryptoLatencies: base.map(x => x), requests: base.length + extra.length, timeouts: 0, unexpectedErrors: 1,
  samples: [...base.map((ms, i) => ({kind: 'crypto', op: i % 2 ? 'open' : 'cancel', status: 200, ms})), ...extra],
  metrics: {before: metrics(100, 1000, 9000, 100, 1, 1), after: metrics(300, 2000, 18000, 120, 3, 1)}});

function write(dir, name, runtime, base, mixedCrypto, viewer) {
  const out = path.join(dir, name, 'out'); fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({runtimeSourceSha: runtime, status: 'FAIL_LOCAL_DIAGNOSTIC'}));
  fs.writeFileSync(path.join(out, 'baseline-result.json'), JSON.stringify(armResult(base, [])));
  fs.writeFileSync(path.join(out, 'mixed-result.json'), JSON.stringify(armResult(mixedCrypto, viewer.map(ms => ({kind: 'viewer', op: 'state', status: 200, ms})))));
}

test('percentiles, error rate, CPU, ELU, memory and WebSocket deltas per arm and pooled per pin', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50-ext-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const ramp = n => Array.from({length: 100}, (_, i) => (i + 1) * n);
  write(dir, 'before-1', 'b'.repeat(40), ramp(1), ramp(2), ramp(3));
  write(dir, 'after-1', 'a'.repeat(40), ramp(1), ramp(1.5), ramp(1.5));
  const r = report(dir), before = r.runs.find(x => x.name === 'before-1');
  assert.deepEqual([before.baseline.crypto.p50, before.baseline.crypto.p95, before.baseline.crypto.p99], [50, 95, 99]);
  assert.deepEqual([before.mixed.viewer.p50, before.mixed.viewer.p95], [150, 285]);
  assert.equal(before.mixed.errorRate, 1 / 200);
  assert.equal(before.mixed.apiCpuMs, 200);
  assert.equal(before.mixed.elu.utilization, 1000 / 10000);
  assert.equal(before.mixed.memory.rssDeltaMb, 20);
  assert.deepEqual(before.mixed.websocket, {connectionsAfter: 1, subscribeControls: 2, restFetches: 0});
  assert.equal(before.mixed.cryptoOps.open, percentile95([...ramp(2)].filter((_, i) => i % 2)));
  assert.equal(r.kinds.before.pooledCryptoP95ChangePercent, 100);
  assert.equal(r.kinds.after.pooledCryptoP95ChangePercent, 50);
  assert.equal(r.afterVsBefore.mixedCryptoP95Percent, -25);
  assert.equal(r.afterVsBefore.viewerStateP95Percent, -50);
  assert.equal(r.acceptance, false);
  assert.match(markdown(r), /not capacity acceptance/);
});

test('missing or partial runs are shown as missing, never invented', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50-ext-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'before-1', 'out'), {recursive: true});
  const r = report(dir);
  assert.equal(r.runs[0].status, 'NO_RESULT'); assert.equal(r.runs[0].baseline, null);
  assert.equal(r.kinds.before.runs, 0); assert.equal(r.afterVsBefore, null);
  assert.match(markdown(r), /\| before-1 \| {2}\| baseline \| — /);
  assert.deepEqual(report(path.join(dir, 'absent')).runs, []);
});

test('separated runs: CPU, RSS and ELU per process, driver and PostgreSQL CPU, server-side crypto time', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50-ext-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const proc = (cpuMs, rssMb) => ({cpu: {user: cpuMs * 1000, system: 0}, memory: {rss: rssMb * 2 ** 20}, loop: {elu: {active: cpuMs, idle: 1000}, delay: {p99Ms: 12}}});
  const side = scale => ({topology: 'separated', ...metrics(100 * scale, 1000, 9000, 100, 1, 1),
    processes: {api: proc(100 * scale, 200), stocksAuthority: proc(10 * scale, 150), stocksGateway: proc(20 * scale, 110)}});
  const host = scale => ({driver: {cpu: {user: 50 * scale * 1000, system: 0}, elu: {active: 50 * scale, idle: 1000}, delay: {p99Ms: 11}}, postgres: {cpuMs: 30 * scale, processes: 9}});
  const crypto = [10, 20, 30, 40], timings = Object.fromEntries(crypto.map((ms, i) => ['c' + i, ms - 2]));
  const result = {cryptoLatencies: crypto, requests: 4, timeouts: 0, unexpectedErrors: 0, samples: crypto.map((ms, i) => ({requestId: 'c' + i, kind: 'crypto', op: 'open', status: 200, ms})),
    metrics: {before: side(1), after: side(3), host: {before: host(1), after: host(4)}}, serverTimings: timings};
  const out = path.join(dir, 'after-1', 'out'); fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({runtimeSourceSha: 'a'.repeat(40), status: 'PASS_LOCAL_DIAGNOSTIC'}));
  for (const arm of ['baseline', 'mixed']) fs.writeFileSync(path.join(out, arm + '-result.json'), JSON.stringify(result));
  const r = report(dir), mixed = r.runs[0].mixed;
  assert.equal(mixed.topology, 'separated');
  assert.deepEqual(Object.fromEntries(Object.entries(mixed.processes).map(([k, v]) => [k, [v.cpuMs, v.rssMb]])), {api: [200, 200], stocksAuthority: [20, 150], stocksGateway: [40, 110]});
  assert.equal(mixed.apiCpuMs, 200, 'API CPU stays the crypto API process alone');
  assert.equal(mixed.driver.cpuMs, 150); assert.equal(mixed.postgresCpuMs, 90);
  assert.deepEqual([mixed.serverCrypto.p95, mixed.clientMinusServerCrypto.p95], [38, 2]);
  assert.deepEqual(r.kinds.after.topology, ['separated']);
  assert.equal(r.kinds.after.meanProcessCpuMs.mixed.stocksGateway, 40);
  assert.match(markdown(r), /stocksAuthority 20 → 20/);
});

function percentile95(a) { return [...a].sort((x, y) => x - y)[Math.ceil(a.length * .95) - 1]; }
