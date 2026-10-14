// Pure contract guards only: no HTTP server, Docker, SQLite connection or workload launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import authorityEntry from './authority-entry.cjs';
import durabilityObserver from './durability-observer.cjs';
import { SUBJECTS, ISSUER, COUNTS, LIMITS, SEED, SAFETY, schedule, ordinaryWaves, sha256,
  validateResources, nearestRank, latencySummary, verifyUniqueTerminals, classifyRun, cancellationCoverage,
  terminalTiming, reconcileAuthority, validateRpcEnvelope, validateFreeze, assertSafety, safetyCode, failureVerdict } from './plan.mjs';
import { validateSeedState, validateSeedAccounts, validateInit, trackedHandler } from './stock-child.mjs';
import { validateRequest, validatePublicState, readCgroup } from './probe.mjs';
import { authorityInitArgs, validateContainerInspect, validateCgroupPath, boundedRpcLines, safeRpcFailure,
  remainingBudget, waitForServiceReady, drainWithinBudget, fixtureCommand, createObserverBinding, validateWorkerObservation,
  validatePrecheckServiceAudit, validatePrecheckClosedSeed, validateKernelResources, observedInitialization, precheckServices,
  validateFunctionalContract, validateGatewayContract } from './run.mjs';

const seed = () => ({ schema: 2, revision: 0, settings: { feeBps: 0 }, wallets: structuredClone(SEED.wallets),
  positions: {}, quotes: {}, orders: [], fills: [], adjustments: [], realized: { USDT: '0.00000000', USDC: '0.00000000' } });
const proof = role => ({ cpuMax: role === 'service' ? '5000 100000' : '50000 100000', memoryMax: String(LIMITS.memory),
  swapMax: '0', cpuset: role === 'service' ? '0' : '1', ioMax: '8:0 rbps=1048576 wbps=131072 riops=max wiops=max' });
