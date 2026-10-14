'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { safePath, excluded, parseTree, backendTests, assertContainer, verifyFiles, artifactFiles, boundedJSON, collectContainerEvidence, terminalInventory, finishEvidence, TMPFS } = require('./qa-backend-full-offline.cjs');
const blob = b => crypto.createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function isolated() {
  return {
    Id: 'a'.repeat(64), Image: 'sha256:' + 'b'.repeat(64), State: { Running: false, Status: 'created' },
    Config: { User: '1001:1001', Entrypoint: ['/usr/local/bin/node'], Cmd: ['/qa/harness.cjs', '--container-run'], Labels: { 'voltex.qa.run': 'owned' }, Env: ['PATH=/usr/local/bin:/usr/bin', 'NODE_ENV=test'] },
    HostConfig: { NetworkMode: 'none', Privileged: false, ReadonlyRootfs: true, PidMode: '', IpcMode: 'private', CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], PidsLimit: 128, Memory: 4 * 1024 ** 3, MemorySwap: 4 * 1024 ** 3, NanoCpus: 2e9, Tmpfs: { ...TMPFS }, Devices: [], DeviceRequests: [], Links: null, VolumesFrom: null },
    Mounts: [{ Type: 'bind', Source: '/owned/evidence', Destination: '/evidence', RW: true }], NetworkSettings: { Networks: { none: {} } },
  };
}
const expected = { id: 'a'.repeat(64), image: 'sha256:' + 'b'.repeat(64), nonce: 'owned', output: '/owned/evidence', env: { PATH: '/usr/local/bin:/usr/bin', NODE_ENV: 'test' } };
test('Git source inventory admits only exact regular blobs and safe relative names', () => {
  assert.deepEqual(parseTree('100644 blob ' + 'a'.repeat(40) + '      12\tsrc/example.ts\0').files.map(x => x.path), ['src/example.ts']);
  for (const p of ['../secret', '/absolute', 'a/../b', 'a\\b', 'line\nname', '.git/config']) assert.throws(() => safePath(p));
  for (const mode of ['120000', '160000']) assert.throws(() => parseTree(mode + ' blob ' + 'a'.repeat(40) + ' 1\tlink\0'));
  assert.throws(() => parseTree('100644 blob ' + 'a'.repeat(40) + ' 600000000\ttoo-big\0'));
  const one = '100644 blob ' + 'a'.repeat(40) + ' 1\ta.ts\0'; assert.throws(() => parseTree(one + one));
});
test('env/private material is excluded while the full source audit closure remains', () => {
  for (const p of ['.env', '.env.production', 'x/.env.example', 'x/secret.key', 'x/test.sqlite', 'x/key.PEM', 'node_modules/a.js']) assert.equal(excluded(p), true);
  for (const p of ['frontend/src/App.tsx', 'workers/market-edge/src/index.ts', 'docs/release.md', 'scripts/fixture.cjs', 'prisma/schema.prisma', 'package-lock.json']) assert.equal(excluded(p), false);
});
test('backend discovery requires the full reviewed249, not frontend or arbitrary fixture files', () => {
  const files = Array.from({ length: 249 }, (_, i) => ({ path: `src/x/${i}.test.ts` }));
  assert.equal(backendTests([...files, { path: 'frontend/src/ui.test.tsx' }, { path: 'src/__tests__/fixtures/server.cjs' }]).length, 249);
  assert.throws(() => backendTests(files.slice(1))); assert.throws(() => backendTests([...files, { path: 'src/new.test.ts' }]));
});
test('prestart inspection rejects network, namespace, entrypoint, mount and identity drift', () => {
  assert.doesNotThrow(() => assertContainer(isolated(), expected));
  const changes = [c => c.HostConfig.NetworkMode = 'host', c => c.HostConfig.Privileged = true, c => c.HostConfig.PidMode = 'host', c => c.HostConfig.IpcMode = 'host', c => c.HostConfig.ReadonlyRootfs = false, c => c.Config.User = '0:0', c => c.Config.Entrypoint = ['/app/start.sh'], c => c.Config.Cmd = ['prisma', 'migrate', 'deploy'], c => c.State.Running = true, c => c.State.Status = 'exited', c => c.Config.Labels['voltex.qa.run'] = 'another', c => c.HostConfig.CapDrop = [], c => c.HostConfig.CapAdd = ['NET_ADMIN'], c => c.HostConfig.SecurityOpt = [], c => c.HostConfig.SecurityOpt.push('seccomp=unconfined'), c => c.HostConfig.PublishAllPorts = true, c => c.HostConfig.PortBindings = { '443/tcp': [] }, c => c.HostConfig.Tmpfs['/tmp'] = 'rw,size=4g', c => c.Mounts.push({ Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock', RW: true }), c => c.Mounts[0].Source = '/another/evidence', c => c.NetworkSettings.Networks = { bridge: {} }];
  for (const change of changes) { const c = isolated(); change(c); assert.throws(() => assertContainer(c, expected)); }
});
test('test container cannot inherit credentials, database opt-ins or change resource guardrails', () => {
  for (const entry of ['GITHUB_TOKEN=private', 'PRIVATE_TRADING_DB_TESTS=1', 'NODE_OPTIONS=--require=/unknown']) { const c = isolated(); c.Config.Env.push(entry); assert.throws(() => assertContainer(c, expected)); }
  const changed = isolated(); changed.Config.Env[1] = 'NODE_ENV=production'; assert.throws(() => assertContainer(changed, expected));
  for (const [key, value] of [['Memory', 0], ['MemorySwap', -1], ['NanoCpus', 0], ['PidsLimit', 0]]) { const c = isolated(); c.HostConfig[key] = value; assert.throws(() => assertContainer(c, expected)); }
});
test('canonical source proof rejects byte mutation independently of path and size', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-offline-proof-'));
  try { const b = Buffer.from('original\n'), f = { path: 'source.ts', bytes: b.length, gitBlob: blob(b), sha256: sha(b) }; fs.writeFileSync(path.join(d, f.path), b); verifyFiles(d, [f]); fs.writeFileSync(path.join(d, f.path), 'tampered\n'); assert.throws(() => verifyFiles(d, [f])); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test('artifact manifest binds exact retained bytes and does not include external paths', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-offline-artifact-'));
  try { fs.writeFileSync(path.join(d, 'result.json'), '{"status":"FAIL"}\n'); const list = artifactFiles(d); assert.equal(list.length, 1); assert.equal(list[0].path, 'result.json'); assert.equal(list[0].sha256, sha(fs.readFileSync(path.join(d, 'result.json')))); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test('terminal suite count cannot hide a missing, duplicated or substituted backend file', () => {
  const tests = Array.from({ length: 249 }, (_, i) => `src/${String(i).padStart(3, '0')}.test.ts`);
  const j = { numTotalTestSuites: 249, testResults: tests.map(t => ({ name: '/work/' + t })) }; terminalInventory(j, tests);
  j.testResults[248].name = j.testResults[0].name; assert.throws(() => terminalInventory(j, tests));
  j.testResults[248].name = '/work/frontend/src/replacement.test.ts'; assert.throws(() => terminalInventory(j, tests));
});
test('container export accepts only bounded flat regular reports and never overwrites host proofs', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-offline-export-')), raw = path.join(d, 'raw'), out = path.join(d, 'evidence'); fs.mkdirSync(raw); fs.mkdirSync(out);
  try {
    fs.writeFileSync(path.join(out, 'source-manifest.json'), 'host-proof'); fs.writeFileSync(path.join(raw, 'container-result.json'), '{"code":1}');
    collectContainerEvidence(raw, out); assert.equal(boundedJSON(path.join(out, 'container-result.json')).code, 1);
    assert.throws(() => collectContainerEvidence(raw, out)); assert.equal(fs.readFileSync(path.join(out, 'source-manifest.json'), 'utf8'), 'host-proof');
    fs.mkdirSync(path.join(raw, 'jest.json')); assert.throws(() => collectContainerEvidence(raw, out)); assert.throws(() => boundedJSON(path.join(raw, 'jest.json')));
    fs.rmdirSync(path.join(raw, 'jest.json')); fs.writeFileSync(path.join(raw, 'source-manifest.json'), 'attempt-overwrite'); assert.throws(() => collectContainerEvidence(raw, out));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test('an artifact validation failure cannot persist a PASS-looking result', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-offline-finalizer-'));
  try {
    const fd = fs.openSync(path.join(d, 'oversize.log'), 'wx'); fs.ftruncateSync(fd, 64 * 1024 ** 2 + 1); fs.closeSync(fd);
    const result = { status: 'PASS_WITH_REPORTED_DATABASE_SKIPS' }; finishEvidence(d, result);
    assert.equal(result.status, 'INCOMPLETE'); assert.match(result.artifactError, /byte limit/);
    assert.equal(boundedJSON(path.join(d, 'result.json')).status, 'INCOMPLETE');
    assert.equal(boundedJSON(path.join(d, 'artifact-validation-error.json')).status, 'INCOMPLETE');
    assert.equal(fs.existsSync(path.join(d, 'artifact-manifest.json')), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
