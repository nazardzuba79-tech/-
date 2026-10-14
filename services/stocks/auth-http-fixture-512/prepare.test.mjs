// Pure guards: no Docker, network, HTTP listener, SQLite, compiler or workload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, sourceAllowed, safeRelative, validateLock, validateStage, validateImage,
  validatePreparationContainer, validateSeedRows, validateDockerfile, parseGitBatch, sha, PREPARE_SCHEMA, BASE_IMAGE, FREEZE_BASE_IMAGE_ALIAS, IDLE_PROGRAM, main } from './prepare.mjs';
import { ISSUER, SUBJECTS, SEED } from './plan.mjs';

const hash = 'a'.repeat(64), commit = 'b'.repeat(40);
const absolute = process.platform === 'win32' ? 'C:/prepare-fixture' : '/prepare-fixture';
const config = () => ({ schema: PREPARE_SCHEMA, sourceSha: commit,
  stage: { archive: absolute + '/stage.zip', sha256: hash, sourceSha: commit, runId: '38509622796', artifactId: '11870556776', buildProvenanceSha256: hash },
  baseImage: BASE_IMAGE, python: { executable: absolute + '/python', sha256: hash }, output: absolute + '/new-output', device: '/dev/vdb' });

test('only explicit strict preparation inputs; same-head stage and immutable official image', () => {
  const c = config(); assert.equal(validateConfig(c), c);
  assert.match(FREEZE_BASE_IMAGE_ALIAS, /^node@sha256:[a-f0-9]{64}$/); assert.equal('docker.io/library/' + FREEZE_BASE_IMAGE_ALIAS, BASE_IMAGE);
  for (const mutate of [ c => { c.launchAuthorized = true; }, c => { c.stage.sourceSha = 'c'.repeat(40); },
    c => { c.baseImage = 'node:24'; }, c => { c.python.sha256 = ''; }, c => { c.stage.runId = '0'; },
    c => { c.device = '/dev/../etc/passwd'; }, c => { c.stage.archive = 'relative.zip'; },
    c => { c.output += ',readonly'; }, c => { c.sourceSha = 'main'; }, c => { c.stage.review = 'ancestor approved'; } ]) {
    const value = config(); mutate(value); assert.throws(() => validateConfig(value));
  }
});

test('canonical context admits only exact QA/runtime source families and rejects private files', () => {
  for (const p of ['src/api/routes/account.ts', 'src/types/shared.d.ts', 'package-lock.json', 'frontend/package-lock.json',
    'services/stocks-global/account-worker.mjs', 'services/stocks-simulator/engine.mjs',
    'services/stocks/targeted-http-512/plan.mjs',
    'scripts/qa-stocks-principal-projection.cjs', 'services/stocks/auth-http-fixture-512/prepare.mjs']) assert.equal(sourceAllowed(p), true, p);
  for (const p of ['.env', '.env.production', '.git/config', '.npmrc', 'private/key.pem', 'accounts.sqlite',
    'src/a.test.ts', 'src/api/routes/account.js', 'node_modules/bcrypt/index.js',
    'services/stocks/auth-http-fixture-512/prepare.test.mjs', 'scripts/qa-stocks-local-stage-recovery.cjs',
    'frontend/src/App.tsx', '../package.json', '/etc/passwd', 'C:/key', 'src/../../key.ts']) assert.equal(sourceAllowed(p), false, p);
  for (const p of ['x/../y', 'x//y', 'a\\b', '.env', 'private/db.sqlite']) assert.throws(() => safeRelative(p));
});

