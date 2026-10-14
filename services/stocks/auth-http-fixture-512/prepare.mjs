// Preparation only. This program cannot launch the auth/Stocks HTTP diagnostic.
// Run only on a disposable Linux runner after review; importing it has no effects.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspect as inspectValue } from 'node:util';
import { ISSUER, SUBJECTS, SEED, PLAN_ID, planHash, validateResources, verifyImageClosure } from './plan.mjs';
import { ownCgroup, verifyBackingDevice } from './run.mjs';

export const PREPARE_SCHEMA = 'stocks-auth-http-prepare-512-v1';
export const BASE_IMAGE = 'docker.io/library/node@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd';
export const FREEZE_BASE_IMAGE_ALIAS = BASE_IMAGE.replace('docker.io/library/', '');
export const DOCKERFILE_SHA256 = 'f5ea53d2dbc94aecc3bd87c4b266fd3b32c48a63baf3342ddb410e91797931ff';
export const BOUNDS = Object.freeze({ archiveBytes: 256 * 1024 ** 2, archiveFiles: 10000,
  expandedBytes: 512 * 1024 ** 2, fileBytes: 16 * 1024 ** 2, imageBytes: 3 * 1024 ** 3,
  dependencyFiles: 120000, dependencyBytes: 2 * 1024 ** 3, commandBytes: 4 * 1024 ** 2,
  pullMs: 180000, buildMs: 600000, containerMs: 120000, idleMs: 30000, commandMs: 30000, totalMs: 1500000 });
