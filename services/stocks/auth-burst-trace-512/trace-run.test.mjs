// Pure guards only: injected RPC records, no server, database, Docker or HTTP calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, SAFETY } from '../auth-http-fixture-512/plan.mjs';
import { TRACE_PLAN_ID, TRACE_COUNTS, TRACE_BOUNDS, tracePlanHash, ordinaryRows, safetyRow, warmupRow, validateTraceFreeze } from './trace-plan.mjs';
import { createTraceDriver } from './trace-driver.mjs';
import { runTrace, validateStoppedTrace } from './trace-run.mjs';

const hash = 'a'.repeat(64);
const freeze = () => ({ schema: 1, planId: TRACE_PLAN_ID, planSha256: tracePlanHash(), sourceSha: 'b'.repeat(40),
  contextSha256: hash, imageId: 'sha256:' + hash, nodeSha256: hash, bcryptSha256: hash, seedSha256: hash, reviewedPacketSha256: hash, device: '8:0' });
const terminal = (row, status = 200, code = null) => ({ ...row, outcome: 'HTTP', status, code, elapsedMs: 1 });
function fakeTrace() {
  return { active: false, generation: 1, overflow: false, incomplete: false, flags: [], counts: { main: 50, worker: 50, requests: 50 },
    columns: ['seq', 'thread', 'request', 'workerCommand', 'span', 'event', 'monoNs', 'cpuUserUs', 'cpuSystemUs'],
    rows: [0, 1].flatMap(thread => Array.from({ length: 50 }, (_, i) => [i + 1, thread, i + 1, 0, 1, 1, i + 100, 1, 1].map(String))) };
}
function fakeAdapter({ failedOrdinary = false, incompleteTrace = false, brokenInit = false } = {}) {
  const calls = []; let authorityRequests = 0, phase = '', safetyIndex = 0, ordinary = 0, warmup = 0, safety = 0, health = 0, traced = false;
  const stock = () => ({ nativeProviderStarts: 0, deniedNetwork: 0, handlerFailures: 0, active: 0, activeHandlers: 0,
    accounts: { queue: { pending: 0, active: 0 }, sqlWriteCalls: 0, sqlExecCalls: 0, transactionExecCalls: 0 } });
  const authority = () => ({ active: 0, counters: { requests: authorityRequests, unregisteredRequests: 0, unexpectedPrisma: 0 }, settlement: { pending: { handlers: 0, operations: 0 } } });
  const adapter = {
    async initialize(f, ms) {
      calls.push({ role: 'adapter', op: 'initialize', ms }); if (brokenInit) throw Error('FIXTURE_INIT_FAILED');
      return { validatedProofs: { ...f, workerProofSha256: hash, workerSynchronous: 2, workerJournal: 'delete' },
        resourceProofs: Object.fromEntries(['service', 'authority', 'driver'].map(role => [role, { cpuMax: role === 'service' ? LIMITS.serviceCpuMax : LIMITS.auxiliaryCpuMax,
          memoryMax: String(LIMITS.memory), swapMax: '0', cpuset: role === 'service' ? '0' : '1', ioMax: '8:0 rbps=1048576 wbps=131072' }])),
        authorityMode: 'compact', networkScope: 'own-loopback-only', trace: { active: false } };
    },
    async rpc(role, op, input, ms) {
      calls.push({ role, op, input, ms });
      if (role === 'authority') {
        if (op === 'functional') { authorityRequests += 52; return { status: 'PASS', authorityRequests: 52 }; }
        if (op === 'drain') return { snapshot: authority() };
        if (['prepare', 'audit', 'mutate', 'window'].includes(op)) return authority();
      }
      if (role === 'service') {
        if (op === 'drain') return stock();
        if (op === 'enabled') return { enabled: input.value };
        if (op === 'startTraceWindow') { assert.equal(warmup, 50); assert.equal(ordinary, 0); traced = true; return { active: true, generation: 1, expectedRequests: 50, capacity: { main: 8192, worker: 4096 } }; }
        if (op === 'stopTraceWindow') { traced = false; return { ...fakeTrace(), incomplete: incompleteTrace }; }
        if (op === 'quiesce') { assert.equal(traced, false); return { closed: true, sha256: hash }; }
      }
      if (role === 'driver') {
        if (op === 'phase') { const before = phase; phase = input.name; return { phase, previousPhase: before, completedMonoNs: '100', snapshot: { observedMonoNs: '100', service: { cpuStat: 'usage_usec 10' } } }; }
        if (op === 'health') { health++; return terminal({}); }
        if (op === 'requests') {
          if (input.class === 'gatewaySafety') { assert.equal(traced, false); const expected = SAFETY[safetyIndex++]; safety++; if (!expected.proxyOnly) authorityRequests++; return [terminal(input.rows[0], expected.status, expected.code ?? null)]; }
          if (input.class === 'warmup') { assert.equal(traced, false); warmup++; authorityRequests++; return input.rows.map(row => terminal(row)); }
          assert.equal(traced, true); ordinary += input.rows.length; authorityRequests += input.rows.length;
          return input.rows.map((row, i) => failedOrdinary && i === 49 ? { ...terminal(row), outcome: 'DEADLINE', status: null, elapsedMs: 3000, reason: 'DEADLINE_3000MS' } : terminal(row));
        }
        if (op === 'stop') return { ordinary, warmup, safety, health, scheduled: 0, files: [], samples: 1, sampleIssues: [] };
      }
      throw Error('FAKE_RPC_UNEXPECTED');
    },
    abort(code) { calls.push({ role: 'adapter', op: 'abort', code }); },
    async close(ms) { calls.push({ role: 'adapter', op: 'close', ms }); return { removed: true, errors: [] }; },
  };
  return { adapter, calls };
}

