import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { analyzeNormalized, partitionWindow, correlateSamples, compareRuns, decodeTrace, normalizeTrace, parseCgroup, analyzeManifest, readerTimeouts, readerHttpErrors } from './analyze.mjs';
import { COLUMNS, EVENTS as E } from './recorder.mjs';

const group = { id: 10, dispatchMs: 30, workerStartMs: 35, workerEndMs: 75, replyMs: 80, workerThreadCpuMs: 6, sqlCalls: 3, sqlWallMs: 32, sqlThreadCpuMs: 2 };
const request = { id: 1, startMs: 0, socketMs: 5, arrivalMs: 10, contextStartMs: 10, contextEndMs: 20,
  commands: [{ groupId: 10, enqueueMs: 20 }], groupIds: [10], responseStartMs: 80, finishMs: 90, settleMs: 100, status: 200 };
const fixture = (changes = {}) => ({ complete: true, clockAligned: true, dropped: 0, requests: [request], physicalGroups: [group], ...changes });

test('joined read accounts for one complete latency without adding SQL or CPU twice', () => {
  const result = analyzeNormalized(fixture());
  assert.equal(result.acceptance, false);
  assert.equal(result.complete, true);
  assert.deepEqual(result.cases[0].phasesMs, { socketWait: 5, preArrival: 5, contextAccount: 10, accountQueue: 10, ipcToWorker: 5, worker: 40, ipcToMain: 5, mainResponse: 10, clientDelivery: 10, unattributed: 0 });
  assert.equal(Object.values(result.cases[0].phasesMs).reduce((a, b) => a + b), 100);
  assert.equal(result.cases[0].observations.sqlWallMs, 32);
  assert.equal(result.cases[0].observations.workerThreadCpuMs, 6);
  assert.equal(result.cases[0].residualMs, 0);
  assert.equal(result.summary.cpuCausalityEstablished, false);
});

test('shared registration batch counts physical SQL once despite multiple logical waiters', () => {
  const result = analyzeNormalized(fixture({ requests: [request, { ...request, id: 2, groupIds: [10, 10] }] }));
  assert.equal(result.summary.physicalGroups, 1);
  assert.equal(result.summary.physicalTotals.sqlCalls, 3);
  assert.equal(result.summary.physicalTotals.sqlWallMs, 32);
  assert.equal(result.summary.physicalTotals.workerThreadCpuMs, 6);
  assert.equal(result.cases[1].observations.sqlCalls, 3);
  assert.equal(result.cases[1].observations.sharedGroupValuesNotSummableAcrossClients, true);
});

test('timeout callback after 3s retains original deadline and separates overshoot and missing work', () => {
  const result = analyzeNormalized(fixture({ physicalGroups: [], requests: [{ id: 3, startMs: 0, socketMs: 5, arrivalMs: 10, contextStartMs: 15, contextEndMs: 3250, settleMs: 3300, timedOut: true, errorCode: 2 }] }));
  const row = result.cases[0];
  assert.equal(row.deadlineMs, 3000);
  assert.equal(row.deadlineExceeded, true);
  assert.equal(row.deadlineOvershootMs, 300);
  assert.equal(Object.values(row.withinDeadlinePhasesMs).reduce((a, b) => a + b), 3000);
  assert.equal(row.phasesMs.unattributed, 55);
  assert.equal(row.observations.sqlWallMs, null);
});

test('missing arrival, unaligned clocks and dropped events never become complete evidence', () => {
  const result = analyzeNormalized(fixture({ dropped: 1, clockAligned: false, requests: [{ id: 4, startMs: 10, settleMs: 3010, timedOut: true }] }));
  assert.equal(result.complete, false);
  assert.equal(result.cases[0].complete, false);
  assert.deepEqual(result.cases[0].missing, ['SERVER_ARRIVAL_MISSING', 'TRACE_INCOMPLETE']);
  assert.ok(result.incompleteness.includes('TRACE_DROPPED_EVENTS'));
  assert.ok(result.incompleteness.includes('CLOCK_ALIGNMENT_UNCONFIRMED'));
  assert.equal(result.cases[0].phasesMs.unattributed, 3000);
});