export const IDLE_PROGRAM = "setTimeout(() => process.exit(0), 30000)";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURE = 'services/stocks/auth-http-fixture-512/';
const SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/;
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(bytes.toString('utf8'));
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'PREPARE_UNKNOWN_FIELD');
function regular(file, maximum = BOUNDS.fileBytes) {
  const s = fs.lstatSync(file); assert.ok(s.isFile() && !s.isSymbolicLink() && s.size <= maximum, 'PREPARE_FILE_BOUND');
  return fs.readFileSync(file);
}
function digestFile(file, maximum) {
  const st = fs.lstatSync(file); assert.ok(st.isFile() && !st.isSymbolicLink() && st.size <= maximum, 'PREPARE_FILE_BOUND');
  const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024), hash = createHash('sha256'); let count = 0;
  try { for (;;) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break; count += n; assert.ok(count <= maximum); hash.update(buffer.subarray(0, n)); } }
  finally { fs.closeSync(fd); }
  assert.equal(count, st.size, 'PREPARE_FILE_CHANGED'); return hash.digest('hex');
}
function write(file, bytes, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: mode === 0o644 ? 0o755 : 0o700 });
  fs.writeFileSync(file, bytes, { flag: 'wx', mode });
}
function writeJson(file, value, mode) { write(file, JSON.stringify(value, null, 2) + '\n', mode); }
function absolute(value) { assert.ok(typeof value === 'string' && path.isAbsolute(value) && !/[\r\n,\x00]/.test(value), 'PREPARE_ABSOLUTE_PATH'); }
export function safeRelative(value) {
  assert.ok(typeof value === 'string' && /^[A-Za-z0-9_.@/-]+$/.test(value) && !value.startsWith('/') && !value.split('/').some(p => !p || p === '.' || p === '..'), 'PREPARE_RELATIVE_PATH');
  assert.ok(!value.split('/').some(p => p === '.git' || p === '.env' || p.startsWith('.env.') || p === '.npmrc') && !/\.(?:sqlite|db|pem|key)$/i.test(value), 'PREPARE_SECRET_PATH');
  return value;
}
export function validateConfig(c) {
  keys(c, ['schema', 'sourceSha', 'stage', 'baseImage', 'python', 'output', 'device']);
  assert.equal(c.schema, PREPARE_SCHEMA); assert.match(c.sourceSha, COMMIT); assert.equal(c.baseImage, BASE_IMAGE);
  keys(c.stage, ['archive', 'sha256', 'sourceSha', 'runId', 'artifactId', 'buildProvenanceSha256']);
  absolute(c.stage.archive); assert.match(c.stage.sha256, SHA); assert.match(c.stage.buildProvenanceSha256, SHA);
  assert.equal(c.stage.sourceSha, c.sourceSha, 'PREPARE_SAME_HEAD_REQUIRED');
  for (const k of ['runId', 'artifactId']) assert.match(c.stage[k], /^[1-9][0-9]{1,19}$/);
  keys(c.python, ['executable', 'sha256']); absolute(c.python.executable); assert.match(c.python.sha256, SHA);
  absolute(c.output); absolute(c.device); assert.ok(c.device.startsWith('/dev/') && !c.device.includes('..'), 'PREPARE_BLOCK_DEVICE');
  return c;
}
export function sourceAllowed(p) {
  try { safeRelative(p); } catch { return false; }
  return ['package.json', 'package-lock.json', 'frontend/package-lock.json', 'tsconfig.json',
    'scripts/qa-stocks-principal-projection.cjs', 'scripts/qa-stocks-package-builder.cjs',
    'services/stocks/targeted-http-512/plan.mjs',
    'services/stocks-simulator/engine.mjs'].includes(p)
    || (p.startsWith('src/') && p.endsWith('.ts') && !p.endsWith('.test.ts'))
    || /^services\/stocks-global\/[A-Za-z0-9_-]+\.mjs$/.test(p)
    || [ 'authority.cjs', 'authority-entry.cjs', 'plan.mjs', 'run.mjs', 'probe.mjs', 'stock-child.mjs', 'prepare.mjs', 'Dockerfile' ].some(n => p === FIXTURE + n);
}
export function validateLock(lock) {
  assert.ok([2, 3].includes(lock.lockfileVersion) && lock.packages);
  for (const [name, row] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.ok(name.startsWith('node_modules/') && !row.link, 'PREPARE_EXTERNAL_DEPENDENCY');
    assert.ok(typeof row.resolved === 'string' && /^https:\/\/registry\.npmjs\.org\/[^?#\s]+$/.test(row.resolved), 'PREPARE_REGISTRY_ONLY');
    assert.match(row.integrity || '', /^sha512-[A-Za-z0-9+/]+=*$/, 'PREPARE_LOCK_INTEGRITY');
  }
}
export function validateDockerfile(bytes) {
  assert.equal(sha(bytes), DOCKERFILE_SHA256, 'PREPARE_REVIEWED_DOCKERFILE_REQUIRED');
}
export function parseGitBatch(bytes, rows) {
  const results = []; let offset = 0, total = 0;
  for (const row of rows) {
    const end = bytes.indexOf(10, offset); assert.ok(end >= offset && end - offset < 128, 'PREPARE_GIT_HEADER');
    const header = bytes.subarray(offset, end).toString(), match = /^([a-f0-9]{40}) blob ([0-9]+)$/.exec(header);
    assert.ok(match && match[1] === row.blob, 'PREPARE_GIT_BLOB_ID'); const size = Number(match[2]);
    assert.ok(Number.isSafeInteger(size) && size <= BOUNDS.fileBytes, 'PREPARE_GIT_BLOB_BOUND');
    total += size; assert.ok(total <= BOUNDS.expandedBytes, 'PREPARE_GIT_TOTAL_BOUND'); offset = end + 1;
    assert.ok(offset + size < bytes.length && bytes[offset + size] === 10, 'PREPARE_GIT_TRUNCATED');
    results.push(bytes.subarray(offset, offset + size)); offset += size + 1;
  }
  assert.equal(offset, bytes.length, 'PREPARE_GIT_EXTRA_OUTPUT'); return results;
}
export function validateStage(manifest, proofBytes, log, files, c, stageReport) {
  assert.equal(stageReport?.status, 'PASS', 'PREPARE_STAGE_NOT_SUCCESSFUL');
  assert.equal(stageReport.fixtureOnly, true); assert.equal(stageReport.productionAccess, false);
  assert.ok(Array.isArray(stageReport.cases) && stageReport.cases.length === 5 && stageReport.cases.every(row => row.status === 'PASS'));
  const proof = json(proofBytes); assert.equal(sha(proofBytes), c.stage.buildProvenanceSha256);
  assert.equal(manifest.sourceSha, c.sourceSha, 'PREPARE_SAME_HEAD_REQUIRED');
  assert.equal(manifest.fixtureOnly, true); assert.deepEqual(manifest.workingTreeChanges, []);
  assert.equal(manifest.buildProvenanceSha256, sha(proofBytes)); assert.equal(manifest.nodeModulesCopied, false);
  assert.equal(manifest.migration, 'NOT_USED'); assert.equal(manifest.productionEntrypoint, 'NOT_USED');
  assert.equal(proof.exitCode, 0); assert.equal(proof.signal, null); assert.equal(proof.sourcesUnchanged, true);
  assert.equal(sha(log), proof.logSha256); assert.ok(/^v22\./.test(proof.node), 'PREPARE_COMPILER_NODE_PROVENANCE');
  assert.ok(Array.isArray(proof.outputs) && Array.isArray(manifest.files));
  const emitted = new Map(proof.outputs.map(row => [row.path, row.sha256]));
  const packaged = new Map(manifest.files.map(row => [row.path, row]));
  assert.equal(packaged.size, manifest.files.length, 'PREPARE_DUPLICATE_PACKAGE_PATH');
  for (const [name, bytes] of files) {
    safeRelative(name); assert.match(name, /^dist\/[A-Za-z0-9_/-]+\.js$/);
    const row = packaged.get(name); assert.ok(row, 'PREPARE_UNMANIFESTED_EMIT');
    assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256); assert.equal(sha(bytes), emitted.get(name));
  }
  assert.equal(files.size, manifest.files.filter(row => row.path.startsWith('dist/')).length, 'PREPARE_MISSING_EMIT');
  for (const p of ['dist/api/routes/account.js', 'dist/api/middleware/auth.js', 'dist/api/asyncRoute.js', 'dist/services/ContactEmailPolicy.js']) assert.ok(files.has(p));
  return proof;
}

// Python is explicitly hash-bound. Only approved public build members are extracted;
// all names/types/size bounds (including ignored members) are checked first.
export const ZIP_EXTRACTOR = String.raw`
import sys, zipfile, pathlib, stat, re, json
archive, dest = sys.argv[1:]
root = pathlib.Path(dest)
assert not root.exists(), 'PREPARE_EXTRACT_FRESH'
with zipfile.ZipFile(archive) as z:
    rows = z.infolist(); assert len(rows) <= 10000, 'PREPARE_ZIP_COUNT'
    seen = set(); total = 0; selected = []
    for row in rows:
        name = row.filename
        assert re.fullmatch(r'[A-Za-z0-9_.@/-]+', name) and not name.startswith('/'), 'PREPARE_ZIP_PATH'
        parts = name.rstrip('/').split('/')
        assert all(p not in ('', '.', '..') for p in parts), 'PREPARE_ZIP_TRAVERSAL'
        normal = '/'.join(parts); assert normal not in seen, 'PREPARE_ZIP_DUPLICATE'; seen.add(normal)
        kind = stat.S_IFMT(row.external_attr >> 16)
        assert kind in (0, stat.S_IFREG, stat.S_IFDIR), 'PREPARE_ZIP_SPECIAL'
        assert row.file_size <= 16 * 1024**2 and not row.flag_bits & 1, 'PREPARE_ZIP_FILE_BOUND'
        total += row.file_size; assert total <= 512 * 1024**2, 'PREPARE_ZIP_TOTAL_BOUND'
        assert row.file_size <= max(row.compress_size, 1) * 500, 'PREPARE_ZIP_RATIO'
        if name in ('build-provenance.json', 'build.log', 'report.json', 'package/manifest.json') or re.fullmatch(r'package/dist/[A-Za-z0-9_/-]+[.]js', name):
            assert not row.is_dir(), 'PREPARE_ZIP_REQUIRED_FILE'; selected.append(row)
    assert {'build-provenance.json','build.log','report.json','package/manifest.json'} <= {r.filename for r in selected}, 'PREPARE_ZIP_REQUIRED'
    root.mkdir(mode=0o700)
    for row in selected:
        out = root / row.filename; out.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with out.open('xb') as f: f.write(z.read(row))
        out.chmod(0o600)
print(json.dumps({'archiveMembers':len(rows),'archiveExpandedBytes':total,'selectedMembers':len(selected)}))
`;

function walk(root, maximum = BOUNDS.dependencyFiles, limit = BOUNDS.dependencyBytes, allowLinks = false) {
  const rows = []; let total = 0;
  const visit = directory => {
    for (const e of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, e.name), relative = path.relative(root, file).replaceAll('\\', '/');
      if (e.isDirectory()) visit(file);
      else if (e.isSymbolicLink() && allowLinks) {
        const resolved = fs.realpathSync(file); assert.ok(resolved.startsWith(fs.realpathSync(root) + path.sep), 'PREPARE_DEPENDENCY_LINK_ESCAPE');
        rows.push({ path: relative, symlink: fs.readlinkSync(file) });
      } else {
        assert.ok(e.isFile(), 'PREPARE_SPECIAL_FILE'); const size = fs.statSync(file).size;
        total += size; assert.ok(total <= limit); rows.push({ path: relative, bytes: size, sha256: digestFile(file, 64 * 1024 ** 2) });
      }
      assert.ok(rows.length <= maximum);
    }
  }; visit(root); return rows.sort((a, b) => a.path.localeCompare(b.path));
}
function kernel(info) {
  const identity = ownCgroup(info.State.Pid);
  const fields = ['cpu.max', 'cpu.stat', 'memory.max', 'memory.current', 'memory.peak', 'memory.events', 'memory.swap.max', 'io.max', 'io.stat', 'cpuset.cpus.effective'];
  const counters = Object.fromEntries(fields.map(n => [n, regular(path.join(identity.directory, n), 65536).toString()]));
  return { identity, atMonoNs: process.hrtime.bigint().toString(), counters };
}
export function validateImage(info, sourceSha, contextSha256) {
  assert.match(info.Id, /^sha256:[a-f0-9]{64}$/); assert.equal(info.Os, 'linux'); assert.equal(info.Architecture, 'amd64');
  assert.equal(info.Config.User, '10001:10001'); assert.deepEqual(info.Config.Entrypoint, ['node']);
  assert.deepEqual(info.Config.Cmd, ['-e', "throw new Error('REVIEW_ONLY_NO_DEFAULT_ENTRY')"]);
  assert.equal(info.Config.Labels['org.opencontainers.image.revision'], sourceSha);
  assert.equal(info.Config.Labels['voltex.auth-http.context'], contextSha256);
  assert.deepEqual((info.Config.Env || []).map(v => v.split('=')[0]).sort(), ['NODE_VERSION', 'PATH', 'YARN_VERSION']);
  assert.ok(info.Config.Env.includes('NODE_VERSION=24.21.0')); return info.Id;
}
export function validatePreparationContainer(info, expected) {
  const h = info.HostConfig, c = info.Config;
  assert.equal(info.Image, expected.image); assert.equal(c.User, expected.uid);
  assert.equal(c.Labels['voltex.auth-http.prepare'], expected.owner); assert.equal(c.Labels['voltex.auth-http.role'], expected.role);
  assert.deepEqual(c.Entrypoint, ['node']); assert.deepEqual(c.Cmd, expected.command);
  assert.equal(h.NetworkMode, expected.network); assert.equal(h.ReadonlyRootfs, true); assert.equal(h.Privileged, false);
  assert.ok(['', 'private'].includes(h.PidMode) && h.IpcMode === 'private');
  assert.deepEqual(h.CapDrop, ['ALL']); assert.ok(!h.CapAdd?.length && !h.Devices?.length && !Object.keys(h.PortBindings || {}).length && !h.PublishAllPorts);
  assert.deepEqual(h.SecurityOpt, ['no-new-privileges']); assert.equal(h.Memory, 268435456); assert.equal(h.MemorySwap, 268435456);
  assert.equal(h.NanoCpus, expected.role === 'service' ? 50000000 : 500000000);
  assert.equal(h.CpusetCpus, expected.role === 'service' ? '0' : '1');
  assert.deepEqual((info.Mounts || []).filter(m => m.Type === 'bind').map(m => ({ source: m.Source, target: m.Destination, readOnly: !m.RW })), expected.mounts);
  assert.ok((info.Mounts || []).every(m => ['bind', 'tmpfs'].includes(m.Type)));
  assert.deepEqual((c.Env || []).map(v => v.split('=')[0]).sort(), ['NODE_VERSION', 'PATH', 'PREPARE_512_ONLY', 'YARN_VERSION']);
  assert.ok(c.Env.includes('PREPARE_512_ONLY=true'));
  return true;
}
export function validateSeedRows(rows, fixedTime) {
  assert.equal(rows.length, SUBJECTS.length); const byId = new Map(rows.map(r => [r.id, r])); assert.equal(byId.size, SUBJECTS.length);
  return SUBJECTS.map(subject => {
    const id = sha(JSON.stringify([ISSUER, subject])), row = byId.get(id); assert.ok(row, 'PREPARE_SEED_OWNER');
    const ledger = JSON.parse(row.ledger); assert.equal(ledger.schema, SEED.schema); assert.equal(ledger.revision, 0); assert.equal(ledger.createdAt, fixedTime);
    assert.deepEqual(ledger.wallets, SEED.wallets); assert.equal(ledger.settings.feeBps, 0);
    assert.deepEqual(ledger.orders, []); assert.deepEqual(ledger.fills, []); assert.deepEqual(ledger.positions, {});
    assert.deepEqual(ledger.quotes, {}); assert.deepEqual(ledger.adjustments, []);
    assert.deepEqual(ledger.realized, { USDT: '0.00000000', USDC: '0.00000000' });
    return { subject, id, ledgerSha256: sha(row.ledger) };
  });
}

