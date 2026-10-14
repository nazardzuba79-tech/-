// QA-only, explicitly initialized adapter. No CLI, implicit image build/pull, or import-time workload.
// Docker/RPC/security/owned-cleanup rules retain auth-http-fixture-512/run.mjs semantics.
// The original six-run freeze is deliberately not reused as one-burst authorization.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import observer from '../auth-http-fixture-512/durability-observer.cjs';
import { LIMITS, ISSUER, sha256, validateResources } from '../auth-http-fixture-512/plan.mjs';
import { readCgroup } from '../auth-http-fixture-512/probe.mjs';
import { fixtureCommand, createObserverBinding, observedInitialization, collectObserverFailure,
  boundedRpcLines, safeRpcFailure, ownCgroup, verifyBackingDevice, waitForServiceReady,
  authorityInitArgs, validateKernelResources } from '../auth-http-fixture-512/run.mjs';
import { validateTraceFreeze, TRACE_BOUNDS } from './trace-plan.mjs';
import { validateLocalLaunch } from './launch-gate.mjs';
import { BASELINE, OVERLAYS, HELPERS } from './closure.mjs';
import { transform } from './instrument.mjs';
import { transformServiceEntry, ENTRY } from './service-overlay.mjs';
import { MEMBER_PATHS } from './prepare-receipts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OLD = 'services/stocks/auth-http-fixture-512/';
const NEW = 'services/stocks/auth-burst-trace-512/';
const SHA = /^[a-f0-9]{64}$/;
const safeCode = error => /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.message || '') ? error.message : 'TRACE_ADAPTER_FAILURE';
function regular(file, max = 16 * 1024 ** 2) {
  const resolved = path.resolve(file), st = fs.lstatSync(resolved);
  assert.ok(st.isFile() && !st.isSymbolicLink() && st.size <= max, 'TRACE_REGULAR_FILE_REQUIRED');
  assert.equal(fs.realpathSync(resolved), resolved, 'TRACE_FILE_SYMLINK_PARENT');
  return fs.readFileSync(resolved);
}
function relative(name) {
  assert.ok(typeof name === 'string' && !name.includes('\\') && !name.includes(':') && !name.includes('\0') &&
    !path.posix.isAbsolute(name) && name.split('/').every(x => x && x !== '.' && x !== '..'), 'TRACE_INVALID_PATH'); return name;
}
function checkRows(rows, allowLinks = false) {
  assert.ok(Array.isArray(rows) && rows.length > 0 && rows.length <= 100000, 'TRACE_INVENTORY_REQUIRED');
  const seen = new Set();
  for (const row of rows) { relative(row.path); assert.ok(!seen.has(row.path)); seen.add(row.path);
    if (Object.hasOwn(row, 'symlink')) {
      assert.ok(allowLinks); cross(Object.keys(row).sort(), ['path', 'symlink']);
      assert.ok(typeof row.symlink === 'string' && !path.posix.isAbsolute(row.symlink) && !row.symlink.includes('\\') && !row.symlink.includes('\0'));
      relative(path.posix.normalize(path.posix.join(path.posix.dirname(row.path), row.symlink))); continue;
    }
    assert.match(row.sha256 || '', SHA);
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0); }
}
function cross(a, b) { assert.deepEqual(a, b, 'TRACE_PREPARATION_BINDING_MISMATCH'); }

