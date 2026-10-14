'use strict';
// Fake DatabaseSync/proof guards plus one real Node worker bootstrap regression.
// The latter runs only tiny temporary scripts: no SQLite, seed, application
// worker, HTTP, Docker or workload.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const observer = require('./durability-observer.cjs');
const { installObserver, validateBinding, validateInvocation, sameDescriptor, ownedDirectory, boundedFile, writeExclusive,
  CONFIG_SQL, OBSERVER, SERVICE, WORKER, DIRECTORY, PROOF, LEDGER, EXECUTABLE, PLAN_ID, LIMITS } = observer;
const fails = (fn, code) => assert.throws(fn, error => error.code === code);

function fakeDatabase({ sync = 2, journal = 'delete', nativeError, readError, recordError, beforeConfiguration } = {}) {
  const calls = [], records = [], failures = [], nativeResult = Object.freeze({ native: true });
  class FakeDatabase {
    constructor() { throw Error('A pure guard must never open a database'); }
    exec(...args) { calls.push({ kind: 'exec', receiver: this, args }); if (nativeError) throw nativeError; return nativeResult; }
    prepare(sql) {
      assert.ok(sameDescriptor(Object.getOwnPropertyDescriptor(FakeDatabase.prototype, 'exec'), descriptor));
      calls.push({ kind: 'prepare', receiver: this, sql }); if (readError) throw readError;
      const row = sql === 'PRAGMA synchronous' ? { synchronous: sync } : { journal_mode: journal };
      return { get() { calls.push({ kind: 'get', sql }); return row; } };
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(FakeDatabase.prototype, 'exec');
  const receiver = Object.create(FakeDatabase.prototype);
  let time = 100n;
  const installed = installObserver({ DatabaseSync: FakeDatabase, clock: () => time++, beforeConfiguration,
    record(value) {
      assert.ok(sameDescriptor(Object.getOwnPropertyDescriptor(FakeDatabase.prototype, 'exec'), descriptor));
      if (recordError) throw recordError;
      records.push(value);
    }, onFailure: error => failures.push(error) });
  return { FakeDatabase, receiver, descriptor, calls, records, failures, installed, nativeResult,
    assertRestored: () => assert.ok(sameDescriptor(Object.getOwnPropertyDescriptor(FakeDatabase.prototype, 'exec'), descriptor)) };
}

function binding(variant = 'P') {
  return { schema: 1, planId: PLAN_ID, runId: 'auth-http512-01234567-0123-0123-0123-0123456789ab', caseId: `pair1-${variant}`, variant,
    serviceContainerId: 'a'.repeat(64), runtimeImageId: 'sha256:' + 'b'.repeat(64), sourceSha: 'c'.repeat(40),
    contextSha256: 'd'.repeat(64), seedSha256: 'e'.repeat(64), observerSha256: 'f'.repeat(64),
    runtimeSha256: { accounts: '1'.repeat(64), accountWorker: '2'.repeat(64), accountWorkerRuntime: '3'.repeat(64) }, ledgerPath: LEDGER };
}

function invocation(main = false) {
  return { platform: 'linux', version: 'v24.21.0', arch: 'x64', uid: 10001, gid: 10001, execPath: EXECUTABLE,
    execArgv: ['--require', OBSERVER], argv: main ? [EXECUTABLE, SERVICE] : [EXECUTABLE],
    env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', NODE_VERSION: '24.21.0', AUTH_HTTP_FIXTURE_512: 'true' },
    filename: OBSERVER, isMainThread: main, threadId: main ? 0 : 1,
    workerData: main ? null : { path: LEDGER, diagnostics: true, clock: undefined, testControl: undefined, registrationControl: undefined } };
}

test('native configuration executes once on the same receiver and returns the original result; descriptor restored before reads/proof', () => {
  const f = fakeDatabase();
  assert.equal(f.receiver.exec(CONFIG_SQL), f.nativeResult);
  f.installed.assertComplete(); f.assertRestored();
  assert.deepEqual(f.calls.filter(c => c.kind === 'exec'), [{ kind: 'exec', receiver: f.receiver, args: [CONFIG_SQL] }]);
  assert.deepEqual(f.calls.filter(c => c.kind === 'prepare'), [
    { kind: 'prepare', receiver: f.receiver, sql: 'PRAGMA synchronous' },
    { kind: 'prepare', receiver: f.receiver, sql: 'PRAGMA journal_mode' }]);
  assert.equal(f.records.length, 1); assert.equal(f.failures.length, 0);
  assert.equal(f.records[0].synchronous, 2); assert.equal(f.records[0].journalMode, 'delete');
  assert.equal(f.records[0].descriptorRestored, true); assert.equal(f.records[0].readOnlyPragmas, 2);
  assert.equal(f.records[0].setupStartedMonoNs, '100'); assert.equal(f.records[0].finishedBeforeProofWriteMonoNs, '103');
  assert.equal(f.records[0].nativeConfigurationDurationNs, '1'); assert.equal(f.records[0].restoreAndReadObservationDurationNs, '1');
  assert.match(f.records[0].timingScope, /outside timed request windows/);
});

test('native error identity and original descriptor are preserved without extra reads or execution', () => {
  const nativeError = Object.assign(Error('test native failure'), { code: 'SQLITE_BUSY' }), f = fakeDatabase({ nativeError });
  assert.throws(() => f.receiver.exec(CONFIG_SQL), error => error === nativeError);
  f.assertRestored(); assert.equal(f.calls.length, 1); assert.equal(f.records.length, 0); assert.deepEqual(f.failures, [nativeError]);
  fails(() => f.installed.assertComplete(), 'OBSERVER_CONFIGURATION_NOT_OBSERVED');
});

test('unexpected SQL and argument count fail before invoking native code and restore the descriptor', () => {
  for (const args of [['PRAGMA synchronous=NORMAL'], [CONFIG_SQL + ' '], [CONFIG_SQL, 'extra'], []]) {
    const f = fakeDatabase(); fails(() => f.receiver.exec(...args), 'OBSERVER_SQL_UNEXPECTED');
    f.assertRestored(); assert.equal(f.calls.length, 0); assert.equal(f.records.length, 0);
  }
});

test('wrong FULL or DELETE values and read exceptions fail closed after restoring instrumentation', () => {
  for (const values of [{ sync: 1 }, { sync: '2' }, { journal: 'wal' }, { journal: 'DELETE' }]) {
    const f = fakeDatabase(values); fails(() => f.receiver.exec(CONFIG_SQL), 'OBSERVER_PRAGMA_MISMATCH');
    f.assertRestored(); assert.equal(f.calls.filter(c => c.kind === 'exec').length, 1); assert.equal(f.records.length, 0);
  }
  const error = Error('read guard failure'), f = fakeDatabase({ readError: error });
  assert.throws(() => f.receiver.exec(CONFIG_SQL), e => e === error); f.assertRestored();
});

test('missing and a second invocation of the captured wrapper are rejected, with no second native execution', () => {
  const missing = fakeDatabase(); fails(() => missing.installed.assertComplete(), 'OBSERVER_CONFIGURATION_NOT_OBSERVED');
  missing.installed.restoreAfterFailure(); missing.assertRestored();
  const f = fakeDatabase(), captured = f.receiver.exec;
  captured.call(f.receiver, CONFIG_SQL); fails(() => captured.call(f.receiver, CONFIG_SQL), 'OBSERVER_MULTIPLE_CONFIGURATION');
  f.assertRestored(); assert.equal(f.calls.filter(c => c.kind === 'exec').length, 1); assert.equal(f.records.length, 1);
  fails(() => f.installed.assertComplete(), 'OBSERVER_CONFIGURATION_NOT_OBSERVED');
});

test('a failed proof write cannot produce a completed observation', () => {
  const error = Error('exclusive proof write failed'), f = fakeDatabase({ recordError: error });
  assert.throws(() => f.receiver.exec(CONFIG_SQL), e => e === error); f.assertRestored();
  fails(() => f.installed.assertComplete(), 'OBSERVER_CONFIGURATION_NOT_OBSERVED');
});

test('unsupported native descriptors are rejected without changing them', () => {
  for (const attribute of ['writable', 'configurable']) {
    class Fake { exec() {} prepare() {} }
    Object.defineProperty(Fake.prototype, 'exec', { [attribute]: false });
    const before = Object.getOwnPropertyDescriptor(Fake.prototype, 'exec');
    fails(() => installObserver({ DatabaseSync: Fake, record() {} }), 'OBSERVER_DESCRIPTOR_UNSUPPORTED');
    assert.deepEqual(Object.getOwnPropertyDescriptor(Fake.prototype, 'exec'), before);
  }
});

test('diagnostic callback failure does not replace the original native error', () => {
  const nativeError = Error('original');
  class Fake { exec() { throw nativeError; } prepare() { throw Error('not reached'); } }
  const instance = Object.create(Fake.prototype), before = Object.getOwnPropertyDescriptor(Fake.prototype, 'exec');
  installObserver({ DatabaseSync: Fake, record() {}, onFailure() { throw Error('diagnostic failure'); } });
  assert.throws(() => instance.exec(CONFIG_SQL), e => e === nativeError);
  assert.deepEqual(Object.getOwnPropertyDescriptor(Fake.prototype, 'exec'), before);
});

test('fresh P and C bindings use the same strict contract and reject unknown, missing or mismatched identities', () => {
  for (const variant of ['P', 'C']) assert.equal(validateBinding(binding(variant)).variant, variant);
  for (const patch of [{ extra: true }, { caseId: 'pair4-P' }, { variant: 'C' }, { ledgerPath: '/production.sqlite' },
    { observerSha256: '' }, { runtimeImageId: 'node:latest' }, { sourceSha: 'main' }, { runtimeSha256: { accounts: '1'.repeat(64) } }]) {
    fails(() => validateBinding({ ...binding(), ...patch }), 'OBSERVER_BINDING_INVALID');
  }
  const missing = binding(); delete missing.seedSha256;
  fails(() => validateBinding(missing), 'OBSERVER_BINDING_INVALID');
});

test('fixed main/worker invocation rejects extra preloads, environment injection, roles and frozen clocks', () => {
  assert.equal(validateInvocation(invocation()), true); assert.equal(validateInvocation(invocation(true)), true);
  assert.equal(validateInvocation({ ...invocation(), argv: [EXECUTABLE, WORKER] }, 'configuration'), true);
  fails(() => validateInvocation({ ...invocation(), argv: [EXECUTABLE, WORKER] }), 'OBSERVER_ROLE_INVALID');
  fails(() => validateInvocation(invocation(), 'configuration'), 'OBSERVER_ROLE_INVALID');
  fails(() => validateInvocation(invocation(true), 'configuration'), 'OBSERVER_PHASE_INVALID');
  fails(() => validateInvocation({ ...invocation(true), argv: [EXECUTABLE] }), 'OBSERVER_ROLE_INVALID');
  for (const [patch, code] of [
    [{ execArgv: ['--require', OBSERVER, '--require', '/other.cjs'] }, 'OBSERVER_PRELOAD_INVALID'],
    [{ execArgv: [] }, 'OBSERVER_PRELOAD_INVALID'], [{ filename: '/tmp/observer.cjs' }, 'OBSERVER_PRELOAD_INVALID'],
    [{ execPath: 'node' }, 'OBSERVER_ROLE_INVALID'], [{ argv: [EXECUTABLE, '/other.mjs'] }, 'OBSERVER_ROLE_INVALID'],
    [{ uid: 0, gid: 0 }, 'OBSERVER_INVOCATION_INVALID'], [{ version: 'v22.23.3' }, 'OBSERVER_INVOCATION_INVALID'],
    [{ env: { ...invocation().env, NODE_OPTIONS: '--require=/other.cjs' } }, 'OBSERVER_ENVIRONMENT_INVALID'],
    [{ env: { ...invocation().env, NODE_PATH: '/tmp' } }, 'OBSERVER_ENVIRONMENT_INVALID'],
    [{ env: { ...invocation().env, PATH: '/tmp' } }, 'OBSERVER_ENVIRONMENT_INVALID'],
    [{ env: { ...invocation().env, JWT_SECRET: 'test-only' } }, 'OBSERVER_ENVIRONMENT_INVALID']]) {
    fails(() => validateInvocation({ ...invocation(), ...patch }), code);
  }
  for (const patch of [{ clock: null }, { clock: new ArrayBuffer(8) }, { diagnostics: false }, { testControl: {} }, { registrationControl: {} }]) {
    fails(() => validateInvocation({ ...invocation(), workerData: { ...invocation().workerData, ...patch } }), 'OBSERVER_WORKER_INVALID');
  }
});

test('deferred worker entry validation runs before native exec; rejection restores without any SQLite work', () => {
  const good = fakeDatabase({ beforeConfiguration: () => validateInvocation({ ...invocation(), argv: [EXECUTABLE, WORKER] }, 'configuration') });
  good.receiver.exec(CONFIG_SQL); good.installed.assertComplete(); good.assertRestored();
  assert.equal(good.calls.filter(c => c.kind === 'exec').length, 1);
  for (const patch of [{ argv: [EXECUTABLE] }, { argv: [EXECUTABLE, SERVICE] }, { argv: [EXECUTABLE, WORKER, 'extra'] },
    { workerData: { ...invocation().workerData, path: '/other.sqlite' } }, { env: { ...invocation().env, NODE_OPTIONS: '--require other' } }]) {
    const f = fakeDatabase({ beforeConfiguration: () => validateInvocation({ ...invocation(), argv: [EXECUTABLE, WORKER], ...patch }, 'configuration') });
    assert.throws(() => f.receiver.exec(CONFIG_SQL)); f.assertRestored();
    assert.equal(f.calls.length, 0); assert.equal(f.records.length, 0); assert.equal(f.failures.length, 1);
  }
});

test('real Node file-worker preload precedes argv entry insertion; both observed phases satisfy exact guards', { timeout: 10000 }, async t => {
  assert.equal(process.version, 'v24.21.0', 'bootstrap regression must use the frozen runtime version');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-observer-bootstrap-'));
  const preload = path.join(directory, 'preload.cjs'), entry = path.join(directory, 'entry.mjs');
  let worker;
  try {
    fs.writeFileSync(preload, `const {parentPort,workerData}=require('node:worker_threads'); parentPort.postMessage({phase:'preload',argv:process.argv,execArgv:process.execArgv,workerData});\n`, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(entry, `import {parentPort,workerData} from 'node:worker_threads'; parentPort.postMessage({phase:'entry',argv:process.argv,execArgv:process.execArgv,workerData});\n`, { flag: 'wx', mode: 0o600 });
    const messages = await new Promise((resolve, reject) => {
      const rows = [], timer = setTimeout(() => reject(Error('BOOTSTRAP_REGRESSION_TIMEOUT')), 5000);
      worker = new Worker(pathToFileURL(entry), { execArgv: ['--require', preload], workerData: invocation().workerData });
      worker.on('message', value => { rows.push(value); if (rows.length > 2) { clearTimeout(timer); reject(Error('BOOTSTRAP_MESSAGE_BOUND')); } });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
      worker.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(rows) : reject(Error('BOOTSTRAP_EXIT_' + code)); });
    });
    assert.deepEqual(messages.map(m => m.phase), ['preload', 'entry']);
    assert.deepEqual(messages[0].argv, [process.execPath]);
    assert.deepEqual(messages[1].argv, [process.execPath, entry]);
    for (const message of messages) {
      assert.deepEqual(message.execArgv, ['--require', preload]);
      assert.deepEqual(message.workerData, invocation().workerData);
      const argv = message.argv.map(value => value === process.execPath ? EXECUTABLE : value === entry ? WORKER : value);
      validateInvocation({ ...invocation(), argv, workerData: message.workerData }, message.phase === 'preload' ? 'preload' : 'configuration');
    }
    t.diagnostic(`Observed genuine ${process.version} ${process.platform} worker bootstrap: argv1 preload, argv2 entry; no database/network application code`);
  } finally {
    if (worker) await worker.terminate();
    const actual = fs.realpathSync(directory);
    assert.equal(actual, directory); assert.equal(path.dirname(actual), fs.realpathSync(os.tmpdir()));
    fs.rmSync(actual, { recursive: true });
  }
});

test('failure proof retains only bounded observer/native metadata and no message, stack, token or arbitrary properties', () => {
  const error = Object.assign(Error('private token body'), { code: 'ERR_SQLITE_ERROR', errcode: 5, token: 'private' });
  assert.deepEqual(observer.safeFailure(error, 'OBSERVER_NATIVE_FAILURE'), { schema: 1, status: 'FAIL', code: 'OBSERVER_NATIVE_FAILURE', errorName: 'Error', nativeCode: 'ERR_SQLITE_ERROR', nativeErrcode: 5 });
  const malicious = { code: 'TOKEN_PRIVATE', name: 'private body', message: 'secret', stack: 'secret', errcode: -1 };
  assert.deepEqual(observer.safeFailure(malicious), { schema: 1, status: 'FAIL', code: 'OBSERVER_SETUP_FAILED', errorName: 'Error', nativeCode: null });
});

test('guard is bound to the actual unchanged worker optional clock and exact account configuration SQL', () => {
  const workerSource = fs.readFileSync(path.join(__dirname, '../../stocks-global/account-worker.mjs'), 'utf8');
  const accountsSource = fs.readFileSync(path.join(__dirname, '../../stocks-global/accounts.mjs'), 'utf8');
  assert.ok(workerSource.includes('clock=now===Date.now?null:'));
  assert.ok(workerSource.includes('workerData:{path,diagnostics:!!diagnostics,clock:clock?.buffer,testControl,registrationControl}'));
  const clock = null, testControl = undefined, registrationControl = undefined;
  const actualShape = { path: LEDGER, diagnostics: !!true, clock: clock?.buffer, testControl, registrationControl };
  assert.equal(actualShape.clock, undefined); validateInvocation({ ...invocation(), workerData: actualShape });
  assert.equal(accountsSource.split(CONFIG_SQL).length - 1, 1);
  assert.ok(accountsSource.includes(`()=>db.exec('${CONFIG_SQL}')`));
});

test('private proof is exclusive, bounded, mode0600, flushed and closed without touching a real file', () => {
  const events = [], io = { existsSync: () => false,
    openSync: (...args) => { events.push(['open', ...args]); return 9; },
    writeFileSync: (fd, bytes) => events.push(['write', fd, bytes.length]),
    fsyncSync: fd => events.push(['fsync', fd]), closeSync: fd => events.push(['close', fd]) };
  writeExclusive(PROOF, { status: 'PASS' }, io);
  assert.deepEqual(events[0], ['open', PROOF, 'wx', 0o600]);
  assert.deepEqual(events.slice(-2), [['fsync', 9], ['close', 9]]);
  fails(() => writeExclusive(PROOF, { oversized: 'x'.repeat(LIMITS.proofBytes) }, io), 'OBSERVER_PROOF_BOUND');
  fails(() => writeExclusive(PROOF, {}, { ...io, existsSync: () => true }), 'OBSERVER_MULTIPLE_OBSERVATION');
  assert.equal(events.filter(e => e[0] === 'open').length, 1);
  const error = Error('fsync failure');
  assert.throws(() => writeExclusive(PROOF, {}, { ...io, fsyncSync() { throw error; } }), e => e === error);
  assert.deepEqual(events.at(-1), ['close', 9]);
});

test('private input guards reject links, wrong owner/mode, oversized and changed files using only fake I/O', () => {
  const stat = { isDirectory: () => true, isFile: () => true, isSymbolicLink: () => false, uid: 10001, gid: 10001, mode: 0o700, size: 2, ino: 3, dev: 4 };
  const io = { lstatSync: () => stat, realpathSync: p => p, readFileSync: () => Buffer.from('{}') };
  ownedDirectory(DIRECTORY, 10001, 10001, io);
  for (const patch of [{ uid: 0 }, { mode: 0o755 }, { isSymbolicLink: () => true }])
    fails(() => ownedDirectory(DIRECTORY, 10001, 10001, { ...io, lstatSync: () => ({ ...stat, ...patch }) }), 'OBSERVER_PRIVATE_DIRECTORY_INVALID');
  const privateIo = { ...io, lstatSync: () => ({ ...stat, mode: 0o600 }) };
  assert.equal(boundedFile(LEDGER, 2, { uid: 10001, gid: 10001, privateFile: true }, privateIo).identity.bytes, 2);
  fails(() => boundedFile(LEDGER, 1, {}, privateIo), 'OBSERVER_FILE_INVALID');
  fails(() => boundedFile(LEDGER, 2, { uid: 0, gid: 0, privateFile: true }, privateIo), 'OBSERVER_PRIVATE_FILE_INVALID');
  fails(() => boundedFile(LEDGER, 2, {}, { ...privateIo, readFileSync: () => Buffer.from('xxx') }), 'OBSERVER_FILE_CHANGED');
});

test('ordinary import performs no SQLite, worker, filesystem, child process or network operation', () => {
  const source = fs.readFileSync(path.join(__dirname, 'durability-observer.cjs'), 'utf8'), loaded = [];
  const fakeModule = { exports: {}, parent: { id: 'pure-guard' } };
  const wrapper = vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Buffer, process: { execArgv: [] }, __filename: OBSERVER });
  wrapper(name => {
    loaded.push(name); assert.ok(['node:fs', 'node:path', 'node:crypto'].includes(name), `Unexpected import ${name}`);
    if (name === 'node:fs') return new Proxy({}, { get() { throw Error('Filesystem side effect during ordinary import'); } });
    return require(name);
  }, fakeModule, fakeModule.exports);
  assert.deepEqual(loaded.sort(), ['node:crypto', 'node:fs', 'node:path']);
  assert.equal(typeof fakeModule.exports.installObserver, 'function');
});

