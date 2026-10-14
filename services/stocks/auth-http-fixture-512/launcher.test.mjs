// Pure admission guards: no Git, Docker, HTTP, SQLite, child process or workload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { SCHEMA, BASELINE_SOURCE_SHA, PR_BASE_REF, PR_BASE_SHA, POLICY_PATH, WORKFLOW_PATH, EXCLUSIONS, parseTree, validatePolicy, validateReviewedTree,
  validateConfig, validateGitHub, validateLauncherNode, canonicalContext, validatePrepared, validateArchiveMembers, classifyLauncherFailure, buildFreeze, main } from './launcher.mjs';

const h = value => createHash('sha256').update(value).digest('hex');
const hash = 'a'.repeat(64), commit = 'b'.repeat(40), other = 'c'.repeat(40);
const base = process.platform === 'win32' ? 'C:/fixture-launch' : '/fixture-launch';
const sort = rows => rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const fixture = 'services/stocks/auth-http-fixture-512/';
const native = { path: 'bcrypt/prebuilds/linux-x64/bcrypt.glibc.node', bytes: 100, sha256: hash };
const compiledOutputs = sort(['api/routes/account', 'api/asyncRoute', 'api/middleware/auth', 'services/AdminPasswordVault', 'services/ContactEmailPolicy', 'services/TwoFactorService']
  .map(name => ({ path: 'dist/' + name + '.js', sha256: hash })));
function policy() {
  const entries = sort(['package.json', 'package-lock.json', 'frontend/package-lock.json', 'tsconfig.json', 'scripts/qa-backend-full-admission.cjs',
    ...['launcher.mjs', 'run.mjs', 'prepare.mjs', 'plan.mjs', 'authority.cjs', 'authority-entry.cjs', 'durability-observer.cjs', 'Dockerfile'].map(p => fixture + p)]
    .map(path => ({ path, mode: '100644', blob: commit })));
  return { schema: SCHEMA, status: 'FROZEN_REVIEWED', planId: 'stocks-auth-http-fixture-512-v2', planSha256: hash, baselineSourceSha: BASELINE_SOURCE_SHA,
    source: { excludedPaths: [...EXCLUSIONS], entries, entriesSha256: h(JSON.stringify(entries)) },
    dependencyBaseline: { baseImage: 'docker.io/library/node@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd',
      node: 'v24.21.0', nodeSha256: hash, compilerNode: 'v22.23.3', inventorySha256: h(JSON.stringify([native])), bcryptSha256: hash,
      nativeFiles: [structuredClone(native)], compiledOutputs: structuredClone(compiledOutputs) },
    closureReview: { complete: true, nativePrismaEngineInvoked: false, unresolvedImports: 0, runtimeClosureSha256: hash, reviewers: ['reviewer-a', 'reviewer-b'] } };
}
function config() {
  const c = { schema: SCHEMA, sourceSha: commit, policySha256: hash,
    stage: { archive: base + '/stage.zip', sha256: hash, sourceSha: commit, runId: '123', artifactId: '1', buildProvenanceSha256: hash },
    prepared: { report: base + '/preparation.json', reportSha256: hash, manifest: base + '/manifest.json', manifestSha256: hash,
      inside: base + '/inside.json', insideSha256: hash, image: base + '/image.tar', seed: base + '/accounts.sqlite',
      publicArchive: base + '/public.zip', inputsArchive: base + '/inputs.zip', runId: '123', publicArtifactId: '2', inputsArtifactId: '3' },
    receipts: {}, python: { executable: '/usr/bin/python3', sha256: hash }, output: base + '/output', disk: base + '/disk', device: '/dev/vdb' };
  ['stage', 'preparation', 'inputs'].forEach((key, i) => { c.receipts[key] = { artifactId: String(i + 1), runId: '123', sourceSha: commit, sha256: hash, bytes: 20,
    name: ['stocks-local-stage-', 'stocks-auth-preparation-', 'stocks-auth-prepared-inputs-'][i] + commit }; }); return c;
}
function github() { const repo = { full_name: 'nazardzuba79-tech/-' }; return {
  env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repo.full_name, GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', AUTH_HTTP_FIXTURE_512_LAUNCH_APPROVED: 'true' },
  event: { number: 512, repository: repo, pull_request: { number: 512,
    head: { sha: commit, ref: 'dot/stocks-owner-usdt-portfolio-20261013', repo }, base: { ref: PR_BASE_REF, sha: PR_BASE_SHA, repo } } } }; }