const row = (requestId = 'r1', extras = {}) => ({ requestId, subject: 'alice', outcome: 'HTTP', status: 200, elapsedMs: 1, endedMonoNs: '300', ...extras });
const events = (requestId = 'r1', start = '100', end = '200') => [
  { type: 'authority-start', requestId, subject: 'alice', startedMonoNs: start },
  { type: 'authority-terminal', requestId, subject: 'alice', startedMonoNs: start, endedMonoNs: end, status: 200, responseBytes: 30 },
];
test('frozen schedule retains every original request and rotated paired cohorts', () => {
  const runs = schedule(); assert.equal(runs.length, 6); assert.deepEqual(runs.map(r => r.variant), ['P', 'C', 'C', 'P', 'P', 'C']);
  assert.deepEqual(runs.filter((_, i) => i % 2 === 0).map(r => r.cohorts), [[5, 20, 50], [50, 5, 20], [20, 50, 5]]);
  const ids = new Set(); for (const run of runs) { const waves = ordinaryWaves(run); assert.equal(waves.length, 9);
    assert.equal(waves.reduce((n, w) => n + w.requests.length, 0), 225);
    for (const wave of waves) { assert.equal(new Set(wave.requests.map(r => r.subject)).size, wave.cohort);
      for (const r of wave.requests) { assert.ok(!ids.has(r.requestId)); ids.add(r.requestId); } } }
  assert.equal(ids.size, COUNTS.ordinary); assert.equal(COUNTS.directAuthority, 3 * (52 + 52));
  assert.equal(SAFETY.length * runs.length, COUNTS.gatewaySafety); assert.equal(SAFETY.filter(r => r.proxyOnly).length * 6, 12);
  assert.equal(SUBJECTS.length, 50); assert.equal(COUNTS.scheduledAborts, 30); assert.equal(COUNTS.warmup, 300);
});
test('resource gates reject softened CPU, memory, swap and disk limits', () => {
  for (const role of ['service', 'authority', 'driver']) validateResources(proof(role), role, '8:0');
  for (const patch of [{ cpuMax: '10000 100000' }, { memoryMax: '536870912' }, { swapMax: 'max' }, { cpuset: '0-1' },
    { ioMax: '8:0 rbps=max wbps=max' }, { ioMax: '8:1 rbps=1048576 wbps=131072' }]) assert.throws(() => validateResources({ ...proof('service'), ...patch }, 'service', '8:0'));
});
test('all-attempt percentiles retain deadlines and invalid values are errors', () => {
  const attempts = [row('one'), row('two', { elapsedMs: 3100, outcome: 'DEADLINE', status: null })];
  assert.deepEqual(latencySummary(attempts), { n: 2, min: 1, max: 3100, p50: 1, p95: 3100, p99: 3100 });
  assert.equal(classifyRun(attempts), 'FAIL'); assert.equal(classifyRun([row()], ['unresolved tail']), 'INCOMPLETE');
  assert.throws(() => nearestRank([1, NaN], .95)); assert.equal(nearestRank([], .95), null);
});
test('exactly one terminal is required for each planned attempt', () => {
  verifyUniqueTerminals([row('one'), row('two')], ['one', 'two']);
  assert.throws(() => verifyUniqueTerminals([row('one')], ['one', 'two']));
  assert.throws(() => verifyUniqueTerminals([row('one'), row('one')], ['one', 'two']));
  assert.throws(() => verifyUniqueTerminals([row('alien')], ['one']));
});
test('monotonic deadline wins over delayed timers and post-body parse completion', () => {
  for (const outcome of ['HTTP', 'TRANSPORT_ERROR', 'ABORTED_CLIENT']) assert.equal(terminalTiming(outcome, 3000, 3000, 250, false).outcome, 'DEADLINE');
  assert.equal(terminalTiming('HTTP', 499, 500, undefined, false).outcome, 'HTTP');
  assert.equal(terminalTiming('HTTP', 501, 500, undefined, false).outcome, 'DEADLINE');
  const delayed = terminalTiming('HTTP', 251, 3000, 250, false);
  assert.equal(delayed.completedBeforeScheduledAbort, false); assert.equal(delayed.completedBeforeAbortTimer, true);
  assert.equal(terminalTiming('HTTP', 249, 3000, 250, false).completedBeforeScheduledAbort, true);
});
test('cancellation proof requires an authority request in flight at actual abort', () => {
  const attempts = Array.from({ length: 5 }, (_, i) => row('r' + (i + 1), { outcome: 'ABORTED_CLIENT', endedMonoNs: '150' }));
  assert.equal(cancellationCoverage(attempts, []), 'NOT_PROVEN');
  assert.equal(cancellationCoverage(attempts, events('r1', '151', '200')), 'NOT_PROVEN');
  assert.equal(cancellationCoverage(attempts, events('r1', '100', '149')), 'NOT_PROVEN');
  assert.equal(cancellationCoverage(attempts, events('r1', '100', '151')), 'OBSERVED');
});
test('authority reconciliation proves identity and tracks resolved late tails', () => {
  const late = reconcileAuthority([row('r1', { outcome: 'DEADLINE', endedMonoNs: '150' })], events());
  assert.equal(late[0].authorityTerminalAfterClient, true); assert.equal(late[0].authorityAdmittedAfterClient, false);
  assert.equal(reconcileAuthority([row('r1', { outcome: 'ABORTED_CLIENT' })], [])[0].canceledBeforeDispatch, true);
  assert.throws(() => reconcileAuthority([row()], []));
  assert.throws(() => reconcileAuthority([row()], events('unknown')));
  assert.throws(() => reconcileAuthority([row()], events().slice(0, 1)));
  assert.throws(() => reconcileAuthority([row()], [...events(), events()[1]]));
  assert.throws(() => reconcileAuthority([row()], events().map(e => ({ ...e, subject: 'bob' }))));
});
test('actual async handler remains active after disconnected response until its promise settles', async () => {
  const metrics = { activeHandlers: 0, handlerStarts: 0, handlerTerminals: 0, handlerFailures: 0 }, response = new EventEmitter();
  let release; const tail = new Promise(resolve => { release = resolve; });
  const pending = trackedHandler(async () => { await tail; }, metrics)({}, response);
  assert.equal(metrics.activeHandlers, 1); response.emit('close'); await Promise.resolve(); assert.equal(metrics.activeHandlers, 1);
  release(); await pending; assert.deepEqual(metrics, { activeHandlers: 0, handlerStarts: 1, handlerTerminals: 1, handlerFailures: 0 });
  await assert.rejects(trackedHandler(async () => { throw Error('tail failure'); }, metrics)({}, response), /tail failure/);
  assert.equal(metrics.activeHandlers, 0); assert.equal(metrics.handlerFailures, 1);
});
test('closed seed contract binds exact fifty issuer-derived principals and unchanged financial values', () => {
  const rows = SUBJECTS.map(subject => ({ id: sha256(JSON.stringify([ISSUER, subject])), ledger: JSON.stringify(seed()) }));
  validateSeedAccounts(rows); const wrong = structuredClone(rows); wrong[49].id = wrong[0].id; assert.throws(() => validateSeedAccounts(wrong));
  assert.throws(() => validateSeedAccounts(rows.slice(1))); assert.throws(() => validateSeedState({ ...seed(), revision: 1 }));
  const changed = seed(); changed.wallets.USDT.cash = '10000.00000001'; assert.throws(() => validateSeedState(changed));
});
test('public account proof distinguishes Alice and Bob without copying CSRF or profile data', () => {
  const publicState = subject => { const s = seed(); for (const wallet of Object.values(s.wallets)) wallet.available = wallet.cash;
    return { ...s, csrfToken: 'private-sentinel', account: { id: sha256(JSON.stringify([ISSUER, subject])), mode: 'isolated-paper', canTrade: subject === 'alice' } }; };
  for (const subject of ['alice', 'bob']) { const result = validatePublicState(publicState(subject), subject); assert.equal(JSON.stringify(result).includes('private-sentinel'), false); }
  assert.throws(() => validatePublicState(publicState('alice'), 'bob'));
  const bob = publicState('bob'); bob.account.canTrade = true; assert.throws(() => validatePublicState(bob, 'bob'));
});
test('only exact read paths and explicit local ports are admitted', () => {
  validateRequest({ requestId: 'local-1', subject: 'alice' });
  assert.throws(() => validateRequest({ requestId: 'local-1', subject: 'eve' }));
  assert.throws(() => validateRequest({ requestId: 'local-1', subject: 'alice', path: '/__stocks_global/order' }));
  const init = { issuer: ISSUER, authority: 'http://127.0.0.1:29301', gatewayPort: 29302, servicePort: 29303 }; validateInit(init);
  assert.throws(() => validateInit({ ...init, servicePort: 29302 }));
  assert.throws(() => validateInit({ ...init, authority: 'https://production.example' }));
});
test('private RPC envelopes use actual runner string IDs and exact authority init fields', () => {
  const args = authorityInitArgs('P', { bcryptSha256: 'a'.repeat(64), contextSha256: 'b'.repeat(64) }, 1800000000000);
  const envelope = validateRpcEnvelope({ id: '1', op: 'init', args }); assert.equal(envelope.args.contextSha256, 'b'.repeat(64));
  authorityEntry.assertInitArgs(args);
  assert.equal(args.mode, 'profile'); assert.equal(args.sourceRoot, '/source'); assert.equal(args.tokenPath, '/private-ipc/tokens.json');
  assert.equal(authorityInitArgs('C', { bcryptSha256: 'a'.repeat(64), contextSha256: 'b'.repeat(64) }, 1800000000000).mode, 'compact');
  authorityEntry.assertInitArgs(authorityInitArgs('C', { bcryptSha256: 'a'.repeat(64), contextSha256: 'b'.repeat(64) }, 1800000000000));
  assert.throws(() => validateRpcEnvelope({ id: 1, op: 'init', args }));
  assert.throws(() => validateRpcEnvelope({ id: '1', op: 'init', args, secret: 'unexpected' }));
  assert.throws(() => authorityInitArgs('P', { bcryptSha256: 'a'.repeat(64) }, 1234));
});
const privateServiceBinds = [{ source: '/owned/data', target: '/data', ro: false }, { source: '/owned/observation', target: '/private-observation', ro: false }];
const inspected = role => ({ Id: 'a'.repeat(64), Image: 'sha256:fixture', Config: { Hostname: 'a'.repeat(12), User: '10001:10001', Entrypoint: [fixtureCommand(role).entrypoint],
  Cmd: fixtureCommand(role).args, Labels: {
  'voltex.auth-http.run': 'fixture', 'voltex.auth-http.role': role }, Env: role === 'authority' ? ['JWT_SECRET=stocks-auth-http-disposable-fixture-secret']
    : role === 'service' ? ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'NODE_VERSION=24.21.0', 'YARN_VERSION=1.22.22', 'AUTH_HTTP_FIXTURE_512=true'] : [] },
  HostConfig: { ReadonlyRootfs: true, CapDrop: ['ALL'], CapAdd: [], SecurityOpt: ['no-new-privileges'], Privileged: false, PidMode: '', IpcMode: 'private',
    NetworkMode: role === 'service' ? 'none' : 'container:service', PortBindings: {}, PublishAllPorts: false, Memory: LIMITS.memory, MemorySwap: LIMITS.memory,
    NanoCpus: role === 'service' ? 50000000 : 500000000, CpusetCpus: role === 'service' ? '0' : '1', Devices: [] },
  Mounts: role === 'service' ? privateServiceBinds.map(b => ({ Type: 'bind', Source: b.source, Destination: b.target, RW: !b.ro })) : [] });