test('npm install inputs reject private registries, mutable links and missing integrity', () => {
  const lock = () => ({ lockfileVersion: 3, packages: { '': { name: 'fixture' }, 'node_modules/example': {
    version: '1.0.0', resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz', integrity: 'sha512-YWJjZA==' } } });
  validateLock(lock());
  for (const mutate of [ r => { r.resolved = 'https://user:secret@example.com/a.tgz'; }, r => { r.resolved = 'file:/home/private'; },
    r => { r.resolved += '?token=private'; }, r => { r.link = true; }, r => { r.integrity = ''; } ]) {
    const value = lock(); mutate(value.packages['node_modules/example']); assert.throws(() => validateLock(value));
  }
});

test('canonical Git binary batch preserves bytes and rejects wrong, truncated or extra objects', () => {
  const blob = 'd'.repeat(40), bytes = Buffer.from('source\r\n\0bytes'), rows = [{ blob }];
  const batch = Buffer.concat([Buffer.from(`${blob} blob ${bytes.length}\n`), bytes, Buffer.from('\n')]);
  assert.deepEqual(parseGitBatch(batch, rows), [bytes]);
  assert.throws(() => parseGitBatch(batch, [{ blob: 'e'.repeat(40) }]));
  assert.throws(() => parseGitBatch(batch.subarray(0, -2), rows));
  assert.throws(() => parseGitBatch(Buffer.concat([batch, Buffer.from('extra')]), rows));
  assert.throws(() => parseGitBatch(Buffer.from(`${blob} blob 99999999999\n`), rows));
});

test('the reviewed ignore-scripts Dockerfile cannot silently gain hooks or default entrypoints', () => {
  const dockerfile = Buffer.from(`# This image is not built or run by the review-only source preparation.\n# Build context must be the separately verified, allowlisted frozen closure.\nARG BASE_IMAGE\nFROM \${BASE_IMAGE}\nARG SOURCE_SHA\nARG CONTEXT_SHA256\nLABEL org.opencontainers.image.revision=\${SOURCE_SHA}\nLABEL voltex.auth-http.context=\${CONTEXT_SHA256}\nWORKDIR /source\nCOPY package.json package-lock.json ./\nRUN npm ci --ignore-scripts --no-audit --no-fund\nCOPY . ./\nUSER 10001:10001\nENTRYPOINT ["node"]\nCMD ["-e", "throw new Error('REVIEW_ONLY_NO_DEFAULT_ENTRY')"]\n`);
  validateDockerfile(dockerfile);
  assert.throws(() => validateDockerfile(Buffer.from(dockerfile.toString().replace('--ignore-scripts ', ''))));
  assert.throws(() => validateDockerfile(Buffer.concat([dockerfile, Buffer.from('RUN npm run build\n')])));
});

function stage() {
  const names = ['dist/api/routes/account.js', 'dist/api/middleware/auth.js', 'dist/api/asyncRoute.js', 'dist/services/ContactEmailPolicy.js'];
  const files = new Map(names.map((name, i) => [name, Buffer.from('module.exports = ' + i + ';\n')]));
  const log = Buffer.from('fresh compiler\n');
  const proof = { exitCode: 0, signal: null, sourcesUnchanged: true, node: 'v22.23.3', logSha256: sha(log),
    outputs: [...files].map(([path, bytes]) => ({ path, sha256: sha(bytes) })) };
  const proofBytes = Buffer.from(JSON.stringify(proof)), c = config(); c.stage.buildProvenanceSha256 = sha(proofBytes);
  const manifest = { fixtureOnly: true, sourceSha: commit, workingTreeChanges: [], buildProvenanceSha256: sha(proofBytes),
    migration: 'NOT_USED', productionEntrypoint: 'NOT_USED', nodeModulesCopied: false,
    files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha(bytes) })) };
  const report = { status: 'PASS', fixtureOnly: true, productionAccess: false, cases: Array.from({ length: 5 }, () => ({ status: 'PASS' })) };
  return { c, proof, proofBytes, log, files, manifest, report };
}
const checkStage = v => validateStage(v.manifest, v.proofBytes, v.log, v.files, v.c, v.report);
test('successful compiler Node 22 provenance is retained, never relabeled Node 24', () => {
  const v = stage(); assert.equal(checkStage(v).node, 'v22.23.3');
});
test('compiled artifact tamper, missing modules, dirty source, cross-head and old build fail closed', () => {
  for (const mutate of [ v => { v.files.set('dist/api/routes/account.js', Buffer.from('tampered')); },
    v => { v.files.delete('dist/api/asyncRoute.js'); }, v => { v.log = Buffer.from('other'); },
    v => { v.manifest.sourceSha = 'c'.repeat(40); }, v => { v.manifest.workingTreeChanges = ['src/api/routes/account.ts']; },
    v => { v.manifest.nodeModulesCopied = true; }, v => { v.manifest.files.push(v.manifest.files[0]); },
    v => { v.c.stage.buildProvenanceSha256 = '0'.repeat(64); }, v => { v.files.set('../private.js', Buffer.from('private')); },
    v => { v.report.status = 'FAIL'; }, v => { v.report.cases[3].status = 'FAIL'; }, v => { v.report.productionAccess = true; } ]) {
    const value = stage(); mutate(value); assert.throws(() => checkStage(value));
  }
  const value = stage(); value.proof.exitCode = 2; value.proofBytes = Buffer.from(JSON.stringify(value.proof));
  value.c.stage.buildProvenanceSha256 = sha(value.proofBytes); value.manifest.buildProvenanceSha256 = sha(value.proofBytes);
  assert.throws(() => checkStage(value));
});

function image() {
  return { Id: 'sha256:' + hash, Os: 'linux', Architecture: 'amd64', Config: { User: '10001:10001',
    Entrypoint: ['node'], Cmd: ['-e', "throw new Error('REVIEW_ONLY_NO_DEFAULT_ENTRY')"],
    Labels: { 'org.opencontainers.image.revision': commit, 'voltex.auth-http.context': hash },
    Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'NODE_VERSION=24.21.0', 'YARN_VERSION=1.22.22'] } };
}
test('image proof rejects mutable identity, wrong source/runtime and private environment', () => {
  assert.equal(validateImage(image(), commit, hash), 'sha256:' + hash);
  for (const mutate of [ i => { i.Config.User = 'root'; }, i => { i.Config.Env.push('DATABASE_URL=private'); },
    i => { i.Config.Cmd = ['server.mjs']; }, i => { i.Config.Labels['voltex.auth-http.context'] = '0'.repeat(64); },
    i => { i.Config.Env[1] = 'NODE_VERSION=22.23.3'; }, i => { i.Os = 'windows'; } ]) {
    const value = image(); mutate(value); assert.throws(() => validateImage(value, commit, hash));
  }
});
function container() {
  const expected = { image: 'sha256:' + hash, uid: '1001:1001', owner: 'prepare-owned', role: 'service',
    network: 'none', command: ['-e', IDLE_PROGRAM], mounts: [] };
  const info = { Image: expected.image, Config: { User: expected.uid, Entrypoint: ['node'], Cmd: expected.command,
    Env: [...image().Config.Env, 'PREPARE_512_ONLY=true'], Labels: { 'voltex.auth-http.prepare': expected.owner, 'voltex.auth-http.role': 'service' } },
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false, PidMode: '', IpcMode: 'private',
      CapDrop: ['ALL'], CapAdd: [], Devices: [], PortBindings: {}, PublishAllPorts: false, SecurityOpt: ['no-new-privileges'],
      Memory: 268435456, MemorySwap: 268435456, NanoCpus: 50000000, CpusetCpus: '0' }, Mounts: [] };
  return { info, expected };
}
test('pre-start inspection admits only exact idle/preparation commands, ownership and resource isolation', () => {
  const value = container(); assert.equal(validatePreparationContainer(value.info, value.expected), true);
  for (const mutate of [ i => { i.Config.Cmd = ['services/stocks-global/server.mjs']; },
    i => { i.HostConfig.NetworkMode = 'host'; }, i => { i.HostConfig.Privileged = true; },
    i => { i.HostConfig.PidMode = 'host'; }, i => { i.HostConfig.CapAdd = ['SYS_ADMIN']; },
    i => { i.HostConfig.PortBindings = { '443/tcp': [{}] }; }, i => { i.Config.Env.push('JWT_SECRET=private'); },
    i => { i.HostConfig.SecurityOpt.push('seccomp=unconfined'); },
    i => { i.HostConfig.MemorySwap = -1; }, i => { i.HostConfig.CpusetCpus = '0-7'; },
    i => { i.Config.Labels['voltex.auth-http.prepare'] = 'foreign'; },
    i => { i.Mounts = [{ Type: 'bind', Source: '/private', Destination: '/private', RW: true }]; } ]) {
    const v = container(); mutate(v.info); assert.throws(() => validatePreparationContainer(v.info, v.expected));
  }
});