test('explicit preload trigger uses the fixed flag pair and the validated service main never loads SQLite or touches files', () => {
  assert.equal(observer.isExplicitPreload(['--require', OBSERVER], OBSERVER), true);
  for (const args of [[], ['--require=' + OBSERVER], ['--import', OBSERVER], ['--require', '/other.cjs']])
    assert.equal(observer.isExplicitPreload(args, OBSERVER), false);
  const source = fs.readFileSync(path.join(__dirname, 'durability-observer.cjs'), 'utf8'), loaded = [];
  const main = invocation(true), fakeModule = { exports: {} };
  const processMock = { ...main, getuid: () => main.uid, getgid: () => main.gid };
  const wrapper = vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Buffer, process: processMock, __filename: OBSERVER });
  wrapper(name => {
    loaded.push(name);
    if (name === 'node:worker_threads') return { isMainThread: true, threadId: 0, workerData: null };
    if (name === 'node:fs') return new Proxy({}, { get() { throw Error('Main preload must not touch files'); } });
    assert.ok(['node:path', 'node:crypto'].includes(name), `Unexpected import ${name}`); return require(name);
  }, fakeModule, fakeModule.exports);
  assert.deepEqual(loaded.sort(), ['node:crypto', 'node:fs', 'node:path', 'node:worker_threads']);
});