async function prepareInside() {
  assert.equal(process.platform, 'linux'); assert.equal(process.version, 'v24.21.0'); assert.equal(process.arch, 'x64');
  assert.equal(process.env.PREPARE_512_ONLY, 'true'); assert.ok(process.getuid() > 0);
  assert.equal(ROOT, '/source'); assert.equal(process.cwd(), '/source');
  assert.ok(Object.keys(process.env).every(k => ['NODE_VERSION', 'PATH', 'PREPARE_512_ONLY', 'YARN_VERSION', 'HOME', 'HOSTNAME'].includes(k)), 'PREPARE_PRIVATE_ENV_DENIED');
  process.umask(0o077);
  const manifest = json(regular('/source/runtime-source-manifest.json', 1024 * 1024 - 1));
  verifyImageClosure(manifest.contextSha256);
  const require = createRequire(import.meta.url);
  const verifiedBuild = require('/source/scripts/qa-stocks-principal-projection.cjs').verifyBuild('/source/compiled-proof.json', '/source', '/source');
  const runtimeClosure = require('/source/scripts/qa-stocks-package-builder.cjs').closure('/source');
  const dependencies = walk('/source/node_modules', BOUNDS.dependencyFiles, BOUNDS.dependencyBytes, true);
  const natives = dependencies.filter(row => /\.node$/.test(row.path));
  const bcrypt = natives.find(row => row.path === 'bcrypt/prebuilds/linux-x64/bcrypt.glibc.node'); assert.ok(bcrypt, 'PREPARE_BCRYPT_MISSING');
  // No compiled auth module is loaded here. Prisma/native runtime admission remains a later independent review.
  const fixedTime = 1791936000000, seedFile = '/prepare-out/private/seed/accounts.sqlite';
  assert.equal(fs.existsSync(seedFile), false); fs.mkdirSync(path.dirname(seedFile), { recursive: true, mode: 0o700 });
  const { openAccountWorker } = await import('../../stocks-global/account-worker.mjs');
  const worker = await openAccountWorker(seedFile, { now: () => fixedTime, diagnostics: true }); let metrics;
  try {
    for (const subject of SUBJECTS) { const owner = await worker.forPrincipal({ issuer: ISSUER, subject }); assert.equal(owner.id, sha(JSON.stringify([ISSUER, subject]))); }
    metrics = await worker.metrics();
  } finally { await worker.close(); }
  const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(seedFile, { readOnly: true }); let rows, integrity, journal;
  try { rows = db.prepare('SELECT id,ledger FROM paper_accounts ORDER BY id').all(); integrity = db.prepare('PRAGMA integrity_check').get().integrity_check; journal = db.prepare('PRAGMA journal_mode').get().journal_mode; }
  finally { db.close(); }
  assert.equal(integrity, 'ok'); assert.equal(journal, 'delete');
  assert.equal(fs.readdirSync(path.dirname(seedFile)).join(','), 'accounts.sqlite', 'PREPARE_SEED_NOT_QUIESCED');
  const seedAccounts = validateSeedRows(rows, fixedTime).map(({ id, ledgerSha256 }) => ({ id, ledgerSha256 }));
  const seed = { api: SEED.api, closed: true, integrity, journal, subjects: [...SUBJECTS], accounts: seedAccounts, fixedTime, synchronous: 2,
    bytes: fs.statSync(seedFile).size, sha256: sha(regular(seedFile)), workerSynchronous: 'SOURCE_CONFIGURED_FULL', actualWorkerConnectionPragma: 'UNMEASURED', metrics };
  const proof = { schema: PREPARE_SCHEMA, status: 'PREPARED_NOT_AUTHORIZED', planId: PLAN_ID, planHash: planHash(), contextSha256: manifest.contextSha256,
    runtime: { node: process.version, nodeSha256: digestFile(process.execPath, 256 * 1024 ** 2), platform: process.platform, arch: process.arch, uid: process.getuid(), gid: process.getgid() },
    compiler: { buildNode: json(regular('/source/compiled-proof.json')).node, ...verifiedBuild }, runtimeClosure,
    dependencies: { files: dependencies, inventorySha256: sha(JSON.stringify(dependencies)), nativeFiles: natives, bcryptSha256: bcrypt.sha256 }, seed,
    sourceReadability: { files: manifest.files.length, mode: 'fresh public context 0644; directories 0755', verified: true },
    workload: { authHttpInvoked: false, stocksHttpInvoked: false, providerInvoked: false, compiledAuthLoaded: false, tradingCommands: 0 } };
  writeJson('/prepare-out/inside-proof.json', proof);
}