test('missing client settlement is not invented as an observed 3000ms latency', () => {
  const result = analyzeNormalized(fixture({ requests: [{ id: 5, startMs: 0, arrivalMs: 10 }] }));
  assert.equal(result.cases[0].latencyMs, null);
  assert.equal(result.cases[0].deadlineExceeded, null);
  assert.equal(result.cases[0].observedWindowMs, 3000);
  assert.equal(result.summary.latencyMs.p95, null);
  assert.equal(result.complete, false);
});

test('overlapping equal-priority phases remain unattributed instead of double counted', () => {
  const result = partitionWindow(0, 100, [{ phase: 'worker', start: 20, end: 80, priority: 2 }, { phase: 'accountQueue', start: 50, end: 90, priority: 2 }]);
  assert.equal(result.ambiguousMs, 30);
  assert.equal(result.phasesMs.worker, 30);
  assert.equal(result.phasesMs.accountQueue, 10);
  assert.equal(result.phasesMs.unattributed, 60);
  assert.equal(result.residualMs, 0);
});

test('cgroup correlation does not prorate or assign shared throttle CPU to a request', () => {
  const sample = (tMs, throttledUsec) => ({ tMs, usageUsec: tMs * 10, throttledUsec });
  const result = correlateSamples(50, 250, [sample(0, 0), sample(100, 1000), sample(200, 5000), sample(300, 9000)], [{ startMs: 0, endMs: 100, maxDelayMs: 7 }, { startMs: 200, endMs: 300, maxDelayMs: 14 }]);
  assert.equal(result.cgroup.counters.throttledUsec.contained, 4000);
  assert.equal(result.cgroup.counters.throttledUsec.intersecting, 9000);
  assert.equal(result.cgroup.coveredMs, 200);
  assert.equal(result.cgroup.exclusiveRequestAttribution, false);
  assert.equal(result.eventLoop.maxDelayMs, 14);
});

test('counter reset and unavailable loop measurements are explicit, never zero evidence', () => {
  const result = correlateSamples(0, 100, [{ tMs: 0, throttledUsec: 400 }, { tMs: 100, throttledUsec: 5 }], [{ startMs: 0, endMs: 100 }]);
  assert.equal(result.cgroup.resetIntervals, 1);
  assert.equal(result.cgroup.counters.throttledUsec.contained, null);
  assert.equal(result.cgroup.counters.throttledUsec.unavailableIntervals, 1);
  assert.equal(result.eventLoop.maxDelayMs, null);
});

const head = 'a'.repeat(40), conditionKey = 'b'.repeat(64);
const run = (repeat, traceMode, change = {}) => ({ head, conditionKey, repeat, traceMode, metrics: { cpuMs: traceMode === 'off' ? 100 : 110, peakRssBytes: 1024, p95Ms: 20, requests: 100, timeouts: 0 }, ...change });
test('three matching OFF/ON repeats report measured overhead without inventing acceptance', () => {
  const result = compareRuns([1, 2, 3].flatMap(repeat => [run(repeat, 'off'), run(repeat, 'on')]));
  assert.equal(result.complete, true);
  assert.equal(result.acceptance, false);
  assert.equal(result.conditions[0].matchedRepeats, 3);
  assert.equal(result.conditions[0].medianPercentOverhead.cpuMs, 10);
  assert.equal(result.conditions[0].pairs[0].overheadAssessment[0].status, 'NOT_ASSESSED_NO_CONFIGURED_LIMIT');
});