const checked = (role, info) => { info ??= inspected(role);
  return validateContainerInspect(info, { runId: 'fixture', image: 'sha256:fixture', role, serviceId: 'service', uid: 10001, binds: role === 'service' ? privateServiceBinds : [] }); };
test('container proof rejects shared host boundaries and unintended secrets', () => {
  for (const role of ['service', 'authority', 'driver']) checked(role);
  for (const patch of [{ NetworkMode: 'host' }, { IpcMode: 'container:foreign' }, { IpcMode: 'host' }, { IpcMode: 'shareable' },
    { SecurityOpt: ['no-new-privileges', 'seccomp=unconfined'] }, { Privileged: true }, { MemorySwap: -1 }, { CapAdd: ['SYS_ADMIN'] }]) {
    const info = inspected('service'); Object.assign(info.HostConfig, patch); assert.throws(() => checked('service', info)); }
  const stockSecret = inspected('service'); stockSecret.Config.Env = ['JWT_SECRET=stocks-auth-http-disposable-fixture-secret']; assert.throws(() => checked('service', stockSecret));
  const wrongSecret = inspected('authority'); wrongSecret.Config.Env = ['JWT_SECRET=other']; assert.throws(() => checked('authority', wrongSecret));
  const hostMount = inspected('driver'); hostMount.Mounts = [{ Type: 'bind', Source: '/sys/fs/cgroup', Destination: '/host', RW: false }]; assert.throws(() => checked('driver', hostMount));
  const wrongEntry = inspected('service'); wrongEntry.Config.Cmd = ['services/stocks-global/server.mjs']; assert.throws(() => checked('service', wrongEntry));
  const authorityFlag = inspected('authority'); authorityFlag.Config.Cmd.pop(); assert.throws(() => checked('authority', authorityFlag));
});
test('metric paths cannot widen to the host cgroup root or arbitrary files', () => {
  assert.throws(() => readCgroup('/host', () => 'unused'));
  const metrics = readCgroup('/metrics/service', () => 'measured'); assert.equal(metrics.cpuStat, 'measured');
  const root = path.resolve('synthetic-cgroup-root'), child = path.join(root, 'disposable');
  validateCgroupPath(child, root, { isDirectory: true, isSymbolicLink: false });
  assert.throws(() => validateCgroupPath(root, root, { isDirectory: true, isSymbolicLink: false }));
  assert.throws(() => validateCgroupPath(child, root, { isDirectory: true, isSymbolicLink: true }));
});
test('missing launch freeze is fail closed and imports do not start a fixture', () => {
  assert.throws(() => validateFreeze({})); assert.throws(() => validateFreeze({ schema: 1, status: 'NOT_LAUNCH_READY' }));
  assert.equal(process.env.AUTH_HTTP_FIXTURE_512_LAUNCH_APPROVED, undefined);
});
test('private stdout bounds partial lines before newline and keeps every coalesced event/reply', () => {
  const decoder = boundedRpcLines(16, 128); assert.deepEqual(decoder.push(Buffer.from('first\nsec')), ['first']);
  assert.deepEqual(decoder.push(Buffer.from('ond\nthird\n')), ['second', 'third']); decoder.end();
  const partial = boundedRpcLines(4, 32); partial.push(Buffer.from('1234')); assert.throws(() => partial.push(Buffer.from('5')));
  assert.throws(() => partial.push(Buffer.from('\n'))); const truncated = boundedRpcLines(); truncated.push(Buffer.from('unfinished')); assert.throws(() => truncated.end());
  const total = boundedRpcLines(16, 4); assert.throws(() => total.push(Buffer.from('1234\n')));
});
test('financial or isolation violations remain safety FAIL independently of incomplete evidence', () => {
  for (const code of ['SAFETY_LEDGER_CHANGED', 'SAFETY_LEDGER_WRITE', 'SAFETY_PROVIDER_ACCESS', 'SAFETY_UNEXPECTED_PRISMA', 'SAFETY_UNREGISTERED_AUTHORITY', 'SAFETY_ACCOUNT_RESPONSE']) {
    let fault; try { assertSafety(false, code); } catch (error) { fault = error; }
    assert.equal(safetyCode(fault), code); assert.deepEqual(failureVerdict(fault), { status: 'FAIL', safetyStatus: 'FAIL', datasetStatus: 'INCOMPLETE' });
    assert.equal(failureVerdict({ message: code }).safetyStatus, 'FAIL');
  }
  assert.equal(safetyCode('SAFETY_unknown-private-text'), null);
  assert.deepEqual(failureVerdict(Error('TAIL_DRAIN_INCOMPLETE')), { status: 'INCOMPLETE', safetyStatus: 'NOT_EVALUATED', datasetStatus: 'INCOMPLETE' });
  assert.throws(() => validatePublicState({}, 'alice'), error => safetyCode(error) === 'SAFETY_ACCOUNT_RESPONSE');
  const safe = safeRpcFailure({ code: 'SAFETY_CONTRACT_MISMATCH', contract: { caseName: 'revoked-session', expectedStatus: 401, actualStatus: 200, body: 'private-sentinel' }, jwt: 'private-sentinel' });
  assert.deepEqual(safe, { code: 'SAFETY_CONTRACT_MISMATCH', contract: { caseName: 'revoked-session', expectedStatus: 401, actualStatus: 200 } });
  assert.equal(JSON.stringify(safe).includes('private-sentinel'), false);
  assert.deepEqual(safeRpcFailure({ code: 'arbitrary-private-sentinel' }), { code: 'FIXTURE_RPC_FAILED' });
});

