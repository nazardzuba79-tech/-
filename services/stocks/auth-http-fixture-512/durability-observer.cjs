'use strict';
// QA-only preload. No database is opened by this module. The launcher must bind
// these exact bytes and fixed --require command in its reviewed closure, then
// create a new private binding/proof directory
// for every service instance (both P/C, including every restart); require one
// matching PASS proof and no failure file before readiness/timed requests. The
// unchanged, source-hashed worker opens one connection. After restoring native
// exec we intentionally do not instrument later database activity. A second
// worker in the same instance fails the exclusive proof-directory guard.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const OBSERVER = '/source/services/stocks/auth-http-fixture-512/durability-observer.cjs';
const SERVICE = '/source/services/stocks/auth-http-fixture-512/stock-child.mjs';
const WORKER = '/source/services/stocks-global/account-worker-runtime.mjs';
const DIRECTORY = '/private-observation';
const BINDING = DIRECTORY + '/binding.json';
const PROOF = DIRECTORY + '/worker-connection.json';
const FAILURE = DIRECTORY + '/worker-connection-failure.json';
const LEDGER = '/data/accounts.sqlite';
const EXECUTABLE = '/usr/local/bin/node';
const PLAN_ID = 'stocks-auth-http-fixture-512-v2';
const CONFIG_SQL = 'PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;';
const LIMITS = Object.freeze({ proofBytes: 8192, bindingBytes: 8192, sourceBytes: 1024 * 1024, seedBytes: 16 * 1024 * 1024 });
const RUNTIME = Object.freeze({ accounts: '/source/services/stocks-global/accounts.mjs',
  accountWorker: '/source/services/stocks-global/account-worker.mjs', accountWorkerRuntime: WORKER });
const SHA = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(code) { const error = Error(code); error.code = code; throw error; }
function requireCondition(condition, code) { if (!condition) fail(code); }
function exactKeys(value, expected, code) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), code);
  requireCondition(Object.keys(value).sort().join('\0') === [...expected].sort().join('\0'), code);
}
function validDescriptor(d) { return d && typeof d.value === 'function' && d.get === undefined && d.set === undefined && d.writable === true && d.configurable === true; }
function sameDescriptor(a, b) {
  return a && b && ['value', 'writable', 'enumerable', 'configurable', 'get', 'set'].every(k => a[k] === b[k]);
}
function isExplicitPreload(execArgv, filename) {
  return Array.isArray(execArgv) && execArgv.some((arg, index) => arg === '--require' && execArgv[index + 1] === filename);
}

function validateBinding(value) {
  exactKeys(value, ['schema', 'planId', 'runId', 'caseId', 'variant', 'serviceContainerId', 'runtimeImageId', 'sourceSha',
    'contextSha256', 'seedSha256', 'observerSha256', 'runtimeSha256', 'ledgerPath'], 'OBSERVER_BINDING_INVALID');
  requireCondition(value.schema === 1 && value.planId === PLAN_ID, 'OBSERVER_BINDING_INVALID');
  requireCondition(/^auth-http512-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.runId), 'OBSERVER_BINDING_INVALID');
  requireCondition(/^pair[1-3]-[PC]$/.test(value.caseId) && ['P', 'C'].includes(value.variant) && value.caseId.endsWith('-' + value.variant), 'OBSERVER_BINDING_INVALID');
  requireCondition(SHA.test(value.serviceContainerId) && /^sha256:[a-f0-9]{64}$/.test(value.runtimeImageId), 'OBSERVER_BINDING_INVALID');
  requireCondition(/^[a-f0-9]{40}$/.test(value.sourceSha) && value.ledgerPath === LEDGER, 'OBSERVER_BINDING_INVALID');
  for (const key of ['contextSha256', 'seedSha256', 'observerSha256']) requireCondition(SHA.test(value[key]), 'OBSERVER_BINDING_INVALID');
  exactKeys(value.runtimeSha256, Object.keys(RUNTIME), 'OBSERVER_BINDING_INVALID');
  for (const valueHash of Object.values(value.runtimeSha256)) requireCondition(SHA.test(valueHash), 'OBSERVER_BINDING_INVALID');
  return value;
}