function prepared() {
  const p = policy(), c = config(), observer = { path: fixture + 'durability-observer.cjs', bytes: 30, sha256: hash, gitBlob: commit };
  const manifest = { schema: 'stocks-auth-http-prepare-512-v1', sourceSha: commit, sourceTree: other, contextSha256: hash, files: [observer] };
  const closure = { fixturePackagingProof: true, npmDependencies: [] }; p.closureReview.runtimeClosureSha256 = h(JSON.stringify(closure));
  const inside = { schema: manifest.schema, status: 'PREPARED_NOT_AUTHORIZED', planId: p.planId, planHash: p.planSha256, contextSha256: hash,
    runtime: { node: 'v24.21.0', nodeSha256: hash, platform: 'linux', arch: 'x64' },
    compiler: { buildNode: 'v22.23.3', proofSha256: hash, compiled: Object.fromEntries(compiledOutputs.map(r => [r.path, r.sha256])) },
    dependencies: { files: [native], inventorySha256: p.dependencyBaseline.inventorySha256, nativeFiles: [native], bcryptSha256: hash }, runtimeClosure: closure,
    seed: { fixedTime: 1791936000000, closed: true, actualWorkerConnectionPragma: 'UNMEASURED', workerSynchronous: 'SOURCE_CONFIGURED_FULL', sha256: hash, bytes: 100 },
    workload: { authHttpInvoked: false, stocksHttpInvoked: false, providerInvoked: false, compiledAuthLoaded: false, tradingCommands: 0 } };
  const report = { schema: manifest.schema, status: 'PREPARED_NOT_AUTHORIZED', sourceSha: commit, inside, contextSha256: hash,
    stage: { ...c.stage, reportSha256: hash }, image: { id: 'sha256:' + hash, baseImage: p.dependencyBaseline.baseImage, freezeBaseImageAlias: p.dependencyBaseline.baseImage.replace('docker.io/library/', '') },
    imageArchive: { bytes: 1000, sha256: hash }, durabilityObserver: { source: observer, includedInCanonicalContext: true, executedDuringPreparation: false },
    cleanup: ['service', 'authority', 'driver', 'prepare'].map(role => ({ kind: 'container', role, status: 'REMOVED', terminal: { running: role !== 'prepare', exitCode: 0, oomKilled: false },
      stop: role === 'prepare' ? 'natural preparation/idle exit' : 'planned preparation cleanup; no workload ran' })) };
  report.cleanup.push({ kind: 'image', id: report.image.id, status: 'REMOVED' }); return { c, p, manifest, report, inside };
}

test('review policy rejects placeholders, extra exclusions, missing closure and self-referential HEAD', () => {
  validatePolicy(policy());
  for (const change of [p => { p.status = 'DRAFT'; }, p => { p.sourceSha = commit; }, p => { p.source.excludedPaths.push('src/api/routes/account.ts'); },
    p => { p.dependencyBaseline.bcryptSha256 = ''; }, p => { p.closureReview.reviewers = ['same', 'same']; }, p => { p.closureReview.nativePrismaEngineInvoked = true; },
    p => { p.closureReview.complete = false; }, p => { p.dependencyBaseline.compiledOutputs.pop(); }, p => { p.dependencyBaseline.node = 'v22.23.3'; },
    p => { p.source.entries.pop(); }]) { const p = policy(); change(p); assert.throws(() => validatePolicy(p)); }
});

