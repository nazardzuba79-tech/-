// SYNTHETIC UNIT FIXTURES ONLY. No real artifacts, images, native files or SQLite
// are created/read, and no fixture PASS is evidence of an actual preparation run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, BASE_IMAGE } from './launch-gate.mjs';
import { BASELINE, OVERLAYS, HELPERS } from './closure.mjs';
import { SUBJECTS, ISSUER, planHash } from '../auth-http-fixture-512/plan.mjs';
import { MEMBER_PATHS, COMPILED_PATHS, PREPARE_SCHEMA, artifactNames, nativeBinding,
  createLaunchReceipts, verifyPreparedProofs, createLocalLaunchReceipts } from './prepare-receipts.mjs';

const sourceSha = '3333333333333333333333333333333333333333', runId = '777777';
const h = name => hash(`synthetic unit only: ${name}`);
const bytes = object => Buffer.from(JSON.stringify(object));
function fixture() {
  const compiled = Object.fromEntries(COMPILED_PATHS.map(p => [p, Buffer.from(`synthetic JS bytes ${p}`)]));
  const compiledHashes = Object.fromEntries(COMPILED_PATHS.map(p => [p, hash(compiled[p])]));
  const buildLog = Buffer.from('synthetic compiler log\n'), sourcePath = 'src/api/middleware/auth.ts';
  const build = { command: { executable: '/synthetic/node', args: ['/synthetic/tsc'], cwd: '/synthetic' },
    startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z', exitCode: 0, signal: null,
    compilerVersion: '5.9.3', compilerFiles: [], node: 'v22.23.3', tsconfig: { path: 'tsconfig.json', sha256: h('tsconfig') },
    packageLockSha256: h('lock'), logSha256: hash(buildLog), sourcesBefore: [{ path: sourcePath, sha256: h('source') }],
    outputs: COMPILED_PATHS.map(p => ({ path: p, sha256: compiledHashes[p] })), sourcesAfterHash: h('source after'), sourcesUnchanged: true };
  const buildProvenance = bytes(build);
  const pkg = { fixtureOnly: true, sourceSha, workingTreeChanges: [], packageEntry: 'fixture', accountEntry: 'compiled-account',
    buildProvenanceSha256: hash(buildProvenance), migration: 'NOT_USED', productionEntrypoint: 'NOT_USED',
    nodeModulesCopied: false, dependencies: [], files: COMPILED_PATHS.map(p => ({ path: p, bytes: compiled[p].length, sha256: compiledHashes[p] })) };
  const stage = { status: 'PASS', fixtureOnly: true, productionAccess: false, capacityClaim: false, browserClaim: false,
    cases: Array.from({ length: 5 }, (_, i) => ({ name: `synthetic case ${i}`, status: 'PASS' })) };
  const sourceFiles = [{ path: sourcePath, bytes: 12, sha256: h('source') },
    { path: 'tsconfig.json', bytes: 12, sha256: h('tsconfig') }, { path: 'package-lock.json', bytes: 12, sha256: h('lock') },
    ...OVERLAYS.map(p => ({ path: p, bytes: 12, sha256: h(p) })), ...pkg.files,
    { path: 'compiled-proof.json', bytes: buildProvenance.length, sha256: hash(buildProvenance) },
    { path: 'build.log', bytes: buildLog.length, sha256: hash(buildLog) }];
  const contextSha256 = hash(JSON.stringify(sourceFiles));
  const runtimeManifest = { schema: PREPARE_SCHEMA, sourceSha, sourceTree: [], files: sourceFiles, contextSha256 };
  const nativeFiles = [{ path: 'bcrypt/prebuilds/linux-x64/bcrypt.glibc.node', bytes: 100, sha256: h('bcrypt') },
    { path: 'bcrypt/prebuilds/win32-x64/bcrypt.node', bytes: 100, sha256: h('windows bcrypt') }];
  const inside = { schema: PREPARE_SCHEMA, status: 'PREPARED_NOT_AUTHORIZED', planId: 'stocks-auth-http-fixture-512-v2',
    planHash: planHash(), contextSha256,
    runtime: { node: 'v24.21.0', nodeSha256: h('node'), platform: 'linux', arch: 'x64', uid: 1001, gid: 1001 },
    compiler: { buildNode: build.node, proofSha256: hash(buildProvenance), compiled: compiledHashes },
    runtimeClosure: { fixturePackagingProof: true, npmDependencies: [], files: OVERLAYS.map(p => ({ path: p, sha256: h(p), bytes: 12 })) },
    dependencies: { files: nativeFiles, inventorySha256: hash(JSON.stringify(nativeFiles)), nativeFiles, bcryptSha256: h('bcrypt') },
    seed: { api: 'openAccountWorker.forPrincipal', closed: true, integrity: 'ok', journal: 'delete',
      subjects: [...SUBJECTS], accounts: SUBJECTS.map(s => ({ id: hash(JSON.stringify([ISSUER, s])), ledgerSha256: h(`ledger ${s}`) })),
      fixedTime: 1791936000000, synchronous: 2, bytes: 40960, sha256: h('seed'),
      actualWorkerConnectionPragma: 'UNMEASURED', workerSynchronous: 'SOURCE_CONFIGURED_FULL', metrics: {} },
    sourceReadability: { verified: true }, workload: { authHttpInvoked: false, stocksHttpInvoked: false,
      providerInvoked: false, compiledAuthLoaded: false, tradingCommands: 0 } };
  const report = { schema: PREPARE_SCHEMA, status: 'PREPARED_NOT_AUTHORIZED', sourceSha, contextSha256, inside,
    stage: { archive: 'stage.zip', sha256: h('compiled archive'), sourceSha, runId, artifactId: '10001',
      buildProvenanceSha256: hash(buildProvenance), reportSha256: hash(bytes(stage)) },
    image: { id: `sha256:${h('image id')}`, baseImage: BASE_IMAGE, freezeBaseImageAlias: BASE_IMAGE.replace('docker.io/library/', '') },
    imageArchive: { sha256: h('image tar'), bytes: 500000 },
    cleanup: ['authority', 'driver', 'prepare', 'service'].map(role => ({ kind: 'container', role, status: 'REMOVED',
      terminal: { exitCode: 0, oomKilled: false } })).concat({ kind: 'image', id: `sha256:${h('image id')}`, status: 'REMOVED' }) };
  const derived = { schema: 'stocks-one-burst-derived-512-v1', baseline: BASELINE, sourceSha, contextSha256,
    overlays: OVERLAYS.map(p => ({ path: p, originalSha256: h(p), outputSha256: h(`derived ${p}`), bytes: 20, hunksSha256: h(`hunks ${p}`) })),
    helpers: HELPERS.map(p => ({ path: p, sha256: h(p), bytes: 20 })) };
  const members = { stageReport: bytes(stage), stageManifest: bytes(pkg), buildProvenance, buildLog, compiled,
    preparationReport: bytes(report), runtimeManifest: bytes(runtimeManifest), insideProof: bytes(inside), derivedManifest: bytes(derived) };
  const archive = (role, artifactId) => ({ artifactId, runId, sourceSha, name: artifactNames(sourceSha)[role], expired: false,
    archiveSha256: h(`${role} archive`), downloadedSha256: h(`${role} archive`), bytes: 10000, selectedMembers: [] });
  const archives = { compiled: archive('compiled', '10001'), preparation: archive('preparation', '10002'), inputs: archive('inputs', '10003') };
  const refresh = key => {
    const role = ['stageReport', 'stageManifest', 'buildProvenance', 'buildLog'].includes(key) ? 'compiled' : 'preparation';
    const array = archives[role].selectedMembers, path = MEMBER_PATHS[key];
    const row = { path, bytes: members[key].length, sha256: hash(members[key]) };
    const index = array.findIndex(r => r.path === path); if (index < 0) array.push(row); else array[index] = row;
  };
  for (const key of Object.keys(members).filter(k => k !== 'compiled')) refresh(key);
  for (const p of COMPILED_PATHS) archives.compiled.selectedMembers.push({ path: `package/${p}`, bytes: compiled[p].length, sha256: hash(compiled[p]) });
  archives.inputs.selectedMembers = [{ path: MEMBER_PATHS.image, bytes: report.imageArchive.bytes, sha256: report.imageArchive.sha256 },
    { path: MEMBER_PATHS.seed, bytes: inside.seed.bytes, sha256: inside.seed.sha256 }];
  const policy = { sourceTreeSha256: h('canonical reviewed source tree'), native: nativeBinding(inside, BASE_IMAGE) };
  const input = { sourceSha, runId, sourceTreeSha256: policy.sourceTreeSha256, archives, members };
  const mutate = (key, change) => { const object = JSON.parse(members[key]); change(object); members[key] = bytes(object); refresh(key); };
  const local = () => ({ sourceSha, runId, jobName: 'auth-burst', sourceTreeSha256: policy.sourceTreeSha256,
    compiledArchive: archives.compiled, selectedMembers: { preparation: archives.preparation.selectedMembers,
      inputs: archives.inputs.selectedMembers }, members });
  return { input, policy, mutate, refresh, local, inside, report, derived,
    run: () => createLaunchReceipts(input, policy) };
}