function validateInvocation({ platform, version, arch, uid, gid, execPath, execArgv, argv, env, isMainThread, threadId, workerData, filename }, phase = 'preload') {
  requireCondition(phase === 'preload' || (phase === 'configuration' && isMainThread === false), 'OBSERVER_PHASE_INVALID');
  requireCondition(platform === 'linux' && version === 'v24.21.0' && arch === 'x64' && uid > 0 && uid === gid, 'OBSERVER_INVOCATION_INVALID');
  requireCondition(filename === OBSERVER && JSON.stringify(execArgv) === JSON.stringify(['--require', OBSERVER]), 'OBSERVER_PRELOAD_INVALID');
  // Node 24 assigns a file worker's argv[1] only AFTER --require preloads.
  // Admit exactly the bootstrap shape here; require the exact worker entrypoint
  // again at the intercepted configuration call, before any native exec.
  const expectedArgv = isMainThread ? [EXECUTABLE, SERVICE] : phase === 'preload' ? [EXECUTABLE] : [EXECUTABLE, WORKER];
  requireCondition(execPath === EXECUTABLE && JSON.stringify(argv) === JSON.stringify(expectedArgv), 'OBSERVER_ROLE_INVALID');
  const allowedEnvironment = ['PATH', 'NODE_VERSION', 'YARN_VERSION', 'HOME', 'HOSTNAME', 'AUTH_HTTP_FIXTURE_512'];
  requireCondition(Object.keys(env).every(k => allowedEnvironment.includes(k)), 'OBSERVER_ENVIRONMENT_INVALID');
  requireCondition(env.AUTH_HTTP_FIXTURE_512 === 'true' && env.NODE_VERSION === '24.21.0'
    && env.PATH === '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    && (env.YARN_VERSION === undefined || env.YARN_VERSION === '1.22.22'), 'OBSERVER_ENVIRONMENT_INVALID');
  if (isMainThread) requireCondition(threadId === 0 && workerData === null, 'OBSERVER_THREAD_INVALID');
  else {
    requireCondition(Number.isSafeInteger(threadId) && threadId > 0, 'OBSERVER_THREAD_INVALID');
    exactKeys(workerData, ['path', 'diagnostics', 'clock', 'testControl', 'registrationControl'], 'OBSERVER_WORKER_INVALID');
    requireCondition(workerData.path === LEDGER && workerData.diagnostics === true && workerData.clock === undefined
      && workerData.testControl === undefined && workerData.registrationControl === undefined, 'OBSERVER_WORKER_INVALID');
  }
  return true;
}

// This pure seam accepts a fake constructor in guards. It never constructs a
// database or changes SQL. The original native exec is called exactly once with
// the original receiver/arguments; its return value or exception is preserved.
function installObserver({ DatabaseSync, record, beforeConfiguration = () => {}, onFailure = () => {}, clock = () => process.hrtime.bigint() }) {
  requireCondition(typeof DatabaseSync === 'function' && typeof record === 'function' && typeof beforeConfiguration === 'function'
    && typeof onFailure === 'function', 'OBSERVER_ARGUMENT_INVALID');
  const proto = DatabaseSync.prototype, original = Object.getOwnPropertyDescriptor(proto, 'exec');
  const prepare = Object.getOwnPropertyDescriptor(proto, 'prepare');
  requireCondition(validDescriptor(original) && validDescriptor(prepare), 'OBSERVER_DESCRIPTOR_UNSUPPORTED');
  const setupStarted = clock(); let attempts = 0, observed = false, restored = false;
  const restore = () => {
    Object.defineProperty(proto, 'exec', original);
    restored = sameDescriptor(Object.getOwnPropertyDescriptor(proto, 'exec'), original);
    requireCondition(restored, 'OBSERVER_RESTORE_FAILED');
  };
  const wrapper = function(...args) {
    try {
    attempts++; requireCondition(attempts === 1, 'OBSERVER_MULTIPLE_CONFIGURATION');
    if (args.length !== 1 || args[0] !== CONFIG_SQL) { restore(); fail('OBSERVER_SQL_UNEXPECTED'); }
    beforeConfiguration();
    let nativeResult, nativeFinished;
    const nativeStarted = clock();
    try { nativeResult = Reflect.apply(original.value, this, args); nativeFinished = clock(); }
    finally { restore(); }
    // Read only the same connection. Do not reopen a DB, use PRAGMA assignments,
    // change transaction state, or write to the ledger for the observation.
    const read = sql => {
      const statement = Reflect.apply(prepare.value, this, [sql]);
      requireCondition(statement && typeof statement.get === 'function', 'OBSERVER_STATEMENT_INVALID');
      return statement.get();
    };
    const sync = read('PRAGMA synchronous'), journal = read('PRAGMA journal_mode');
    exactKeys(sync, ['synchronous'], 'OBSERVER_PRAGMA_MISMATCH'); exactKeys(journal, ['journal_mode'], 'OBSERVER_PRAGMA_MISMATCH');
    requireCondition(sync.synchronous === 2 && journal.journal_mode === 'delete', 'OBSERVER_PRAGMA_MISMATCH');
    requireCondition(sameDescriptor(Object.getOwnPropertyDescriptor(proto, 'exec'), original), 'OBSERVER_RESTORE_FAILED');
    const finishedBeforeProofWrite = clock();
    const observation = { synchronous: 2, journalMode: 'delete', nativeConfigurationCalls: 1, readOnlyPragmas: 2,
      descriptorRestored: true, configurationSqlSha256: hash(CONFIG_SQL), setupStartedMonoNs: String(setupStarted),
      nativeConfigurationDurationNs: String(nativeFinished - nativeStarted),
      restoreAndReadObservationDurationNs: String(finishedBeforeProofWrite - nativeFinished),
      finishedBeforeProofWriteMonoNs: String(finishedBeforeProofWrite),
      timingScope: 'worker startup only; native configuration separated from restore/read observation; excludes proof write and is outside timed request windows' };
    record(observation); observed = true; return nativeResult;
    } catch (error) {
      observed = false;
      restore();
      // A diagnostic write failure must not replace a native configuration error.
      // No successful observation exists in that case; readiness requires proof.
      try { onFailure(error); } catch { /* original error remains the failure */ }
      throw error;
    }
  };
  Object.defineProperty(proto, 'exec', { ...original, value: wrapper });
  requireCondition(Object.getOwnPropertyDescriptor(proto, 'exec').value === wrapper, 'OBSERVER_INSTALL_FAILED');
  return {
    assertComplete() { requireCondition(attempts === 1 && observed && restored && sameDescriptor(Object.getOwnPropertyDescriptor(proto, 'exec'), original), 'OBSERVER_CONFIGURATION_NOT_OBSERVED'); },
    restoreAfterFailure() { restore(); },
  };
}

function ownedDirectory(directory, uid, gid, io = fs) {
  const st = io.lstatSync(directory);
  requireCondition(st.isDirectory() && !st.isSymbolicLink() && io.realpathSync(directory) === directory
    && st.uid === uid && st.gid === gid && (st.mode & 0o777) === 0o700, 'OBSERVER_PRIVATE_DIRECTORY_INVALID');
}
function boundedFile(file, maximum, { uid, gid, privateFile = false } = {}, io = fs) {
  const st = io.lstatSync(file);
  requireCondition(st.isFile() && !st.isSymbolicLink() && io.realpathSync(file) === file && st.size <= maximum, 'OBSERVER_FILE_INVALID');
  if (privateFile) requireCondition(st.uid === uid && st.gid === gid && (st.mode & 0o777) === 0o600, 'OBSERVER_PRIVATE_FILE_INVALID');
  const bytes = io.readFileSync(file);
  requireCondition(bytes.length === st.size && bytes.length <= maximum, 'OBSERVER_FILE_CHANGED');
  return { bytes, identity: { bytes: st.size, inode: st.ino, device: st.dev } };
}
function writeExclusive(file, value, io = fs) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  requireCondition(bytes.length <= LIMITS.proofBytes, 'OBSERVER_PROOF_BOUND');
  requireCondition(!io.existsSync(file), 'OBSERVER_MULTIPLE_OBSERVATION');
  const fd = io.openSync(file, 'wx', 0o600);
  try { io.writeFileSync(fd, bytes); io.fsyncSync(fd); }
  finally { io.closeSync(fd); }
}