test('exact canonical whole-tree closure rejects added executable, changed mode/blob and missing trust root', () => {
  const p = policy(), rows = sort([...p.source.entries, ...EXCLUSIONS.map(path => ({ path, mode: '100644', blob: other }))]);
  validateReviewedTree(rows, p);
  for (const change of [r => { r.push({ path: 'scripts/unreviewed.cjs', mode: '100644', blob: commit }); },
    r => { r.find(x => x.path === 'package.json').blob = other; }, r => { r.find(x => x.path === 'package.json').mode = '100755'; },
    r => { r.splice(r.findIndex(x => x.path === WORKFLOW_PATH), 1); }]) { const r = structuredClone(rows); change(r); assert.throws(() => validateReviewedTree(sort(r), p)); }
  // The three explicit review/control files avoid the hash cycle; no executable helper is excluded.
  const changedTrustRoot = structuredClone(rows); changedTrustRoot.find(r => r.path === POLICY_PATH).blob = 'd'.repeat(40); validateReviewedTree(changedTrustRoot, p);
});

test('Git tree parser preserves canonical paths and rejects symlinks, duplicate or truncated entries', () => {
  assert.deepEqual(parseTree(Buffer.from(`100644 blob ${commit}\ta b.ts\0`)), [{ path: 'a b.ts', mode: '100644', blob: commit }]);
  for (const value of [`120000 blob ${commit}\ta\0`, `100644 blob ${commit}\t../a\0`, `100644 blob ${commit}\ta`,
    `100644 blob ${commit}\ta\0`.repeat(2)]) assert.throws(() => parseTree(Buffer.from(value)));
});

test('strict launch config and receipts require three exact same-run same-head artifacts', () => {
  validateConfig(config());
  for (const change of [c => { c.retry = true; }, c => { c.stage.sourceSha = other; }, c => { c.prepared.runId = '124'; },
    c => { c.receipts.inputs.name = 'another-input'; }, c => { c.receipts.preparation.sourceSha = other; }, c => { c.receipts.inputs.bytes = 4 * 1024 ** 3; },
    c => { c.receipts.stage.artifactId = '9'; }, c => { c.prepared.publicArtifactId = '1'; }, c => { c.python.executable = '/tmp/python'; },
    c => { c.output = 'relative'; }, c => { c.device = '/dev/../production'; }]) { const c = config(); change(c); assert.throws(() => validateConfig(c)); }
});

test('GitHub event is PR512 same repository/head/branch/run, never a main or fork fallback', () => {
  const g = github(); assert.equal(validateGitHub(config(), g.env, g.event).sourceSha, commit);
  for (const change of [g => { g.env.GITHUB_RUN_ID = '124'; }, g => { g.env.GITHUB_EVENT_NAME = 'push'; }, g => { g.env.AUTH_HTTP_FIXTURE_512_LAUNCH_APPROVED = ''; },
    g => { g.event.pull_request.head.sha = other; }, g => { g.event.pull_request.head.ref = 'main'; }, g => { g.event.number = 497; },
    g => { g.event.pull_request.head.repo = { full_name: 'fork/-' }; }]) { const g = github(); change(g); assert.throws(() => validateGitHub(config(), g.env, g.event)); }
});

test('actual stacked PR512 base is pinned independently from integrated-main ancestry', () => {
  const g = github();
  assert.equal(g.event.pull_request.base.ref, 'codex/stocks-integration-20261010');
  assert.equal(g.event.pull_request.base.sha, '2f6fa3f7ec152a1849fb12c3694854963694af14');
  validateGitHub(config(), g.env, g.event);
  const retargeted = github(); retargeted.event.pull_request.base.ref = 'main'; assert.throws(() => validateGitHub(config(), retargeted.env, retargeted.event));
  const advanced = github(); advanced.event.pull_request.base.sha = other; assert.throws(() => validateGitHub(config(), advanced.env, advanced.event));
});

test('Node24 launch orchestration stays distinct from the Node22 compiled-stage proof', () => {
  const p = policy(); validateLauncherNode('v24.21.0', p);
  assert.throws(() => validateLauncherNode('v22.23.3', p)); assert.throws(() => validateLauncherNode('v24.20.0', p));
  assert.equal(p.dependencyBaseline.compilerNode, 'v22.23.3');
});

