// Private fixture IPC entrypoint. NOT invoked by default; never a production service.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createAuthority, writePrivateCredentials, safeEnvironment } = require('./authority.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function boundary({ sourceRoot, port, bcryptSha256 }) {
  assert.match(bcryptSha256, /^[a-f0-9]{64}$/);
  const native = require('node:module'), net = require('node:net'), cp = require('node:child_process');
  const bcrypt = path.join(sourceRoot, 'node_modules/bcrypt/prebuilds/linux-x64/bcrypt.glibc.node');
  const st = fs.lstatSync(bcrypt);
  assert.ok(st.isFile() && !st.isSymbolicLink() && st.size > 0 && st.size < 4 * 1024 * 1024);
  assert.equal(fs.realpathSync(bcrypt), bcrypt); assert.equal(sha(fs.readFileSync(bcrypt)), bcryptSha256, 'FIXTURE_BCRYPT_HASH_MISMATCH');
  const loads = [], originalNative = native._extensions['.node'];
  native._extensions['.node'] = (module, file) => {
    assert.equal(path.resolve(file), bcrypt, 'FIXTURE_NATIVE_MODULE_DENIED');
    assert.equal(sha(fs.readFileSync(file)), bcryptSha256, 'FIXTURE_BCRYPT_HASH_MISMATCH');
    loads.push({ path: 'node_modules/bcrypt/prebuilds/linux-x64/bcrypt.glibc.node', sha256: bcryptSha256 });
    return originalNative(module, file);
  };
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[method] = () => { throw Error('FIXTURE_CHILD_PROCESS_DENIED'); };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function(...args) {
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const opts = typeof normalized[0] === 'object' ? normalized[0] : { port: normalized[0], host: normalized[1] };
    if (opts.path || (opts.hostname || opts.host) !== '127.0.0.1' || Number(opts.port) !== port) throw Error('FIXTURE_NETWORK_DENIED');
    return connect.apply(this, args);
  };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || Number(url.port) !== port) return Promise.reject(Error('FIXTURE_NETWORK_DENIED'));
    return nativeFetch(input, options);
  };
  return { snapshot: () => ({ allowedLoopbackPort: port, nativeLoads: loads.slice(), networkScope: 'own-loopback-only', childProcessesAllowed: false }) };
}
function assertEnvelope(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), ['args', 'id', 'op']);
  assert.match(value.id, /^[A-Za-z0-9_.:-]{1,96}$/);
  assert.ok(['init', 'prepare', 'window', 'mutate', 'functional', 'audit', 'drain', 'stop'].includes(value.op));
  assert.ok(value.args && typeof value.args === 'object' && !Array.isArray(value.args));
}
function assertInitArgs(args) {
  assert.ok(args && typeof args === 'object' && !Array.isArray(args));
  assert.deepEqual(Object.keys(args).sort(), ['sourceRoot', 'compiledRoot', 'proofFile', 'mode', 'port', 'issuer', 'startedAtMs', 'tokenPath', 'bcryptSha256', 'contextSha256'].sort());
  assert.equal(args.sourceRoot, '/source'); assert.equal(args.compiledRoot, '/source'); assert.equal(args.proofFile, '/source/compiled-proof.json');
  assert.equal(args.tokenPath, '/private-ipc/tokens.json'); assert.ok(['profile', 'compact'].includes(args.mode));
  assert.ok(Number.isInteger(args.port) && args.port >= 1024 && args.port <= 65535);
  assert.match(args.issuer, /^[A-Za-z0-9_.:-]{1,128}$/);
  assert.ok(Number.isSafeInteger(args.startedAtMs) && args.startedAtMs >= 1700000000000 && args.startedAtMs <= 2200000000000);
  assert.match(args.bcryptSha256, /^[a-f0-9]{64}$/); assert.match(args.contextSha256, /^[a-f0-9]{64}$/);
  return args;
}
function safeCommandError(error) {
  const contract = error?.code === 'SAFETY_CONTRACT_MISMATCH' && error.message === 'SAFETY_CONTRACT_MISMATCH';
  const code = contract ? 'SAFETY_CONTRACT_MISMATCH' : /^FIXTURE_[A-Z_]+$/.test(error?.message || '') ? error.message : 'FIXTURE_COMMAND_FAILED';
  const result = { code, name: 'Error' };
  if (contract && /^[a-z0-9-]{1,80}$/.test(error.fixtureContract?.caseName || '')) {
    result.contract = { caseName: error.fixtureContract.caseName };
    for (const key of ['expectedStatus', 'actualStatus']) {
      const value = error.fixtureContract[key]; if (Number.isInteger(value) && value >= 100 && value <= 599) result.contract[key] = value;
    }
  }
  return result;
}
async function drainAuthority(authority, remainingMs, { now = () => performance.now(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  assert.ok(Number.isInteger(remainingMs) && remainingMs > 0 && remainingMs <= 10000, 'FIXTURE_DRAIN_BUDGET_INVALID');
  const began = now(), end = began + remainingMs;
  while (true) {
    assert.ok(now() < end, 'FIXTURE_DRAIN_TIMEOUT'); const snapshot = authority.snapshot(), observed = now();
    assert.ok(observed < end, 'FIXTURE_DRAIN_TIMEOUT');
    if (snapshot.active === 0 && snapshot.settlement.pending.handlers === 0 && snapshot.settlement.pending.operations === 0)
      return { quiescent: true, elapsedMs: observed - began, snapshot };
    await pause(Math.min(25, Math.max(1, Math.ceil(end - now()))));
  }
}
async function main() {
  safeEnvironment(); assert.deepEqual(process.argv.slice(2), ['--stdio'], 'FIXTURE_STDIO_INVOCATION_REQUIRED');
  let authority, importedBoundary, stopping = false, commands = 0, buffer = '', busy = false;
  const seen = new Set(), queue = [];
  const output = value => {
    const line = JSON.stringify(value);
    assert.ok(Buffer.byteLength(line) <= 256 * 1024, 'FIXTURE_IPC_OUTPUT_BOUND');
    process.stdout.write(line + '\n');
  };
  const ownKeys = (args, keys) => assert.deepEqual(Object.keys(args).sort(), [...keys].sort(), 'FIXTURE_IPC_ARGUMENTS_INVALID');
  async function dispatch({ op, args }) {
    if (op === 'init') {
      assert.ok(!authority, 'FIXTURE_ALREADY_INITIALIZED');
      assertInitArgs(args);
      const { verifyImageClosure } = await import('./plan.mjs');
      const imageClosure = verifyImageClosure(args.contextSha256);
      importedBoundary = boundary(args);
      authority = await createAuthority({ ...args, eventSink: value => output({ type: 'event', value }) });
      const privateFile = writePrivateCredentials(args.tokenPath, args.issuer, authority.privateTokenDescriptors());
      return { origin: authority.origin, provenance: authority.provenance, imageClosure, privateFile, boundary: importedBoundary.snapshot(), snapshot: authority.snapshot() };
    }
    assert.ok(authority && !stopping, 'FIXTURE_NOT_INITIALIZED');
    if (op === 'prepare') { ownKeys(args, ['startedAtMs']); return authority.control({ action: 'prepare', startedAtMs: args.startedAtMs }); }
    if (op === 'window') { ownKeys(args, ['entries']); return authority.setWindow(args.entries); }
    if (op === 'mutate') {
      assert.ok(Object.keys(args).every(k => ['action', 'subject', 'enabled'].includes(k))); return authority.control(args);
    }
    if (op === 'drain') { ownKeys(args, ['remainingMs']); return drainAuthority(authority, args.remainingMs); }
    ownKeys(args, []);
    if (op === 'functional') return authority.runContractCases();
    if (op === 'audit') return { ...authority.snapshot(), boundary: importedBoundary.snapshot() };
    if (op === 'stop') { stopping = true; const result = await authority.close(); process.stdin.pause(); return result; }
    throw Error('FIXTURE_COMMAND_INVALID');
  }
  async function consume() {
    if (busy) return; busy = true;
    try {
      while (queue.length) {
        const envelope = queue.shift();
        try { const result = await dispatch(envelope); output({ type: 'reply', id: envelope.id, ok: true, result }); }
        catch (error) {
          // No JWT/header/profile/environment values or raw third-party errors enter the public event stream.
          output({ type: 'reply', id: envelope.id, ok: false, error: safeCommandError(error) });
          process.exitCode = 1; process.stdin.pause();
          // Container-owner cleanup remains authoritative after a failed command. Never continue load.
          queue.length = 0; stopping = true; break;
        }
      }
    } finally { busy = false; }
  }
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (stopping) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 128 * 1024) throw Error('FIXTURE_IPC_INPUT_BOUND');
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      assert.ok(Buffer.byteLength(line) <= 64 * 1024 && ++commands <= 4096, 'FIXTURE_IPC_COMMAND_BOUND');
      const value = JSON.parse(line); assertEnvelope(value); assert.ok(!seen.has(value.id), 'FIXTURE_IPC_DUPLICATE_ID'); seen.add(value.id);
      assert.ok(queue.length < 8, 'FIXTURE_IPC_QUEUE_BOUND'); queue.push(value);
    }
    void consume();
  });
  process.stdin.on('end', () => { if (!stopping) { process.exitCode = 1; process.stderr.write('FIXTURE_UNEXPECTED_IPC_EOF\n'); } });
}
module.exports = { assertEnvelope, assertInitArgs, safeCommandError, drainAuthority, boundary };
if (require.main === module) main().catch(error => { process.stderr.write(/^FIXTURE_[A-Z_]+$/.test(error.message || '') ? error.message + '\n' : 'FIXTURE_START_FAILED\n'); process.exitCode = 1; });
