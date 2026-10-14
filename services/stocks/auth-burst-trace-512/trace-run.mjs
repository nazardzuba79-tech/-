// Pure orchestration: no CLI, Docker, image build, source mutation or import-time workload.
// Concrete adapter must validate frozen image/overlay/native/observer proofs before initialize returns.
// Adapter: initialize(freeze, ms), rpc(role, op, input, ms), abort(code), close(ms).
// RPC roles are service/authority/driver; all transport and cleanup must honor ms.
import assert from 'node:assert/strict';
import { setTimeout as pauseDefault } from 'node:timers/promises';
import { LIMITS, SAFETY, validateResources, verifyUniqueTerminals, classifyRun, latencySummary,
  assertSafety, failureVerdict, safetyCode } from '../auth-http-fixture-512/plan.mjs';
import { validateFunctionalContract, validateGatewayContract, drainWithinBudget } from '../auth-http-fixture-512/run.mjs';
import { TRACE_PLAN_ID, TRACE_COUNTS, TRACE_BOUNDS, REQUEST_IDS, validateTraceFreeze,
  ordinaryRows, safetyRow, warmupRow } from './trace-plan.mjs';

const ALIASES = Object.freeze({ revoke: 'revoke', 'restore-session': 'restoreSession', delete: 'deleteUser',
  'restore-user': 'restoreUser', 'contact-block': 'block', unblock: 'unblock',
  'post-auth-delete': 'deleteBetweenReads', 'fail-session': 'sessionBackendFailure' });
const count = value => { assert.ok(Number.isSafeInteger(value) && value >= 0, 'TRACE_COUNTER_MISSING_OR_INVALID'); return value; };
const writes = stock => ['sqlWriteCalls', 'sqlExecCalls', 'transactionExecCalls'].map(key => count(stock.accounts?.[key]));
function validateDrainCounters(stock, authority) {
  for (const value of [stock.nativeProviderStarts, stock.deniedNetwork, stock.handlerFailures, stock.active, stock.activeHandlers,
    stock.accounts?.queue?.pending, stock.accounts?.queue?.active, authority.active, authority.counters?.requests,
    authority.counters?.unregisteredRequests, authority.counters?.unexpectedPrisma,
    authority.settlement?.pending?.handlers, authority.settlement?.pending?.operations]) count(value);
  writes(stock);
}
const safeFailure = error => safetyCode(error) || (/^[A-Z][A-Z0-9_]{1,79}$/.test(error?.message || '') ? error.message : 'TRACE_DIAGNOSTIC_ERROR');

export function validateTraceInitialization(proof, freeze) {
  for (const key of ['sourceSha', 'contextSha256', 'imageId', 'nodeSha256', 'bcryptSha256', 'seedSha256']) assert.equal(proof.validatedProofs[key], freeze[key]);
  assert.match(proof.validatedProofs.workerProofSha256, /^[a-f0-9]{64}$/);
  assert.equal(proof.validatedProofs.workerSynchronous, 2); assert.equal(proof.validatedProofs.workerJournal, 'delete');
  for (const role of ['service', 'authority', 'driver']) validateResources(proof.resourceProofs[role], role, freeze.device);
  assert.equal(proof.authorityMode, 'compact'); assert.equal(proof.networkScope, 'own-loopback-only');
  assert.equal(proof.trace.active, false); return true;
}
export function validateStoppedTrace(trace) {
  assert.equal(trace.active, false); assert.equal(trace.generation, 1);
  assert.equal(trace.overflow, false, 'TRACE_OVERFLOW'); assert.equal(trace.incomplete, false, 'TRACE_INCOMPLETE');
  assert.deepEqual(trace.flags, []); assert.equal(trace.counts.requests, 50);
  assert.deepEqual(trace.columns, ['seq', 'thread', 'request', 'workerCommand', 'span', 'event', 'monoNs', 'cpuUserUs', 'cpuSystemUs']);
  assert.ok(Array.isArray(trace.rows) && trace.rows.length <= 12288);
  for (const row of trace.rows) assert.ok(Array.isArray(row) && row.length === 9 && row.every(x => typeof x === 'string' && /^-?\d{1,20}$/.test(x)), 'TRACE_ROW_INVALID');
  assert.ok(Number.isInteger(trace.counts.main) && trace.counts.main > 0 && trace.counts.main <= 8192);
  assert.ok(Number.isInteger(trace.counts.worker) && trace.counts.worker >= 0 && trace.counts.worker <= 4096);
  assert.equal(trace.rows.length, trace.counts.main + trace.counts.worker);
  const tracedIds = [...new Set(trace.rows.map(row => Number(row[2])).filter(id => id > 0))].sort((a, b) => a - b);
  assert.deepEqual(tracedIds, Array.from({ length: 50 }, (_, i) => i + 1), 'TRACE_REQUEST_COVERAGE');
  const acceptedCommands = trace.rows.filter(row => Number(row[1]) === 0 && Number(row[3]) > 0);
  if (acceptedCommands.length) {
    assert.ok(trace.counts.worker > 0, 'TRACE_ACCEPTED_COMMAND_WITHOUT_WORKER_EVENTS');
    assert.equal(trace.windowCpu?.worker?.cpuAvailable, true, 'TRACE_WORKER_CPU_MISSING');
  } else if (trace.counts.worker === 0) assert.equal(trace.windowCpu?.worker?.cpuAvailable, false, 'TRACE_ABSENT_WORKER_CPU');
  return true;
}