test('changed resource signature cannot be silently paired; explicit overhead threshold is honored', () => {
  const mismatched = compareRuns([run(1, 'off'), run(1, 'on', { conditionKey: 'c'.repeat(64) })]);
  assert.equal(mismatched.complete, false);
  assert.equal(mismatched.conditions[0].matchedRepeats, 0);
  const configured = compareRuns([run(1, 'off'), run(1, 'on')], { expectedRepeats: 1, overheadLimits: { cpuMs: { maxIncreasePercent: 5 } } });
  assert.equal(configured.conditions[0].pairs[0].overheadAssessment[0].status, 'EXCEEDS_CONFIGURED_LIMIT');
});

test('zero baseline and duplicate request/group/run identities cannot hide overhead or double count', () => {
  const comparison = compareRuns([run(1, 'off', { metrics: { cpuMs: 0 } }), run(1, 'on')], { expectedRepeats: 1 });
  assert.equal(comparison.conditions[0].pairs[0].metrics.cpuMs.percent, null);
  assert.throws(() => analyzeNormalized(fixture({ requests: [request, request] })), /TRACE_DUPLICATE_CLIENT/);
  assert.throws(() => analyzeNormalized(fixture({ physicalGroups: [group, group] })), /TRACE_DUPLICATE_PHYSICAL_GROUP/);
  assert.throws(() => compareRuns([run(1, 'on'), run(1, 'on')]), /TRACE_DUPLICATE_RUN/);
});

test('analysis outputs only safe numeric observations and controlled labels', () => {
  const result = analyzeNormalized(fixture({ requests: [{ ...request, secret: 'SECRET_CANARY', userId: 'ALICE_CANARY', payload: 'PRICE_CANARY', error: 'SECRET_CANARY' }] }));
  const json = JSON.stringify(result);
  assert.equal(json.includes('CANARY'), false);
  assert.equal(json.includes('cpuCausalityEstablished'), true);
});

test('HTTP refusals retain controlled error names and remain separate from success percentiles', () => {
  const result = analyzeNormalized(fixture({ requests: [request, { ...request, id: 2, settleMs: 2000, status: 422, errorCode: 7 }] }));
  assert.equal(result.cases[1].errorName, 'RATE_LIMIT');
  assert.equal(result.summary.allAttemptLatencyMs.p95, 2000);
  assert.equal(result.summary.successLatencyMs.p95, 100);
  assert.equal(result.summary.successfulRequests, 1);
});

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'stocks-phase-analyzer-'));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\stocks-phase-analyzer-') || resolve(root).startsWith(resolve(tmpdir()) + '/stocks-phase-analyzer-')); rmSync(root, { recursive: true, force: true }); });
  return root;
}
const record = (role, event, monoMs, http = 1, command = 0, groupId = 0, a = 0, b = 0, c = 0, d = 0, e = 0) => ({ role, event, monoMs, http, command, group: groupId, a, b, c, d, e, f: 0 });
function binaryFiles(root, records) {
  for (const role of ['main', 'worker', 'client']) {
    const rows = records.filter(row => row.role === role).sort((a, b) => a.monoMs - b.monoMs);
    const bytes = Buffer.alloc(rows.length * 96);
    rows.forEach((row, index) => COLUMNS.forEach((key, column) => bytes.writeDoubleLE(key === 'seq' ? index + 1 : row[key] ?? 0, index * 96 + column * 8)));
    writeFileSync(join(root, role + '.bin'), bytes);
    writeFileSync(join(root, role + '.meta.json'), JSON.stringify({ version: 1, role, byteOrder: 'LE', recordBytes: 96, columns: COLUMNS, count: rows.length, capacity: 100, dropped: 0, complete: true, clock: 'Number(process.hrtime.bigint())/1e6', anchor: { monoMs: 0, unixMs: 100000 }, events: E, threadCpuAvailable: true, sqlThreadCpuAvailable: true }));
  }
}