test('authority startup waits for running service PID and established network sandbox', async () => {
  let clock = 0, calls = 0; const budgets = [];
  const ready = { State: { Running: true, Status: 'running', Pid: 42 }, NetworkSettings: { SandboxKey: '/run/docker/netns/fixture' } };
  const phases = [{ State: { Running: false, Status: 'created', Pid: 0 } },
    { State: ready.State, NetworkSettings: { SandboxKey: '' } }, ready];
  const result = await waitForServiceReady((id, budget) => { assert.equal(id, 'service'); budgets.push(budget); return phases[calls++]; }, 'service',
    { now: () => clock, pause: async ms => { clock += ms; } });
  assert.equal(result, ready); assert.equal(calls, 3); assert.deepEqual(budgets, [10000, 9900, 9800]);
});

test('service readiness cannot pass after a slow inspection or delayed polling callback', async () => {
  const ready = { State: { Running: true, Status: 'running', Pid: 42 }, NetworkSettings: { SandboxKey: '/run/docker/netns/fixture' } };
  let clock = 0;
  await assert.rejects(waitForServiceReady(() => { clock = 10000; return ready; }, 'service', { now: () => clock }), /SERVICE_NAMESPACE_READY_INCOMPLETE/);
  clock = 0; let calls = 0;
  await assert.rejects(waitForServiceReady(() => { calls++; return calls === 1 ? { State: {} } : ready; }, 'service',
    { now: () => clock, pause: async () => { clock = 10001; } }), /SERVICE_NAMESPACE_READY_INCOMPLETE/);
  assert.equal(calls, 1, 'late poll must not inspect or start an authority');
});