test('real schema translation binds synthetic unit metadata to exact remote receipt wrapper fields', () => {
  const f = fixture(), result = f.run();
  assert.deepEqual(Object.keys(result), ['compiled', 'preparation', 'inputs']);
  for (const role of Object.keys(result)) {
    const row = result[role]; assert.equal(row.artifactId, f.input.archives[role].artifactId);
    assert.equal(hash(row.proofText), row.proofSha256); assert.equal(JSON.parse(row.proofText).sourceSha, sourceSha);
  }
  const proof = JSON.parse(result.preparation.proofText);
  assert.equal(proof.compiledArtifactId, '10001'); assert.equal(proof.native.nativeFilesSha256, f.policy.native.nativeFilesSha256);
  assert.equal(proof.native.prismaEngineSha256, undefined); assert.equal(proof.native.baseImage, BASE_IMAGE);
});
test('selected evidence/local receipts do not invent upload IDs, archives, image inspection or workload permission', () => {
  const f = fixture(), { jobName, ...input } = f.local();
  const evidence = verifyPreparedProofs(input, f.policy); assert.equal(evidence.eligible, false); assert.equal(evidence.releaseGatePass, false);
  const local = createLocalLaunchReceipts(f.local(), f.policy);
  assert.equal(local.compiled.artifactId, '10001');
  for (const role of ['preparation', 'inputs']) {
    assert.equal(local[role].kind, 'local'); assert.equal(local[role].jobName, jobName);
    assert.equal(local[role].artifactId, undefined); assert.equal(local[role].archiveSha256, undefined);
    assert.equal(local[role].downloadedSha256, undefined);
    const proof = JSON.parse(local[role].proofText);
    assert.equal(proof.filesSha256, hash(JSON.stringify(local[role].files)));
  }
});
test('missing/unknown inputs, guessed artifact IDs, expired/wrong-role/cross-run/cross-head archives fail', () => {
  const changes = [f => { f.input.unknown = true; }, f => { f.input.archives.compiled.artifactId = 'pending'; },
    f => { f.input.archives.compiled.runId = '8888'; }, f => { f.input.archives.preparation.sourceSha = 'a'.repeat(40); },
    f => { f.input.archives.inputs.name = 'stocks-auth-inputs-old'; }, f => { f.input.archives.compiled.expired = true; },
    f => { f.input.archives.compiled.downloadedSha256 = h('tampered zip'); },
    f => { f.input.archives.inputs.artifactId = f.input.archives.compiled.artifactId; },
    f => { f.input.archives.inputs.claimedVerified = true; }, f => { delete f.input.members.insideProof; }];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(f.run); }
});
test('selected member digests/sizes, duplicates, unsafe paths and extra members are checked before JSON use', () => {
  const changes = [f => { f.input.members.stageReport = Buffer.from('{}'); },
    f => { f.input.archives.inputs.selectedMembers[0].bytes = -1; },
    f => { f.input.archives.preparation.selectedMembers.push({ ...f.input.archives.preparation.selectedMembers[0] }); },
    f => { f.input.archives.inputs.selectedMembers[0].path = '../runtime-image.tar'; },
    f => { f.input.archives.inputs.selectedMembers[0].extra = true; },
    f => { f.input.archives.inputs.selectedMembers.push({ path: 'unexpected', bytes: 1, sha256: h('extra') }); },
    f => { f.input.members.compiled[COMPILED_PATHS[0]][0] ^= 1; }];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(f.run); }
});
test('stage/compiler/package/provenance/source drift and softened safety claims are refused', () => {
  const rows = [['stageReport', r => { r.status = 'FAIL'; }], ['stageReport', r => { r.productionAccess = true; }],
    ['stageManifest', r => { r.migration = 'USED'; }], ['stageManifest', r => { r.files.pop(); }],
    ['stageManifest', r => { r.sourceSha = 'a'.repeat(40); }], ['buildProvenance', r => { r.exitCode = 1; }],
    ['buildProvenance', r => { r.sourcesUnchanged = false; }], ['runtimeManifest', r => { r.files[0].sha256 = h('different source'); }],
    ['runtimeManifest', r => { r.unrecognized = true; }], ['preparationReport', r => { r.stage.artifactId = '9999'; }],
    ['preparationReport', r => { r.status = 'INCOMPLETE'; }], ['preparationReport', r => { r.cleanup[0].status = 'FAILED'; }]];
  for (const [key, change] of rows) { const f = fixture(); f.mutate(key, change); assert.throws(f.run); }
});
test('native inventory completeness, new Prisma/native entry, image and dependency pins are enforced', () => {
  const f = fixture(), native = structuredClone(f.inside);
  native.dependencies.nativeFiles.pop(); assert.throws(() => nativeBinding(native, BASE_IMAGE));
  const g = fixture(), other = structuredClone(g.inside);
  const node = { path: '.prisma/client/query_engine.node', bytes: 1, sha256: h('unapproved prisma native') };
  other.dependencies.files.push(node); other.dependencies.nativeFiles = [...other.dependencies.files];
  other.dependencies.inventorySha256 = hash(JSON.stringify(other.dependencies.files));
  assert.throws(() => nativeBinding(other, BASE_IMAGE), /UNREVIEWED_NATIVE_OR_PRISMA/);
  assert.throws(() => nativeBinding(g.inside, 'node:24'), /BASE_IMAGE/);
  for (const key of Object.keys(g.policy.native)) { const x = fixture(); x.policy.native[key] = 'unknown'; assert.throws(x.run); }
});
test('actual npm inventory symlink rows are bound without following filesystem links or allowing escapes', () => {
  const f = fixture(), inside = structuredClone(f.inside);
  inside.dependencies.files = [...inside.dependencies.files, { path: '.bin/test-only', symlink: '../bcrypt/prebuilds/linux-x64/bcrypt.glibc.node' }];
  inside.dependencies.inventorySha256 = hash(JSON.stringify(inside.dependencies.files));
  assert.equal(nativeBinding(inside, BASE_IMAGE).dependencyInventorySha256, inside.dependencies.inventorySha256);
  for (const target of ['../../outside', '/outside', 'C:/outside', '../missing', 'test-only']) {
    const altered = structuredClone(inside); altered.dependencies.files.at(-1).symlink = target;
    altered.dependencies.inventorySha256 = hash(JSON.stringify(altered.dependencies.files));
    assert.throws(() => nativeBinding(altered, BASE_IMAGE));
  }
});
test('seed/image native inputs and derived overlay original-head/context links must match measured digests', () => {
  for (const key of ['image', 'seed']) { const f = fixture(); f.input.archives.inputs.selectedMembers.find(r => r.path === MEMBER_PATHS[key]).sha256 = h('tampered input'); assert.throws(f.run); }
  const changes = [d => { d.sourceSha = 'a'.repeat(40); }, d => { d.contextSha256 = h('different context'); },
    d => { d.baseline = 'a'.repeat(40); }, d => { d.overlays.pop(); }, d => { d.helpers.pop(); },
    d => { d.overlays[0].originalSha256 = h('different original'); }, d => { d.helpers[0].unexpected = true; }];
  for (const change of changes) { const f = fixture(); f.mutate('derivedManifest', change); assert.throws(f.run); }
});
test('local API does not accept fake upload metadata or unsafe job identities', () => {
  const f = fixture(), local = f.local(); local.jobName = '../job';
  assert.throws(() => createLocalLaunchReceipts(local, f.policy));
  const g = fixture(), input = g.local(); input.preparationArtifactId = 'invented';
  assert.throws(() => createLocalLaunchReceipts(input, g.policy));
});