test('binary adapter joins awaited work and separately exposes inherited background context', t => {
  const root = temporary(t);
  binaryFiles(root, [record('client', E.CLIENT_START, 0, 1, 0, 0, 1, 3000), record('client', E.CLIENT_SOCKET, 5), record('client', E.CLIENT_END, 100, 1, 0, 0, 0, 200),
    record('main', E.HTTP_ARRIVAL, 10), record('main', E.CONTEXT_WAIT, 10, 1, 0, 0, 7), record('main', E.CONTEXT_READY, 80, 1, 0, 0, 7),
    record('main', E.ADMISSION, 20, 1, 10, 0, 1, 7), record('main', E.DISPATCH, 30, 1, 10, 10, 1), record('main', E.DISPATCH_MEMBER, 30, 1, 10, 10, 1, 7),
    record('worker', E.WORKER_START, 35, 1, 10, 10), record('worker', E.SQL_END, 70, 1, 10, 10, 6, 3, 32, 2, 1), record('worker', E.WORKER_END, 75, 1, 10, 10, 6), record('main', E.MAIN_RECEIPT, 80, 0, 10, 10, 1),
    record('main', E.ADMISSION, 11, 1, 20, 0, 7), record('main', E.DISPATCH, 12, 1, 20, 20, 1), record('main', E.DISPATCH_MEMBER, 12, 1, 20, 20, 7),
    record('worker', E.WORKER_START, 13, 1, 20, 20), record('worker', E.WORKER_END, 19, 1, 20, 20, 1), record('main', E.MAIN_RECEIPT, 20, 0, 20, 20, 1),
    record('main', E.RESPONSE_BEGIN, 80), record('main', E.HTTP_FINISH, 90, 1, 0, 0, 200),
  ]);
  const decoded = decodeTrace(root), normalized = normalizeTrace(decoded), result = analyzeNormalized(normalized);
  assert.equal(decoded.complete, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.cases[0].linkedPhysicalGroupIds, [10]);
  assert.equal(result.cases[0].phasesMs.worker, 40);
  assert.equal(result.cases[0].observations.backgroundOverlap.workerWallMs, 6);
  assert.equal(result.cases[0].observations.backgroundOverlap.causalAttribution, false);
  assert.equal(result.summary.physicalTotals.workerWallMs, 46);
  assert.equal(result.summary.physicalTotals.sqlCalls, 1);
});

test('arrival after client deadline remains measured pre-arrival latency, not fabricated server execution', () => {
  const decoded = { roles: [], issues: [], complete: true, dropped: 0, records: [record('client', E.CLIENT_START, 0, 1, 0, 0, 1, 3000), record('client', E.CLIENT_SOCKET, 5), record('client', E.CLIENT_DEADLINE, 3000), record('client', E.CLIENT_END, 3001, 1, 0, 0, 9), record('main', E.HTTP_ARRIVAL, 3200)] };
  const result = analyzeNormalized(normalizeTrace(decoded));
  assert.equal(result.cases[0].latencyMs, 3001);
  assert.equal(result.cases[0].phasesMs.preArrival, 2996);
  assert.equal(result.cases[0].phasesMs.worker, 0);
  assert.equal(result.cases[0].observations.sqlWallMs, null);
});

test('corrupt binary and missing roles cannot masquerade as an empty successful trace', t => {
  const root = temporary(t); binaryFiles(root, []);
  writeFileSync(join(root, 'main.bin'), Buffer.alloc(1));
  const decoded = decodeTrace(root);
  assert.equal(decoded.complete, false);
  assert.ok(decoded.issues.includes('TRACE_BINARY_SCHEMA_INVALID'));
  assert.equal(analyzeNormalized(normalizeTrace(decoded)).complete, false);
});

