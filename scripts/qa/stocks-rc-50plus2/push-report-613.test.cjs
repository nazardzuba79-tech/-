'use strict';
// push-report-613.cjs on synthetic stored results (no benchmark runs here): uptime, waits, stale viewers, quote age,
// private requests in the window (identity batches vs account commands), the busiest sliding minute against 240,
// gateway connections, CPU and totals over runs; a run without a result is listed and never counted.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {report, markdown, busiestMinute, privateRequests} = require('./push-report-613.cjs');

const T0 = Date.parse('2026-10-29T10:00:00Z');
function run(dir, name, {quotes = 1000, staleViewers = 0, rows = []} = {}) {
  const out = path.join(dir, name, 'out'); fs.mkdirSync(out, {recursive: true});
  const cpu = (user, system) => ({cpu: {user, system}});
  const arm = mixed => ({startedAt: new Date(T0).toISOString(), finishedAt: new Date(T0 + 20000).toISOString(), cryptoLatencies: Array.from({length: 100}, (_, i) => i + (mixed ? 2 : 1)),
    viewerDenials: mixed ? 50 : 0, orderLoss: 0, doubleSpend: 0, viewerMutations: 0, timeouts: 0, unexpectedErrors: 0, samples: mixed ? [{kind: 'trader', op: 'state', ms: 40}] : [],
    isolation: {usage: {server: {utilization: mixed ? 0.1 : 0.07}}, memory: {api: {hwmKb: 204800}, postgres: {pssKb: 102400}}},
    metrics: {before: {processes: {api: cpu(0, 0), stocksAuthority: cpu(0, 0), stocksGateway: cpu(0, 0)}}, after: {processes: {api: cpu(900000, 100000), stocksAuthority: cpu(mixed ? 800000 : 0, 0), stocksGateway: {...cpu(mixed ? 500000 : 0, 0), connections: {peak: 54, shed: 0, dropped: 0}}}},
      host: {before: {postgres: {cpuMs: 100}}, after: {postgres: {cpuMs: mixed ? 330 : 120}}}},
    ...(mixed ? {push: {kind: 'PUSH_DIAGNOSTIC', viewers: 50, opened: 50, quotes, waits: 0, unavailable: 0, revoked: 0, discarded: 0, staleViewers, quoteAgeP95Ms: 2071, deliveryDelayP95Ms: 26, errors: []}} : {})});
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({runtimeSourceSha: 'a'.repeat(40), workload: 'push-viewers-diagnostic', status: 'PUSH_DIAGNOSTIC_REPORT_ONLY'}));
  fs.writeFileSync(path.join(out, 'baseline-result.json'), JSON.stringify(arm(false)));
  fs.writeFileSync(path.join(out, 'mixed-result.json'), JSON.stringify(arm(true)));
  fs.writeFileSync(path.join(out, 'mixed-private-requests.json'), JSON.stringify(rows));
}

test('busiest sliding minute and private requests inside the measured window', () => {
  assert.equal(busiestMinute([]), 0);
  assert.equal(busiestMinute([0, 59999, 60000, 119999]), 2);
  const rows = [{at: T0 - 5000, route: 'identities', status: 200}, {at: T0 + 1000, route: 'identities', status: 200}, {at: T0 + 2000, route: 'order', status: 200}, {at: T0 + 3000, route: 'account', status: 429}];
  const q = privateRequests(rows, new Date(T0).toISOString(), new Date(T0 + 20000).toISOString());
  assert.deepEqual([q.window, q.identities, q.commands, q.status429, q.busiestMinute, q.quota], [3, 1, 2, 1, 4, 240]);
  assert.equal(privateRequests(null), null);
});

test('per-run and total stream delivery, costs and invariants; a run without a result is listed, not counted', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50-push-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  run(dir, 'push-1', {rows: Array.from({length: 30}, (_, i) => ({at: T0 + i * 500, route: i % 3 ? 'identities' : 'order', status: 200}))});
  run(dir, 'push-2', {quotes: 990, staleViewers: 1});
  fs.mkdirSync(path.join(dir, 'push-3', 'out'), {recursive: true});
  fs.mkdirSync(path.join(dir, 'after-1', 'out'), {recursive: true});
  const r = report(dir);
  assert.equal(r.acceptance, false);
  assert.deepEqual(r.runs.map(x => [x.name, x.status]), [['push-1', 'PUSH_DIAGNOSTIC_REPORT_ONLY'], ['push-2', 'PUSH_DIAGNOSTIC_REPORT_ONLY'], ['push-3', 'NO_RESULT']]);
  const m = r.runs[0].mixed;
  assert.equal(m.push.uptime, 1); assert.equal(m.push.expectedQuotes, 1000); assert.equal(m.traderP95, 40);
  assert.deepEqual(m.cpuMs, {api: 1000, authority: 800, gateway: 500, postgres: 230});
  assert.deepEqual([m.privateRequests.identities, m.privateRequests.commands, m.privateRequests.busiestMinute], [20, 10, 30]);
  assert.equal(r.total.runs, 2); assert.equal(r.total.staleViewers, 1); assert.equal(r.total.uptime, 1990 / 2000);
  assert.equal(r.total.gatewayPeakConnectionsMax, 54); assert.equal(r.total.busiestMinuteMax, 30); assert.equal(r.total.maxMemoryMb.api, 200);
  assert.deepEqual(r.total.financial, {orderLoss: 0, doubleSpend: 0, viewerMutations: 0});
  const md = markdown(r);
  assert.match(md, /\| push-1 \| aaaaaaaa \|/); assert.match(md, /1990 of 2000 quotes \(uptime 99\.50 %\)/); assert.match(md, /busiest minute 30\/240/);
});
