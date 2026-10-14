// No side effects on import. No image build/pull, implicit retry, or launch without a complete reviewed freeze.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import durabilityObserver from './durability-observer.cjs';
import { readCgroup } from './probe.mjs';
import { PLAN_ID, LIMITS, COUNTS, SUBJECTS, ISSUER, SAFETY, schedule, ordinaryWaves, sha256, validateFreeze,
  validateResources, verifyUniqueTerminals, classifyRun, cancellationCoverage, latencySummary, reconcileAuthority, assertSafety, failureVerdict, safetyCode } from './plan.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeFile = (file, max = 16 * 1024 * 1024) => { const st = fs.lstatSync(file); assert.ok(st.isFile() && !st.isSymbolicLink() && st.size <= max); return fs.readFileSync(file); };
const OBSERVER_RELATIVE = 'services/stocks/auth-http-fixture-512/durability-observer.cjs';
export function fixtureCommand(role) {
  assert.ok(['service', 'authority', 'driver'].includes(role));
  return role === 'service' ? { entrypoint: durabilityObserver.EXECUTABLE,
    args: ['--require', durabilityObserver.OBSERVER, durabilityObserver.SERVICE] }
    : { entrypoint: 'node', args: ['services/stocks/auth-http-fixture-512/' + (role === 'authority' ? 'authority-entry.cjs' : 'probe.mjs'), ...(role === 'authority' ? ['--stdio'] : [])] };
}
export function precheckServices(pair) {
  assert.ok(Number.isInteger(pair) && pair >= 0 && pair < 3);
  return ['P', 'C'].map(variant => ({ pair, variant, runId: `pair${pair + 1}-contract-${variant}` }));
}
export function createObserverBinding(freeze, runId, row, serviceContainerId) {
  const files = new Map(freeze.files.map(file => [file.path, file]));
  const requiredHash = relative => { const file = files.get(relative); assert.match(file?.sha256 || '', /^[a-f0-9]{64}$/, 'OBSERVER_CLOSURE_MISSING'); return file.sha256; };
  assert.ok(Number.isInteger(row.pair) && row.pair >= 0 && row.pair < 3);
  return durabilityObserver.validateBinding({ schema: 1, planId: PLAN_ID, runId, caseId: `pair${row.pair + 1}-${row.variant}`, variant: row.variant,
    serviceContainerId, runtimeImageId: freeze.runtimeImageId, sourceSha: freeze.sourceSha, contextSha256: freeze.contextSha256,
    seedSha256: freeze.seed.sha256, observerSha256: requiredHash(OBSERVER_RELATIVE), ledgerPath: durabilityObserver.LEDGER,
    runtimeSha256: Object.fromEntries(Object.entries(durabilityObserver.RUNTIME).map(([key, file]) => [key, requiredHash(file.slice('/source/'.length))])) });
}
export function validateWorkerObservation(proof, { binding, bindingSha256, init, info, failurePresent = false }) {
  durabilityObserver.validateBinding(binding); assert.match(bindingSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(failurePresent, false, 'OBSERVER_FAILURE_MARKER');
  assert.ok(init && info?.State?.Running && info.State.Status === 'running', 'OBSERVER_WORKER_NOT_READY');
  assert.equal(info.Id, binding.serviceContainerId); assert.equal(info.Image, binding.runtimeImageId);
  assert.equal(info.Config?.Hostname, binding.serviceContainerId.slice(0, 12));
  assert.equal(init.node, 'v24.21.0'); assert.equal(init.gatewayOrigin, 'http://127.0.0.1:29302');
  assert.equal(init.providerStarts, 0); assert.equal(init.seed?.sha256, binding.seedSha256);
  assert.equal(init.closure?.contextSha256, binding.contextSha256);
  assert.ok(Number.isSafeInteger(init.closure?.verifiedFiles) && init.closure.verifiedFiles > 0);
  assert.ok(proof && typeof proof === 'object'); assert.equal(proof.schema, 1); assert.equal(proof.status, 'PASS');
  for (const [key, value] of Object.entries(binding)) assert.deepEqual(proof[key], value, 'OBSERVER_BINDING_MISMATCH: ' + key);
  assert.equal(proof.bindingSha256, bindingSha256); assert.equal(proof.node, 'v24.21.0');
  assert.ok(Number.isSafeInteger(proof.pid) && proof.pid > 0 && Number.isSafeInteger(proof.threadId) && proof.threadId > 0);
  assert.ok(Number.isSafeInteger(proof.seedIdentityBeforeOpen?.bytes) && proof.seedIdentityBeforeOpen.bytes > 0
    && proof.seedIdentityBeforeOpen.bytes <= durabilityObserver.LIMITS.seedBytes, 'OBSERVER_SEED_IDENTITY_MISSING');
  for (const key of ['inode', 'device']) assert.ok(Number.isSafeInteger(proof.seedIdentityBeforeOpen[key]) && proof.seedIdentityBeforeOpen[key] >= 0);
  assert.equal(proof.synchronous, 2); assert.equal(proof.journalMode, 'delete'); assert.equal(proof.nativeConfigurationCalls, 1);
  assert.equal(proof.readOnlyPragmas, 2); assert.equal(proof.descriptorRestored, true);
  assert.equal(proof.configurationSqlSha256, sha256(durabilityObserver.CONFIG_SQL));
  for (const key of ['preloadStartedMonoNs', 'setupStartedMonoNs', 'finishedBeforeProofWriteMonoNs', 'nativeConfigurationDurationNs', 'restoreAndReadObservationDurationNs'])
    assert.match(proof[key] || '', /^[0-9]{1,30}$/, 'OBSERVER_TIMING_INVALID');
  const elapsed = BigInt(proof.finishedBeforeProofWriteMonoNs) - BigInt(proof.setupStartedMonoNs);
  assert.ok(BigInt(proof.setupStartedMonoNs) >= BigInt(proof.preloadStartedMonoNs) && elapsed >= 0n);
  assert.ok(BigInt(proof.nativeConfigurationDurationNs) + BigInt(proof.restoreAndReadObservationDurationNs) <= elapsed);
  return true;
}
export function collectObserverFailure({ directory, uid, gid, bindingSha256 }, io = fs) {
  durabilityObserver.ownedDirectory(directory, uid, gid, io);
  assert.match(bindingSha256 || '', /^[a-f0-9]{64}$/);
  const read = name => durabilityObserver.boundedFile(path.join(directory, name), durabilityObserver.LIMITS.proofBytes,
    { uid, gid, privateFile: true }, io).bytes;
  const result = { status: 'COLLECTED', bindingMatches: sha256(read('binding.json')) === bindingSha256 };
  for (const [key, name] of [['failure', 'worker-connection-failure.json'], ['observation', 'worker-connection.json']]) {
    if (!io.existsSync(path.join(directory, name))) { result[key] = { present: false }; continue; }
    const bytes = read(name), value = JSON.parse(bytes);
    assert.equal(value?.schema, 1); assert.equal(value.status, key === 'failure' ? 'FAIL' : 'PASS');
    // Retain only the known-safe proof fields. Arbitrary extra JSON properties,
    // error messages/stacks and environment values never enter this report.
    const projection = { schema: 1, status: value.status };
    if (key === 'failure') {
      assert.equal(durabilityObserver.safeFailure({ code: value.code }).code, value.code); projection.code = value.code;
      if (['Error', 'TypeError', 'RangeError', 'AssertionError', 'SyntaxError'].includes(value.errorName)) projection.errorName = value.errorName;
      if (value.nativeCode === null || (typeof value.nativeCode === 'string' && durabilityObserver.safeFailure({ code: value.nativeCode }).nativeCode === value.nativeCode)) projection.nativeCode = value.nativeCode;
      if (Number.isSafeInteger(value.nativeErrcode) && value.nativeErrcode >= 0 && value.nativeErrcode <= 65535) projection.nativeErrcode = value.nativeErrcode;
    } else {
      assert.match(value.bindingSha256 || '', /^[a-f0-9]{64}$/); projection.bindingMatches = value.bindingSha256 === bindingSha256;
      for (const field of ['synchronous', 'nativeConfigurationCalls', 'readOnlyPragmas']) if (Number.isSafeInteger(value[field]) && value[field] >= 0) projection[field] = value[field];
      if (value.journalMode === 'delete') projection.journalMode = value.journalMode;
      if (typeof value.descriptorRestored === 'boolean') projection.descriptorRestored = value.descriptorRestored;
    }
    result[key] = { present: true, bytes: bytes.length, sha256: sha256(bytes), projection };
  }
  return result;
}
export function validatePrecheckServiceAudit(value) {
  for (const field of ['nativeProviderStarts', 'deniedNetwork']) {
    assert.ok(Number.isSafeInteger(value?.[field]) && value[field] >= 0, 'PRECHECK_SAFETY_COUNTER_MISSING');
    assertSafety(value[field] === 0, 'SAFETY_PROVIDER_ACCESS');
  }
  for (const field of ['requests', 'health', 'active', 'activeHandlers', 'handlerStarts', 'handlerTerminals', 'handlerFailures'])
    assert.equal(value?.[field], 0, 'PRECHECK_SERVICE_NOT_IDLE: ' + field);
  assert.equal(value.accounts?.queue?.pending, 0); assert.equal(value.accounts?.queue?.active, 0);
  return true;
}
export function validatePrecheckClosedSeed(value, seed) {
  assert.equal(value?.closed, true); assert.match(value.sha256 || '', /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(value.accounts), 'PRECHECK_SEED_ACCOUNTS_MISSING');
  for (const row of value.accounts) { assert.match(row.id || '', /^[a-f0-9]{64}$/); assert.match(row.ledgerSha256 || '', /^[a-f0-9]{64}$/); }
  assertSafety(value.sha256 === seed.sha256, 'SAFETY_LEDGER_CHANGED');
  const byId = (a, b) => a.id.localeCompare(b.id);
  assertSafety(JSON.stringify([...value.accounts].sort(byId)) === JSON.stringify([...seed.accounts].sort(byId)), 'SAFETY_LEDGER_CHANGED');
  return true;
}
export function validateKernelResources(snapshot, role, device) {
  assert.ok(['service', 'authority'].includes(role));
  const proof = readCgroup('/metrics/' + role, file => {
    const value = snapshot?.counters?.[path.basename(file)]; assert.equal(typeof value, 'string', 'ACTUAL_CGROUP_PROOF_MISSING'); return value;
  });
  validateResources(proof, role, device); return proof;
}
export function validateFunctionalContract(result) {
  assert.ok(result && ['PASS', 'FAIL'].includes(result.status), 'FUNCTIONAL_CONTRACT_EVIDENCE_INCOMPLETE');
  assertSafety(result.status === 'PASS', 'SAFETY_CONTRACT_MISMATCH');
  assert.ok(Number.isSafeInteger(result.authorityRequests) && result.authorityRequests >= 0, 'FUNCTIONAL_CONTRACT_COUNT_INCOMPLETE');
  assertSafety(result.authorityRequests === 52, 'SAFETY_CONTRACT_MISMATCH');
  return true;
}
export function validateGatewayContract(terminal, expected, { beforeAuthorityRequests, afterAuthorityRequests } = {}) {
  // A transport failure or absent/malformed response is incomplete evidence.
  // A complete HTTP response with the wrong safety behavior is an explicit FAIL.
  assert.ok(terminal && terminal.outcome === 'HTTP', 'GATEWAY_HTTP_EVIDENCE_INCOMPLETE');
  assert.ok(Number.isInteger(terminal.status) && terminal.status >= 100 && terminal.status <= 599, 'GATEWAY_STATUS_EVIDENCE_INCOMPLETE');
  assertSafety(terminal.status === expected.status, 'SAFETY_CONTRACT_MISMATCH');
  assert.ok(terminal.code === null || (typeof terminal.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(terminal.code)), 'GATEWAY_CODE_EVIDENCE_INCOMPLETE');
  assertSafety(terminal.code === (expected.code ?? null), 'SAFETY_CONTRACT_MISMATCH');
  if (expected.proxyOnly) {
    assert.ok([beforeAuthorityRequests, afterAuthorityRequests].every(value => Number.isSafeInteger(value) && value >= 0), 'GATEWAY_AUTHORITY_COUNT_INCOMPLETE');
    assertSafety(afterAuthorityRequests === beforeAuthorityRequests, 'SAFETY_CONTRACT_MISMATCH');
  }
  return true;
}
// This span includes normal worker/HTTP initialization and the observer proof
// write/read. It is not isolated observer CPU or fsync time and never changes a
// timed request window. Injected functions let pure guards prove ordering.
export async function observedInitialization({ init, inspect, snapshot, readProof, readFailure, binding, bindingSha256,
  now = () => performance.now(), timeoutMs = LIMITS.drainMs + 5000, evidence = {} }) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= LIMITS.drainMs + 5000);
  const started = now(), deadline = started + timeoutMs, before = snapshot(inspect(remainingBudget(deadline, now(), 'OBSERVER_INIT_INCOMPLETE')));
  Object.assign(evidence, { status: 'INCOMPLETE', wholeInit: { scope: 'whole stock init through required worker proof; includes proof fsync; not isolated observer cost', before } });
  try {
    const value = await init(remainingBudget(deadline, now(), 'OBSERVER_INIT_INCOMPLETE'));
    remainingBudget(deadline, now(), 'OBSERVER_INIT_INCOMPLETE');
    const observed = readProof(); evidence.observation = observed;
    const info = inspect(remainingBudget(deadline, now(), 'OBSERVER_INIT_INCOMPLETE'));
    validateWorkerObservation(observed.proof, { binding, bindingSha256, init: value, info, failurePresent: observed.failurePresent });
    const after = snapshot(info), ended = now(); remainingBudget(deadline, ended, 'OBSERVER_INIT_INCOMPLETE');
    Object.assign(evidence, { status: 'PASS', init: value, observation: observed,
      workerReadiness: 'stock init resolved after unchanged createServer awaited account worker ready; matching proof and no failure marker verified' });
    Object.assign(evidence.wholeInit, { elapsedMs: ended - started, after }); return evidence;
  } catch (error) {
    evidence.wholeInit.elapsedMs = now() - started; evidence.failure = String(error.message).slice(0, 500);
    // The init RPC can fail before readProof. Collect bounded diagnostics while
    // the owned bind directory still exists, before outer lifecycle cleanup.
    if (readFailure) {
      try { evidence.observerFailureEvidence = readFailure(); }
      catch (diagnosticError) { evidence.observerFailureEvidence = { status: 'UNAVAILABLE', error: durabilityObserver.safeFailure(diagnosticError) }; }
    }
    throw error;
  }
}
export function remainingBudget(deadline, now, code = 'TAIL_DRAIN_INCOMPLETE') {
  assert.ok(Number.isFinite(deadline) && Number.isFinite(now));
  assert.ok(now < deadline, code); return Math.max(1, Math.ceil(deadline - now));
}
export async function waitForServiceReady(inspect, id, { now = () => performance.now(), pause = sleep } = {}) {
  const end = now() + LIMITS.drainMs, code = 'SERVICE_NAMESPACE_READY_INCOMPLETE';
  while (true) {
    const info = inspect(id, remainingBudget(end, now(), code));
    const remaining = remainingBudget(end, now(), code);
    if (info.State?.Running && info.State.Status === 'running' && Number.isSafeInteger(info.State.Pid) && info.State.Pid > 1 &&
      typeof info.NetworkSettings?.SandboxKey === 'string' && path.isAbsolute(info.NetworkSettings.SandboxKey) && info.NetworkSettings.SandboxKey !== path.parse(info.NetworkSettings.SandboxKey).root) return info;
    await pause(Math.min(100, remaining));
  }
}
export async function drainWithinBudget(read, quiescent, { now = () => performance.now(), pause = sleep } = {}) {
  const end = now() + LIMITS.drainMs, remaining = () => remainingBudget(end, now());
  while (true) {
    remaining(); const snapshot = await read(remaining), ready = quiescent(snapshot); remaining();
    if (ready) return snapshot;
    await pause(Math.min(100, remaining()));
  }
}
export function authorityInitArgs(variant, freeze, startedAtMs) {
  assert.ok(['P', 'C'].includes(variant)); assert.ok(Number.isSafeInteger(startedAtMs) && startedAtMs >= 1700000000000 && startedAtMs <= 2200000000000);
  for (const key of ['bcryptSha256', 'contextSha256']) assert.match(freeze[key] || '', /^[a-f0-9]{64}$/);
  return { sourceRoot: '/source', compiledRoot: '/source', proofFile: '/source/compiled-proof.json',
    mode: variant === 'P' ? 'profile' : 'compact', port: 29301, issuer: ISSUER, startedAtMs,
    tokenPath: '/private-ipc/tokens.json', bcryptSha256: freeze.bcryptSha256, contextSha256: freeze.contextSha256 };
}
export function verifyClosure(root, freeze) {
  validateFreeze(freeze); const base = fs.realpathSync(root);
  for (const row of freeze.files) { const file = path.resolve(base, row.path); assert.ok(file.startsWith(base + path.sep));
    assert.equal(fs.realpathSync(file), file); const bytes = safeFile(file); assert.equal(bytes.length, row.bytes); assert.equal(sha256(bytes), row.sha256, row.path); }
  assert.equal(sha256(JSON.stringify(freeze.files)), freeze.contextSha256, 'complete context hash');
  assert.equal(sha256(safeFile(path.join(base, 'compiled-proof.json'))), freeze.compiledProofSha256);
  const proof = JSON.parse(safeFile(path.join(base, 'compiled-proof.json'))), byPath = new Map(freeze.files.map(row => [row.path, row]));
  assert.equal(proof.exitCode, 0); assert.equal(proof.sourcesUnchanged, true); assert.ok(proof.sourcesBefore.length > 0);
  for (const source of proof.sourcesBefore) assert.equal(byPath.get(source.path)?.sha256, source.sha256, 'compiled source not frozen: ' + source.path);
  const visited = new Set(), pending = ['services/stocks-global/server.mjs', 'services/stocks-global/accounts.mjs', 'services/stocks-global/identity.mjs',
    'services/stocks-global/local-proxy.mjs', 'services/stocks-global/account-worker-runtime.mjs', OBSERVER_RELATIVE, 'dist/api/routes/account.js', 'dist/api/middleware/auth.js'];
  while (pending.length) {
    const relative = pending.pop(); if (visited.has(relative)) continue; visited.add(relative); assert.ok(byPath.has(relative), 'missing executable dependency: ' + relative);
    const source = safeFile(path.join(base, relative)).toString();
    for (const match of source.matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(base, path.dirname(relative), match[1]); assert.ok(target.startsWith(base + path.sep));
      const found = [target, target + '.js', target + '.mjs', target + '.json', path.join(target, 'index.js')].find(file => fs.existsSync(file) && fs.lstatSync(file).isFile());
      assert.ok(found, 'unresolved local dependency'); pending.push(path.relative(base, found).split(path.sep).join('/'));
    }
  }
  assert.equal(sha256(safeFile(path.join(base, 'services/stocks/targeted-http-512/plan.mjs'))), freeze.originalTargetedPlanSha256);
  for (const name of ['run.mjs', 'durability-observer.cjs', 'plan.mjs', 'probe.mjs']) assert.equal(sha256(safeFile(fileURLToPath(new URL('./' + name, import.meta.url)))),
    byPath.get('services/stocks/auth-http-fixture-512/' + name)?.sha256, 'host observer/runner source differs from frozen image');
  return true;
}
export function validateContainerInspect(info, { runId, image, role, serviceId, uid, binds }) {
  assert.equal(info.Image, image); assert.equal(info.Config.Labels?.['voltex.auth-http.run'], runId);
  assert.equal(info.Config.Labels?.['voltex.auth-http.role'], role); assert.equal(info.Config.User, String(uid) + ':' + String(uid));
  const command = fixtureCommand(role);
  assert.deepEqual(info.Config.Entrypoint, [command.entrypoint]); assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(info.Config.Cmd, command.args);
  assert.deepEqual(info.HostConfig.CapDrop, ['ALL']); assert.ok((info.HostConfig.CapAdd || []).length === 0);
  assert.deepEqual(info.HostConfig.SecurityOpt, ['no-new-privileges']); assert.equal(info.HostConfig.Privileged, false);
  assert.equal(info.HostConfig.PidMode || '', ''); assert.ok(['', 'private'].includes(info.HostConfig.IpcMode || ''));
  assert.equal(info.HostConfig.NetworkMode, role === 'service' ? 'none' : 'container:' + serviceId);
  assert.deepEqual(info.HostConfig.PortBindings || {}, {}); assert.equal(info.HostConfig.PublishAllPorts, false);
  assert.equal(info.HostConfig.Memory, LIMITS.memory); assert.equal(info.HostConfig.MemorySwap, LIMITS.memory);
  assert.equal(info.HostConfig.NanoCpus, role === 'service' ? 50000000 : 500000000);
  assert.equal(info.HostConfig.CpusetCpus, role === 'service' ? '0' : '1');
  assert.ok((info.HostConfig.Devices || []).length === 0);
  const actual = info.Mounts.filter(m => m.Type === 'bind').map(m => ({ source: m.Source, target: m.Destination, ro: !m.RW })).sort((a, b) => a.target.localeCompare(b.target));
  assert.deepEqual(actual, [...binds].sort((a, b) => a.target.localeCompare(b.target)), 'mount boundary mismatch');
  if (role === 'service') {
    assert.deepEqual(actual.map(m => m.target), ['/data', durabilityObserver.DIRECTORY]);
    assert.ok(actual.every(m => !m.ro));
    assert.equal(info.Config.Hostname, info.Id.slice(0, 12), 'OBSERVER_CONTAINER_HOSTNAME');
    const entries = info.Config.Env.map(value => { const at = value.indexOf('='); assert.ok(at > 0); return [value.slice(0, at), value.slice(at + 1)]; });
    const env = Object.fromEntries(entries); assert.equal(Object.keys(env).length, entries.length, 'duplicate service environment');
    durabilityObserver.validateInvocation({ platform: 'linux', version: 'v24.21.0', arch: 'x64', uid, gid: uid,
      execPath: command.entrypoint, execArgv: command.args.slice(0, 2), argv: [command.entrypoint, command.args[2]],
      env, isMainThread: true, threadId: 0, workerData: null, filename: durabilityObserver.OBSERVER });
  }
  assert.ok(info.Mounts.every(m => m.Type === 'bind' || m.Type === 'tmpfs'));
  assert.ok(!info.Config.Env.some(e => /^(DATABASE_URL|DIRECT_URL|JWT_SECRET|NODE_OPTIONS|NODE_PATH|.*TOKEN|.*PASSWORD|.*SECRET)=/.test(e) &&
    !(role === 'authority' && e === 'JWT_SECRET=stocks-auth-http-disposable-fixture-secret')));
  return true;
}
export function validateCgroupPath(realPath, expectedRoot, stat) {
  assert.ok(realPath.startsWith(expectedRoot + path.sep) && realPath !== expectedRoot && !realPath.split(path.sep).includes('..'));
  assert.ok(stat.isDirectory && !stat.isSymbolicLink); return true;
}
export function ownCgroup(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  const rows = safeFile(`/proc/${pid}/cgroup`, 65536).toString().split('\n'), line = rows.find(r => r.startsWith('0::'));
  assert.ok(line && !line.includes('..'), 'cgroup v2 required'); const root = fs.realpathSync('/sys/fs/cgroup');
  const directory = fs.realpathSync(root + line.slice(3)), st = fs.lstatSync(directory);
  validateCgroupPath(directory, root, { isDirectory: st.isDirectory(), isSymbolicLink: st.isSymbolicLink() });
  return { directory, inode: st.ino, device: st.dev, pid };
}
export function verifyBackingDevice(disk, device, execute) {
  assert.ok(path.isAbsolute(disk) && device.startsWith('/dev/')); assert.ok(fs.statSync(device).isBlockDevice());
  const mounted = execute('/usr/bin/findmnt', ['-n', '-o', 'MAJ:MIN', '-T', disk]);
  const devices = JSON.parse(execute('/usr/bin/lsblk', ['-J', '-p', '-o', 'NAME,MAJ:MIN,PKNAME']));
  const rows = [], flatten = list => { for (const row of list) { rows.push(row); flatten(row.children || []); } }; flatten(devices.blockdevices);
  let row = rows.find(r => r['maj:min'] === mounted), chain = [];
  for (let i = 0; row && i < 8; i++) { chain.push(row.name); if (row.name === device) break; row = rows.find(r => r.name === row.pkname || r.name === '/dev/' + row.pkname); }
  assert.equal(chain.at(-1), device, 'disk is not on the throttled device'); return { device, deviceNumber: row['maj:min'], mounted, chain };
}
export function boundedRpcLines(maxLine = LIMITS.maxRpcBytes, maxTotal = 64 * 1024 * 1024) {
  let buffered = Buffer.alloc(0), total = 0, failed = false;
  return { push(bytes) { assert.equal(failed, false); try {
    assert.ok(Buffer.isBuffer(bytes)); total += bytes.length; assert.ok(total <= maxTotal, 'PRIVATE_RPC_TOTAL_BOUND');
    buffered = Buffer.concat([buffered, bytes]); const lines = []; let end;
    while ((end = buffered.indexOf(10)) >= 0) { assert.ok(end <= maxLine, 'PRIVATE_RPC_LINE_BOUND');
      lines.push(buffered.subarray(0, end).toString('utf8')); buffered = buffered.subarray(end + 1); }
    assert.ok(buffered.length <= maxLine, 'PRIVATE_RPC_PARTIAL_BOUND'); return lines;
  } catch (error) { failed = true; buffered = Buffer.alloc(0); throw error; } },
  end() { assert.equal(failed, false); assert.equal(buffered.length, 0, 'PRIVATE_RPC_TRUNCATED_OUTPUT'); } };
}
export function safeRpcFailure(input) {
  const code = safetyCode(input) || (/^FIXTURE_[A-Z_]{1,80}$/.test(input?.code || '') ? input.code : 'FIXTURE_RPC_FAILED');
  const result = { code };
  if (code === 'SAFETY_CONTRACT_MISMATCH' && /^[a-z0-9-]{1,80}$/.test(input?.contract?.caseName || '')) {
    result.contract = { caseName: input.contract.caseName };
    for (const key of ['expectedStatus', 'actualStatus']) if (Number.isInteger(input.contract[key]) && input.contract[key] >= 100 && input.contract[key] <= 599) result.contract[key] = input.contract[key];
  }
  return result;
}
function rpcProcess(name, env, timeoutMs, safeErrors, safeEvents) {
  const child = spawn('/usr/bin/docker', ['start', '-ai', name], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, closed = false, failure; const pending = new Map(), lines = boundedRpcLines();
  const invalid = () => { failure = 'INVALID_PRIVATE_RPC'; safeErrors.push({ child: name, code: failure });
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error(failure)); } pending.clear(); child.kill('SIGTERM'); };
  child.stdout.on('data', bytes => {
    try { for (const line of lines.push(bytes)) { const message = JSON.parse(line);
      if (message.type === 'event') { assert.ok(safeEvents.length < 20000); safeEvents.push({ container: name, ...message.value }); continue; }
      const entry = pending.get(message.id); assert.ok(entry, 'unmatched private RPC response');
      pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) { const safe = safeRpcFailure(message.error); safeErrors.push({ child: name, ...safe }); entry.reject(Error(safe.code)); }
      else entry.resolve(message.result);
    } } catch { invalid(); }
  });
  // Authority/test stacks are retained only as bounded safe codes, never stdout containing tokens or environment.
  child.stderr.on('data', bytes => { safeErrors.push({ child: name, bytes: bytes.length, sha256: sha256(bytes) }); if (safeErrors.length > 1024) child.kill('SIGTERM'); });
  child.once('close', code => { try { lines.end(); } catch { invalid(); } closed = true;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('FIXTURE_CHILD_EXIT_' + code)); } pending.clear(); });
  child.once('error', () => { closed = true; for (const entry of pending.values()) entry.reject(Error('DOCKER_ATTACH_FAILED')); pending.clear(); });
  return { child, get closed() { return closed; }, get failure() { return failure; }, request(op, args = {}, requestTimeoutMs = timeoutMs) {
    assert.ok(!closed); const id = String(++sequence), line = JSON.stringify({ id, op, args }); assert.ok(Buffer.byteLength(line) < LIMITS.maxRpcBytes);
    assert.ok(Number.isInteger(requestTimeoutMs) && requestTimeoutMs > 0 && requestTimeoutMs <= timeoutMs);
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error('PRIVATE_RPC_TIMEOUT')); }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer }); child.stdin.write(line + '\n'); });
  } };
}
async function stopPrivate(item) {
  const result = await item.rpc.request('stop'); item.rpc.child.stdin.end();
  const deadline = performance.now() + 5000; while (!item.rpc.closed && performance.now() < deadline) await sleep(25);
  assert.equal(item.rpc.closed, true, 'PRIVATE_ATTACH_CLOSE_INCOMPLETE'); assert.equal(item.rpc.failure, undefined); return result;
}
function countWrites(snapshot) { const value = snapshot?.accounts?.sqlWriteCalls; assert.ok(Number.isSafeInteger(value) && value >= 0); return value; }
export async function main(options) {
  // These gates precede every Docker call, including inspect. Missing freeze is NOT RUN.
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64'); assert.ok(process.getuid() > 0);
  assert.equal(process.env.AUTH_HTTP_FIXTURE_512_LAUNCH_APPROVED, 'true', 'NO_LOAD_LAUNCH_AUTHORIZATION');
  assert.ok(os.availableParallelism() >= 2, 'two logical CPUs required');
  const bytes = safeFile(options.freeze); assert.equal(sha256(bytes), options.freezeSha256, 'freeze bytes not explicitly bound');
  const freeze = JSON.parse(bytes); verifyClosure(options.source, freeze);
  assert.equal(sha256(safeFile(options.seed, 16 * 1024 * 1024)), freeze.seed.sha256, 'seed not frozen');
  assert.ok(!fs.existsSync(options.seed + '-journal'), 'closed seed required');
  const uid = process.getuid(); assert.equal(uid, process.getgid(), 'same nonroot uid/gid required');
  const out = path.resolve(options.output); assert.ok(!fs.existsSync(out), 'fresh evidence directory required'); fs.mkdirSync(out, { mode: 0o700 });
  const dockerConfig = path.join(out, 'private-docker-config'); fs.mkdirSync(dockerConfig, { mode: 0o700 });
  const env = { PATH: '/usr/bin:/bin', LANG: 'C', DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONFIG: dockerConfig };
  let runDeadline = Infinity, overallDeadline = performance.now() + LIMITS.totalMs, cleaning = false;
  const execute = (binary, args, commandTimeoutMs = 30000) => {
    assert.ok(Number.isInteger(commandTimeoutMs) && commandTimeoutMs > 0 && commandTimeoutMs <= 30000);
    const remaining = Math.min(overallDeadline, runDeadline) - performance.now();
    if (!cleaning) assert.ok(remaining > 0, 'HARD_WALL_DEADLINE');
    return execFileSync(binary, args, { env, encoding: 'utf8', timeout: cleaning ? commandTimeoutMs : Math.max(1, Math.min(commandTimeoutMs, Math.floor(remaining))), maxBuffer: 8 * 1024 * 1024 }).trim();
  };
  const docker = (args, timeoutMs) => execute('/usr/bin/docker', args, timeoutMs), inspect = (id, timeoutMs) => JSON.parse(docker(['inspect', id], timeoutMs))[0];
  const backing = verifyBackingDevice(fs.realpathSync(options.disk), fs.realpathSync(options.device), execute);
  const image = JSON.parse(docker(['image', 'inspect', freeze.runtimeImageId]))[0];
  assert.equal(image.Id, freeze.runtimeImageId); assert.equal(image.Architecture, 'amd64'); assert.equal(image.Os, 'linux');
  assert.equal(image.Config.Labels?.['org.opencontainers.image.revision'], freeze.sourceSha);
  assert.equal(image.Config.Labels?.['voltex.auth-http.context'], freeze.contextSha256);
  const runId = 'auth-http512-' + randomUUID(), scratch = path.join(fs.realpathSync(options.disk), runId);
  fs.mkdirSync(scratch, { mode: 0o700 }); fs.writeFileSync(path.join(scratch, 'owned'), runId, { flag: 'wx', mode: 0o600 });
  const scratchStat = fs.lstatSync(scratch), containers = new Set(), started = performance.now();
  const report = { schema: 1, planId: PLAN_ID, sourceSha: freeze.sourceSha, freezeSha256: sha256(bytes), status: 'INCOMPLETE',
    capacityAcceptance: 'NOT_EVALUATED', backing, image: { id: image.Id, contextSha256: freeze.contextSha256 }, prerequisites: [], runs: [], cleanup: [], safeErrors: [], safeEvents: [] };
  const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); save();
  const remove = async id => {
    cleaning = true;
    try {
      let before = inspect(id); assert.equal(before.Config.Labels?.['voltex.auth-http.run'], runId);
      const deadline = performance.now() + 5000;
      while (before.State.Running && performance.now() < deadline) { await sleep(100); before = inspect(id); }
      const forcedStop = before.State.Running;
      if (forcedStop) docker(['stop', '--time', '3', id]); const after = inspect(id);
      report.cleanup.push({ id, running: after.State.Running, exitCode: after.State.ExitCode, oomKilled: after.State.OOMKilled, forcedStop });
      assert.equal(after.State.Running, false); docker(['rm', id]); containers.delete(id);
      assert.equal(after.State.ExitCode, 0, 'child exited unsuccessfully'); assert.equal(after.State.OOMKilled, false, 'child OOM'); assert.equal(forcedStop, false, 'child required forced stop');
    } finally { cleaning = false; }
  };
  const watchdog = ms => setTimeout(() => {
    report.hardWallDeadline = true; report.status = 'INCOMPLETE'; cleaning = true;
    for (const id of containers) try { const info = inspect(id); assert.equal(info.Config.Labels?.['voltex.auth-http.run'], runId);
      if (info.State.Running) docker(['kill', id]); } catch (error) { report.cleanup.push({ id, watchdog: String(error.message).slice(0, 200) }); }
    cleaning = false; save();
  }, ms);
  const totalWatchdog = watchdog(Math.max(1, overallDeadline - performance.now()));
  const create = (role, row, binds, serviceId) => {
    const name = `${runId}-${row.runId}-${role}`;
    const command = fixtureCommand(role);
    const args = ['create', '--interactive', '--name', name, '--label', 'voltex.auth-http.run=' + runId, '--label', 'voltex.auth-http.role=' + role,
      '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--user', `${uid}:${uid}`,
      '--cpus', role === 'service' ? '.05' : '.5', '--cpuset-cpus', role === 'service' ? '0' : '1', '--memory', '256m', '--memory-swap', '256m',
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m', '--network', role === 'service' ? 'none' : 'container:' + serviceId,
      ...(role === 'service' ? ['--device-read-bps', backing.device + ':1048576', '--device-write-bps', backing.device + ':131072'] : []),
      ...binds.flatMap(b => ['--mount', `type=bind,src=${b.source},dst=${b.target}${b.ro ? ',readonly' : ''}`]),
      '-e', 'AUTH_HTTP_FIXTURE_512=true', ...(role === 'authority' ? ['-e', 'STOCKS_AUTH_HTTP_FIXTURE=true', '-e', 'JWT_SECRET=stocks-auth-http-disposable-fixture-secret'] : []),
      '--entrypoint', command.entrypoint, freeze.runtimeImageId, ...command.args];
    const id = docker(args); assert.match(id, /^[a-f0-9]{64}$/); containers.add(id);
    validateContainerInspect(inspect(id), { runId, image: freeze.runtimeImageId, role, serviceId, uid, binds });
    let observation;
    if (role === 'service') {
      const directory = binds.find(b => b.target === durabilityObserver.DIRECTORY).source;
      durabilityObserver.ownedDirectory(directory, uid, uid); assert.deepEqual(fs.readdirSync(directory), [], 'OBSERVER_FRESH_DIRECTORY_REQUIRED');
      const binding = createObserverBinding(freeze, runId, row, id), bindingBytes = Buffer.from(JSON.stringify(binding, null, 2) + '\n');
      assert.ok(bindingBytes.length <= durabilityObserver.LIMITS.bindingBytes);
      fs.writeFileSync(path.join(directory, 'binding.json'), bindingBytes, { flag: 'wx', mode: 0o600 });
      observation = { directory, binding, bindingSha256: sha256(bindingBytes) };
    }
    return { id, observation, rpc: rpcProcess(id, env, LIMITS.drainMs + 5000, report.safeErrors, report.safeEvents) };
  };
  const kernelSnapshot = info => {
    const cg = ownCgroup(info.State.Pid), fields = ['cpu.max', 'cpu.stat', 'memory.max', 'memory.current', 'memory.peak', 'memory.events', 'memory.swap.max', 'io.max', 'io.stat', 'cpuset.cpus.effective'];
    return { identity: cg, atMonoNs: process.hrtime.bigint().toString(), counters: Object.fromEntries(fields.map(name => [name, safeFile(path.join(cg.directory, name), 65536).toString()])) };
  };
  const freshServiceFiles = directory => {
    fs.mkdirSync(directory, { mode: 0o700 });
    for (const name of ['data', 'ipc', 'observation']) fs.mkdirSync(path.join(directory, name), { mode: 0o700 });
    const seed = path.join(directory, 'data/accounts.sqlite');
    fs.copyFileSync(options.seed, seed, fs.constants.COPYFILE_EXCL); fs.chmodSync(seed, 0o600);
    assert.equal(sha256(safeFile(seed)), freeze.seed.sha256);
    return [{ source: path.join(directory, 'data'), target: '/data', ro: false },
      { source: path.join(directory, 'observation'), target: durabilityObserver.DIRECTORY, ro: false }];
  };
  const initializeObservedService = async (service, evidence) => {
    const { directory, binding, bindingSha256 } = service.observation;
    return observedInitialization({ binding, bindingSha256, evidence,
      timeoutMs: Math.min(LIMITS.drainMs + 5000, Math.max(1, Math.floor(Math.min(overallDeadline, runDeadline) - performance.now()))),
      inspect: timeout => inspect(service.id, timeout), snapshot: info => {
        const value = kernelSnapshot(info); validateKernelResources(value, 'service', backing.deviceNumber); return value;
      },
      init: timeout => service.rpc.request('init', { issuer: ISSUER, authority: 'http://127.0.0.1:29301', gatewayPort: 29302, servicePort: 29303,
        seedSha256: freeze.seed.sha256, contextSha256: freeze.contextSha256 }, timeout),
      readFailure: () => collectObserverFailure({ directory, uid, gid: uid, bindingSha256 }),
      readProof: () => {
        durabilityObserver.ownedDirectory(directory, uid, uid);
        const files = fs.readdirSync(directory).sort(), failurePresent = files.includes('worker-connection-failure.json');
        const read = name => durabilityObserver.boundedFile(path.join(directory, name), durabilityObserver.LIMITS.proofBytes, { uid, gid: uid, privateFile: true }).bytes;
        if (failurePresent) {
          return { failurePresent, failure: collectObserverFailure({ directory, uid, gid: uid, bindingSha256 }).failure };
        }
        assert.deepEqual(files, ['binding.json', 'worker-connection.json'], 'OBSERVER_MISSING_OR_EXTRA_PROOF');
        assert.equal(sha256(read('binding.json')), bindingSha256, 'OBSERVER_BINDING_CHANGED');
        const bytes = read('worker-connection.json');
        return { proof: JSON.parse(bytes), sha256: sha256(bytes), bytes: bytes.length, failurePresent };
      } });
  };
  const pairedPrerequisite = async pair => {
    const evidence = { pair, status: 'INCOMPLETE', variants: [], scope: 'functional prerequisite only; two fresh seeded observed service lifecycles, separate from all six timed runs' };
    report.prerequisites.push(evidence); const owned = [];
    try {
      for (const row of precheckServices(pair)) {
        const { variant } = row, dir = path.join(scratch, row.runId);
        const service = create('service', row, freshServiceFiles(dir)); owned.push(service);
        await waitForServiceReady(inspect, service.id);
        const authority = create('authority', row, [{ source: path.join(dir, 'ipc'), target: '/private-ipc', ro: false }], service.id); owned.push(authority);
        const init = await authority.rpc.request('init', authorityInitArgs(variant, freeze, Date.now()));
        const variantEvidence = { variant, init, serviceInitialization: {} }; evidence.variants.push(variantEvidence);
        await initializeObservedService(service, variantEvidence.serviceInitialization);
        const before = kernelSnapshot(inspect(authority.id)), serviceBeforeHttp = kernelSnapshot(inspect(service.id));
        variantEvidence.resourceProof = { service: validateKernelResources(serviceBeforeHttp, 'service', backing.deviceNumber),
          authority: validateKernelResources(before, 'authority', backing.deviceNumber) };
        variantEvidence.serviceBeforeHttp = serviceBeforeHttp;
        const result = await authority.rpc.request('functional'), after = kernelSnapshot(inspect(authority.id));
        Object.assign(variantEvidence, { result, before, after });
        validateFunctionalContract(result);
        variantEvidence.serviceAudit = await service.rpc.request('drain'); validatePrecheckServiceAudit(variantEvidence.serviceAudit);
        variantEvidence.closedSeed = await service.rpc.request('quiesce'); validatePrecheckClosedSeed(variantEvidence.closedSeed, freeze.seed);
        await stopPrivate(authority); await remove(authority.id); owned.pop();
        variantEvidence.serviceFinal = kernelSnapshot(inspect(service.id)); await stopPrivate(service); await remove(service.id); owned.pop();
      }
      evidence.authorityRequests = evidence.variants.reduce((n, v) => n + v.result.authorityRequests, 0); assert.equal(evidence.authorityRequests, 104);
      evidence.status = 'PASS';
    } finally { for (const item of owned.reverse()) try { await remove(item.id); } catch (error) { evidence.cleanupError = String(error.message).slice(0, 200); } save(); }
    return evidence;
  };
  try {
    let preparedPair = -1;
    for (const row of schedule()) {
      if (performance.now() - started >= LIMITS.totalMs) throw Error('TOTAL_DIAGNOSTIC_DEADLINE');
      if (preparedPair !== row.pair) { await pairedPrerequisite(row.pair); preparedPair = row.pair; }
      const since = performance.now(), result = { ...row, status: 'INCOMPLETE', ordinary: [], cancellations: [], warmup: [], safety: [], health: [], phases: [] };
      runDeadline = since + LIMITS.runMs; const runWatchdog = watchdog(LIMITS.runMs);
      report.runs.push(result); save(); const directory = path.join(scratch, row.runId), evidence = path.join(out, row.runId);
      const serviceBinds = freshServiceFiles(directory); fs.mkdirSync(evidence, { mode: 0o700 });
      const owned = []; let service, authority, driver;
      try {
        service = create('service', row, serviceBinds); owned.push(service);
        await waitForServiceReady(inspect, service.id);
        authority = create('authority', row, [{ source: path.join(directory, 'ipc'), target: '/private-ipc', ro: false }], service.id); owned.push(authority);
        result.authorityInit = await authority.rpc.request('init', authorityInitArgs(row.variant, freeze, Date.now()));
        result.serviceInitialization = {};
        result.stockInit = (await initializeObservedService(service, result.serviceInitialization)).init;
        const serviceGroup = ownCgroup(inspect(service.id).State.Pid), authorityGroup = ownCgroup(inspect(authority.id).State.Pid);
        result.cgroupIdentities = { service: serviceGroup, authority: authorityGroup };
        driver = create('driver', row, [{ source: path.join(directory, 'ipc'), target: '/private-ipc', ro: true },
          { source: evidence, target: '/evidence', ro: false }, { source: serviceGroup.directory, target: '/metrics/service', ro: true },
          { source: authorityGroup.directory, target: '/metrics/authority', ro: true }], service.id); owned.push(driver);
        result.driverInit = await driver.rpc.request('init', { gatewayPort: 29302, device: backing.deviceNumber, contextSha256: freeze.contextSha256 });
        for (const role of ['service', 'authority', 'driver']) validateResources(result.driverInit.resourceProof[role], role, backing.deviceNumber);
        const phase = async name => { const counters = { stock: await service.rpc.request('drain'), authority: await authority.rpc.request('audit') };
          const boundary = await driver.rpc.request('phase', { name }); result.phases.push({ ...boundary, counters }); return boundary; };
        const drain = () => drainWithinBudget(async remaining => {
          const stock = await service.rpc.request('drain', {}, remaining());
          const remainingMs = remaining(), auth = (await authority.rpc.request('drain', { remainingMs }, remainingMs)).snapshot;
          return { stock, authority: auth };
        }, ({ stock, authority: auth }) => {
            for (const value of [stock.nativeProviderStarts, stock.deniedNetwork, auth.counters?.unregisteredRequests, auth.counters?.unexpectedPrisma]) assert.ok(Number.isSafeInteger(value) && value >= 0, 'missing safety counters');
            assertSafety(stock.nativeProviderStarts === 0 && stock.deniedNetwork === 0, 'SAFETY_PROVIDER_ACCESS');
            assertSafety(auth.counters.unregisteredRequests === 0, 'SAFETY_UNREGISTERED_AUTHORITY');
            assertSafety(auth.counters.unexpectedPrisma === 0, 'SAFETY_UNEXPECTED_PRISMA');
            assert.equal(stock.handlerFailures, 0);
            return stock.active === 0 && stock.activeHandlers === 0 && stock.accounts?.queue?.pending === 0 && stock.accounts?.queue?.active === 0 && auth.active === 0 &&
              auth.settlement?.pending?.handlers === 0 && auth.settlement?.pending?.operations === 0;
        });
        const window = async (requests, kind) => { await authority.rpc.request('window', { entries: requests.map(({ subject, requestId }) => ({ subject, requestId })) });
          const terminal = await driver.rpc.request('requests', { rows: requests, class: kind }); verifyUniqueTerminals(terminal, requests.map(r => r.requestId));
          for (const attempt of terminal) { const code = safetyCode(attempt.firstEventReason) || safetyCode(attempt.reason); if (code) assertSafety(false, code); }
          const tail = await drain(); if (performance.now() - since >= LIMITS.runMs) throw Error('RUN_DEADLINE'); return { terminal, tail }; };
        await phase('startup');
        for (let attempt = 0; attempt < LIMITS.startupProbes; attempt++) { const before = performance.now(), response = await driver.rpc.request('health'); result.health.push(response);
          if (response.outcome === 'HTTP' && response.status === 200) break; if (attempt + 1 === LIMITS.startupProbes) throw Error('STARTUP_INCOMPLETE');
          await sleep(Math.max(0, LIMITS.startupCadenceMs - (performance.now() - before))); }
        result.contractPrerequisite = { pair: row.pair, status: report.prerequisites[row.pair].status, authorityRequests: 104 };
        assert.equal(result.contractPrerequisite.status, 'PASS');
        await phase('gateway-safety');
        const aliases = { 'revoke': 'revoke', 'restore-session': 'restoreSession', 'delete': 'deleteUser', 'restore-user': 'restoreUser',
          'contact-block': 'block', 'unblock': 'unblock', 'post-auth-delete': 'deleteBetweenReads', 'fail-session': 'sessionBackendFailure' };
        for (const [index, test] of SAFETY.entries()) {
          if (test.enabled !== undefined) await service.rpc.request('enabled', { value: test.enabled });
          if (test.name === 'authority-restored') await authority.rpc.request('mutate', { action: 'restoreAll', subject: test.subject });
          if (test.control) await authority.rpc.request('mutate', { action: aliases[test.control], subject: test.subject });
          const request = { subject: test.subject, requestId: `${row.runId}-safety-${index}`, ...(test.path ? { path: test.path } : {}), ...(test.forged ? { forged: true } : {}) };
          const before = await authority.rpc.request('audit'), response = await window([request], 'gatewaySafety'), terminal = response.terminal[0];
          validateGatewayContract(terminal, test, { beforeAuthorityRequests: before?.counters?.requests,
            afterAuthorityRequests: response.tail?.authority?.counters?.requests });
          result.safety.push({ name: test.name, ...terminal });
        }
        await phase('warmup');
        for (const subject of SUBJECTS) { const response = await window([{ subject, requestId: `${row.runId}-warmup-${subject}` }], 'warmup');
          const terminal = response.terminal[0]; result.warmup.push(terminal); if (terminal.outcome !== 'HTTP' || terminal.status !== 200) throw Error('WARMUP_INCOMPLETE'); }
        result.before = await drain(); const writes = countWrites(result.before.stock); await phase('ordinary');
        for (const wave of ordinaryWaves(row)) { const response = await window(wave.requests, 'ordinary');
          result.ordinary.push(...response.terminal.map(r => ({ ...r, cohort: wave.cohort, wave: wave.wave })));
          assertSafety(countWrites(response.tail.stock) === writes, 'SAFETY_LEDGER_WRITE'); }
        result.ordinaryAfterTail = await drain();
        await phase('cancellation'); const canceled = await window(SUBJECTS.slice(0, 5).map(subject => ({ subject, requestId: `${row.runId}-cancel-${subject}` })), 'cancellation');
        result.cancellations = canceled.terminal;
        await phase('tail-drain'); result.after = await drain(); assertSafety(countWrites(result.after.stock) === writes, 'SAFETY_LEDGER_WRITE');
        result.ledger = await service.rpc.request('quiesce'); assertSafety(result.ledger.sha256 === freeze.seed.sha256, 'SAFETY_LEDGER_CHANGED');
        result.driver = await stopPrivate(driver); assert.deepEqual(result.driver.sampleIssues, []);
        result.authority = await authority.rpc.request('audit');
        const authorityEvents = report.safeEvents.filter(event => event.container === authority.id);
        result.authorityReconciliation = reconcileAuthority([...result.safety, ...result.warmup, ...result.ordinary, ...result.cancellations], authorityEvents);
        assertSafety(result.authority.counters.unregisteredRequests === 0, 'SAFETY_UNREGISTERED_AUTHORITY');
        assertSafety(result.authority.counters.unexpectedPrisma === 0, 'SAFETY_UNEXPECTED_PRISMA');
        assert.equal(result.authority.counters.requests, result.authorityReconciliation.filter(row => row.admitted).length);
        result.cancellationCoverage = cancellationCoverage(result.cancellations, authorityEvents);
        result.summaries = row.cohorts.map(cohort => { const attempts = result.ordinary.filter(r => r.cohort === cohort); return { cohort,
          allAttempts: latencySummary(attempts), successfulBodies: latencySummary(attempts.filter(r => r.outcome === 'HTTP' && r.status === 200)),
          errors: attempts.filter(r => r.outcome !== 'HTTP' || r.status !== 200).length }; });
        assert.ok(performance.now() < runDeadline && performance.now() < overallDeadline && !report.hardWallDeadline, 'HARD_WALL_DEADLINE');
        result.status = classifyRun(result.ordinary); await stopPrivate(authority); await stopPrivate(service);
      } catch (error) { result.failure = String(error.message).slice(0, 300); Object.assign(result, failureVerdict(error)); throw error; }
      finally { clearTimeout(runWatchdog); for (const item of owned.reverse()) { try { await remove(item.id); } catch (error) { result.cleanupError = String(error.message).slice(0, 300); result.status = 'INCOMPLETE'; } item.rpc.child.stdin.end(); }
        result.elapsedMs = performance.now() - since; if (result.elapsedMs >= LIMITS.runMs) result.status = 'INCOMPLETE'; runDeadline = Infinity; save(); }
      if (result.status === 'INCOMPLETE') throw Error('INCOMPLETE_RUN_STOPS_DIAGNOSTIC');
    }
    assert.equal(report.runs.length, COUNTS.runs); const total = key => report.runs.reduce((sum, r) => sum + r[key].length, 0);
    assert.equal(total('ordinary'), COUNTS.ordinary); assert.equal(total('cancellations'), COUNTS.scheduledAborts); assert.equal(total('warmup'), COUNTS.warmup);
    assert.equal(total('safety'), COUNTS.gatewaySafety); assert.ok(total('health') <= COUNTS.healthMaximum);
    assert.equal(report.prerequisites.reduce((sum, r) => sum + r.authorityRequests, 0), COUNTS.directAuthority);
    report.status = report.runs.some(r => r.status === 'FAIL') ? 'FAIL' : 'PASS';
  } catch (error) { report.failure = String(error.message).slice(0, 300); Object.assign(report, failureVerdict(error)); }
  finally {
    clearTimeout(totalWatchdog); for (const id of [...containers].reverse()) try { await remove(id); } catch (error) { report.cleanup.push({ id, error: String(error.message).slice(0, 200) }); report.status = 'INCOMPLETE'; }
    if (containers.size === 0) {
      const st = fs.lstatSync(scratch); assert.equal(fs.realpathSync(scratch), scratch); assert.equal(st.ino, scratchStat.ino); assert.equal(st.dev, scratchStat.dev);
      assert.equal(st.uid, uid); assert.equal(fs.readFileSync(path.join(scratch, 'owned'), 'utf8'), runId);
      fs.rmSync(scratch, { recursive: true }); report.privateScratchRemoved = !fs.existsSync(scratch);
    }
    if (report.safetyStatus === 'FAIL') report.status = 'FAIL';
    report.elapsedMs = performance.now() - started; save();
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Deliberately no permissive defaults or environment-discovered database/source paths.
  throw Error('REVIEW_ONLY: no CLI launch entry is enabled; frozen implementation and explicit release review still required');
}