test('numeric cgroup format preserves counter values and sums devices without raw text leakage', () => {
  const rows = parseCgroup([{ monoMs: 100, cpuStat: { usage_usec: 200, throttled_usec: 300, nr_throttled: 2, secret: 'CANARY' }, ioStat: [{ device: '8:0', rbytes: 10, wbytes: 20, rios: 1, wios: 2 }, { device: '8:1', rbytes: 30, wbytes: 40, rios: 3, wios: 4 }] }]);
  assert.equal(rows[0].usageUsec, 200);
  assert.equal(rows[0].ioWriteBytes, 60);
  assert.equal(JSON.stringify(rows).includes('CANARY'), false);
});

test('partial manifest emits an explicit incomplete report without fabricated acceptance or unsafe paths', t => {
  const root = temporary(t);
  const result = analyzeManifest({ schemaVersion: 1, diagnosticOnly: true, acceptance: false, complete: false, revisions: {}, runs: [{ runId: 'before-on-1', variant: 'before', revision: 'de565eac17a8477e0dd4c50c2dc936b2bea21990', traceEnabled: true, repeat: 1, readerPath: '../outside-secret.json' }] }, root, join(root, 'analysis'));
  assert.equal(result.complete, false);
  assert.equal(result.acceptance, false);
  assert.ok(result.runs[0].issues.includes('READERPATH_TRACE_ARTIFACT_OUTSIDE_ROOT'));
  assert.equal(result.runs[0].reader.requests, null);
  assert.equal(JSON.stringify(result).includes('outside-secret'), false);
});

test('runner repetitions 0/1/2 form all three OFF/ON pairs without dropping repeat zero', t => {
  const root = temporary(t);
  const runs = [0, 1, 2].flatMap(repeat => [false, true].map(traceEnabled => ({
    runId: `before-r${repeat}-${traceEnabled ? 'on' : 'off'}`, variant: 'before', revision: 'de565eac17a8477e0dd4c50c2dc936b2bea21990',
    repeat, traceEnabled, workloadSignature: '1'.repeat(64), resourceSignature: '2'.repeat(64),
  })));
  const result = analyzeManifest({ schemaVersion: 1, diagnosticOnly: true, acceptance: false, complete: false, revisions: {}, runs }, root, join(root, 'analysis'));
  assert.equal(result.overhead.conditions[0].matchedRepeats, 3);
  assert.deepEqual(result.overhead.conditions[0].pairs.map(pair => pair.repeat), [1, 2, 3]);
  assert.deepEqual(result.overhead.conditions[0].missing, []);
  assert.equal(result.runs.some(run => run.issues.includes('MATCHED_CONDITIONS_UNCONFIRMED')), false);
  // Missing artifacts remain a failure; pairing metadata alone is not evidence.
  assert.equal(result.complete, false);
  assert.equal(result.acceptance, false);
});

test('timeouts come from original reader failure codes, not all errors or an absent top-level field', () => {
  assert.equal(readerTimeouts({ errors: 37, failures: { DEADLINE_3000MS: 32, ECONNRESET: 5 } }), 32);
  assert.equal(readerTimeouts({ errors: 4, failures: {}, httpErrorCodes: { ACCOUNT_BUSY: 4 } }), 0);
  assert.equal(readerTimeouts({ failures: { DEADLINE_3000MS: '32' } }), null);
  assert.equal(readerTimeouts(undefined), null);
});

test('original HTTP status-prefixed safe error counters remain visible without accepting arbitrary strings', () => {
  const actual = readerHttpErrors({ httpErrorCodes: { 'HTTP_503:ACCOUNT_BUSY': 17, 'HTTP_422:MOEX_UNVERIFIED': 1, RATE_LIMIT: 2, 'HTTP_503:SECRET_CANARY': 9, 'SECRET_CANARY:ACCOUNT_BUSY': 8 } });
  assert.deepEqual(actual, { 'HTTP_503:ACCOUNT_BUSY': 17, 'HTTP_422:MOEX_UNVERIFIED': 1, RATE_LIMIT: 2 });
  assert.equal(JSON.stringify(actual).includes('CANARY'), false);
});