function seedRows() {
  return SUBJECTS.map(subject => ({ id: sha(JSON.stringify([ISSUER, subject])), ledger: JSON.stringify({ schema: SEED.schema,
    revision: 0, createdAt: 1234, settings: { feeBps: 0 }, wallets: SEED.wallets, orders: [], fills: [], positions: {}, quotes: {},
    adjustments: [], realized: { USDT: '0.00000000', USDC: '0.00000000' } }) }));
}
test('closed seed projection requires exactly 50 isolated identities and pristine original balances', () => {
  const rows = seedRows(), result = validateSeedRows(rows, 1234); assert.equal(result.length, 50);
  assert.notEqual(result[0].id, result[1].id); assert.equal(result[0].subject, 'alice'); assert.equal(result[1].subject, 'bob');
  assert.throws(() => validateSeedRows(rows.slice(1), 1234));
  const duplicate = seedRows(); duplicate[1].id = duplicate[0].id; assert.throws(() => validateSeedRows(duplicate, 1234));
  for (const mutate of [ l => { l.wallets.USDT.cash = '9999.00000000'; }, l => { l.wallets.USDC.reserved = '1.00000000'; },
    l => { l.revision = 1; }, l => { l.positions.AAPL = {}; }, l => { l.orders = [{}]; }, l => { l.quotes.AAPL = {}; },
    l => { l.settings.feeBps = 1; }, l => { l.realized.USDT = '1.00000000'; } ]) {
    const r = seedRows(), ledger = JSON.parse(r[0].ledger); mutate(ledger); r[0].ledger = JSON.stringify(ledger);
    assert.throws(() => validateSeedRows(r, 1234));
  }
});

test('import/default CLI does not start preparation or authorize a workload', async () => {
  await assert.rejects(main([]), /PREPARE_EXPLICIT_CONFIG_REQUIRED/);
  await assert.rejects(main(['--run']), /PREPARE_EXPLICIT_CONFIG_REQUIRED/);
  await assert.rejects(main(['--prepare', 'relative.json']), /PREPARE_ABSOLUTE_PATH/);
});