function safeFailure(error, fallback = 'OBSERVER_SETUP_FAILED') {
  // Never serialize messages, stacks, environment, argv, tokens or arbitrary
  // error properties into the retained diagnostic proof.
  const observerCodes = ['ARGUMENT_INVALID', 'BINDING_CHANGED', 'BINDING_INVALID', 'CONFIGURATION_NOT_OBSERVED', 'CONTAINER_BINDING_INVALID',
    'DESCRIPTOR_UNSUPPORTED', 'ENVIRONMENT_INVALID', 'FILE_CHANGED', 'FILE_INVALID', 'INSTALL_FAILED', 'INVOCATION_INVALID',
    'MULTIPLE_CONFIGURATION', 'MULTIPLE_OBSERVATION', 'NATIVE_FAILURE', 'PHASE_INVALID', 'PRAGMA_MISMATCH', 'PRELOAD_INVALID',
    'PRIVATE_DIRECTORY_INVALID', 'PRIVATE_FILE_INVALID', 'PROOF_BOUND', 'REQUIRE_ONLY', 'RESTORE_FAILED', 'ROLE_INVALID',
    'RUNTIME_CHANGED', 'SEED_CHANGED', 'SETUP_FAILED', 'SOURCE_CHANGED', 'SQL_UNEXPECTED', 'STATEMENT_INVALID', 'THREAD_INVALID', 'WORKER_INVALID']
    .map(code => 'OBSERVER_' + code);
  const nativeCodes = ['ERR_SQLITE_ERROR', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_INVALID_STATE', 'ERR_OUT_OF_RANGE',
    'SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_READONLY', 'SQLITE_IOERR', 'SQLITE_FULL', 'SQLITE_CORRUPT', 'SQLITE_CANTOPEN', 'SQLITE_NOMEM', 'SQLITE_NOTADB',
    'ENOENT', 'EACCES', 'EPERM', 'EEXIST', 'EMFILE', 'ENFILE', 'ENOSPC', 'EIO'];
  requireCondition(['OBSERVER_SETUP_FAILED', 'OBSERVER_NATIVE_FAILURE', 'OBSERVER_CONFIGURATION_NOT_OBSERVED'].includes(fallback), 'OBSERVER_ARGUMENT_INVALID');
  const code = observerCodes.includes(error?.code) ? error.code : fallback;
  const result = { schema: 1, status: 'FAIL', code,
    errorName: ['Error', 'TypeError', 'RangeError', 'AssertionError', 'SyntaxError'].includes(error?.name) ? error.name : 'Error',
    nativeCode: nativeCodes.includes(error?.code) ? error.code : null };
  if (Number.isSafeInteger(error?.errcode) && error.errcode >= 0 && error.errcode <= 65535) result.nativeErrcode = error.errcode;
  return result;
}