test('prepared evidence must match real dependency/native/compiler closure and has no workload', () => {
  const a = prepared(); validatePrepared(a.c, a.p, a.report, a.manifest, a.inside);
  for (const change of [a => { a.report.sourceSha = other; }, a => { a.report.stage.runId = '999'; }, a => { a.inside.dependencies.files.push({ path: 'extra', bytes: 1, sha256: hash }); },
    a => { a.inside.dependencies.nativeFiles[0] = { ...native, sha256: 'd'.repeat(64) }; }, a => { a.inside.compiler.compiled[compiledOutputs[0].path] = 'd'.repeat(64); },
    a => { a.inside.workload.authHttpInvoked = true; }, a => { a.inside.seed.actualWorkerConnectionPragma = 'OBSERVED'; },
    a => { a.report.durabilityObserver.executedDuringPreparation = true; }, a => { a.report.imageArchive.bytes = 4 * 1024 ** 3; }]) {
    const a = structuredClone(prepared()); change(a); assert.throws(() => validatePrepared(a.c, a.p, a.report, a.manifest, a.inside));
  }
});

test('preparation cleanup permits only recorded planned idle removal; failure/OOM/missing cleanup blocks', () => {
  for (const change of [a => { a.report.cleanup[0].terminal.oomKilled = true; }, a => { a.report.cleanup[0].terminal.exitCode = 137; },
    a => { a.report.cleanup[0].stop = 'force timeout'; }, a => { a.report.cleanup[3].terminal.running = true; },
    a => { a.report.cleanup.pop(); }, a => { a.report.cleanup[4].id = 'sha256:' + 'd'.repeat(64); }]) {
    const a = prepared(); change(a); assert.throws(() => validatePrepared(a.c, a.p, a.report, a.manifest, a.inside));
  }
});

test('extracted metadata/image/seed bind exact streamed artifact members, not adjacent receipt files alone', () => {
  const a = prepared(), sizes = { report: 100, manifest: 200, inside: 300 };
  const publicProof = Object.fromEntries(Object.entries(sizes).map(([key, bytes]) => [key, { bytes, sha256: hash }]));
  const inputProof = { image: { bytes: a.report.imageArchive.bytes, sha256: hash }, seed: { bytes: a.inside.seed.bytes, sha256: hash } };
  validateArchiveMembers(publicProof, inputProof, a.c, a.report, sizes);
  for (const change of [p => { p.inside.sha256 = 'd'.repeat(64); }, p => { p.report.bytes++; }, p => { p.extra = { bytes: 1, sha256: hash }; }]) {
    const p = structuredClone(publicProof); change(p); assert.throws(() => validateArchiveMembers(p, inputProof, a.c, a.report, sizes));
  }
  for (const key of ['image', 'seed']) { const p = structuredClone(inputProof); p[key].sha256 = 'd'.repeat(64); assert.throws(() => validateArchiveMembers(publicProof, p, a.c, a.report, sizes)); }
});

test('source context is reconstructed from actual canonical blobs and compiled bytes, never manifest alone', () => {
  const originalPlan = fs.readFileSync(new URL('../targeted-http-512/plan.mjs', import.meta.url));
  const rows = ['package-lock.json', 'tsconfig.json', fixture + 'Dockerfile', 'services/stocks/targeted-http-512/plan.mjs'].map(path => ({ path, mode: '100644', blob: commit }));
  const blobs = [Buffer.from('{}'), Buffer.from('{}'), Buffer.from('dockerfile'), originalPlan], compiled = new Map([['dist/a.js', Buffer.from('actual compiled')]]);
  const proof = Buffer.from(JSON.stringify({ sourcesBefore: [], tsconfig: { sha256: h(blobs[1]) }, packageLockSha256: h(blobs[0]) })), log = Buffer.from('build ok');
  const files = rows.map((row, i) => ({ path: row.path, bytes: blobs[i].length, sha256: h(blobs[i]), gitBlob: row.blob }));
  for (const [path, bytes] of [...compiled, ['compiled-proof.json', proof], ['build.log', log]]) files.push({ path, bytes: bytes.length, sha256: h(bytes) });
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = { schema: 'stocks-auth-http-prepare-512-v1', sourceSha: commit, sourceTree: other, files, contextSha256: h(JSON.stringify(files)) };
  const helpers = { sourceAllowed: () => true, safeRelative: x => x, validateLock: () => {}, validateDockerfile: () => {} };
  const result = canonicalContext(rows, blobs, compiled, proof, log, commit, other, manifest, helpers); assert.equal(result.bytesByPath.get('dist/a.js').toString(), 'actual compiled');
  const tampered = [...blobs]; tampered[0] = Buffer.from('unreviewed'); assert.throws(() => canonicalContext(rows, tampered, compiled, proof, log, commit, other, manifest, helpers));
  assert.throws(() => canonicalContext(rows, blobs, new Map(), proof, log, commit, other, manifest, helpers));
  assert.throws(() => canonicalContext(rows, blobs, compiled, proof, log, other, other, manifest, helpers));
});

