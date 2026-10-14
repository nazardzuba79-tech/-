// Pure contract guards only: no HTTP server, Docker, SQLite connection or workload launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import authorityEntry from './authority-entry.cjs';
import { SUBJECTS, ISSUER, COUNTS, LIMITS, SEED, SAFETY, schedule, ordinaryWaves, sha256,
  validateResources, nearestRank, latencySummary, verifyUniqueTerminals, classifyRun, cancellationCoverage,
  terminalTiming, reconcileAuthority, validateRpcEnvelope, validateFreeze, assertSafety, safetyCode, failureVerdict } from './plan.mjs';
import { validateSeedState, validateSeedAccounts, validateInit, trackedHandler } from './stock-child.mjs';
import { validateRequest, validatePublicState, readCgroup } from './probe.mjs';
import { authorityInitArgs, validateContainerInspect, validateCgroupPath, boundedRpcLines, safeRpcFailure } from './run.mjs';

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
const inspected = role => ({ Image: 'sha256:fixture', Config: { User: '10001:10001', Entrypoint: ['node'],
  Cmd: ['services/stocks/auth-http-fixture-512/' + (role === 'service' ? 'stock-child.mjs' : role === 'authority' ? 'authority-entry.cjs' : 'probe.mjs'), ...(role === 'authority' ? ['--stdio'] : [])], Labels: {
  'voltex.auth-http.run': 'fixture', 'voltex.auth-http.role': role }, Env: role === 'authority' ? ['JWT_SECRET=stocks-auth-http-disposable-fixture-secret'] : [] },
  HostConfig: { ReadonlyRootfs: true, CapDrop: ['ALL'], CapAdd: [], SecurityOpt: ['no-new-privileges'], Privileged: false, PidMode: '', IpcMode: 'private',
    NetworkMode: role === 'service' ? 'none' : 'container:service', PortBindings: {}, PublishAllPorts: false, Memory: LIMITS.memory, MemorySwap: LIMITS.memory,
    NanoCpus: role === 'service' ? 50000000 : 500000000, CpusetCpus: role === 'service' ? '0' : '1', Devices: [] }, Mounts: [] });
const checked = (role, info) => { info ??= inspected(role);
  return validateContainerInspect(info, { runId: 'fixture', image: 'sha256:fixture', role, serviceId: 'service', uid: 10001, binds: [] }); };
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