test('tail drain shares shrinking budget across service and authority without adding a fresh timeout', async () => {
  let clock = 0, reads = 0; const budgets = [];
  const result = await drainWithinBudget(async remaining => {
    budgets.push(remaining()); clock += 700; budgets.push(remaining()); clock += 300; return { ready: ++reads === 2 };
  }, snapshot => snapshot.ready, { now: () => clock, pause: async ms => { clock += ms; } });
  assert.equal(result.ready, true); assert.deepEqual(budgets, [10000, 9300, 8900, 8200]);
  assert.throws(() => remainingBudget(10000, 10000), /TAIL_DRAIN_INCOMPLETE/);
});

test('late RPC completion or delayed drain callback is incomplete even when the final snapshot is quiescent', async () => {
  let clock = 0;
  await assert.rejects(drainWithinBudget(async () => { clock = 10000; return true; }, Boolean, { now: () => clock }), /TAIL_DRAIN_INCOMPLETE/);
  clock = 0; let reads = 0;
  await assert.rejects(drainWithinBudget(async () => ++reads > 1, Boolean,
    { now: () => clock, pause: async () => { clock = 10001; } }), /TAIL_DRAIN_INCOMPLETE/);
  assert.equal(reads, 1);
  clock = 0;
  await assert.rejects(drainWithinBudget(async () => { clock = 10001; return {}; }, () => assertSafety(false, 'SAFETY_LEDGER_WRITE'),
    { now: () => clock }), error => safetyCode(error) === 'SAFETY_LEDGER_WRITE');
});

