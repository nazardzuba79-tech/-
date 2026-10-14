'use strict';
// QA only. Build-time package downloads are separate from an inspected network=none test container.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const SHA = /^[a-f0-9]{40}$/;
const MAX_SOURCE = 512 * 1024 * 1024;
const MAX_LOG = 64 * 1024 * 1024;
const EXPECTED_TESTS = 249;
const TMPFS = { '/tmp': 'rw,nosuid,nodev,noexec,size=256m,mode=1777', '/work': 'rw,nosuid,nodev,noexec,size=512m,mode=1777' };
const CONTAINER_FILES = ['container-provenance.json', 'build-prerequisite.json', 'build.stdout.log', 'build.stderr.log', 'jest-command.json', 'jest-discovery.json', 'jest.json', 'container-result.json'];
const OPT_INS = ['BANKING_DB_TESTS', 'PRIVATE_TRADING_DB_TESTS', 'VOLTEX_PG_TEST_URL', 'VOLTEX_NRX_TEST_URL', 'VOLTEX_LISTING_TEST_URL', 'KYC_TEST_DATABASE_URL', 'EMAIL_POLICY_TEST_URL', 'ADMIN_PASSWORD_TEST_URL', 'NATIVE_EGRESS_TEST_DATABASE_URL'];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const json = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
function safePath(name) {
  assert.ok(typeof name === 'string' && name && !/[\x00-\x1f\x7f\\]/.test(name), 'unsafe Git path');
  assert.ok(!path.posix.isAbsolute(name) && name.split('/').every(p => p && p !== '.' && p !== '..') && !name.startsWith('.git/'), 'unsafe Git path');
  return name;
}
function excluded(name) {
  return /(^|\/)(?:\.env(?:\..*)?|[^/]*\.(?:pem|key|pfx|p12|sqlite(?:3)?|db))$/i.test(name)
    || /(^|\/)(?:node_modules|\.git)(?:\/|$)/.test(name);
}
function parseTree(raw) {
  const all = raw.split('\0').filter(Boolean).map(line => {
    const m = /^(100644|100755) blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/.exec(line);
    assert.ok(m, 'only regular Git blobs are permitted');
    return { path: safePath(m[4]), gitBlob: m[2], bytes: Number(m[3]), executable: m[1] === '100755' };
  });
  assert.equal(new Set(all.map(f => f.path)).size, all.length, 'duplicate source path');
  assert.ok(all.reduce((n, f) => n + f.bytes, 0) <= MAX_SOURCE, 'source byte limit exceeded');
  return { files: all.filter(f => !excluded(f.path)), excluded: all.filter(f => excluded(f.path)).map(f => f.path) };
}
function backendTests(files) {
  const result = files.map(f => f.path).filter(p => p.startsWith('src/') && (/\/__tests__\/.*\.[jt]sx?$/.test(p) || /\.(?:spec|test)\.[jt]sx?$/.test(p))).sort();
  assert.equal(result.length, EXPECTED_TESTS, 'backend test discovery changed: review exact inventory before running');
  return result;
}
function assertContainer(c, expected) {
  assert.equal(c.Id, expected.id); assert.equal(c.Image, expected.image);
  assert.equal(c.State.Running, false); assert.equal(c.State.Status, 'created');
  const h = c.HostConfig;
  assert.equal(h.NetworkMode, 'none'); assert.equal(h.Privileged, false); assert.equal(h.ReadonlyRootfs, true);
  assert.ok(!h.PidMode || h.PidMode === 'private'); assert.equal(h.IpcMode, 'private');
  assert.deepEqual(h.CapDrop, ['ALL']); assert.ok(!h.CapAdd?.length); assert.deepEqual(h.SecurityOpt, ['no-new-privileges']);
  assert.equal(h.PidsLimit, 128); assert.equal(h.Memory, 4 * 1024 ** 3); assert.equal(h.MemorySwap, h.Memory); assert.equal(h.NanoCpus, 2e9);
  assert.ok(/^[1-9]\d*:[1-9]\d*$/.test(c.Config.User), 'non-root UID and GID required');
  assert.deepEqual(c.Config.Entrypoint, ['/usr/local/bin/node']);
  assert.deepEqual(c.Config.Cmd, ['/qa/harness.cjs', '--container-run']);
  assert.equal(c.Config.Labels['voltex.qa.run'], expected.nonce);
  assert.deepEqual(h.Tmpfs, TMPFS); assert.ok(!h.PublishAllPorts && !Object.keys(h.PortBindings || {}).length);
  assert.equal(c.Mounts.length, 1); const m = c.Mounts[0];
  assert.equal(m.Type, 'bind'); assert.equal(m.Source, expected.output); assert.equal(m.Destination, '/evidence'); assert.equal(m.RW, true);
  assert.ok(!h.Devices?.length && !h.DeviceRequests?.length && !h.Links?.length && !h.VolumesFrom?.length);
  assert.deepEqual(Object.keys(c.NetworkSettings.Networks), ['none']);
  const actualEnv = {};
  for (const e of c.Config.Env) {
    const i = e.indexOf('='), k = e.slice(0, i); assert.ok(i > 0 && !Object.hasOwn(actualEnv, k), 'duplicate environment key'); actualEnv[k] = e.slice(i + 1);
    assert.ok(Object.hasOwn(expected.env, k), 'unexpected container environment key: ' + k);
    assert.ok(!OPT_INS.includes(k), 'database opt-in present');
  }
  assert.deepEqual(actualEnv, expected.env, 'container environment values changed');
}
function verifyFiles(base, files) {
  for (const f of files) {
    const p = path.join(base, f.path), stat = fs.lstatSync(p);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'source is not a regular file: ' + f.path);
    const data = fs.readFileSync(p); assert.equal(data.length, f.bytes, 'source size changed: ' + f.path);
    const blob = crypto.createHash('sha1').update('blob ' + data.length + '\0').update(data).digest('hex');
    assert.equal(blob, f.gitBlob, 'source Git blob changed: ' + f.path);
    if (f.sha256) assert.equal(hash(data), f.sha256, 'source SHA256 changed: ' + f.path);
  }
}
function artifactFiles(dir) {
  const result = []; let bytes = 0;
  const walk = (d, prefix = '') => { for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'evidence symlink'); const rel = prefix + entry.name;
    if (entry.isDirectory()) walk(path.join(d, entry.name), rel + '/');
    else { assert.ok(entry.isFile(), 'evidence is not regular'); const p = path.join(d, entry.name), size = fs.lstatSync(p).size; bytes += size; assert.ok(size <= MAX_LOG && bytes <= 128 * 1024 ** 2, 'evidence byte limit exceeded'); const data = fs.readFileSync(p); result.push({ path: rel, bytes: data.length, sha256: hash(data) }); }
  } }; walk(dir); return result;
}
function boundedJSON(file) {
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_LOG, 'invalid or oversized JSON evidence');
  return JSON.parse(fs.readFileSync(file));
}
function collectContainerEvidence(raw, evidence) {
  const entries = fs.readdirSync(raw, { withFileTypes: true }); let bytes = 0;
  for (const e of entries) { assert.ok(CONTAINER_FILES.includes(e.name) && e.isFile() && !e.isSymbolicLink(), 'unexpected container evidence entry'); const st = fs.lstatSync(path.join(raw, e.name)); bytes += st.size; assert.ok(st.size <= MAX_LOG && bytes <= MAX_LOG, 'container evidence byte limit exceeded'); }
  for (const e of entries) fs.copyFileSync(path.join(raw, e.name), path.join(evidence, e.name), fs.constants.COPYFILE_EXCL);
}
function terminalInventory(j, tests) {
  assert.equal(j.numTotalTestSuites, EXPECTED_TESTS, 'terminal Jest suite inventory mismatch');
  assert.deepEqual(j.testResults.map(t => { assert.ok(t.name.startsWith('/work/src/')); return t.name.slice('/work/'.length); }).sort(), tests, 'terminal Jest filename inventory mismatch');
}
function summarizeJestOutcomes(j) {
  const keys = ['numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites', 'numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests'];
  const counts = Object.fromEntries(keys.map(k => { assert.ok(Number.isSafeInteger(j[k]) && j[k] >= 0, 'invalid Jest count: ' + k); return [k, j[k]]; }));
  const suites = { passed: 0, focused: 0, failed: 0, skipped: 0 };
  const tests = { passed: 0, failed: 0, pending: 0, todo: 0 };
  const skippedSuites = [], partiallySkippedSuites = [];
  for (const suite of j.testResults) {
    assert.ok(Object.hasOwn(suites, suite.status), 'unrecognized terminal Jest suite status: ' + suite.status);
    suites[suite.status]++;
    const name = suite.name.replace('/work/', '');
    if (suite.status === 'skipped') skippedSuites.push(name);
    let pendingTests = 0;
    for (const test of suite.assertionResults) {
      assert.ok(Object.hasOwn(tests, test.status), 'unrecognized terminal Jest assertion status: ' + test.status);
      tests[test.status]++;
      if (test.status === 'pending') pendingTests++;
    }
    // Jest29 calls a non-failing suite with skipped assertions "focused".
    // It is counted as passed by Jest, but its pending assertions remain NOT_RUN.
    if (suite.status === 'focused') {
      assert.ok(pendingTests > 0, 'focused Jest suite has no pending assertions');
      partiallySkippedSuites.push({ name, pendingTests });
    }
  }
  assert.equal(j.numTotalTestSuites, j.testResults.length, 'Jest suite count mismatch');
  assert.equal(j.numPassedTestSuites, suites.passed + suites.focused, 'Jest passed suite count mismatch');
  assert.equal(j.numFailedTestSuites, suites.failed, 'Jest failed suite count mismatch');
  assert.equal(j.numPendingTestSuites, suites.skipped, 'Jest skipped suite count mismatch');
  assert.equal(j.numTotalTests, Object.values(tests).reduce((a, n) => a + n, 0), 'Jest assertion count mismatch');
  for (const [key, status] of [['numPassedTests', 'passed'], ['numFailedTests', 'failed'], ['numPendingTests', 'pending'], ['numTodoTests', 'todo']]) assert.equal(j[key], tests[status], 'Jest assertion status count mismatch: ' + key);
  return { counts, skippedSuites, partiallySkippedSuites };
}
function compiledInventory(work) {
  const dir = path.join(work, 'dist'), result = []; let total = 0;
  const walk = (base, prefix) => {
    const st = fs.lstatSync(base); assert.ok(st.isDirectory() && !st.isSymbolicLink(), 'compiled directory is not regular');
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const file = path.join(base, entry.name), relative = prefix + '/' + entry.name;
      assert.ok(!entry.isSymbolicLink(), 'compiled output symlink');
      if (entry.isDirectory()) walk(file, relative);
      else {
        assert.ok(entry.isFile() && /\.(?:js|js\.map|json)$/.test(entry.name), 'unexpected compiled output');
        const size = fs.lstatSync(file).size; total += size;
        assert.ok(size <= 4 * 1024 ** 2 && total <= MAX_LOG && result.length < 10000, 'compiled output bound');
        result.push({ path: relative, bytes: size, sha256: hash(fs.readFileSync(file)) });
      }
    }
  };
  walk(dir, 'dist');
  for (const relative of ['private-trading/native/engine.js', 'private-trading/native/store.js', 'private-trading/native/liveProjection.js', 'private-trading/native/historyPage.js', 'private-trading/native/testing/liveFixture.js', 'private-trading/serviceTypes.js'])
    assert.ok(result.some(f => f.path === 'dist/' + relative), 'required native-review compiled prerequisite missing: ' + relative);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
