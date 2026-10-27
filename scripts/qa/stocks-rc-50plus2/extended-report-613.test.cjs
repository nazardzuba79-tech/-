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

function percentile95(a) { return [...a].sort((x, y) => x - y)[Math.ceil(a.length * .95) - 1]; }