test('observer service command and private mount are exact; other role commands are preserved', () => {
  assert.deepEqual(fixtureCommand('service'), { entrypoint: '/usr/local/bin/node', args: ['--require', durabilityObserver.OBSERVER, durabilityObserver.SERVICE] });
  assert.equal(fixtureCommand('authority').entrypoint, 'node'); assert.deepEqual(fixtureCommand('authority').args.slice(-1), ['--stdio']);
  assert.equal(fixtureCommand('driver').args.length, 1);
  for (const mutate of [i => i.Config.Cmd.push('--require', '/other.cjs'), i => { i.Config.Entrypoint = ['node']; },
    i => { i.Mounts = i.Mounts.slice(0, 1); }, i => { i.Config.Hostname = 'unbound'; }, i => i.Config.Env.push('LD_PRELOAD=/tmp/extra.so'),
    i => i.Config.Env.push('AUTH_HTTP_FIXTURE_512=true')]) {
    const info = inspected('service'); mutate(info); assert.throws(() => checked('service', info));
  }
});
function observerFixture(variant = 'P', id = 'a'.repeat(64)) {
  const files = [durabilityObserver.OBSERVER, ...Object.values(durabilityObserver.RUNTIME)].map((file, n) =>
    ({ path: file.slice('/source/'.length), bytes: 100, sha256: String(n + 1).repeat(64) }));
  const freeze = { files, sourceSha: 'b'.repeat(40), runtimeImageId: 'sha256:' + 'c'.repeat(64), contextSha256: 'd'.repeat(64), seed: { sha256: 'e'.repeat(64) } };
  const binding = createObserverBinding(freeze, 'auth-http512-01234567-0123-0123-0123-0123456789ab', { pair: 0, variant }, id);
  const bindingSha256 = sha256(JSON.stringify(binding, null, 2) + '\n');
  const init = { node: 'v24.21.0', gatewayOrigin: 'http://127.0.0.1:29302', providerStarts: 0,
    seed: { sha256: freeze.seed.sha256 }, closure: { contextSha256: freeze.contextSha256, verifiedFiles: 4 } };
  const info = { Id: id, Image: freeze.runtimeImageId, Config: { Hostname: id.slice(0, 12) }, State: { Running: true, Status: 'running' } };
  const proof = { ...binding, bindingSha256, schema: 1, status: 'PASS', node: 'v24.21.0', pid: 1, threadId: 1,
    seedIdentityBeforeOpen: { bytes: 4096, inode: 123, device: 456 },
    synchronous: 2, journalMode: 'delete', nativeConfigurationCalls: 1, readOnlyPragmas: 2, descriptorRestored: true,
    configurationSqlSha256: sha256(durabilityObserver.CONFIG_SQL), preloadStartedMonoNs: '1', setupStartedMonoNs: '2',
    finishedBeforeProofWriteMonoNs: '7', nativeConfigurationDurationNs: '2', restoreAndReadObservationDurationNs: '3' };
  return { freeze, binding, bindingSha256, init, info, proof };
}
test('worker proof binds both variants and every fresh service to image/source/context/seed/runtime', () => {
  for (const variant of ['P', 'C']) {
    const f = observerFixture(variant); assert.equal(validateWorkerObservation(f.proof, f), true);
    assert.equal(f.binding.variant, variant); assert.equal(f.binding.caseId, 'pair1-' + variant);
    assert.throws(() => validateWorkerObservation(f.proof, observerFixture(variant, 'f'.repeat(64))));
  }
  const f = observerFixture();
  for (const patch of [{ status: 'FAIL' }, { synchronous: 1 }, { journalMode: 'wal' }, { descriptorRestored: false },
    { nativeConfigurationCalls: 2 }, { readOnlyPragmas: 3 }, { seedSha256: 'f'.repeat(64) }, { observerSha256: 'f'.repeat(64) },
    { runtimeSha256: { ...f.binding.runtimeSha256, accounts: 'f'.repeat(64) } }, { bindingSha256: 'f'.repeat(64) },
    { threadId: 0 }, { seedIdentityBeforeOpen: undefined }, { finishedBeforeProofWriteMonoNs: '0' }]) assert.throws(() => validateWorkerObservation({ ...f.proof, ...patch }, f));
  assert.throws(() => validateWorkerObservation(f.proof, { ...f, failurePresent: true }));
  assert.throws(() => validateWorkerObservation(f.proof, { ...f, init: undefined }));
  assert.throws(() => validateWorkerObservation(f.proof, { ...f, info: { ...f.info, State: { Running: false } } }));
  assert.throws(() => createObserverBinding({ ...f.freeze, files: f.freeze.files.slice(1) }, f.binding.runId, { pair: 0, variant: 'P' }, f.info.Id));
});
test('whole-init accounting starts before initialization and proof admission precedes later HTTP work', async () => {
  const f = observerFixture(), events = [], evidence = {}; let clock = 0, snapshots = 0, admitted = false;
  const result = await observedInitialization({ ...f, evidence, now: () => clock,
    inspect: () => { events.push('inspect'); return f.info; }, snapshot: () => { events.push('snapshot'); return { sequence: ++snapshots }; },
    init: async timeout => { assert.equal(timeout, LIMITS.drainMs + 5000); events.push('init'); clock += 3; return f.init; },
    readProof: () => { events.push('proof'); clock += 4; return { proof: f.proof, failurePresent: false }; } });
  admitted = true;
  assert.equal(admitted, true); assert.equal(result, evidence); assert.equal(result.status, 'PASS');
  assert.deepEqual(events, ['inspect', 'snapshot', 'init', 'proof', 'inspect', 'snapshot']);
  assert.equal(result.wholeInit.elapsedMs, 7); assert.equal(result.wholeInit.before.sequence, 1); assert.equal(result.wholeInit.after.sequence, 2);
  assert.match(result.wholeInit.scope, /not isolated observer cost/);
});
test('missing/failing/late proof or worker initialization failure cannot admit HTTP work', async () => {
  const f = observerFixture();
  for (const mode of ['missing', 'failure', 'late', 'worker']) {
    let clock = 0, admitted = false; const evidence = {};
    await assert.rejects(async () => {
      await observedInitialization({ ...f, evidence, now: () => clock, inspect: () => f.info, snapshot: () => ({}),
        init: async () => { if (mode === 'worker') throw Error('WORKER_FAILED'); return f.init; },
        readProof: () => {
          if (mode === 'missing') throw Error('OBSERVER_MISSING_OR_EXTRA_PROOF');
          if (mode === 'late') clock = LIMITS.drainMs + 5000;
          return { proof: f.proof, failurePresent: mode === 'failure' };
        } });
      admitted = true;
    });
    assert.equal(admitted, false); assert.equal(evidence.status, 'INCOMPLETE'); assert.equal(typeof evidence.failure, 'string');
  }
});
test('paired precheck service admits no extra HTTP, provider access or pending account work', () => {
  const audit = { nativeProviderStarts: 0, deniedNetwork: 0, requests: 0, health: 0, active: 0, activeHandlers: 0,
    handlerStarts: 0, handlerTerminals: 0, handlerFailures: 0, accounts: { queue: { active: 0, pending: 0 } } };
  assert.equal(validatePrecheckServiceAudit(audit), true);
  for (const field of Object.keys(audit).filter(k => k !== 'accounts')) assert.throws(() => validatePrecheckServiceAudit({ ...audit, [field]: 1 }));
  assert.throws(() => validatePrecheckServiceAudit({ ...audit, accounts: { queue: { active: 0, pending: 1 } } }));
});
test('precheck topology is exactly six fresh service lifecycles, both P/C before each timed pair', () => {
  const rows = [0, 1, 2].flatMap(precheckServices);
  assert.equal(rows.length, 6); assert.equal(new Set(rows.map(r => r.runId)).size, 6);
  for (const pair of [0, 1, 2]) assert.deepEqual(rows.filter(r => r.pair === pair).map(r => r.variant), ['P', 'C']);
  assert.ok(rows.every(row => !schedule().some(timed => timed.runId === row.runId)));
  assert.throws(() => precheckServices(3)); assert.throws(() => precheckServices(-1));
});
test('positive precheck safety mismatches remain FAIL; missing evidence remains INCOMPLETE', () => {
  for (const field of ['nativeProviderStarts', 'deniedNetwork']) {
    assert.throws(() => validatePrecheckServiceAudit({ nativeProviderStarts: 0, deniedNetwork: 0, [field]: 1 }), e => safetyCode(e) === 'SAFETY_PROVIDER_ACCESS');
  }
  assert.throws(() => validatePrecheckServiceAudit({}), e => !safetyCode(e));
  const seed = { sha256: 'a'.repeat(64), accounts: [{ id: 'b'.repeat(64), ledgerSha256: 'c'.repeat(64) }] };
  const closed = { ...seed, closed: true }; assert.equal(validatePrecheckClosedSeed(closed, seed), true);
  for (const patch of [{ sha256: 'd'.repeat(64) }, { accounts: [] }, { accounts: [{ ...seed.accounts[0], ledgerSha256: 'd'.repeat(64) }] }])
    assert.throws(() => validatePrecheckClosedSeed({ ...closed, ...patch }, seed), e => safetyCode(e) === 'SAFETY_LEDGER_CHANGED');
  assert.throws(() => validatePrecheckClosedSeed({ ...closed, accounts: undefined }, seed), e => !safetyCode(e));
});
test('actual precheck cgroup proof validates CPU/RAM/swap/cpuset and the exact backing-device disk quota before HTTP', () => {
  const snapshot = role => ({ counters: { 'cpu.max': role === 'service' ? '5000 100000' : '50000 100000', 'cpu.stat': 'usage_usec 0',
    'memory.max': String(LIMITS.memory), 'memory.current': '1000', 'memory.peak': '1000', 'memory.events': 'oom 0', 'memory.swap.max': '0',
    'cpuset.cpus.effective': role === 'service' ? '0' : '1', 'io.max': '8:0 rbps=1048576 wbps=131072', 'io.stat': '8:0 rbytes=0 wbytes=0' } });
  for (const role of ['service', 'authority']) validateKernelResources(snapshot(role), role, '8:0');
  for (const patch of [{ 'cpu.max': 'max 100000' }, { 'memory.max': 'max' }, { 'memory.swap.max': 'max' },
    { 'cpuset.cpus.effective': '0-1' }, { 'io.max': '8:1 rbps=1048576 wbps=131072' }, { 'io.max': '8:0 rbps=max wbps=max' }])
    assert.throws(() => validateKernelResources({ counters: { ...snapshot('service').counters, ...patch } }, 'service', '8:0'));
  assert.throws(() => validateKernelResources({ counters: {} }, 'service', '8:0'));
});
test('actual AssertionError message does not provide a safety code; positive contract mismatches now use explicit FAIL codes', () => {
  let oldError;
  try { assert.equal('FAIL', 'PASS', 'SAFETY_CONTRACT_MISMATCH'); } catch (error) { oldError = error; }
  assert.ok(oldError instanceof assert.AssertionError); assert.equal(oldError.code, 'ERR_ASSERTION');
  assert.equal(safetyCode(oldError), null); assert.equal(failureVerdict(oldError).status, 'INCOMPLETE');
  const fail = fn => assert.throws(fn, error => safetyCode(error) === 'SAFETY_CONTRACT_MISMATCH'
    && error.code === 'SAFETY_CONTRACT_MISMATCH' && failureVerdict(error).status === 'FAIL');
  assert.equal(validateFunctionalContract({ status: 'PASS', authorityRequests: 52 }), true);
  fail(() => validateFunctionalContract({ status: 'FAIL', authorityRequests: 52 }));
  fail(() => validateFunctionalContract({ status: 'FAIL' }));
  fail(() => validateFunctionalContract({ status: 'PASS', authorityRequests: 51 }));
  fail(() => validateFunctionalContract({ status: 'PASS', authorityRequests: 53 }));
  const terminal = { outcome: 'HTTP', status: 401, code: 'AUTH_REQUIRED' }, expected = { status: 401, code: 'AUTH_REQUIRED' };
  assert.equal(validateGatewayContract(terminal, expected), true);
  fail(() => validateGatewayContract({ ...terminal, status: 200 }, expected));
  fail(() => validateGatewayContract({ outcome: 'HTTP', status: 200 }, expected));
  fail(() => validateGatewayContract({ ...terminal, code: 'WRONG_CODE' }, expected));
  fail(() => validateGatewayContract({ ...terminal, code: null }, expected));
  fail(() => validateGatewayContract(terminal, { ...expected, proxyOnly: true }, { beforeAuthorityRequests: 0, afterAuthorityRequests: 1 }));
});
test('missing, malformed or transport safety evidence remains INCOMPLETE and cannot falsely pass', () => {
  const incomplete = fn => assert.throws(fn, error => !safetyCode(error) && failureVerdict(error).status === 'INCOMPLETE');
  for (const result of [undefined, {}, { status: 'INCOMPLETE', authorityRequests: 52 }, { status: 'PASS' },
    { status: 'PASS', authorityRequests: '52' }, { status: 'PASS', authorityRequests: -1 }]) incomplete(() => validateFunctionalContract(result));
  const expected = { status: 401, code: 'AUTH_REQUIRED' }, terminal = { outcome: 'HTTP', status: 401, code: 'AUTH_REQUIRED' };
  for (const value of [undefined, {}, { ...terminal, outcome: 'TRANSPORT_ERROR' }, { ...terminal, outcome: 'DEADLINE' },
    { ...terminal, status: null }, { ...terminal, status: '401' }, { ...terminal, code: undefined }, { ...terminal, code: {} }])
    incomplete(() => validateGatewayContract(value, expected));
  incomplete(() => validateGatewayContract(terminal, { ...expected, proxyOnly: true }, { beforeAuthorityRequests: 0 }));
});