export async function prepare(config, { root = ROOT } = {}) {
  const c = validateConfig(config); assert.equal(process.platform, 'linux'); assert.ok(process.getuid() > 0, 'PREPARE_NONROOT_RUNNER');
  assert.ok(!fs.existsSync(c.output) && !path.resolve(c.output).startsWith(path.resolve(root) + path.sep), 'PREPARE_FRESH_OUTSIDE_GIT_OUTPUT');
  const outputParent = fs.realpathSync(path.dirname(c.output)); assert.equal(outputParent, path.dirname(c.output), 'PREPARE_OUTPUT_PARENT_SYMLINK');
  const previousMask = process.umask(0o077); fs.mkdirSync(c.output, { mode: 0o700 });
  const owner = 'stocks-prepare-' + c.sourceSha.slice(0, 12) + '-' + process.pid, privateDir = path.join(c.output, 'private');
  fs.mkdirSync(privateDir, { mode: 0o700 }); fs.mkdirSync(path.join(privateDir, 'docker'), { mode: 0o700 });
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: privateDir, DOCKER_CONFIG: path.join(privateDir, 'docker'), DOCKER_HOST: 'unix:///var/run/docker.sock', LANG: 'C.UTF-8' };
  const report = { schema: PREPARE_SCHEMA, status: 'INCOMPLETE', sourceSha: c.sourceSha, stage: { ...c.stage, archive: path.basename(c.stage.archive) },
    scope: 'preparation only; no auth/Stocks HTTP or workload', timings: [], cleanup: [], prerequisiteLimits: BOUNDS, resources: [],
    releaseAcceptance: 'NOT_EVALUATED', previousBackendFailure: 'PRESERVED', remaining: [ 'independent image/native/compiled closure review', 'actual worker FULL connection observation', 'fresh launch-time resource/backing-device verification', 'separate reviewed workload entrypoint; current CLI remains disabled' ] };
  const owned = []; let imageId, cleaning = false, commandSerial = 0; const deadline = performance.now() + BOUNDS.totalMs;
  const command = (binary, args, timeout = BOUNDS.commandMs, rawName) => {
    const start = performance.now(); if (!cleaning) { assert.ok(start < deadline, 'PREPARE_WALL_DEADLINE'); timeout = Math.min(timeout, Math.max(1, Math.floor(deadline - start))); }
    const r = spawnSync(binary, args, { cwd: root, env, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: BOUNDS.commandBytes });
    const timing = { tool: path.basename(binary), phase: rawName || args[0], elapsedMs: performance.now() - start, timeoutMs: timeout, exitCode: r.status, signal: r.signal,
      errorCode: typeof r.error?.code === 'string' ? r.error.code : null, stdoutBytes: Buffer.byteLength(r.stdout || ''), stderrBytes: Buffer.byteLength(r.stderr || '') };
    if (rawName || r.error || r.status !== 0 || r.signal !== null) {
      const prefix = String(++commandSerial).padStart(3, '0') + '-' + (rawName || 'command-failure'); timing.rawLogs = [];
      for (const stream of ['stdout', 'stderr']) {
        const bytes = Buffer.from(r[stream] || ''), relativePath = 'private/command-logs/' + prefix + '.' + stream;
        write(path.join(c.output, relativePath), bytes); timing.rawLogs.push({ relativePath, bytes: bytes.length, sha256: sha(bytes) });
      }
    }
    report.timings.push(timing);
    assert.ok(!r.error && r.status === 0 && r.signal === null, 'PREPARE_COMMAND_FAILED'); return (r.stdout || '').trim();
  };
  const docker = (args, timeout, log) => command('/usr/bin/docker', args, timeout, log);
  const inspect = id => JSON.parse(docker(['inspect', id]))[0];
  try {
    const git = args => command('/usr/bin/git', args);
    assert.equal(git(['rev-parse', 'HEAD']), c.sourceSha, 'PREPARE_CURRENT_HEAD');
    assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '', 'PREPARE_CLEAN_SOURCE');
    assert.equal(digestFile(c.stage.archive, BOUNDS.archiveBytes), c.stage.sha256, 'PREPARE_ARCHIVE_DIGEST');
    assert.equal(digestFile(fs.realpathSync(c.python.executable), 128 * 1024 ** 2), c.python.sha256, 'PREPARE_PYTHON_DIGEST');
    const extracted = path.join(privateDir, 'stage-selected');
    report.archive = json(Buffer.from(command(c.python.executable, ['-I', '-S', '-c', ZIP_EXTRACTOR, c.stage.archive, extracted], BOUNDS.commandMs, 'archive-selection')));
    const manifest = json(regular(path.join(extracted, 'package/manifest.json'))), proofBytes = regular(path.join(extracted, 'build-provenance.json')), log = regular(path.join(extracted, 'build.log'));
    const compiled = new Map(walk(path.join(extracted, 'package/dist')).map(row => ['dist/' + row.path, regular(path.join(extracted, 'package/dist', row.path))]));
    const stageReport = json(regular(path.join(extracted, 'report.json')));
    const build = validateStage(manifest, proofBytes, log, compiled, c, stageReport);
    report.stage.reportSha256 = sha(regular(path.join(extracted, 'report.json')));
    const context = path.join(c.output, 'public-context'); fs.mkdirSync(context, { mode: 0o755 });
    const rows = git(['ls-tree', '-r', '--full-tree', c.sourceSha]).split('\n').map(line => { const m = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line); return m ? { mode: m[1], blob: m[2], path: m[3] } : { invalid: line }; });
    const selected = rows.filter(row => row.path && sourceAllowed(row.path));
    assert.ok(selected.some(row => row.path === FIXTURE + 'prepare.mjs'));
    assert.ok(!rows.some(row => row.invalid && /(?:src\/|services\/stocks|package|tsconfig)/.test(row.invalid)), 'PREPARE_SPECIAL_GIT_SOURCE');
    // One bounded binary batch, rather than one subprocess for every source file.
    const batchStarted = performance.now();
    const batch = spawnSync('/usr/bin/git', ['cat-file', '--batch'], { cwd: root, env, input: selected.map(row => row.blob).join('\n') + '\n', timeout: BOUNDS.commandMs, killSignal: 'SIGKILL', maxBuffer: BOUNDS.expandedBytes });
    report.timings.push({ tool: 'git', phase: 'canonical-blob-batch', elapsedMs: performance.now() - batchStarted, exitCode: batch.status, signal: batch.signal });
    assert.ok(!batch.error && batch.status === 0 && batch.signal === null, 'PREPARE_GIT_BATCH_FAILED');
    const blobs = parseGitBatch(batch.stdout, selected), sourceRows = [];
    for (const [index, row] of selected.entries()) {
      const bytes = blobs[index];
      write(path.join(context, row.path), bytes, 0o644); sourceRows.push({ path: row.path, bytes: bytes.length, sha256: sha(bytes), gitBlob: row.blob });
    }
    validateLock(json(regular(path.join(context, 'package-lock.json'))));
    validateDockerfile(regular(path.join(context, FIXTURE + 'Dockerfile')));
    assert.equal(sha(regular(path.join(context, 'services/stocks/targeted-http-512/plan.mjs'))), '258cc65cbee2638265d61bfa7b8f6079fc385520f66af710e324fe4a2a37a1cc', 'PREPARE_ORIGINAL_PLAN_CHANGED');
    assert.equal(sha(regular(path.join(context, FIXTURE + 'prepare.mjs'))), sha(regular(fileURLToPath(import.meta.url))), 'PREPARE_ENTRYPOINT_SOURCE_DRIFT');
    for (const row of build.sourcesBefore) assert.equal(sha(regular(path.join(context, safeRelative(row.path)))), row.sha256, 'PREPARE_SOURCE_BUILD_DRIFT');
    assert.equal(sha(regular(path.join(context, 'tsconfig.json'))), build.tsconfig.sha256);
    assert.equal(sha(regular(path.join(context, 'package-lock.json'))), build.packageLockSha256);
    for (const [p, bytes] of [...compiled, ['compiled-proof.json', proofBytes], ['build.log', log]]) { write(path.join(context, p), bytes, 0o644); sourceRows.push({ path: p, bytes: bytes.length, sha256: sha(bytes) }); }
    sourceRows.sort((a, b) => a.path.localeCompare(b.path));
    const contextSha256 = sha(JSON.stringify(sourceRows));
    const sourceManifest = { schema: PREPARE_SCHEMA, sourceSha: c.sourceSha, sourceTree: git(['rev-parse', c.sourceSha + '^{tree}']), files: sourceRows, contextSha256 };
    const contextBytes = Buffer.from(JSON.stringify(sourceManifest, null, 2) + '\n'); assert.ok(contextBytes.length < 1024 * 1024);
    write(path.join(context, 'runtime-source-manifest.json'), contextBytes, 0o644); report.contextSha256 = contextSha256;
    // umask077 protects all private evidence. Normalize only this fresh public
    // build context, never original source, extracted artifact or host tooling.
    const normalizePublic = dir => {
      assert.ok(dir === context || dir.startsWith(context + path.sep));
      const st = fs.lstatSync(dir); assert.ok(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid()); fs.chmodSync(dir, 0o755);
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, e.name); if (e.isDirectory()) normalizePublic(target);
        else { assert.ok(e.isFile() && fs.lstatSync(target).uid === process.getuid()); fs.chmodSync(target, 0o644); assert.equal(fs.statSync(target).mode & 0o777, 0o644); }
      }
      assert.equal(fs.statSync(dir).mode & 0o777, 0o755);
    }; normalizePublic(context);
    // Only this freshly allowlisted context is sent to Docker. No HOME, checkout,
    // archive, credentials, seed or node_modules is in the build context.
    docker(['pull', c.baseImage], BOUNDS.pullMs, 'base-pull');
    const base = JSON.parse(docker(['image', 'inspect', c.baseImage]))[0];
    assert.equal(base.Os, 'linux'); assert.equal(base.Architecture, 'amd64'); assert.ok(base.Config.Env.includes('NODE_VERSION=24.21.0'));
    assert.deepEqual(base.Config.Env.map(v => v.split('=')[0]).sort(), ['NODE_VERSION', 'PATH', 'YARN_VERSION']);
    const iid = path.join(privateDir, 'image.id');
    docker(['build', '--pull=false', '--network=default', '--label', 'voltex.auth-http.prepare=' + owner, '--iidfile', iid,
      '--build-arg', 'BASE_IMAGE=' + c.baseImage, '--build-arg', 'SOURCE_SHA=' + c.sourceSha, '--build-arg', 'CONTEXT_SHA256=' + contextSha256,
      '-f', path.join(context, FIXTURE + 'Dockerfile'), context], BOUNDS.buildMs, 'image-build');
    imageId = regular(iid).toString().trim(); assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
    const image = JSON.parse(docker(['image', 'inspect', imageId]))[0]; validateImage(image, c.sourceSha, contextSha256);
    assert.equal(image.Config.Labels['voltex.auth-http.prepare'], owner); report.image = { id: imageId, baseImage: c.baseImage,
      freezeBaseImageAlias: FREEZE_BASE_IMAGE_ALIAS, aliasMeaning: 'same immutable docker.io/library/node manifest digest', config: image.Config, size: image.Size };
    const uid = `${process.getuid()}:${process.getgid()}`;
    const create = (role, cmd, mounts = [], serviceId) => {
      const network = serviceId ? 'container:' + serviceId : 'none';
      const args = ['create', '--name', owner + '-' + role, '--label', 'voltex.auth-http.prepare=' + owner, '--label', 'voltex.auth-http.role=' + role,
        '--user', uid, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--ipc=private', '--pids-limit=32',
        '--memory=256m', '--memory-swap=256m', '--cpus', role === 'service' ? '.05' : '.5', '--cpuset-cpus', role === 'service' ? '0' : '1',
        '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m', '--network', network,
        ...(role === 'service' ? ['--device-read-bps', c.device + ':1048576', '--device-write-bps', c.device + ':131072'] : []),
        ...mounts.flatMap(m => ['--mount', `type=bind,src=${m.source},dst=${m.target}${m.readOnly ? ',readonly' : ''}`]),
        '-e', 'PREPARE_512_ONLY=true', '--entrypoint', 'node', imageId, ...cmd];
      const id = docker(args); assert.match(id, /^[a-f0-9]{64}$/); owned.push(id);
      validatePreparationContainer(inspect(id), { image: imageId, uid, owner, role, network, command: cmd, mounts }); return id;
    };
    const runtimeOutput = path.join(privateDir, 'runtime-output'); fs.mkdirSync(runtimeOutput, { mode: 0o700 });
    const prep = create('prepare', [FIXTURE + 'prepare.mjs', '--container-prepare'], [{ source: runtimeOutput, target: '/prepare-out', readOnly: false }]);
    docker(['start', '--attach', prep], BOUNDS.containerMs, 'seed-and-provenance');
    const ended = inspect(prep); assert.equal(ended.State.ExitCode, 0); assert.equal(ended.State.OOMKilled, false); assert.equal(ended.State.Running, false);
    report.inside = json(regular(path.join(runtimeOutput, 'inside-proof.json'), 32 * 1024 ** 2));
    assert.equal(report.inside.status, 'PREPARED_NOT_AUTHORIZED'); assert.equal(report.inside.planHash, planHash());
    assert.equal(report.inside.contextSha256, contextSha256, 'PREPARE_IMAGE_CONTEXT_DRIFT');
    assert.equal(report.inside.compiler.proofSha256, c.stage.buildProvenanceSha256);
    report.seedPath = 'private/runtime-output/private/seed/accounts.sqlite';
    const backing = verifyBackingDevice(path.join(runtimeOutput, 'private/seed/accounts.sqlite'), c.device, (bin, args) => command(bin, args)); report.backing = backing;
    const service = create('service', ['-e', IDLE_PROGRAM]); docker(['start', service]);
    for (const role of ['service', 'authority', 'driver']) {
      const id = role === 'service' ? service : create(role, ['-e', IDLE_PROGRAM], [], service); if (role !== 'service') docker(['start', id]);
      const info = inspect(id); assert.equal(info.State.Running, true); const proof = kernel(info);
      validateResources({ cpuMax: proof.counters['cpu.max'], memoryMax: proof.counters['memory.max'], swapMax: proof.counters['memory.swap.max'], cpuset: proof.counters['cpuset.cpus.effective'], ioMax: proof.counters['io.max'] }, role, backing.deviceNumber);
      report.resources.push({ role, proof, scope: 'owned idle container; reverify on future launch' });
    }
    assert.ok(Number.isSafeInteger(image.Size) && image.Size > 0 && image.Size + 64 * 1024 ** 2 < BOUNDS.imageBytes, 'PREPARE_IMAGE_SIZE_BOUND');
    const disk = fs.statfsSync(privateDir, { bigint: true }), free = disk.bavail * disk.bsize;
    assert.ok(free >= BigInt(BOUNDS.imageBytes + 256 * 1024 ** 2), 'PREPARE_IMAGE_DISK_FREE');
    report.archiveDisk = { availableBytes: String(free), requiredBytes: BOUNDS.imageBytes + 256 * 1024 ** 2, writerLimit: 'RLIMIT_FSIZE hard+soft via prlimit' };
    const partialArchive = path.join(privateDir, 'runtime-image.partial'), archive = path.join(privateDir, 'runtime-image.tar');
    command('/usr/bin/prlimit', [`--fsize=${BOUNDS.imageBytes}:${BOUNDS.imageBytes}`, '--', '/usr/bin/docker', 'image', 'save', '-o', partialArchive, imageId], 120000, 'image-save');
    fs.renameSync(partialArchive, archive);
    const archiveStat = fs.lstatSync(archive); assert.ok(archiveStat.isFile() && !archiveStat.isSymbolicLink() && archiveStat.size <= BOUNDS.imageBytes);
    // Streaming digest avoids loading a multi-GB Docker archive into Node heap.
    assert.ok(performance.now() < deadline, 'PREPARE_WALL_DEADLINE');
    const digest = createHash('sha256'); for await (const bytes of fs.createReadStream(archive, { signal: AbortSignal.timeout(Math.max(1, Math.floor(deadline - performance.now()))) })) digest.update(bytes);
    report.imageArchive = { relativePath: 'private/runtime-image.tar', bytes: archiveStat.size, sha256: digest.digest('hex'), distribution: 'private QA artifact only; no registry push' };
    assert.ok(performance.now() < deadline, 'PREPARE_WALL_DEADLINE');
    report.status = 'PREPARED_NOT_AUTHORIZED';
  } catch (error) {
    report.failure = { code: /^PREPARE_[A-Z_]+$/.test(error.message) ? error.message : 'PREPARE_PREREQUISITE_FAILED', type: error.name };
    // These are private diagnostic artifacts. No token, auth body, environment
    // dump or market data is produced by this preparation route.
    const diagnostic = Buffer.from(inspectValue(error, { depth: 8, maxArrayLength: null, maxStringLength: null, breakLength: 120 }));
    const retained = diagnostic.subarray(0, BOUNDS.commandBytes);
    write(path.join(privateDir, 'command-logs/failure.txt'), retained);
    report.failure.diagnostic = { relativePath: 'private/command-logs/failure.txt', bytes: retained.length, sha256: sha(retained),
      totalBytes: diagnostic.length, truncated: retained.length !== diagnostic.length, completeSha256: sha(diagnostic) };
    throw error;
  } finally {
    cleaning = true;
    // Delete only IDs created by this invocation, after exact ownership checks.
    for (const id of owned.reverse()) {
      try {
        const last = inspect(id); assert.equal(last.Config.Labels['voltex.auth-http.prepare'], owner);
        const role = last.Config.Labels['voltex.auth-http.role'];
        const terminal = { running: last.State.Running, exitCode: last.State.ExitCode, oomKilled: last.State.OOMKilled, startedAt: last.State.StartedAt, finishedAt: last.State.FinishedAt };
        if (terminal.oomKilled || (!terminal.running && terminal.exitCode !== 0)) report.status = 'INCOMPLETE';
        docker(['rm', '-f', id]); report.cleanup.push({ kind: 'container', id, role, status: 'REMOVED', terminal,
          stop: terminal.running ? 'planned preparation cleanup; no workload ran' : 'natural preparation/idle exit' });
      }
      catch { report.cleanup.push({ kind: 'container', id, status: 'FAILED' }); report.status = 'INCOMPLETE'; }
    }
    if (imageId) {
      try { const info = JSON.parse(docker(['image', 'inspect', imageId]))[0]; assert.equal(info.Config.Labels['voltex.auth-http.prepare'], owner); docker(['image', 'rm', imageId]); report.cleanup.push({ kind: 'image', id: imageId, status: 'REMOVED' }); }
      catch { report.cleanup.push({ kind: 'image', id: imageId, status: 'FAILED' }); report.status = 'INCOMPLETE'; }
    }
    writeJson(path.join(c.output, 'preparation.json'), report);
    process.umask(previousMask);
  }
  assert.equal(report.status, 'PREPARED_NOT_AUTHORIZED', 'PREPARE_CLEANUP_FAILED'); return report;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--container-prepare') return prepareInside();
  assert.ok(args.length === 2 && args[0] === '--prepare', 'PREPARE_EXPLICIT_CONFIG_REQUIRED');
  absolute(args[1]); return prepare(json(regular(args[1], 65536)));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(/^PREPARE_[A-Z_]+$/.test(error.message) ? error.message : 'PREPARE_PREREQUISITE_FAILED'); process.exitCode = 1; });
}