function bootstrap() {
  const threads = require('node:worker_threads');
  const invocation = () => ({ platform: process.platform, version: process.version, arch: process.arch, uid: process.getuid?.(), gid: process.getgid?.(),
    execPath: process.execPath, execArgv: process.execArgv, argv: process.argv, env: process.env, isMainThread: threads.isMainThread, threadId: threads.threadId,
    workerData: threads.workerData, filename: __filename });
  // The service main thread must not load SQLite or modify its prototype.
  if (threads.isMainThread) { validateInvocation(invocation()); return; }
  const startedMonoNs = process.hrtime.bigint(), uid = process.getuid(), gid = process.getgid();
  let privateDirectoryVerified = false, observer;
  try {
    ownedDirectory(DIRECTORY, uid, gid); privateDirectoryVerified = true;
    validateInvocation(invocation());
    requireCondition(JSON.stringify(fs.readdirSync(DIRECTORY).sort()) === JSON.stringify(['binding.json']), 'OBSERVER_MULTIPLE_OBSERVATION');
    const bindingFile = boundedFile(BINDING, LIMITS.bindingBytes, { uid, gid, privateFile: true });
    const binding = validateBinding(JSON.parse(bindingFile.bytes));
    requireCondition(process.env.HOSTNAME === binding.serviceContainerId.slice(0, 12), 'OBSERVER_CONTAINER_BINDING_INVALID');
    requireCondition(hash(boundedFile(OBSERVER, LIMITS.sourceBytes).bytes) === binding.observerSha256, 'OBSERVER_SOURCE_CHANGED');
    for (const [name, file] of Object.entries(RUNTIME)) requireCondition(hash(boundedFile(file, LIMITS.sourceBytes).bytes) === binding.runtimeSha256[name], 'OBSERVER_RUNTIME_CHANGED');
    ownedDirectory(path.dirname(LEDGER), uid, gid);
    const seed = boundedFile(LEDGER, LIMITS.seedBytes, { uid, gid, privateFile: true });
    requireCondition(hash(seed.bytes) === binding.seedSha256 && !fs.existsSync(LEDGER + '-journal'), 'OBSERVER_SEED_CHANGED');
    // Requiring the API does not open a connection; unchanged account-worker-runtime
    // constructs it after this preload returns.
    const { DatabaseSync } = require('node:sqlite');
    const missing = () => {
      try { observer.assertComplete(); }
      catch (error) { observer.restoreAfterFailure(); writeExclusive(FAILURE, safeFailure(error, 'OBSERVER_CONFIGURATION_NOT_OBSERVED')); throw error; }
    };
    observer = installObserver({ DatabaseSync, beforeConfiguration: () => {
      validateInvocation(invocation(), 'configuration');
      validateBinding(binding);
      requireCondition(process.env.HOSTNAME === binding.serviceContainerId.slice(0, 12), 'OBSERVER_CONTAINER_BINDING_INVALID');
      requireCondition(hash(boundedFile(BINDING, LIMITS.bindingBytes, { uid, gid, privateFile: true }).bytes) === hash(bindingFile.bytes), 'OBSERVER_BINDING_CHANGED');
      requireCondition(hash(boundedFile(OBSERVER, LIMITS.sourceBytes).bytes) === binding.observerSha256, 'OBSERVER_SOURCE_CHANGED');
      for (const [name, file] of Object.entries(RUNTIME)) requireCondition(hash(boundedFile(file, LIMITS.sourceBytes).bytes) === binding.runtimeSha256[name], 'OBSERVER_RUNTIME_CHANGED');
    }, record: observation => {
      writeExclusive(PROOF, { schema: 1, status: 'PASS', scope: 'actual account worker connection; startup only',
        bindingSha256: hash(bindingFile.bytes), ...binding, pid: process.pid, threadId: threads.threadId, node: process.version,
        seedIdentityBeforeOpen: seed.identity, preloadStartedMonoNs: String(startedMonoNs), ...observation,
        proofWrite: 'exclusive owned0600 file and fsync; write duration not measured here; future launcher must measure whole init wall/cgroup deltas before init through required proof' });
      process.removeListener('beforeExit', missing);
    }, onFailure: error => {
      process.removeListener('beforeExit', missing);
      if (!fs.existsSync(FAILURE)) writeExclusive(FAILURE, safeFailure(error, 'OBSERVER_NATIVE_FAILURE'));
    } });
    // This listener has no timer or active handle. It is a final missing-proof
    // guard, not readiness admission: stock init must require the proof before
    // opening its timed request gate. No message is added to parentPort/stdout.
    process.once('beforeExit', missing);
  } catch (error) {
    observer?.restoreAfterFailure();
    if (privateDirectoryVerified && !fs.existsSync(FAILURE)) {
      try { writeExclusive(FAILURE, safeFailure(error)); } catch { /* retain the original setup error */ }
    }
    throw error;
  }
}

module.exports = { validateBinding, validateInvocation, installObserver, sameDescriptor, isExplicitPreload, ownedDirectory, boundedFile, writeExclusive, safeFailure,
  CONFIG_SQL, OBSERVER, SERVICE, WORKER, DIRECTORY, PROOF, FAILURE, LEDGER, EXECUTABLE, PLAN_ID, LIMITS, RUNTIME, hash };
// Normal imports (including pure tests) have no SQLite/filesystem side effects.
// Only an explicit --require pair can activate this module. NODE_OPTIONS and
// alternate flag spellings cannot supply it; no private Node module id is used.
if (require.main === module) fail('OBSERVER_REQUIRE_ONLY');
if (isExplicitPreload(process.execArgv, __filename)) bootstrap();