// Complete prepared bytes + successful compiler + dependency inventory, independently
// cross-bound to reviewed same-run receipts. Preparation by itself never authorizes HTTP.
export function verifyPreparedInputs(options, freeze, eligibility) {
  validateTraceFreeze(freeze); assert.equal(eligibility.eligible, true, 'TRACE_LAUNCH_NOT_ELIGIBLE');
  cross(eligibility.sourceSha, freeze.sourceSha); cross(eligibility.planSha256, freeze.planSha256);
  cross(eligibility.policySha256, freeze.reviewedPacketSha256);
  cross(eligibility.imageId, freeze.imageId); cross(eligibility.sourceContextSha256, freeze.contextSha256);
  cross(eligibility.seedSha256, freeze.seedSha256); cross(eligibility.derivedManifestSha256, options.overlay.manifestSha256);
  const reportBytes = regular(options.preparationPath, 32 * 1024 ** 2);
  assert.match(options.preparationSha256 || '', SHA); cross(sha256(reportBytes), options.preparationSha256);
  cross(eligibility.receiptKind, 'LOCAL_SAME_JOB');
  const localFile = (role, name, bytes) => {
    const row = eligibility.localFileBindings[role].find(value => value.path === name);
    cross(row, { path: name, bytes: bytes.length, sha256: sha256(bytes) });
  };
  localFile('preparation', MEMBER_PATHS.preparationReport, reportBytes);
  const report = JSON.parse(reportBytes), inside = report.inside;
  const insideBytes = regular(path.join(path.dirname(options.preparationPath), 'private/runtime-output/inside-proof.json'), 32 * 1024 ** 2);
  localFile('preparation', MEMBER_PATHS.insideProof, insideBytes); cross(JSON.parse(insideBytes), inside);
  localFile('preparation', MEMBER_PATHS.derivedManifest, regular(options.overlay.manifestPath, 1024 ** 2));
  cross(report.schema, 'stocks-auth-http-prepare-512-v1'); cross(report.status, 'PREPARED_NOT_AUTHORIZED');
  cross(report.sourceSha, freeze.sourceSha); cross(report.contextSha256, freeze.contextSha256); cross(report.image.id, freeze.imageId);
  cross(inside.status, 'PREPARED_NOT_AUTHORIZED'); cross(inside.contextSha256, freeze.contextSha256);
  cross(inside.runtime.node, 'v24.21.0'); cross(inside.runtime.platform, 'linux'); cross(inside.runtime.arch, 'x64');
  cross(inside.runtime.nodeSha256, freeze.nodeSha256); cross(inside.dependencies.bcryptSha256, freeze.bcryptSha256);
  cross(options.launch.policy.native.nodeSha256, freeze.nodeSha256); cross(options.launch.policy.native.bcryptSha256, freeze.bcryptSha256);
  cross(options.launch.policy.native.nodeVersion, inside.runtime.node); cross(options.launch.policy.native.baseImage, report.image.baseImage);
  const dependencies = inside.dependencies.files; checkRows(dependencies, true);
  cross(sha256(JSON.stringify(dependencies)), inside.dependencies.inventorySha256);
  cross(inside.dependencies.inventorySha256, options.launch.policy.native.dependencyInventorySha256);
  const bcrypt = dependencies.find(row => row.path === 'bcrypt/prebuilds/linux-x64/bcrypt.glibc.node');
  cross(bcrypt?.sha256, freeze.bcryptSha256);
  cross(inside.dependencies.nativeFiles, dependencies.filter(row => /\.node$/.test(row.path)));
  cross(sha256(JSON.stringify(inside.dependencies.nativeFiles)), options.launch.policy.native.nativeFilesSha256);
  assert.equal(inside.seed.closed, true); cross(inside.seed.integrity, 'ok'); cross(inside.seed.journal, 'delete'); cross(inside.seed.synchronous, 2);
  cross(inside.seed.sha256, freeze.seedSha256); const seed = regular(options.seedPath); cross(seed.length, inside.seed.bytes); cross(sha256(seed), freeze.seedSha256);
  localFile('inputs', MEMBER_PATHS.seed, seed);
  for (const suffix of ['-journal', '-wal', '-shm']) assert.ok(!fs.existsSync(options.seedPath + suffix), 'TRACE_SEED_NOT_CLOSED');
  const source = fs.realpathSync(options.sourceRoot); cross(source, path.resolve(options.sourceRoot));
  const manifestBytes = regular(path.join(source, 'runtime-source-manifest.json'), 1024 ** 2);
  localFile('preparation', MEMBER_PATHS.runtimeManifest, manifestBytes); const manifest = JSON.parse(manifestBytes);
  cross(manifest.schema, report.schema); cross(manifest.sourceSha, freeze.sourceSha); cross(manifest.contextSha256, freeze.contextSha256);
  checkRows(manifest.files); cross(sha256(JSON.stringify(manifest.files)), freeze.contextSha256);
  const byPath = new Map(manifest.files.map(row => [row.path, row]));
  for (const row of manifest.files) { const bytes = regular(path.join(source, row.path)); cross(bytes.length, row.bytes); cross(sha256(bytes), row.sha256); }
  const proofBytes = regular(path.join(source, 'compiled-proof.json'));
  cross(sha256(proofBytes), inside.compiler.proofSha256);
  const receipt = JSON.parse(options.launch.input.artifacts.compiled.proofText);
  cross(sha256(proofBytes), receipt.buildProvenanceSha256);
  const proof = JSON.parse(proofBytes); cross(proof.exitCode, 0); cross(proof.signal, null); cross(proof.sourcesUnchanged, true);
  assert.ok(proof.sourcesBefore.length > 0 && proof.outputs.length > 0);
  cross(sha256(JSON.stringify(proof.sourcesBefore)), proof.sourcesAfterHash);
  for (const row of proof.sourcesBefore) cross(byPath.get(relative(row.path))?.sha256, row.sha256);
  cross(byPath.get('package-lock.json')?.sha256, proof.packageLockSha256);
  cross(byPath.get('tsconfig.json')?.sha256, proof.tsconfig.sha256); cross(byPath.get('build.log')?.sha256, proof.logSha256);
  for (const row of proof.outputs) { const file = byPath.get(relative(row.path)); if (file) cross(file.sha256, row.sha256); }
  for (const row of proof.compilerFiles) cross(dependencies.find(item => item.path === 'typescript/' + row.file)?.sha256, row.sha256);
  const compiledRows = Object.entries(inside.compiler.compiled).map(([name, hash]) => ({ path: name, sha256: hash }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  cross(compiledRows, manifest.files.filter(row => row.path.startsWith('dist/') && row.path.endsWith('.js'))
    .map(({ path: name, sha256: hash }) => ({ path: name, sha256: hash })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  cross(sha256(JSON.stringify(compiledRows)), options.launch.policy.native.compiledClosureSha256);
  cross(sha256(JSON.stringify(compiledRows)), receipt.closureSha256);
  for (const row of inside.runtimeClosure.files) cross(byPath.get(relative(row.path))?.sha256, row.sha256);
  const visited = new Set(), pending = ['services/stocks-global/server.mjs', 'services/stocks-global/accounts.mjs',
    'services/stocks-global/identity.mjs', 'services/stocks-global/local-proxy.mjs', 'services/stocks-global/account-worker-runtime.mjs',
    OLD + 'durability-observer.cjs', 'dist/api/routes/account.js', 'dist/api/middleware/auth.js'];
  while (pending.length) {
    const name = pending.pop(); if (visited.has(name)) continue; visited.add(name); assert.ok(byPath.has(name), 'TRACE_EXECUTABLE_DEPENDENCY_MISSING');
    for (const match of regular(path.join(source, name)).toString().matchAll(/(?:from\s*|(?:import|require)\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(source, path.dirname(name), match[1]); assert.ok(target.startsWith(source + path.sep));
      const found = [target, target + '.js', target + '.mjs', target + '.json', path.join(target, 'index.js')]
        .find(file => fs.existsSync(file) && fs.lstatSync(file).isFile());
      assert.ok(found, 'TRACE_UNRESOLVED_LOCAL_DEPENDENCY'); pending.push(path.relative(source, found).split(path.sep).join('/'));
    }
  }
  for (const name of ['run.mjs', 'durability-observer.cjs', 'plan.mjs', 'probe.mjs'])
    cross(sha256(regular(path.join(HERE, '..', 'auth-http-fixture-512', name))), byPath.get(OLD + name)?.sha256);
  return { report, manifest, compiledProofSha256: sha256(proofBytes), source, seedSha256: sha256(seed) };
}

// Recompute guarded transformations rather than trusting caller-supplied new hashes.
export function verifyOverlay(options, freeze, baseManifest) {
  const supplied = options.overlay, bytes = regular(supplied.manifestPath, 1024 ** 2), manifest = JSON.parse(bytes);
  cross(sha256(bytes), supplied.manifestSha256); cross(manifest, supplied.manifest);
  cross(manifest.schema, 'stocks-one-burst-derived-512-v1'); cross(manifest.baseline, BASELINE);
  cross(manifest.sourceSha, freeze.sourceSha); cross(manifest.contextSha256, freeze.contextSha256);
  cross(manifest.overlays.map(x => x.path).sort(), [...OVERLAYS].sort()); cross(manifest.helpers.map(x => x.path).sort(), [...HELPERS].sort());
  const base = new Map(baseManifest.files.map(row => [row.path, row]));
  const output = path.dirname(fs.realpathSync(supplied.manifestPath));
  assert.ok(output !== options.sourceRoot && !output.startsWith(path.resolve(options.sourceRoot) + path.sep));
  const expectedMounts = [];
  for (const row of manifest.overlays) {
    const original = regular(path.join(options.sourceRoot, row.path)); cross(sha256(original), row.originalSha256); cross(base.get(row.path)?.sha256, row.originalSha256);
    const changed = row.path === ENTRY ? transformServiceEntry(original) : transform(row.path, original);
    const outputBytes = row.path === ENTRY ? changed.output : Buffer.from(changed.text);
    cross(sha256(outputBytes), row.outputSha256); cross(outputBytes.length, row.bytes);
    cross(row.hunksSha256, row.path === ENTRY ? changed.manifest.hunksSha256 : sha256(JSON.stringify(changed.proof.hunks)));
    const source = path.join(output, row.path); cross(regular(source), outputBytes);
    expectedMounts.push({ source, target: '/source/' + row.path, sha256: row.outputSha256, readOnly: true });
  }
  for (const row of manifest.helpers) {
    const source = path.join(output, row.path), helper = regular(path.join(HERE, path.basename(row.path)));
    cross(regular(source), helper); cross(helper.length, row.bytes); cross(sha256(helper), row.sha256);
    expectedMounts.push({ source, target: '/source/' + row.path, sha256: row.sha256, readOnly: true });
  }
  expectedMounts.push({ source: supplied.manifestPath, target: '/trace/derived-manifest.json', sha256: supplied.manifestSha256, readOnly: true });
  const sort = rows => [...rows].sort((a, b) => a.target.localeCompare(b.target)); cross(sort(supplied.mounts), sort(expectedMounts));
  return { manifest, mounts: expectedMounts.map(row => ({ source: row.source, target: row.target, ro: true })) };
}

export function traceCommand(role) {
  return role === 'driver' ? { entrypoint: 'node', args: [NEW + 'trace-driver.mjs'] } : fixtureCommand(role);
}
// Register before the daemon call: a timeout or malformed stdout is an unknown
// outcome, never evidence that no container was created.
export function trackContainerCreation(items, { role, name }, createCall) {
  assert.ok(!items.has(role)); assert.match(name, /^auth-http512-[a-z0-9-]+-(service|authority|driver)$/);
  const item = { id: null, name, role, rpc: null, stopped: false }; items.set(role, item);
  const id = createCall(); assert.match(id, /^[a-f0-9]{64}$/); item.id = id; return item;
}
export function reconcileOwnedContainer(item, runId, inspect) {
  const target = item.id || item.name;
  let info;
  try { info = inspect(target); }
  catch (error) {
    const lines = String(error?.stderr || '').trim().split(/\r?\n/);
    const missing = error?.status === 1 && lines.length === 1 &&
      [`Error: No such object: ${target}`, `Error response from daemon: No such container: ${target}`].includes(lines[0]);
    if (missing) return { absent: true };
    throw Error('TRACE_CONTAINER_OUTCOME_UNRESOLVED');
  }
  cross(info.Config.Labels?.['voltex.auth-http.run'], runId); cross(info.Config.Labels?.['voltex.auth-http.role'], item.role);
  cross(info.Name, '/' + item.name); assert.match(info.Id, /^[a-f0-9]{64}$/);
  if (item.id) cross(info.Id, item.id); item.id = info.Id;
  return { absent: false, info };
}
// Copied security contract from original validator; changes are the explicit
// read-only service overlays and the new finite driver entrypoint only.
export function validateTraceContainer(info, { runId, image, role, serviceId, uid, binds }) {
  cross(info.Image, image); cross(info.Config.Labels?.['voltex.auth-http.run'], runId); cross(info.Config.Labels?.['voltex.auth-http.role'], role);
  cross(info.Config.User, `${uid}:${uid}`); const command = traceCommand(role);
  cross(info.Config.Entrypoint, [command.entrypoint]); cross(info.Config.Cmd, command.args);
  const host = info.HostConfig; cross(host.ReadonlyRootfs, true); cross(host.CapDrop, ['ALL']); cross(host.CapAdd || [], []);
  cross(host.SecurityOpt, ['no-new-privileges']); cross(host.Privileged, false); cross(host.PidMode || '', '');
  assert.ok(['', 'private'].includes(host.IpcMode || '')); cross(host.NetworkMode, role === 'service' ? 'none' : 'container:' + serviceId);
  cross(host.PortBindings || {}, {}); cross(host.PublishAllPorts, false); cross(host.Memory, LIMITS.memory); cross(host.MemorySwap, LIMITS.memory);
  cross(host.NanoCpus, role === 'service' ? 50000000 : 500000000); cross(host.CpusetCpus, role === 'service' ? '0' : '1');
  cross(host.Devices || [], []); cross(host.PidsLimit, 64);
  const actual = info.Mounts.filter(m => m.Type === 'bind').map(m => ({ source: m.Source, target: m.Destination, ro: !m.RW })).sort((a, b) => a.target.localeCompare(b.target));
  cross(actual, [...binds].sort((a, b) => a.target.localeCompare(b.target)));
  assert.ok(info.Mounts.every(m => ['bind', 'tmpfs'].includes(m.Type)));
  const entries = info.Config.Env.map(value => { const at = value.indexOf('='); assert.ok(at > 0); return [value.slice(0, at), value.slice(at + 1)]; });
  const env = Object.fromEntries(entries); cross(Object.keys(env).length, entries.length);
  assert.ok(!info.Config.Env.some(e => /^(DATABASE_URL|DIRECT_URL|JWT_SECRET|NODE_OPTIONS|NODE_PATH|.*TOKEN|.*PASSWORD|.*SECRET)=/.test(e) &&
    !(role === 'authority' && e === 'JWT_SECRET=stocks-auth-http-disposable-fixture-secret')));
  if (role === 'service') {
    cross(actual.filter(m => !m.ro).map(m => m.target).sort(), ['/data', observer.DIRECTORY].sort());
    cross(actual.filter(m => m.ro).map(m => m.target).sort(), [...OVERLAYS, ...HELPERS].map(p => '/source/' + p).concat('/trace/derived-manifest.json').sort());
    cross(info.Config.Hostname, info.Id.slice(0, 12));
    observer.validateInvocation({ platform: 'linux', version: 'v24.21.0', arch: 'x64', uid, gid: uid,
      execPath: command.entrypoint, execArgv: command.args.slice(0, 2), argv: [command.entrypoint, command.args[2]],
      env, isMainThread: true, threadId: 0, workerData: null, filename: observer.OBSERVER });
  }
  return true;
}

// Private transport adapted from original rpcProcess: bounded JSONL, no secret/raw
// stderr exposure, absolute post-response timeout checks, one attach per container.
function attach(id, env, evidence, spawnImpl = spawn) {
  const child = spawnImpl('/usr/bin/docker', ['start', '-ai', id], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, closed = false, failure; const pending = new Map(), lines = boundedRpcLines();
  const fail = code => { failure = code; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error(code)); } pending.clear(); };
  child.stdout.on('data', bytes => { try { for (const line of lines.push(bytes)) {
    const message = JSON.parse(line);
    if (message.type === 'event') { assert.ok(evidence.events.length < 20000); evidence.events.push({ container: id, ...message.value }); continue; }
    const item = pending.get(message.id); assert.ok(item); pending.delete(message.id); clearTimeout(item.timer);
    if (performance.now() >= item.end) { item.reject(Error('PRIVATE_RPC_TIMEOUT')); continue; }
    if (message.error) { const safe = safeRpcFailure(message.error); evidence.errors.push({ child: id, ...safe }); item.reject(Error(safe.code)); }
    else item.resolve(message.result);
  } } catch { fail('INVALID_PRIVATE_RPC'); child.kill('SIGTERM'); } });
  child.stderr.on('data', bytes => { evidence.errors.push({ child: id, bytes: bytes.length, sha256: sha256(bytes) }); if (evidence.errors.length > 1024) child.kill('SIGTERM'); });
  child.once('close', code => { try { lines.end(); } catch { failure = 'INVALID_PRIVATE_RPC'; } closed = true; fail(failure || 'FIXTURE_CHILD_EXIT_' + code); });
  child.once('error', () => { closed = true; fail('DOCKER_ATTACH_FAILED'); });
  return { child, get closed() { return closed; }, get failure() { return failure; }, request(op, args, ms) {
    assert.ok(!closed && Number.isInteger(ms) && ms > 0 && ms <= TRACE_BOUNDS.functionalMs);
    const key = String(++sequence), line = JSON.stringify({ id: key, op, args }); assert.ok(Buffer.byteLength(line) < LIMITS.maxRpcBytes);
    return new Promise((resolve, reject) => { const end = performance.now() + ms;
      const timer = setTimeout(() => { pending.delete(key); reject(Error('PRIVATE_RPC_TIMEOUT')); }, ms);
      pending.set(key, { resolve, reject, timer, end }); child.stdin.write(line + '\n'); });
  } };
}

export function createTraceAdapter(options) {
  let initialized = false, aborted = false, closing = false, deadline = 0, scratch, scratchIdentity, env, uid, runId, backing, freeze, out;
  const items = new Map(), evidence = { events: [], errors: [], containers: [], cleanup: [], rawFiles: [] };
  const remaining = cap => { const value = Math.min(cap, deadline - performance.now()); assert.ok(value > 0, 'TRACE_ADAPTER_DEADLINE'); return Math.max(1, Math.floor(value)); };
  const execute = (binary, args, cap = 30000) => {
    const end = performance.now() + remaining(cap);
    const value = execFileSync(binary, args, { env, cwd: options.repository, encoding: 'utf8', timeout: remaining(cap), maxBuffer: 8 * 1024 ** 2 }).trim();
    assert.ok(performance.now() < end, 'TRACE_ADAPTER_DEADLINE'); return value;
  };
  const docker = (args, ms) => execute('/usr/bin/docker', args, ms), inspect = (id, ms) => JSON.parse(docker(['inspect', id], ms))[0];
  const kernel = info => { const identity = ownCgroup(info.State.Pid), counters = {};
    for (const field of ['cpu.max', 'cpu.stat', 'memory.max', 'memory.current', 'memory.peak', 'memory.events', 'memory.swap.max', 'io.max', 'io.stat', 'cpuset.cpus.effective'])
      counters[field] = regular(path.join(identity.directory, field), 65536).toString();
    return { identity, atMonoNs: process.hrtime.bigint().toString(), counters }; };
  const archive = () => {
    if (!scratch || !out) return;
    for (const name of ['driver-attempts.jsonl', 'driver-cgroups.jsonl']) {
      const source = path.join(scratch, 'evidence', name); if (!fs.existsSync(source)) continue;
      const bytes = regular(source, 32 * 1024 ** 2); const target = path.join(out, name);
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }); evidence.rawFiles.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
    }
    if (evidence.driverStopped) for (const row of evidence.driverStopped.files) {
      cross(evidence.rawFiles.find(file => file.path === row.file), { path: row.file, bytes: row.bytes, sha256: row.sha256 });
    }
    for (const name of ['binding.json', 'worker-connection.json', 'worker-connection-failure.json']) {
      const source = path.join(scratch, 'observation', name); if (!fs.existsSync(source)) continue;
      const bytes = regular(source, observer.LIMITS.proofBytes), target = path.join(out, 'observer-' + name);
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }); evidence.rawFiles.push({ path: path.basename(target), bytes: bytes.length, sha256: sha256(bytes) });
    }
  };
  const create = (role, binds, serviceId, base) => {
    assert.ok(!aborted); const command = traceCommand(role);
    const args = ['create', '--interactive', '--name', runId + '-' + role, '--label', 'voltex.auth-http.run=' + runId,
      '--label', 'voltex.auth-http.role=' + role, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '64', '--user', `${uid}:${uid}`, '--cpus', role === 'service' ? '.05' : '.5', '--cpuset-cpus', role === 'service' ? '0' : '1',
      '--memory', '256m', '--memory-swap', '256m', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m',
      '--network', role === 'service' ? 'none' : 'container:' + serviceId,
      ...(role === 'service' ? ['--device-read-bps', backing.device + ':1048576', '--device-write-bps', backing.device + ':131072'] : []),
      ...binds.flatMap(b => ['--mount', `type=bind,src=${b.source},dst=${b.target}${b.ro ? ',readonly' : ''}`]),
      '-e', 'AUTH_HTTP_FIXTURE_512=true', ...(role === 'authority' ? ['-e', 'STOCKS_AUTH_HTTP_FIXTURE=true', '-e', 'JWT_SECRET=stocks-auth-http-disposable-fixture-secret'] : []),
      '--entrypoint', command.entrypoint, freeze.imageId, ...command.args];
    const item = trackContainerCreation(items, { role, name: runId + '-' + role }, () => docker(args));
    const id = item.id; item.binds = binds; evidence.containers.push({ id, name: item.name, role });
    validateTraceContainer(inspect(id), { runId, image: freeze.imageId, role, serviceId, uid, binds });
    if (role === 'service') {
      const baseline = { files: base.manifest.files, runtimeImageId: freeze.imageId, sourceSha: freeze.sourceSha, contextSha256: freeze.contextSha256, seed: base.report.inside.seed };
      const reviewed = new Map(options.overlay.manifest.overlays.map(row => [row.path, row.outputSha256]));
      const derived = { ...baseline, files: baseline.files.map(row => ({ ...row, sha256: reviewed.get(row.path) || row.sha256 })) };
      const binding = createObserverBinding(derived, runId, { pair: 0, variant: 'C' }, id);
      const baselineBinding = createObserverBinding(baseline, runId, { pair: 0, variant: 'C' }, id);
      const bytes = Buffer.from(JSON.stringify(binding, null, 2) + '\n'), directory = path.join(scratch, 'observation');
      observer.ownedDirectory(directory, uid, uid); cross(fs.readdirSync(directory), []);
      fs.writeFileSync(path.join(directory, 'binding.json'), bytes, { flag: 'wx', mode: 0o600 });
      item.observation = { directory, binding, bindingSha256: sha256(bytes) };
      evidence.observerBinding = { baseline: baselineBinding, derived: binding, derivedManifestSha256: options.overlay.manifestSha256 };
    }
    item.rpc = attach(id, env, evidence); return item;
  };
  return {
    async initialize(input, ms) {
      assert.ok(!initialized); initialized = true; freeze = input; validateTraceFreeze(freeze); deadline = performance.now() + ms;
      assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64'); uid = process.getuid(); assert.ok(uid > 0 && uid === process.getgid());
      assert.ok(os.availableParallelism() >= 2);
      // No Docker call before exact same-run source/artifact eligibility and local byte verification.
      env = { PATH: '/usr/bin:/bin', LANG: 'C' };
      const eligibility = validateLocalLaunch(options.launch.input, options.launch.policy, { git: args => execute('/usr/bin/git', args) });
      assert.equal(eligibility.eligible, true, 'TRACE_LAUNCH_NOT_ELIGIBLE');
      // The gate verifies Git objects; additionally reject dirty host QA files before loading them into containers.
      for (const name of fs.readdirSync(HERE)) {
        assert.ok(/\.(?:mjs|json|md)$/.test(name), 'TRACE_UNREVIEWED_HOST_QA_FILE');
        const committed = execFileSync('/usr/bin/git', ['cat-file', 'blob', freeze.sourceSha + ':' + NEW + name],
          { env, cwd: options.repository, timeout: remaining(10000), maxBuffer: 16 * 1024 ** 2 });
        cross(sha256(regular(path.join(HERE, name))), sha256(committed));
      }
      const base = verifyPreparedInputs(options, freeze, eligibility), overlay = verifyOverlay(options, freeze, base.manifest);
      const driverFiles = ['trace-driver.mjs', 'trace-plan.mjs'].map(name => {
        const expected = { source: path.join(HERE, name), target: '/source/' + NEW + name, sha256: sha256(regular(path.join(HERE, name))) };
        cross(options.driverFiles.find(row => row.target === expected.target), expected); return { source: expected.source, target: expected.target, ro: true }; });
      cross(options.driverFiles.length, 2);
      out = path.resolve(options.outputDirectory); assert.ok(!fs.existsSync(out)); cross(fs.realpathSync(path.dirname(out)), path.dirname(out));
      assert.ok(!out.startsWith(fs.realpathSync(options.repository) + path.sep) && out !== fs.realpathSync(options.repository), 'TRACE_OUTPUT_MUST_BE_OUTSIDE_GIT');
      fs.mkdirSync(out, { mode: 0o700 }); const config = path.join(out, 'private-docker-config'); fs.mkdirSync(config, { mode: 0o700 });
      env = { ...env, DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONFIG: config };
      backing = verifyBackingDevice(fs.realpathSync(options.disk), fs.realpathSync(options.device), execute); cross(backing.deviceNumber, freeze.device);
      const image = JSON.parse(docker(['image', 'inspect', freeze.imageId]))[0];
      cross(image.Id, freeze.imageId); cross(image.Architecture, 'amd64'); cross(image.Os, 'linux');
      cross(image.Config.Labels?.['org.opencontainers.image.revision'], freeze.sourceSha); cross(image.Config.Labels?.['voltex.auth-http.context'], freeze.contextSha256);
      cross(image.Config, base.report.image.config);
      runId = 'auth-http512-' + randomUUID(); scratch = path.join(fs.realpathSync(options.disk), runId);
      fs.mkdirSync(scratch, { mode: 0o700 }); fs.writeFileSync(path.join(scratch, 'owned'), runId, { flag: 'wx', mode: 0o600 }); scratchIdentity = fs.lstatSync(scratch);
      for (const name of ['data', 'ipc', 'observation', 'evidence']) fs.mkdirSync(path.join(scratch, name), { mode: 0o700 });
      const seed = path.join(scratch, 'data/accounts.sqlite'); fs.copyFileSync(options.seedPath, seed, fs.constants.COPYFILE_EXCL); fs.chmodSync(seed, 0o600); cross(sha256(regular(seed)), freeze.seedSha256);
      const service = create('service', [{ source: path.join(scratch, 'data'), target: '/data', ro: false },
        { source: path.join(scratch, 'observation'), target: observer.DIRECTORY, ro: false }, ...overlay.mounts], undefined, base);
      await waitForServiceReady((id, cap) => inspect(id, Math.min(cap, remaining(cap))), service.id);
      const authority = create('authority', [{ source: path.join(scratch, 'ipc'), target: '/private-ipc', ro: false }], service.id, base);
      const authInit = await authority.rpc.request('init', authorityInitArgs('C', freeze, Date.now()), remaining(15000));
      const { directory, binding, bindingSha256 } = service.observation, observation = {};
      evidence.observation = observation;
      await observedInitialization({ binding, bindingSha256, evidence: observation, timeoutMs: remaining(15000),
        inspect: cap => inspect(service.id, cap), snapshot: info => { const value = kernel(info); validateKernelResources(value, 'service', freeze.device); return value; },
        init: cap => service.rpc.request('init', { issuer: ISSUER, authority: 'http://127.0.0.1:29301', gatewayPort: 29302, servicePort: 29303,
          seedSha256: freeze.seedSha256, contextSha256: freeze.contextSha256, derivedManifestSha256: options.overlay.manifestSha256 }, cap),
        readFailure: () => collectObserverFailure({ directory, uid, gid: uid, bindingSha256 }),
        readProof: () => { observer.ownedDirectory(directory, uid, uid);
          cross(fs.readdirSync(directory).sort(), ['binding.json', 'worker-connection.json']); cross(sha256(regular(path.join(directory, 'binding.json'))), bindingSha256);
          const bytes = observer.boundedFile(path.join(directory, 'worker-connection.json'), observer.LIMITS.proofBytes, { uid, gid: uid, privateFile: true }).bytes;
          return { proof: JSON.parse(bytes), sha256: sha256(bytes), bytes: bytes.length, failurePresent: false }; } });
      const trace = observation.init.trace;
      cross(trace?.active, false); cross(trace.generation, 0); cross(trace.flags, []); cross(trace.overflow, false); cross(trace.incomplete, false);
      cross(trace.counts, { main: 0, worker: 0, requests: 0 });
      const serviceCg = ownCgroup(inspect(service.id).State.Pid), authorityCg = ownCgroup(inspect(authority.id).State.Pid);
      const driver = create('driver', [{ source: path.join(scratch, 'ipc'), target: '/private-ipc', ro: true },
        { source: path.join(scratch, 'evidence'), target: '/evidence', ro: false },
        { source: serviceCg.directory, target: '/metrics/service', ro: true }, { source: authorityCg.directory, target: '/metrics/authority', ro: true }, ...driverFiles], service.id, base);
      const driverInit = await driver.rpc.request('init', { contextSha256: freeze.contextSha256, gatewayPort: 29302, device: freeze.device }, remaining(15000));
      for (const role of ['service', 'authority', 'driver']) validateResources(driverInit.resourceProof[role], role, freeze.device);
      const result = { validatedProofs: { sourceSha: freeze.sourceSha, contextSha256: freeze.contextSha256, imageId: image.Id,
        nodeSha256: base.report.inside.runtime.nodeSha256, bcryptSha256: base.report.inside.dependencies.bcryptSha256, seedSha256: freeze.seedSha256,
        compiledProofSha256: base.compiledProofSha256, workerProofSha256: observation.observation.sha256, workerSynchronous: 2, workerJournal: 'delete' },
        resourceProofs: Object.fromEntries(['service', 'authority', 'driver'].map(role => [role, driverInit.resourceProof[role]])),
        authorityMode: 'compact', networkScope: 'own-loopback-only', trace,
        backing, eligibility, observation, authInit, image: { id: image.Id, config: image.Config }, observerBinding: evidence.observerBinding };
      evidence.initialization = result; assert.ok(performance.now() < deadline, 'TRACE_ADAPTER_DEADLINE'); return result;
    },
    async rpc(role, op, input = {}, ms) {
      assert.ok(initialized && !aborted && !closing); const item = items.get(role); assert.ok(item?.rpc);
      const result = await item.rpc.request(op, input, Math.max(1, Math.floor(ms)));
      if (op === 'stop') { item.stopped = true; item.rpc.child.stdin.end(); if (role === 'driver') evidence.driverStopped = result; }
      return result;
    },
    abort(code) { aborted = true; evidence.abort = /^[A-Z][A-Z0-9_]+$/.test(code) ? code : 'TRACE_ABORT'; },
    async close(ms) {
      closing = true; deadline = performance.now() + ms;
      const errors = [];
      for (const item of [...items.values()].reverse()) {
        try {
          if (item.rpc && !item.rpc.closed && !item.stopped) { const result = await item.rpc.request('stop', {}, remaining(5000)); item.stopped = true; item.rpc.child.stdin.end();
            if (item.role === 'driver') evidence.driverStopped = result; }
        } catch (error) { errors.push(safeCode(error)); }
        try {
          const reconciled = reconcileOwnedContainer(item, runId, inspect);
          if (reconciled.absent) { evidence.cleanup.push({ name: item.name, role: item.role, absent: true }); items.delete(item.role); continue; }
          let info = reconciled.info;
          const end = Math.min(deadline, performance.now() + 5000);
          while (info.State.Running && performance.now() < end) { await sleep(Math.min(100, remaining(100))); info = inspect(item.id); }
          const forcedStop = info.State.Running;
          if (forcedStop) docker(['stop', '--time', '3', item.id], remaining(5000));
          info = inspect(item.id); cross(info.State.Running, false);
          evidence.cleanup.push({ id: item.id, role: item.role, exitCode: info.State.ExitCode, oomKilled: info.State.OOMKilled, forcedStop });
          docker(['rm', item.id]); items.delete(item.role);
          if (item.rpc) {
            const attachEnd = Math.min(deadline, performance.now() + 5000);
            while (!item.rpc.closed && performance.now() < attachEnd) await sleep(Math.min(25, remaining(25)));
            if (!item.rpc.closed) errors.push('TRACE_PRIVATE_ATTACH_CLOSE_INCOMPLETE');
          }
          if (forcedStop || info.State.OOMKilled || info.State.ExitCode !== 0) errors.push('TRACE_CONTAINER_CLEANUP_INCOMPLETE');
          if (item.rpc?.failure && !/^FIXTURE_CHILD_EXIT_0$/.test(item.rpc.failure)) errors.push(item.rpc.failure);
        } catch (error) { errors.push(safeCode(error)); }
      }
      let archived = false; try { archive(); archived = true; } catch (error) { errors.push(safeCode(error)); }
      if (scratch && items.size === 0 && archived) try {
        cross(fs.realpathSync(scratch), scratch); const st = fs.lstatSync(scratch);
        cross(st.uid, uid); cross(st.ino, scratchIdentity.ino); cross(st.dev, scratchIdentity.dev);
        cross(regular(path.join(scratch, 'owned')).toString(), runId);
        assert.ok(scratch.startsWith(fs.realpathSync(options.disk) + path.sep) && path.basename(scratch) === runId);
        fs.rmSync(scratch, { recursive: true });
      } catch (error) { errors.push(safeCode(error)); }
      evidence.cleanupErrors = errors;
      if (out) fs.writeFileSync(path.join(out, 'adapter-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      return { removed: items.size === 0 && (!scratch || !fs.existsSync(scratch)), errors, containers: evidence.cleanup, rawFiles: evidence.rawFiles,
        image: 'Prepared image ownership remains with launcher; adapter neither builds nor removes it.' };
    },
  };
}