test('final freeze binds runtime verified source/image and delegates original plan validation', () => {
  const a = prepared(); let checked = 0;
  const fakePlan = { planHash: () => hash, COUNTS: { original: 1350 }, validateFreeze: value => { checked++; assert.equal(value.sourceSha, a.c.sourceSha); } };
  const freeze = buildFreeze(a.c, a.p, a.report, a.manifest, fakePlan);
  assert.equal(checked, 1); assert.equal(freeze.sourceTree, a.manifest.sourceTree); assert.equal(freeze.runtimeImageId, a.report.image.id);
  assert.deepEqual(freeze.expectedCounts, fakePlan.COUNTS); assert.equal(freeze.closureReview.nativePrismaEngine, false);
  assert.throws(() => buildFreeze(a.c, a.p, a.report, a.manifest, { ...fakePlan, planHash: () => 'changed' }));
});

test('launcher cleanup/report failure never erases an exact-bound workload safety FAIL or invents PASS', () => {
  const binding = { sourceSha: commit, freezeSha256: hash, imageId: 'sha256:' + hash, contextSha256: hash };
  const saved = { schema: 1, planId: 'stocks-auth-http-fixture-512-v2', sourceSha: commit, freezeSha256: hash,
    image: { id: binding.imageId, contextSha256: hash }, status: 'INCOMPLETE', safetyStatus: 'FAIL' };
  assert.equal(classifyLauncherFailure(Error('cleanup'), saved, binding).status, 'FAIL');
  assert.equal(classifyLauncherFailure(Error('SAFETY_LEDGER_CHANGED'), undefined, undefined).safetyStatus, 'FAIL');
  let actualAssertion;
  try { assert.equal(401, 200, 'SAFETY_CONTRACT_MISMATCH'); } catch (error) { actualAssertion = error; }
  assert.equal(actualAssertion.code, 'ERR_ASSERTION'); assert.equal(classifyLauncherFailure(actualAssertion).status, 'FAIL');
  let ordinaryAssertion;
  try { assert.equal(1, 2, 'missing evidence'); } catch (error) { ordinaryAssertion = error; }
  assert.equal(classifyLauncherFailure(ordinaryAssertion).status, 'INCOMPLETE');
  for (const change of [s => { s.sourceSha = other; }, s => { s.freezeSha256 = 'd'.repeat(64); }, s => { s.image.id = 'changed'; },
    s => { s.status = 'PASS'; }, s => { s.safetyStatus = 'PASS'; }, s => { s.schema = 2; }]) {
    const s = structuredClone(saved); change(s); assert.equal(classifyLauncherFailure(Error('cleanup'), s, binding).status, 'INCOMPLETE');
  }
  assert.equal(classifyLauncherFailure(Error('SAFETY_UNREVIEWED_CODE'), undefined, binding).status, 'INCOMPLETE');
  assert.equal(classifyLauncherFailure(Error('transport'), undefined, binding).status, 'INCOMPLETE');
});

test('no default executable launch, artifact fallback or retry', async () => {
  for (const args of [[], ['--prepare', base + '/config.json'], ['--launch'], ['--launch', 'relative']]) await assert.rejects(() => main(args));
});