export async function runTrace({ freeze, adapter, now = () => performance.now(), wallNow = Date.now, pause = pauseDefault, budgetMs = TRACE_BOUNDS.totalMs }) {
  validateTraceFreeze(freeze);
  assert.ok(Number.isFinite(budgetMs) && budgetMs > TRACE_BOUNDS.cleanupMs && budgetMs <= TRACE_BOUNDS.totalMs, 'TRACE_OVERALL_BUDGET_INVALID');
  for (const method of ['initialize', 'rpc', 'abort', 'close']) assert.equal(typeof adapter[method], 'function');
  const started = now(), totalDeadline = started + budgetMs;
  let deadline = totalDeadline - TRACE_BOUNDS.cleanupMs, traceActive = false, timer;
  const report = { schema: 1, planId: TRACE_PLAN_ID, sourceSha: freeze.sourceSha, planSha256: freeze.planSha256,
    status: 'INCOMPLETE', capacityAcceptance: 'NOT_EVALUATED', variant: 'C', countLimits: TRACE_COUNTS,
    health: [], safety: [], warmup: [], ordinary: [], phases: [], errors: [], cleanup: null,
    initiated: { directAuthority: 0, gatewaySafety: 0, warmup: 0, ordinary: 0, health: 0 } };
  const remaining = (cap = TRACE_BOUNDS.rpcMs) => {
    const value = Math.min(cap, deadline - now()); assert.ok(value > 0, 'TRACE_WALL_DEADLINE'); return Math.max(1, Math.ceil(value));
  };
  const invoke = async (fn, cap) => {
    const end = Math.min(deadline, now() + cap), ms = remaining(cap); let timeout;
    try { const result = await Promise.race([Promise.resolve().then(() => fn(ms)), new Promise((_, reject) => {
      timeout = setTimeout(() => { adapter.abort('TRACE_RPC_TIMEOUT'); reject(Error('TRACE_RPC_TIMEOUT')); }, ms);
    })]);
      if (now() >= end) { adapter.abort('TRACE_RPC_TIMEOUT'); throw Error('TRACE_RPC_TIMEOUT'); }
      return result;
    } finally { clearTimeout(timeout); }
  };
  const rpc = (role, op, input = {}, cap = TRACE_BOUNDS.rpcMs) => invoke(ms => adapter.rpc(role, op, input, ms), cap);
  const phase = async name => {
    const counters = { stock: await rpc('service', 'drain'), authority: await rpc('authority', 'audit') };
    const boundary = await rpc('driver', 'phase', { name }); report.phases.push({ ...boundary, counters }); return boundary;
  };
  const drain = () => drainWithinBudget(async timeLeft => {
    const stock = await rpc('service', 'drain', {}, timeLeft());
    const ms = timeLeft(), authority = (await rpc('authority', 'drain', { remainingMs: ms }, ms)).snapshot;
    return { stock, authority };
  }, ({ stock, authority }) => {
    validateDrainCounters(stock, authority);
    assertSafety(stock.nativeProviderStarts === 0 && stock.deniedNetwork === 0, 'SAFETY_PROVIDER_ACCESS');
    assertSafety(authority.counters.unregisteredRequests === 0, 'SAFETY_UNREGISTERED_AUTHORITY');
    assertSafety(authority.counters.unexpectedPrisma === 0, 'SAFETY_UNEXPECTED_PRISMA');
    assert.equal(stock.handlerFailures, 0);
    return stock.active === 0 && stock.activeHandlers === 0 && stock.accounts.queue.pending === 0 && stock.accounts.queue.active === 0 &&
      authority.active === 0 && authority.settlement.pending.handlers === 0 && authority.settlement.pending.operations === 0;
  }, { now, pause });
  const window = async (rows, kind) => {
    await rpc('authority', 'window', { entries: rows.map(({ subject, requestId }) => ({ subject, requestId })) });
    report.initiated[kind] += rows.length;
    const terminal = await rpc('driver', 'requests', { rows, class: kind });
    verifyUniqueTerminals(terminal, rows.map(r => r.requestId));
    if (kind === 'ordinary') report.ordinary = terminal;
    for (const row of terminal) { const code = safetyCode(row.firstEventReason) || safetyCode(row.reason); if (code) assertSafety(false, code); }
    return { terminal, tail: await drain() };
  };
  timer = setTimeout(() => adapter.abort('TRACE_WALL_DEADLINE'), budgetMs - TRACE_BOUNDS.cleanupMs);
  try {
    report.initialization = await invoke(ms => adapter.initialize(freeze, ms), TRACE_BOUNDS.initializeMs);
    validateTraceInitialization(report.initialization, freeze);
    report.functional = await rpc('authority', 'functional', {}, TRACE_BOUNDS.functionalMs); validateFunctionalContract(report.functional);
    report.initiated.directAuthority = report.functional.authorityRequests;
    report.preparedAuthority = await rpc('authority', 'prepare', { startedAtMs: wallNow() });
    assert.equal(report.preparedAuthority.counters.requests, TRACE_COUNTS.directAuthority);
    deadline = Math.min(deadline, now() + TRACE_BOUNDS.runMs);
    await phase('startup'); const startupDeadline = now() + TRACE_BOUNDS.startupMs;
    for (let i = 0; i < TRACE_COUNTS.healthMaximum; i++) {
      assert.ok(now() < startupDeadline, 'TRACE_STARTUP_DEADLINE'); const before = now(); report.initiated.health++;
      const row = await rpc('driver', 'health', {}, Math.min(TRACE_BOUNDS.rpcMs, startupDeadline - now())); report.health.push(row);
      assert.ok(now() < startupDeadline, 'TRACE_STARTUP_DEADLINE');
      if (row.outcome === 'HTTP' && row.status === 200) break;
      if (i + 1 === TRACE_COUNTS.healthMaximum) throw Error('STARTUP_INCOMPLETE');
      await pause(Math.max(0, LIMITS.startupCadenceMs - (now() - before)));
    }
    await phase('gateway-safety');
    for (const [i, test] of SAFETY.entries()) {
      if (test.enabled !== undefined) await rpc('service', 'enabled', { value: test.enabled });
      if (test.name === 'authority-restored') await rpc('authority', 'mutate', { action: 'restoreAll', subject: test.subject });
      if (test.control) await rpc('authority', 'mutate', { action: ALIASES[test.control], subject: test.subject });
      const before = await rpc('authority', 'audit'), response = await window([safetyRow(i)], 'gatewaySafety');
      validateGatewayContract(response.terminal[0], test, { beforeAuthorityRequests: before.counters.requests, afterAuthorityRequests: response.tail.authority.counters.requests });
      report.safety.push({ name: test.name, ...response.terminal[0] });
    }
    await phase('warmup');
    for (let i = 0; i < TRACE_COUNTS.warmup; i++) {
      const { terminal } = await window([warmupRow(i)], 'warmup'); report.warmup.push(terminal[0]);
      assert.ok(terminal[0].outcome === 'HTTP' && terminal[0].status === 200, 'WARMUP_INCOMPLETE');
    }
    report.before = await drain(); const beforeWrites = writes(report.before.stock);
    const ordinaryPhase = await phase('ordinary'); traceActive = true;
    report.traceStart = await rpc('service', 'startTraceWindow', { requestIds: REQUEST_IDS });
    assert.equal(report.traceStart.active, true); assert.equal(report.traceStart.generation, 1); assert.equal(report.traceStart.expectedRequests, 50);
    assert.deepEqual(report.traceStart.capacity, { main: 8192, worker: 4096 });
    const burst = await window(ordinaryRows(), 'ordinary'); report.ordinary = burst.terminal; report.after = burst.tail;
    assertSafety(writes(report.after.stock).every((value, i) => value === beforeWrites[i]), 'SAFETY_LEDGER_WRITE');
    report.trace = await rpc('service', 'stopTraceWindow'); traceActive = false; validateStoppedTrace(report.trace);
    const tailPhase = await phase('tail-drain');
    assert.match(ordinaryPhase.completedMonoNs || '', /^\d+$/); assert.match(tailPhase.snapshot?.observedMonoNs || '', /^\d+$/);
    report.cgroupWindow = { startMonoNs: ordinaryPhase.completedMonoNs, endMonoNs: tailPhase.snapshot.observedMonoNs,
      before: ordinaryPhase.snapshot, after: tailPhase.snapshot,
      scope: 'Start after initial sequential cgroup reads; end before final sequential cgroup reads. Counter deltas cover a broader interval.' };
    assert.ok(BigInt(report.cgroupWindow.endMonoNs) >= BigInt(report.cgroupWindow.startMonoNs));
    report.ledger = await rpc('service', 'quiesce');
    assert.equal(typeof report.ledger.closed, 'boolean', 'TRACE_LEDGER_PROOF_MISSING');
    assert.match(report.ledger.sha256 || '', /^[a-f0-9]{64}$/, 'TRACE_LEDGER_PROOF_MISSING');
    assertSafety(report.ledger.closed === true && report.ledger.sha256 === freeze.seedSha256, 'SAFETY_LEDGER_CHANGED');
    report.authority = await rpc('authority', 'audit');
    const upstream = report.authority.counters.requests - report.preparedAuthority.counters.requests;
    assert.ok(Number.isInteger(upstream) && upstream >= 0 && upstream <= TRACE_COUNTS.authFetchMaximum, 'TRACE_AUTH_REQUEST_BUDGET');
    report.counts = { ...report.initiated, initiating: Object.values(report.initiated).reduce((a, b) => a + b, 0),
      authFetches: upstream, authority: report.authority.counters.requests };
    assert.ok(report.counts.initiating <= TRACE_COUNTS.initiatingMaximum && report.counts.authority <= TRACE_COUNTS.authorityMaximum);
    report.driver = await rpc('driver', 'stop'); assert.equal(report.driver.ordinary, 50);
    assert.equal(report.driver.warmup, 50); assert.equal(report.driver.safety, 17); assert.equal(report.driver.scheduled, 0);
    assert.equal(report.driver.health, report.initiated.health); assert.ok(count(report.driver.samples) > 0);
    assert.deepEqual(report.driver.sampleIssues, [], 'TRACE_SAMPLER_INCOMPLETE');
    report.summary = latencySummary(report.ordinary); report.status = classifyRun(report.ordinary);
  } catch (error) {
    report.errors.push(safeFailure(error)); report.status = failureVerdict(error).status;
  } finally {
    clearTimeout(timer);
    // Cleanup gets a separate reserved bound; timed request or wall failures never authorize another burst.
    deadline = totalDeadline;
    if (traceActive) {
      try { report.trace = await rpc('service', 'stopTraceWindow', {}, Math.min(5000, TRACE_BOUNDS.cleanupMs)); }
      catch (error) { report.errors.push(safeFailure(error)); }
    }
    try { report.cleanup = await invoke(ms => adapter.close(ms), TRACE_BOUNDS.cleanupMs);
      assert.ok(report.cleanup && report.cleanup.removed === true && Array.isArray(report.cleanup.errors) && report.cleanup.errors.length === 0, 'TRACE_CLEANUP_INCOMPLETE');
    } catch (error) { adapter.abort('TRACE_CLEANUP_INCOMPLETE'); report.errors.push(safeFailure(error)); report.status = 'INCOMPLETE'; }
    report.elapsedMs = now() - started;
  }
  return report;
}