function buildPrerequisite(manifest) {
  // Compile canonical source inside the already inspected, network=none test container.
  // No npm hooks, host dist reuse, server startup, database operation or migration.
  assert.ok(!fs.existsSync('/work/dist'), 'fresh compiled output required');
  const compiler = '/app/node_modules/typescript/bin/tsc';
  const compilerFiles = ['package.json', 'bin/tsc', 'lib/tsc.js', 'lib/_tsc.js'].map(relative => {
    const file = '/app/node_modules/typescript/' + relative, st = fs.lstatSync(file);
    assert.ok(st.isFile() && !st.isSymbolicLink() && st.size <= MAX_LOG, 'compiler provenance requires regular bounded files');
    return { path: 'node_modules/typescript/' + relative, bytes: st.size, sha256: hash(fs.readFileSync(file)) };
  });
  const args = [compiler, '--project', '/work/tsconfig.json', '--pretty', 'false', '--listEmittedFiles'];
  const proof = { sourceSHA: manifest.sha, executable: process.execPath, args, cwd: '/work', timeoutMs: 120000,
    compilerVersion: require('/app/node_modules/typescript/package.json').version,
    compilerFiles, compilerSHA256: hash(fs.readFileSync(compiler)), configSHA256: hash(fs.readFileSync('/work/tsconfig.json')),
    packageLockSHA256: hash(fs.readFileSync('/work/package-lock.json')), frontendLockSHA256: hash(fs.readFileSync('/work/frontend/package-lock.json')),
    startedAt: new Date().toISOString(), status: 'INCOMPLETE' };
  const result = cp.spawnSync(process.execPath, args, { cwd: '/work', env: process.env, encoding: 'utf8', timeout: proof.timeoutMs, maxBuffer: MAX_LOG });
  fs.writeFileSync('/evidence/build.stdout.log', result.stdout || '', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync('/evidence/build.stderr.log', result.stderr || '', { flag: 'wx', mode: 0o600 });
  Object.assign(proof, { code: result.status, signal: result.signal, errorCode: result.error?.code || null, finishedAt: new Date().toISOString(),
    stdout: { bytes: Buffer.byteLength(result.stdout || ''), sha256: hash(result.stdout || '') },
    stderr: { bytes: Buffer.byteLength(result.stderr || ''), sha256: hash(result.stderr || '') } });
  try {
    verifyFiles('/work', manifest.files); proof.sourceUnchanged = true;
    assert.ok(!result.error && result.status === 0 && result.signal === null, 'backend build prerequisite failed; Jest NOT_RUN');
    proof.outputs = compiledInventory('/work'); proof.status = 'PASS';
  } catch (error) { proof.failure = error.message; throw error; }
  finally { json('/evidence/build-prerequisite.json', proof); }
}
function finishEvidence(evidence, result) {
  let artifacts = null;
  try {
    artifacts = artifactFiles(evidence);
    assert.ok(artifacts.reduce((s, f) => s + f.bytes, 0) + Buffer.byteLength(JSON.stringify(result)) + 1024 ** 2 <= 128 * 1024 ** 2, 'artifact manifest/result reserve exceeds evidence bound');
  } catch (e) { result.status = 'INCOMPLETE'; result.artifactError = e.message; artifacts = null; }
  json(path.join(evidence, 'result.json'), result);
  if (artifacts) { const data = fs.readFileSync(path.join(evidence, 'result.json')); json(path.join(evidence, 'artifact-manifest.json'), [...artifacts, { path: 'result.json', bytes: data.length, sha256: hash(data) }]); }
  else json(path.join(evidence, 'artifact-validation-error.json'), { status: 'INCOMPLETE', error: result.artifactError });
}
async function containerMain() {
  assert.equal(process.platform, 'linux'); assert.ok(process.getuid() > 0);
  const manifest = JSON.parse(fs.readFileSync('/qa/manifest.json'));
  assert.equal(process.env.NODE_ENV, 'test'); for (const k of OPT_INS) assert.equal(process.env[k], undefined);
  verifyFiles('/app', manifest.files);
  const tests = backendTests(manifest.files); assert.deepEqual(tests, manifest.tests);
  for (const f of manifest.files) {
    const dest = path.join('/work', f.path); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join('/app', f.path), dest); fs.chmodSync(dest, f.executable ? 0o700 : 0o600);
  }
  fs.symlinkSync('/app/node_modules', '/work/node_modules', 'dir');
  fs.symlinkSync('/app/frontend/node_modules', '/work/frontend/node_modules', 'dir');
  fs.mkdirSync('/tmp/home', { recursive: true }); process.chdir('/work');
  buildPrerequisite(manifest);
  const discovery = cp.spawnSync(process.execPath, ['/app/node_modules/jest/bin/jest.js', '--listTests', '--json', '--runInBand'], { cwd: '/work', env: process.env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 ** 2 });
  assert.ok(!discovery.error && discovery.status === 0, 'same-config Jest discovery failed');
  const discovered = JSON.parse(discovery.stdout).filter(p => p.startsWith('/work/src/')).map(p => p.slice('/work/'.length)).sort();
  assert.deepEqual(discovered, tests, 'same-config Jest discovery differs from reviewed backend inventory');
  json('/evidence/jest-discovery.json', { command: ['--listTests', '--json', '--runInBand'], stderr: discovery.stderr, actual: discovered, expected: tests });
  const provenance = {
    sourceSHA: manifest.sha, node: process.version, platform: process.platform, uid: process.getuid(), testCount: tests.length,
    sourceFiles: manifest.files.length, sourceBytes: manifest.files.reduce((s, f) => s + f.bytes, 0),
    lockSHA256: hash(fs.readFileSync('/app/package-lock.json')), frontendLockSHA256: hash(fs.readFileSync('/app/frontend/package-lock.json')), schemaSHA256: hash(fs.readFileSync('/app/prisma/schema.prisma')),
    generatedClient: ['index.js', 'schema.prisma'].map(f => ({ path: '.prisma/client/' + f, sha256: hash(fs.readFileSync('/app/node_modules/.prisma/client/' + f)) })),
    prismaVersion: require('/app/node_modules/@prisma/client/package.json').version,
    databaseOptIns: Object.fromEntries(OPT_INS.map(k => [k, 'ABSENT'])), databaseAcceptance: 'NOT_RUN',
    environmentKeys: Object.keys(process.env).sort(), network: 'Docker network=none inspected before start; this is not a database integration test',
  };
  json('/evidence/container-provenance.json', provenance);
  const args = ['/app/node_modules/jest/bin/jest.js', '--runInBand', '--runTestsByPath', ...tests, '--json', '--outputFile=/evidence/jest.json'];
  json('/evidence/jest-command.json', { executable: process.execPath, args, cwd: '/work', sourceSHA: manifest.sha });
  const child = cp.spawn(process.execPath, args, { cwd: '/work', env: process.env, stdio: 'inherit' });
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  let sourceUnchanged = true, sourceError = null;
  try { verifyFiles('/work', manifest.files); } catch (e) { sourceUnchanged = false; sourceError = e.message; }
  json('/evidence/container-result.json', { ...result, sourceUnchanged, sourceError, finishedAt: new Date().toISOString() });
  process.exitCode = result.code === 0 && sourceUnchanged ? 0 : 1;
}
async function main(argv = process.argv.slice(2)) {
  assert.equal(process.platform, 'linux', 'full backend isolation requires Linux Docker; no host fallback');
  const value = key => { const i = argv.indexOf(key); assert.ok(i >= 0 && argv[i + 1], 'missing ' + key); return argv[i + 1]; };
  const sha = value('--sha'), out = value('--out'); assert.ok(SHA.test(sha)); assert.ok(path.isAbsolute(out) && !/[,\x00-\x1f]/.test(out));
  assert.equal(argv.length, 4); assert.ok(!fs.existsSync(out), 'output must be fresh');
  const root = path.resolve(__dirname, '..'); fs.mkdirSync(out, { recursive: false, mode: 0o700 });
  const evidence = path.join(out, 'evidence'), raw = path.join(out, 'test-output'), context = path.join(out, 'context'), source = path.join(context, 'source');
  for (const p of [evidence, raw, context, source, path.join(out, 'home'), path.join(out, 'docker-config')]) fs.mkdirSync(p, { mode: 0o700 });
  const env = { PATH: process.env.PATH, HOME: path.join(out, 'home'), DOCKER_CONFIG: path.join(out, 'docker-config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', DOCKER_BUILDKIT: '1' };
  const commandRecords = [];
  const exec = (file, args, opts = {}) => {
    const t = Date.now(); const r = cp.spawnSync(file, args, { cwd: root, env, encoding: 'utf8', timeout: opts.timeout || 30000, maxBuffer: opts.maxBuffer || 8 * 1024 ** 2 });
    commandRecords.push({ executable: file, args, elapsedMs: Date.now() - t, code: r.status, signal: r.signal, error: r.error?.code || null });
    if (opts.log) { fs.writeFileSync(path.join(evidence, opts.log + '.stdout.log'), r.stdout || ''); fs.writeFileSync(path.join(evidence, opts.log + '.stderr.log'), r.stderr || ''); }
    assert.ok(!r.error && r.status === 0, file + ' failed: ' + (r.error?.code || r.status) + (opts.log ? ' (see ' + opts.log + ' logs)' : ''));
    return r.stdout.trim();
  };
  let id, image, nonce = crypto.randomBytes(12).toString('hex'), failure = null, cleanupErrors = [], inspected = null, collected = false, stopped = false;
  const result = { sourceSHA: sha, startedAt: new Date().toISOString(), status: 'INCOMPLETE', originalCriteriaUnchanged: true, databaseAcceptance: 'NOT_RUN', capacityClaim: false };
  try {
    assert.equal(exec('git', ['rev-parse', 'HEAD']), sha, 'checkout must be the exact requested SHA');
    const tree = parseTree(exec('git', ['ls-tree', '-rlz', '--full-tree', sha], { maxBuffer: 16 * 1024 ** 2 }));
    const tests = backendTests(tree.files);
    exec('git', ['archive', '--format=tar', '--output=' + path.join(out, 'source.tar'), sha]);
    fs.writeFileSync(path.join(out, 'allowed-paths.txt'), tree.files.map(f => f.path).join('\n') + '\n');
    exec('tar', ['--extract', '--file=' + path.join(out, 'source.tar'), '--directory=' + source, '--no-same-owner', '--no-same-permissions', '--no-recursion', '--verbatim-files-from', '--files-from=' + path.join(out, 'allowed-paths.txt')]);
    verifyFiles(source, tree.files);
    for (const f of tree.files) f.sha256 = hash(fs.readFileSync(path.join(source, f.path)));
    const manifest = { sha, files: tree.files, excluded: tree.excluded, tests };
    json(path.join(evidence, 'source-manifest.json'), manifest); json(path.join(context, 'manifest.json'), manifest);
    assert.equal(hash(fs.readFileSync(__filename)), hash(fs.readFileSync(path.join(source, 'scripts/qa-backend-full-offline.cjs'))), 'helper differs from exact source');
    fs.copyFileSync(__filename, path.join(context, 'harness.cjs'));
    fs.copyFileSync(path.join(source, 'scripts/qa-backend-full-offline.Dockerfile'), path.join(context, 'Dockerfile'));
    for (const filename of ['package-lock.json', 'frontend/package-lock.json']) {
      const lock = JSON.parse(fs.readFileSync(path.join(source, filename)));
      for (const p of Object.values(lock.packages)) if (p.resolved) { const u = new URL(p.resolved); assert.equal(u.protocol, 'https:'); assert.equal(u.hostname, 'registry.npmjs.org'); assert.ok(!u.username && !u.password); }
    }
    const dockerContext = JSON.parse(exec('docker', ['context', 'inspect']))[0]; assert.equal(dockerContext.Endpoints.docker.Host, 'unix:///var/run/docker.sock', 'local default Docker socket required');
    const baseTag = 'node:22.23.3-bookworm'; exec('docker', ['pull', baseTag], { timeout: 180000, log: 'image-pull' });
    const base = JSON.parse(exec('docker', ['image', 'inspect', baseTag]))[0];
    assert.equal(base.Os, 'linux'); assert.equal(base.Architecture, 'amd64');
    const digest = base.RepoDigests.find(d => /^node@sha256:[a-f0-9]{64}$/.test(d)); assert.ok(digest, 'immutable official Node digest unavailable');
    json(path.join(evidence, 'base-image.json'), { tag: baseTag, digest, id: base.Id, platform: base.Os + '/' + base.Architecture });
    const tag = 'voltex-backend-qa-' + nonce;
    exec('docker', ['build', '--pull=false', '--build-arg', 'QA_BASE=' + digest, '--label', 'voltex.qa.run=' + nonce, '--tag', tag, context], { timeout: 600000, maxBuffer: MAX_LOG, log: 'image-build' });
    image = JSON.parse(exec('docker', ['image', 'inspect', tag]))[0].Id;
    const imageInfo = JSON.parse(exec('docker', ['image', 'inspect', image]))[0]; assert.equal(imageInfo.Config.Labels['voltex.qa.run'], nonce);
    const imageEnv = Object.fromEntries(imageInfo.Config.Env.map(e => { const i = e.indexOf('='); return [e.slice(0, i), e.slice(i + 1)]; }));
    assert.deepEqual(Object.keys(imageEnv).sort(), ['NODE_VERSION', 'PATH', 'YARN_VERSION']); assert.equal(imageEnv.NODE_VERSION, '22.23.3');
    json(path.join(evidence, 'test-image.json'), { id: image, label: nonce, baseDigest: digest, helperSHA256: hash(fs.readFileSync(__filename)), dockerfileSHA256: hash(fs.readFileSync(path.join(context, 'Dockerfile'))) });
    const uid = process.getuid(), gid = process.getgid(); assert.ok(uid > 0 && gid > 0, 'non-root CI runner required');
    const testEnv = { NODE_ENV: 'test', TZ: 'UTC', CI: 'true', FORCE_COLOR: '0', HOME: '/tmp/home', TMPDIR: '/tmp', DATABASE_URL: 'postgresql://test:test@127.0.0.1:9/voltex_test', DIRECT_URL: 'postgresql://test:test@127.0.0.1:9/voltex_test', JWT_SECRET: 'test-secret-at-least-this-long', EMAIL_VERIFICATION_SECRET: 'test-email-verification-secret-distinct-from-jwt', API_KEY_ENCRYPTION_SECRET: '0'.repeat(64) };
    const args = ['create', '--label', 'voltex.qa.run=' + nonce, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--ipc', 'private', '--pids-limit', '128', '--cpus', '2', '--memory', '4g', '--memory-swap', '4g', '--user', uid + ':' + gid, ...Object.entries(TMPFS).flatMap(([p, opts]) => ['--tmpfs', p + ':' + opts]), '--mount', 'type=bind,source=' + raw + ',target=/evidence', '--entrypoint', '/usr/local/bin/node'];
    for (const [k, v] of Object.entries(testEnv)) args.push('--env', k + '=' + v);
    args.push(image, '/qa/harness.cjs', '--container-run');
    id = exec('docker', args); assert.match(id, /^[a-f0-9]{64}$/);
    inspected = JSON.parse(exec('docker', ['inspect', id]))[0];
    const expectedEnv = { ...imageEnv, ...testEnv }, envKeys = Object.keys(expectedEnv);
    assertContainer(inspected, { id, image, nonce, output: raw, env: expectedEnv });
    json(path.join(evidence, 'prestart-isolation.json'), { id, image, networkMode: inspected.HostConfig.NetworkMode, networkNames: Object.keys(inspected.NetworkSettings.Networks), readOnly: true, user: inspected.Config.User, pidsLimit: 128, memoryBytes: inspected.HostConfig.Memory, cpuLimit: 2, binds: inspected.Mounts.map(m => ({ source: m.Source, target: m.Destination })), noHostPidIpc: true, verifiedBeforeStart: true, environmentKeys: envKeys, dbOptInsAbsent: true });
    const stdout = fs.createWriteStream(path.join(evidence, 'jest.stdout.log'), { flags: 'wx', mode: 0o600 }), stderr = fs.createWriteStream(path.join(evidence, 'jest.stderr.log'), { flags: 'wx', mode: 0o600 });
    let bytes = 0, overflow = false, timedOut = false;
    const attached = cp.spawn('docker', ['start', '--attach', id], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => { try { exec('docker', ['kill', id], { timeout: 15000 }); } catch (e) { cleanupErrors.push(e.message); } attached.kill('SIGKILL'); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, 20 * 60 * 1000);
    for (const [stream, dest] of [[attached.stdout, stdout], [attached.stderr, stderr]]) stream.on('data', b => { bytes += b.length; if (bytes <= MAX_LOG) dest.write(b); else if (!overflow) { overflow = true; stop(); } });
    let attachResult;
    try { attachResult = await new Promise((resolve, reject) => { attached.once('error', reject); attached.once('close', (code, signal) => resolve({ code, signal })); }); }
    finally { clearTimeout(timer); await Promise.all([new Promise(resolve => stdout.end(resolve)), new Promise(resolve => stderr.end(resolve))]); }
    const state = JSON.parse(exec('docker', ['inspect', id]))[0].State;
    Object.assign(result, { attachResult, containerExitCode: state.ExitCode, oomKilled: state.OOMKilled, timedOut, logOverflow: overflow, logBytes: bytes });
    assert.equal(state.Running, false); stopped = true; assert.ok(!timedOut && !overflow && !state.OOMKilled, 'test incomplete due timeout/log bound/OOM');
    collectContainerEvidence(raw, evidence); collected = true;
    assert.ok(fs.existsSync(path.join(evidence, 'jest.json')), 'no terminal Jest JSON: incomplete');
    const j = boundedJSON(path.join(evidence, 'jest.json')); terminalInventory(j, tests);
    const cr = boundedJSON(path.join(evidence, 'container-result.json')); assert.equal(cr.sourceUnchanged, true, 'tests modified canonical source');
    Object.assign(result, summarizeJestOutcomes(j));
    result.status = attachResult.code === 0 && !attachResult.signal && state.ExitCode === 0 && cr.code === 0 && j.success && j.numFailedTestSuites === 0 ? 'PASS_WITH_REPORTED_DATABASE_SKIPS' : 'FAIL';
  } catch (e) { failure = e.message; result.failure = failure; }
  finally {
    if (id) try { const c = JSON.parse(exec('docker', ['inspect', id]))[0]; assert.equal(c.Config.Labels['voltex.qa.run'], nonce); exec('docker', ['rm', '--force', id], { timeout: 30000 }); stopped = true; } catch (e) { cleanupErrors.push(e.message); }
    if (!collected && (!id || stopped)) try { collectContainerEvidence(raw, evidence); collected = true; } catch (e) { cleanupErrors.push('Evidence export: ' + e.message); }
    if (image) try { const i = JSON.parse(exec('docker', ['image', 'inspect', image]))[0]; assert.equal(i.Config.Labels['voltex.qa.run'], nonce); exec('docker', ['image', 'rm', image], { timeout: 30000 }); } catch (e) { cleanupErrors.push(e.message); }
    result.cleanupErrors = cleanupErrors; if (cleanupErrors.length) result.status = 'INCOMPLETE'; result.finishedAt = new Date().toISOString();
    // Commands include only explicitly constructed dummy env values; redact their values regardless.
    json(path.join(evidence, 'commands.json'), commandRecords.map(c => ({ ...c, args: c.args.map((a, i) => c.args[i - 1] === '--env' ? a.split('=')[0] + '=<test-only>' : a) })));
    finishEvidence(evidence, result);
  }
  console.log(JSON.stringify({ status: result.status, evidence, counts: result.counts || null, failure, cleanupErrors }));
  process.exitCode = result.status === 'PASS_WITH_REPORTED_DATABASE_SKIPS' ? 0 : 1;
}
module.exports = { safePath, excluded, parseTree, backendTests, assertContainer, verifyFiles, artifactFiles, boundedJSON, collectContainerEvidence, terminalInventory, summarizeJestOutcomes, compiledInventory, finishEvidence, main, TMPFS };
if (require.main === module) (process.argv[2] === '--container-run' ? containerMain() : main()).catch(e => { console.error(e.stack); process.exitCode = 1; });