test('single compact plan keeps original runtime resources and exact finite HTTP budgets', () => {
  assert.equal(TRACE_COUNTS.initiatingMaximum, 52 + 17 + 50 + 50 + 40);
  assert.equal(TRACE_COUNTS.allHttpHopsMaximum, 209 + 155 + 115);
  assert.equal(TRACE_BOUNDS.deadlineMs, 3000); assert.equal(TRACE_BOUNDS.drainMs, 10000);
  assert.equal(LIMITS.serviceCpuMax, '5000 100000'); assert.equal(LIMITS.memory, 256 * 1024 ** 2);
  validateTraceFreeze(freeze()); assert.throws(() => validateTraceFreeze({ ...freeze(), extraBurst: true }));
  assert.throws(() => validateTraceFreeze({ ...freeze(), planSha256: 'c'.repeat(64) }));
});

test('late fulfilled adapter calls are rejected even when the timeout callback has not run', async () => {
  let monotonic = 0; const { adapter } = fakeAdapter(); const initialize = adapter.initialize;
  adapter.initialize = async (...args) => { const result = await initialize(...args); monotonic += TRACE_BOUNDS.initializeMs; return result; };
  const report = await runTrace({ freeze: freeze(), adapter, now: () => monotonic });
  assert.equal(report.status, 'INCOMPLETE'); assert.ok(report.errors.includes('TRACE_RPC_TIMEOUT'));
  assert.equal(report.initiated.directAuthority, 0);
});

test('missing counters are incomplete while real safety violations remain safety failures', async () => {
  for (const missing of [true, false]) {
    const { adapter } = fakeAdapter(), rpc = adapter.rpc;
    adapter.rpc = async (...args) => { const result = await rpc(...args); if (args[0] === 'service' && args[1] === 'drain') {
      if (missing) delete result.nativeProviderStarts; else result.nativeProviderStarts = 1;
    } return result; };
    const report = await runTrace({ freeze: freeze(), adapter });
    assert.equal(report.status, missing ? 'INCOMPLETE' : 'FAIL');
  }
});

test('observed safety failure before ordinary survives rejected or incomplete cleanup', async () => {
  for (const throws of [true, false]) {
    const { adapter, calls } = fakeAdapter(), rpc = adapter.rpc;
    adapter.rpc = async (...args) => { const result = await rpc(...args);
      if (args[0] === 'service' && args[1] === 'drain') result.nativeProviderStarts = 1;
      return result;
    };
    adapter.close = async () => { if (throws) throw Error('CLEANUP_TEST_FAILURE'); return { removed: false, errors: ['UNKNOWN'] }; };
    const report = await runTrace({ freeze: freeze(), adapter });
    assert.equal(report.status, 'FAIL'); assert.equal(report.observedStatus, 'FAIL');
    assert.equal(report.safetyStatus, 'FAIL'); assert.equal(report.failureVerdict.safetyStatus, 'FAIL');
    assert.equal(report.captureStatus, 'INCOMPLETE'); assert.equal(report.cleanupStatus, 'INCOMPLETE');
    assert.ok(report.errors.includes('SAFETY_PROVIDER_ACCESS'));
    assert.equal(report.ordinary.length, 0); assert.ok(!calls.some(row => row.op === 'startTraceWindow'));
  }
});

test('capture gaps retain observed ordinary failures while successful terminals do not hide gaps', async () => {
  for (const failedOrdinary of [true, false]) {
    const { adapter } = fakeAdapter({ failedOrdinary, incompleteTrace: true });
    const report = await runTrace({ freeze: freeze(), adapter });
    assert.equal(report.status, failedOrdinary ? 'FAIL' : 'INCOMPLETE');
    assert.equal(report.observedStatus, failedOrdinary ? 'FAIL' : 'PASS');
    assert.equal(report.captureStatus, 'INCOMPLETE'); assert.equal(report.cleanupStatus, 'COMPLETE');
    assert.equal(report.ordinary.length, 50); assert.equal(report.trace.incomplete, true);
    assert.deepEqual(report.errors, ['TRACE_DIAGNOSTIC_ERROR']);
  }
  const { adapter } = fakeAdapter(); adapter.close = async () => ({ removed: false, errors: ['UNKNOWN'] });
  const report = await runTrace({ freeze: freeze(), adapter });
  assert.equal(report.observedStatus, 'PASS'); assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.captureStatus, 'COMPLETE'); assert.equal(report.cleanupStatus, 'INCOMPLETE');
});

test('zero worker commands are valid with explicitly unavailable worker CPU', () => {
  const trace = fakeTrace(); trace.rows = trace.rows.filter(row => row[1] === '0'); trace.counts.worker = 0;
  trace.windowCpu = { worker: { cpuAvailable: false } }; assert.equal(validateStoppedTrace(trace), true);
  trace.rows[0][3] = '1'; assert.throws(() => validateStoppedTrace(trace));
});
test('driver rejects early/duplicate burst, skips, extra health and cancellation without dispatch', async () => {
  const seen = [], driver = await createTraceDriver({ createInner: async () => ({ command: async (op, input) => { seen.push({ op, input }); return op === 'health' ? terminal({}) : {}; } }) });
  await driver.command('init', {}); await driver.command('phase', { name: 'startup' });
  await assert.rejects(driver.command('requests', { class: 'ordinary', rows: ordinaryRows() }));
  await driver.command('health'); await assert.rejects(driver.command('health'));
  await driver.command('phase', { name: 'gateway-safety' });
  for (let i = 0; i < 17; i++) await driver.command('requests', { class: 'gatewaySafety', rows: [safetyRow(i)] });
  await driver.command('phase', { name: 'warmup' });
  for (let i = 0; i < 50; i++) await driver.command('requests', { class: 'warmup', rows: [warmupRow(i)] });
  await driver.command('phase', { name: 'ordinary' });
  await assert.rejects(driver.command('requests', { class: 'cancellation', rows: ordinaryRows() }));
  await driver.command('requests', { class: 'ordinary', rows: ordinaryRows() });
  await assert.rejects(driver.command('requests', { class: 'ordinary', rows: ordinaryRows() }));
  assert.equal(seen.filter(x => x.op === 'requests' && x.input.class === 'ordinary').length, 1);
  await driver.command('stop'); await assert.rejects(driver.command('audit'));
});
test('orchestration dispatches only one burst after complete warmup and records raw outcome unchanged', async () => {
  const { adapter, calls } = fakeAdapter({ failedOrdinary: true });
  const report = await runTrace({ freeze: freeze(), adapter });
  assert.equal(report.status, 'FAIL'); assert.equal(report.capacityAcceptance, 'NOT_EVALUATED');
  assert.equal(report.ordinary.length, 50); assert.equal(report.ordinary[49].reason, 'DEADLINE_3000MS');
  assert.equal(report.counts.initiating, 170); assert.equal(report.counts.authFetches, 115); assert.equal(report.counts.authority, 167);
  assert.equal(calls.filter(x => x.role === 'driver' && x.op === 'requests' && x.input.class === 'ordinary').length, 1);
  assert.equal(calls.at(-1).op, 'close'); assert.deepEqual(report.errors, []);
});
test('trace coverage or initialization failure remains incomplete and always cleans owned resources', async () => {
  for (const options of [{ incompleteTrace: true }, { brokenInit: true }]) {
    const { adapter, calls } = fakeAdapter(options); const report = await runTrace({ freeze: freeze(), adapter });
    assert.equal(report.status, 'INCOMPLETE'); assert.ok(report.errors.length); assert.equal(calls.at(-1).op, 'close');
    assert.equal(report.cleanup.removed, true);
  }
  const empty = fakeTrace(); empty.rows = []; empty.counts.main = empty.counts.worker = 0;
  assert.throws(() => validateStoppedTrace(empty));
});
