// Finite CI-only launcher. Importing this module performs no I/O or workload.
// The reviewed workflow pins policy bytes; neither a policy nor a report signs itself.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'stocks-auth-http-launch-512-v1';
export const BASELINE_SOURCE_SHA = 'a9d5b9bd85fe96e8dcb31ec7a6b315f9730d2900';
// PR512 is intentionally stacked. Main ancestry does not retarget its GitHub base.
export const PR_BASE_REF = 'codex/stocks-integration-20261010';
export const PR_BASE_SHA = '2f6fa3f7ec152a1849fb12c3694854963694af14';
export const POLICY_PATH = 'services/stocks/auth-http-fixture-512/launch-policy.json';
export const WORKFLOW_PATH = '.github/workflows/stocks-review.yml';
export const ADMISSION_PATH = 'docs/evidence/stocks-contract-proofs-20261014/backend-full/admission-review.json';
// These three exact review/control files mutually reference hashes. Their final
// bytes are independently reviewed; the executable admission controller is pinned.
export const EXCLUSIONS = Object.freeze([WORKFLOW_PATH, POLICY_PATH, ADMISSION_PATH]);
export const ORIGINAL_PLAN = '258cc65cbee2638265d61bfa7b8f6079fc385520f66af710e324fe4a2a37a1cc';
export const PUBLIC_MEMBERS = Object.freeze({ report: 'stocks-auth-preparation-output/preparation.json',
  manifest: 'stocks-auth-preparation-output/public-context/runtime-source-manifest.json',
  inside: 'stocks-auth-preparation-output/private/runtime-output/inside-proof.json' });
export const INPUT_MEMBERS = Object.freeze({ image: 'runtime-image.tar', seed: 'runtime-output/private/seed/accounts.sqlite' });
// Fixed standard-library verifier only: stream selected members, never extract or execute.
export const ARCHIVE_MEMBER_PROOF = String.raw`import hashlib,json,stat,sys,zipfile
archive,kind=sys.argv[1:]
assert kind in ('public','inputs')
selected={'report':'stocks-auth-preparation-output/preparation.json','manifest':'stocks-auth-preparation-output/public-context/runtime-source-manifest.json','inside':'stocks-auth-preparation-output/private/runtime-output/inside-proof.json'} if kind=='public' else {'image':'runtime-image.tar','seed':'runtime-output/private/seed/accounts.sqlite'}
result={}; seen=set(); total=0
with zipfile.ZipFile(archive) as z:
    entries=z.infolist(); assert 0<len(entries)<=10000
    for info in entries:
        name=info.filename; assert name and not name.startswith('/') and '\\' not in name and not any(ord(c)<32 for c in name)
        assert all(p not in ('','.','..') for p in name.rstrip('/').split('/')) and name not in seen
        seen.add(name); mode=(info.external_attr>>16)&0o170000
        assert not info.flag_bits&1 and mode in (0,stat.S_IFREG,stat.S_IFDIR)
        assert not info.is_dir() or info.file_size==0
        limit=3*1024**3 if kind=='inputs' and name==selected['image'] else 16*1024**2
        assert 0<=info.file_size<=limit and (info.file_size==0 or info.compress_size>0 and info.file_size/info.compress_size<=500)
        total+=info.file_size; assert total <= (3*1024**3+16*1024**2 if kind=='inputs' else 512*1024**2)
    if kind=='inputs': assert {i.filename for i in entries if not i.is_dir()}==set(selected.values())
    for key,name in selected.items():
        assert name in seen; digest=hashlib.sha256(); count=0
        with z.open(name) as f:
            while True:
                chunk=f.read(1024**2)
                if not chunk: break
                count+=len(chunk); assert count<=z.getinfo(name).file_size; digest.update(chunk)
        assert count==z.getinfo(name).file_size
        result[key]={'sha256':digest.hexdigest(),'bytes':count}
print(json.dumps(result,sort_keys=True))
`;
const FIXTURE = 'services/stocks/auth-http-fixture-512/';
const SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]{0,19}$/;
const PREPARE_SCHEMA = 'stocks-auth-http-prepare-512-v1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MAX_FILE = 16 * 1024 ** 2;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(bytes.toString('utf8'));
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'LAUNCH_UNKNOWN_FIELD');
const comparePath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
function absolute(value) { assert.ok(typeof value === 'string' && path.isAbsolute(value) && !/[\r\n,\x00]/.test(value), 'LAUNCH_ABSOLUTE_PATH'); }
function gitPath(value) {
  assert.ok(typeof value === 'string' && value.length > 0 && value.length < 4096 && !/[\x00-\x1f\\]/.test(value)
    && !value.startsWith('/') && !value.split('/').some(p => !p || p === '.' || p === '..'), 'LAUNCH_GIT_PATH');
  return value;
}
export function parseTree(bytes) {
  const text = bytes.toString('utf8'); assert.ok(text.endsWith('\0'), 'LAUNCH_TREE_TRUNCATED');
  const rows = text.slice(0, -1).split('\0').map(line => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(line);
    assert.ok(match, 'LAUNCH_SPECIAL_GIT_ENTRY'); return { path: gitPath(match[3]), mode: match[1], blob: match[2] };
  }).sort(comparePath);
  assert.ok(rows.length > 0 && rows.length <= 100000); assert.equal(new Set(rows.map(r => r.path)).size, rows.length);
  return rows;
}
export function validatePolicy(policy) {
  keys(policy, ['schema', 'status', 'planId', 'planSha256', 'baselineSourceSha', 'source', 'dependencyBaseline', 'closureReview']);
  assert.equal(policy.schema, SCHEMA); assert.equal(policy.status, 'FROZEN_REVIEWED', 'LAUNCH_REVIEW_REQUIRED');
  assert.equal(policy.planId, 'stocks-auth-http-fixture-512-v2'); assert.match(policy.planSha256, SHA); assert.equal(policy.baselineSourceSha, BASELINE_SOURCE_SHA);
  keys(policy.source, ['excludedPaths', 'entries', 'entriesSha256']);
  assert.deepEqual(policy.source.excludedPaths, EXCLUSIONS, 'LAUNCH_EXCLUSIONS_FIXED');
  assert.ok(Array.isArray(policy.source.entries) && policy.source.entries.length > 0 && policy.source.entries.length <= 100000);
  for (const row of policy.source.entries) {
    keys(row, ['path', 'mode', 'blob']); gitPath(row.path); assert.ok(['100644', '100755'].includes(row.mode)); assert.match(row.blob, COMMIT);
    assert.ok(!EXCLUSIONS.includes(row.path), 'LAUNCH_REVIEW_CIRCULAR_ENTRY');
  }
  assert.equal(new Set(policy.source.entries.map(r => r.path)).size, policy.source.entries.length);
  assert.deepEqual(policy.source.entries, [...policy.source.entries].sort(comparePath), 'LAUNCH_TREE_ORDER');
  assert.equal(hash(JSON.stringify(policy.source.entries)), policy.source.entriesSha256);
  const required = ['package.json', 'package-lock.json', 'frontend/package-lock.json', 'tsconfig.json', 'scripts/qa-backend-full-admission.cjs',
    ...['launcher.mjs', 'run.mjs', 'prepare.mjs', 'plan.mjs', 'authority.cjs', 'authority-entry.cjs', 'durability-observer.cjs', 'Dockerfile'].map(p => FIXTURE + p)];
  for (const p of required) assert.ok(policy.source.entries.some(r => r.path === p), 'LAUNCH_REVIEW_SOURCE_MISSING');
  const dependency = policy.dependencyBaseline;
  keys(dependency, ['baseImage', 'node', 'nodeSha256', 'compilerNode', 'inventorySha256', 'bcryptSha256', 'nativeFiles', 'compiledOutputs']);
  assert.equal(dependency.baseImage, 'docker.io/library/node@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd');
  assert.equal(dependency.node, 'v24.21.0'); assert.match(dependency.compilerNode, /^v22\.\d+\.\d+$/);
  for (const key of ['nodeSha256', 'inventorySha256', 'bcryptSha256']) assert.match(dependency[key], SHA);
  assert.ok(Array.isArray(dependency.nativeFiles) && dependency.nativeFiles.length > 0 && dependency.nativeFiles.length <= 1000);
  for (const row of dependency.nativeFiles) { keys(row, ['path', 'bytes', 'sha256']); gitPath(row.path); assert.ok(row.path.endsWith('.node'));
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 256 * 1024 ** 2); assert.match(row.sha256, SHA); }
  assert.equal(new Set(dependency.nativeFiles.map(r => r.path)).size, dependency.nativeFiles.length);
  assert.equal(dependency.compiledOutputs?.length, 6);
  for (const row of dependency.compiledOutputs) { keys(row, ['path', 'sha256']); assert.match(row.path, /^dist\/[A-Za-z0-9_/-]+\.js$/); assert.match(row.sha256, SHA); }
  assert.equal(new Set(dependency.compiledOutputs.map(r => r.path)).size, 6);
  assert.deepEqual(dependency.compiledOutputs, [...dependency.compiledOutputs].sort(comparePath));
  const review = policy.closureReview;
  keys(review, ['complete', 'nativePrismaEngineInvoked', 'unresolvedImports', 'runtimeClosureSha256', 'reviewers']);
  assert.equal(review.complete, true); assert.equal(review.nativePrismaEngineInvoked, false); assert.equal(review.unresolvedImports, 0);
  assert.match(review.runtimeClosureSha256, SHA);
  assert.ok(Array.isArray(review.reviewers) && review.reviewers.length >= 2 && review.reviewers.every(r => /^[A-Za-z0-9_.@/-]{1,100}$/.test(r)));
  assert.equal(new Set(review.reviewers).size, review.reviewers.length);
  return policy;
}
export function validateLauncherNode(version, policy) {
  assert.equal(version, policy.dependencyBaseline.node, 'LAUNCH_RUNNER_NODE_DRIFT');
}
export function validateReviewedTree(rows, policy) {
  validatePolicy(policy);
  for (const excluded of EXCLUSIONS) assert.equal(rows.filter(r => r.path === excluded).length, 1, 'LAUNCH_TRUST_ROOT_MISSING');
  assert.deepEqual(rows.filter(r => !EXCLUSIONS.includes(r.path)), policy.source.entries, 'LAUNCH_UNREVIEWED_TREE');
}
export function validateConfig(c) {
  keys(c, ['schema', 'sourceSha', 'policySha256', 'stage', 'prepared', 'receipts', 'python', 'output', 'disk', 'device']);
  assert.equal(c.schema, SCHEMA); assert.match(c.sourceSha, COMMIT); assert.match(c.policySha256, SHA);
  keys(c.stage, ['archive', 'sha256', 'sourceSha', 'runId', 'artifactId', 'buildProvenanceSha256']);
  absolute(c.stage.archive); assert.match(c.stage.sha256, SHA); assert.equal(c.stage.sourceSha, c.sourceSha);
  assert.match(c.stage.runId, ID); assert.match(c.stage.artifactId, ID); assert.match(c.stage.buildProvenanceSha256, SHA);
  keys(c.prepared, ['report', 'reportSha256', 'manifest', 'manifestSha256', 'inside', 'insideSha256', 'image', 'seed', 'publicArchive', 'inputsArchive', 'runId', 'publicArtifactId', 'inputsArtifactId']);
  for (const key of ['report', 'manifest', 'inside', 'image', 'seed', 'publicArchive', 'inputsArchive']) absolute(c.prepared[key]);
  for (const key of ['reportSha256', 'manifestSha256', 'insideSha256']) assert.match(c.prepared[key], SHA);
  for (const key of ['runId', 'publicArtifactId', 'inputsArtifactId']) assert.match(c.prepared[key], ID);
  assert.equal(c.prepared.runId, c.stage.runId, 'LAUNCH_SAME_RUN_ARTIFACTS');
  assert.equal(new Set([c.stage.artifactId, c.prepared.publicArtifactId, c.prepared.inputsArtifactId]).size, 3);
  keys(c.receipts, ['stage', 'preparation', 'inputs']);
  for (const key of ['stage', 'preparation', 'inputs']) {
    const row = c.receipts[key]; keys(row, ['artifactId', 'runId', 'sourceSha', 'sha256', 'bytes', 'name']);
    assert.match(row.artifactId, ID); assert.equal(row.runId, c.stage.runId); assert.equal(row.sourceSha, c.sourceSha); assert.match(row.sha256, SHA);
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= (key === 'inputs' ? 3 * 1024 ** 3 : 256 * 1024 ** 2));
    assert.equal(row.name, ({ stage: 'stocks-local-stage-', preparation: 'stocks-auth-preparation-', inputs: 'stocks-auth-prepared-inputs-' })[key] + c.sourceSha);
  }
  assert.equal(c.receipts.stage.artifactId, c.stage.artifactId); assert.equal(c.receipts.stage.sha256, c.stage.sha256);
  assert.equal(c.receipts.preparation.artifactId, c.prepared.publicArtifactId); assert.equal(c.receipts.inputs.artifactId, c.prepared.inputsArtifactId);
  keys(c.python, ['executable', 'sha256']); assert.equal(c.python.executable, '/usr/bin/python3'); assert.match(c.python.sha256, SHA);
  absolute(c.output); absolute(c.disk); assert.match(c.device, /^\/dev\/[A-Za-z0-9_-]+$/);
  return c;
}
export function validateGitHub(c, env, event) {
  assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.GITHUB_REPOSITORY, 'nazardzuba79-tech/-');
  assert.equal(env.GITHUB_EVENT_NAME, 'pull_request'); assert.equal(env.GITHUB_RUN_ID, c.stage.runId);
  assert.match(env.GITHUB_RUN_ATTEMPT || '', ID); assert.equal(env.AUTH_HTTP_FIXTURE_512_LAUNCH_APPROVED, 'true');
  assert.equal(event.number, 512); assert.equal(event.pull_request?.number, 512);
  assert.equal(event.pull_request?.head?.sha, c.sourceSha); assert.equal(event.pull_request?.head?.ref, 'dot/stocks-owner-usdt-portfolio-20261013');
  assert.equal(event.pull_request?.head?.repo?.full_name, env.GITHUB_REPOSITORY); assert.equal(event.repository?.full_name, env.GITHUB_REPOSITORY);
  assert.equal(event.pull_request?.base?.ref, PR_BASE_REF); assert.equal(event.pull_request?.base?.sha, PR_BASE_SHA);
  assert.equal(event.pull_request?.base?.repo?.full_name, env.GITHUB_REPOSITORY);
  return { repository: env.GITHUB_REPOSITORY, pullRequest: 512, sourceSha: c.sourceSha, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT };
}
export function canonicalContext(rows, blobs, compiled, proofBytes, buildLog, sourceSha, sourceTree, prepared, helpers) {
  const selected = rows.filter(r => helpers.sourceAllowed(r.path)), files = [], bytesByPath = new Map();
  assert.equal(blobs.length, selected.length);
  const add = (p, bytes, gitBlob) => {
    helpers.safeRelative(p); assert.ok(Buffer.isBuffer(bytes) && bytes.length <= MAX_FILE); assert.ok(!bytesByPath.has(p), 'LAUNCH_DUPLICATE_CONTEXT');
    bytesByPath.set(p, bytes); files.push({ path: p, bytes: bytes.length, sha256: hash(bytes), ...(gitBlob ? { gitBlob } : {}) });
  };
  selected.forEach((row, i) => add(row.path, blobs[i], row.blob));
  for (const [p, bytes] of compiled) add(p, bytes);
  add('compiled-proof.json', proofBytes); add('build.log', buildLog); files.sort((a, b) => a.path.localeCompare(b.path));
  const result = { schema: PREPARE_SCHEMA, sourceSha, sourceTree, files, contextSha256: hash(JSON.stringify(files)) };
  assert.deepEqual(result, prepared, 'LAUNCH_CONTEXT_RECONSTRUCTION_MISMATCH');
  const proof = parse(proofBytes);
  for (const row of proof.sourcesBefore) assert.equal(hash(bytesByPath.get(row.path)), row.sha256, 'LAUNCH_COMPILED_SOURCE_DRIFT');
  assert.equal(hash(bytesByPath.get('tsconfig.json')), proof.tsconfig.sha256);
  assert.equal(hash(bytesByPath.get('package-lock.json')), proof.packageLockSha256);
  helpers.validateLock(parse(bytesByPath.get('package-lock.json'))); helpers.validateDockerfile(bytesByPath.get(FIXTURE + 'Dockerfile'));
  assert.equal(hash(bytesByPath.get('services/stocks/targeted-http-512/plan.mjs')), ORIGINAL_PLAN);
  return { manifest: result, bytesByPath };
}
export function validatePrepared(c, policy, report, manifest, inside) {
  assert.equal(report.schema, PREPARE_SCHEMA); assert.equal(report.status, 'PREPARED_NOT_AUTHORIZED');
  assert.equal(report.sourceSha, c.sourceSha, 'LAUNCH_PREPARATION_SAME_HEAD'); assert.deepEqual(report.inside, inside);
  assert.equal(manifest.schema, PREPARE_SCHEMA); assert.equal(manifest.sourceSha, c.sourceSha);
  assert.equal(report.contextSha256, manifest.contextSha256); assert.equal(inside.contextSha256, manifest.contextSha256);
  assert.equal(inside.schema, PREPARE_SCHEMA); assert.equal(inside.status, 'PREPARED_NOT_AUTHORIZED');
  assert.equal(inside.planId, policy.planId); assert.equal(inside.planHash, policy.planSha256);
  for (const key of ['sha256', 'sourceSha', 'runId', 'artifactId', 'buildProvenanceSha256']) assert.equal(report.stage[key], c.stage[key], 'LAUNCH_STAGE_RECEIPT_MISMATCH');
  assert.match(report.stage.reportSha256, SHA);
  const baseline = policy.dependencyBaseline;
  assert.equal(report.image.baseImage, baseline.baseImage); assert.equal(report.image.freezeBaseImageAlias, baseline.baseImage.replace('docker.io/library/', ''));
  assert.match(report.image.id, /^sha256:[a-f0-9]{64}$/); assert.match(report.imageArchive.sha256, SHA);
  assert.ok(Number.isSafeInteger(report.imageArchive.bytes) && report.imageArchive.bytes > 0 && report.imageArchive.bytes <= 3 * 1024 ** 3);
  assert.equal(inside.runtime.node, baseline.node); assert.equal(inside.runtime.nodeSha256, baseline.nodeSha256);
  assert.equal(inside.runtime.platform, 'linux'); assert.equal(inside.runtime.arch, 'x64'); assert.equal(inside.compiler.buildNode, baseline.compilerNode);
  assert.equal(inside.compiler.proofSha256, c.stage.buildProvenanceSha256, 'LAUNCH_COMPILER_PROOF_DRIFT');
  assert.equal(inside.dependencies.inventorySha256, baseline.inventorySha256);
  assert.equal(hash(JSON.stringify(inside.dependencies.files)), baseline.inventorySha256, 'LAUNCH_INVENTORY_CONTENT_MISMATCH');
  assert.deepEqual(inside.dependencies.nativeFiles, inside.dependencies.files.filter(r => /\.node$/.test(r.path)));
  assert.deepEqual(inside.dependencies.nativeFiles, baseline.nativeFiles); assert.equal(inside.dependencies.bcryptSha256, baseline.bcryptSha256);
  assert.equal(hash(JSON.stringify(inside.runtimeClosure)), policy.closureReview.runtimeClosureSha256);
  assert.deepEqual(Object.entries(inside.compiler.compiled).map(([path, sha256]) => ({ path, sha256 })).sort(comparePath), baseline.compiledOutputs, 'LAUNCH_COMPILED_BASELINE_DRIFT');
  assert.equal(inside.runtimeClosure.fixturePackagingProof, true); assert.deepEqual(inside.runtimeClosure.npmDependencies, []);
  assert.deepEqual(inside.workload, { authHttpInvoked: false, stocksHttpInvoked: false, providerInvoked: false, compiledAuthLoaded: false, tradingCommands: 0 });
  assert.equal(inside.seed.fixedTime, 1791936000000); assert.equal(inside.seed.closed, true);
  assert.equal(inside.seed.actualWorkerConnectionPragma, 'UNMEASURED'); assert.equal(inside.seed.workerSynchronous, 'SOURCE_CONFIGURED_FULL');
  assert.match(inside.seed.sha256, SHA); assert.ok(Number.isSafeInteger(inside.seed.bytes) && inside.seed.bytes > 0 && inside.seed.bytes <= MAX_FILE);
  assert.equal(report.durabilityObserver?.includedInCanonicalContext, true); assert.equal(report.durabilityObserver.executedDuringPreparation, false);
  const observer = manifest.files.find(r => r.path === FIXTURE + 'durability-observer.cjs'); assert.ok(observer); assert.deepEqual(report.durabilityObserver.source, observer);
  assert.ok(Array.isArray(report.cleanup) && report.cleanup.length === 5);
  assert.deepEqual(report.cleanup.filter(row => row.kind === 'container').map(row => row.role).sort(), ['authority', 'driver', 'prepare', 'service']);
  assert.equal(report.cleanup.filter(row => row.kind === 'image').length, 1);
  for (const row of report.cleanup) {
    assert.equal(row.status, 'REMOVED', 'LAUNCH_PREPARATION_CLEANUP_INCOMPLETE'); assert.ok(!row.error);
    if (row.kind === 'image') { assert.equal(row.id, report.image.id); continue; }
    assert.equal(row.kind, 'container'); assert.equal(row.terminal.oomKilled, false); assert.equal(row.terminal.exitCode, 0);
    if (row.terminal.running) { assert.notEqual(row.role, 'prepare'); assert.equal(row.stop, 'planned preparation cleanup; no workload ran'); }
    else assert.equal(row.stop, 'natural preparation/idle exit');
  }
  return true;
}
export function buildFreeze(c, policy, report, manifest, plan) {
  assert.equal(policy.planSha256, plan.planHash());
  const freeze = { schema: 1, planId: policy.planId, planSha256: policy.planSha256, status: 'FROZEN_REVIEWED', launchAuthorized: true,
    sourceSha: c.sourceSha, sourceTree: manifest.sourceTree, node: policy.dependencyBaseline.node, platform: 'linux', arch: 'x64',
    baseImage: report.image.freezeBaseImageAlias, runtimeImageId: report.image.id, contextSha256: manifest.contextSha256,
    compiledProofSha256: c.stage.buildProvenanceSha256, bcryptSha256: policy.dependencyBaseline.bcryptSha256,
    files: manifest.files, closureReview: { complete: true, nativePrismaEngine: false, unresolvedImports: 0, reviewers: policy.closureReview.reviewers },
    seed: report.inside.seed, expectedCounts: plan.COUNTS, originalTargetedPlanSha256: ORIGINAL_PLAN };
  // Legacy field name means no Prisma engine invocation in the reviewed authority;
  // root locked dependencies can still contain engine binaries.
  plan.validateFreeze(freeze); return freeze;
}
export function validateArchiveMembers(publicProof, inputProof, c, report, sizes) {
  keys(publicProof, Object.keys(PUBLIC_MEMBERS)); keys(inputProof, Object.keys(INPUT_MEMBERS));
  for (const key of ['report', 'manifest', 'inside']) {
    keys(publicProof[key], ['sha256', 'bytes']);
    assert.deepEqual(publicProof[key], { sha256: c.prepared[key + 'Sha256'], bytes: sizes[key] }, 'LAUNCH_EXTRACTED_METADATA_MISMATCH');
  }
  assert.deepEqual(inputProof.image, { sha256: report.imageArchive.sha256, bytes: report.imageArchive.bytes }, 'LAUNCH_IMAGE_MEMBER_MISMATCH');
  assert.deepEqual(inputProof.seed, { sha256: report.inside.seed.sha256, bytes: report.inside.seed.bytes }, 'LAUNCH_SEED_MEMBER_MISMATCH');
}
export function classifyLauncherFailure(error, saved, binding) {
  const allowed = new Set(['SAFETY_CONTRACT_MISMATCH', 'SAFETY_LEDGER_CHANGED', 'SAFETY_LEDGER_WRITE', 'SAFETY_PROVIDER_ACCESS',
    'SAFETY_UNEXPECTED_PRISMA', 'SAFETY_UNREGISTERED_AUTHORITY', 'SAFETY_ACCOUNT_RESPONSE']);
  const candidate = error?.code === 'ERR_ASSERTION' ? error.message : error?.code || error?.message || '';
  const code = String(candidate).match(/^SAFETY_[A-Z_]+\b/)?.[0];
  const retainedFailure = Boolean(binding && saved?.schema === 1 && saved.planId === 'stocks-auth-http-fixture-512-v2'
    && saved.sourceSha === binding.sourceSha && saved.freezeSha256 === binding.freezeSha256
    && saved.image?.id === binding.imageId && saved.image?.contextSha256 === binding.contextSha256
    && saved.safetyStatus === 'FAIL' && ['FAIL', 'INCOMPLETE'].includes(saved.status));
  const failed = allowed.has(code) || retainedFailure;
  return { status: failed ? 'FAIL' : 'INCOMPLETE', safetyStatus: failed ? 'FAIL' : 'NOT_EVALUATED', datasetStatus: 'INCOMPLETE', retainedWorkloadSafetyFailure: retainedFailure };
}
function regular(file, maximum = MAX_FILE) {
  const st = fs.lstatSync(file); assert.ok(st.isFile() && !st.isSymbolicLink() && st.size <= maximum, 'LAUNCH_FILE_BOUND'); return fs.readFileSync(file);
}
function digest(file, maximum) {
  const st = fs.lstatSync(file); assert.ok(st.isFile() && !st.isSymbolicLink() && st.size > 0 && st.size <= maximum, 'LAUNCH_FILE_BOUND');
  const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(1024 ** 2), h = createHash('sha256'); let size = 0;
  try { for (;;) { const n = fs.readSync(fd, bytes); if (!n) break; size += n; assert.ok(size <= maximum); h.update(bytes.subarray(0, n)); } }
  finally { fs.closeSync(fd); }
  assert.equal(size, st.size); const after = fs.lstatSync(file); assert.equal(after.ino, st.ino); assert.equal(after.mtimeMs, st.mtimeMs); assert.equal(after.size, st.size);
  return { sha256: h.digest('hex'), bytes: size };
}
function write(file, bytes, mode = 0o600) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: mode === 0o644 ? 0o755 : 0o700 }); fs.writeFileSync(file, bytes, { flag: 'wx', mode }); }
function walk(dir) { return fs.readdirSync(dir).sort().flatMap(name => { const full = path.join(dir, name), st = fs.lstatSync(full); assert.ok(!st.isSymbolicLink());
  return st.isDirectory() ? walk(full).map(p => name + '/' + p) : (assert.ok(st.isFile()), [name]); }); }

export async function launch(config) {
  const c = validateConfig(config);
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64'); assert.ok(process.getuid() > 0 && process.getuid() === process.getgid());
  assert.ok(!process.env.NODE_OPTIONS && !process.env.NODE_PATH && !process.env.LD_PRELOAD && !process.env.LD_LIBRARY_PATH, 'LAUNCH_PRELOAD_DENIED');
  const github = validateGitHub(c, process.env, parse(regular(process.env.GITHUB_EVENT_PATH, 4 * 1024 ** 2)));
  const policyBytes = regular(path.join(ROOT, POLICY_PATH), MAX_FILE); assert.equal(hash(policyBytes), c.policySha256, 'LAUNCH_POLICY_LITERAL_MISMATCH');
  const policy = validatePolicy(parse(policyBytes)); validateLauncherNode(process.version, policy);
  assert.equal(fs.realpathSync(ROOT), ROOT); assert.ok(!fs.existsSync(c.output), 'LAUNCH_FRESH_OUTPUT');
  const parent = fs.realpathSync(path.dirname(c.output)); assert.equal(parent, path.dirname(c.output));
  assert.ok(!c.output.startsWith(ROOT + path.sep) && c.output !== ROOT, 'LAUNCH_OUTPUT_OUTSIDE_GIT');
  const oldMask = process.umask(0o077); fs.mkdirSync(c.output, { mode: 0o700 });
  const privateDir = path.join(c.output, 'private'); fs.mkdirSync(privateDir, { mode: 0o700 });
  const dockerConfig = path.join(privateDir, 'docker-config'); fs.mkdirSync(dockerConfig, { mode: 0o700 });
  const env = { PATH: '/usr/bin:/bin', LANG: 'C', DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONFIG: dockerConfig };
  const report = { schema: SCHEMA, status: 'NOT_RUN', github, policySha256: c.policySha256, commands: [],
    workloadInvoked: false, imageBuilt: false, dependenciesInstalled: false, seedCreated: false,
    preparationResourceProof: 'PRIOR_RUNNER_ONLY; never capacity or current-resource acceptance', cleanup: [], previousFailures: 'PRESERVED' };
  let loadedImage = null, removeImage = false, prepDeadline = performance.now() + 300000;
  const command = (exe, args, { input, maxBuffer = 4 * 1024 ** 2, timeout = 30000, allowMissingImage = false } = {}) => {
    const left = Math.floor(prepDeadline - performance.now()); assert.ok(left > 0, 'LAUNCH_PREFLIGHT_DEADLINE');
    const started = performance.now(), result = spawnSync(exe, args, { cwd: ROOT, env, input, timeout: Math.min(timeout, left), killSignal: 'SIGKILL', maxBuffer });
    report.commands.push({ tool: path.basename(exe), elapsedMs: performance.now() - started, exitCode: result.status, signal: result.signal,
      errorCode: result.error?.code || null, stdoutBytes: result.stdout?.length || 0, stderrBytes: result.stderr?.length || 0 });
    const i = String(report.commands.length).padStart(3, '0');
    write(path.join(privateDir, 'commands', i + '.stdout'), result.stdout || Buffer.alloc(0)); write(path.join(privateDir, 'commands', i + '.stderr'), result.stderr || Buffer.alloc(0));
    assert.ok(performance.now() < prepDeadline, 'LAUNCH_PREFLIGHT_DEADLINE');
    if (allowMissingImage && !result.error && result.status === 1 && result.signal === null && /^Error response from daemon: No such image: sha256:[a-f0-9]{64}\s*$/.test(result.stderr?.toString().trim())) return null;
    assert.ok(!result.error && result.status === 0 && result.signal === null, 'LAUNCH_COMMAND_FAILED'); return result.stdout;
  };
  const git = args => command('/usr/bin/git', args).toString('utf8').trim();
  try {
    assert.equal(git(['rev-parse', 'HEAD']), c.sourceSha); assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '', 'LAUNCH_DIRTY_CHECKOUT');
    const sourceTree = git(['rev-parse', c.sourceSha + '^{tree}']);
    const rows = parseTree(command('/usr/bin/git', ['ls-tree', '-rz', '--full-tree', c.sourceSha], { maxBuffer: MAX_FILE })); validateReviewedTree(rows, policy);
    // Verify the actual executing QA files before importing any relative helper.
    for (const row of rows.filter(r => r.path.startsWith(FIXTURE) && /\.(?:mjs|cjs)$/.test(r.path))) {
      assert.deepEqual(regular(path.join(ROOT, row.path)), command('/usr/bin/git', ['cat-file', 'blob', row.blob], { maxBuffer: MAX_FILE }), 'LAUNCH_HELPER_BYTES_DRIFT');
    }
    assert.deepEqual(policyBytes, command('/usr/bin/git', ['show', c.sourceSha + ':' + POLICY_PATH]), 'LAUNCH_POLICY_WORKTREE_DRIFT');
    const helpers = await import('./prepare.mjs'), plan = await import('./plan.mjs');
    const preparedBytes = regular(c.prepared.report), manifestBytes = regular(c.prepared.manifest), insideBytes = regular(c.prepared.inside);
    assert.equal(hash(preparedBytes), c.prepared.reportSha256); assert.equal(hash(manifestBytes), c.prepared.manifestSha256); assert.equal(hash(insideBytes), c.prepared.insideSha256);
    const prepared = parse(preparedBytes), manifest = parse(manifestBytes), inside = parse(insideBytes);
    validatePrepared(c, policy, prepared, manifest, inside); assert.equal(manifest.sourceTree, sourceTree);
    for (const [key, archive] of [['stage', c.stage.archive], ['preparation', c.prepared.publicArchive], ['inputs', c.prepared.inputsArchive]]) {
      const observed = digest(archive, key === 'inputs' ? helpers.BOUNDS.imageBytes : helpers.BOUNDS.archiveBytes);
      assert.deepEqual(observed, { sha256: c.receipts[key].sha256, bytes: c.receipts[key].bytes }, 'LAUNCH_ARTIFACT_RECEIPT_MISMATCH');
    }
    assert.equal(digest(fs.realpathSync(c.python.executable), 128 * 1024 ** 2).sha256, c.python.sha256);
    const publicMembers = parse(command(c.python.executable, ['-I', '-S', '-c', ARCHIVE_MEMBER_PROOF, c.prepared.publicArchive, 'public']));
    const inputMembers = parse(command(c.python.executable, ['-I', '-S', '-c', ARCHIVE_MEMBER_PROOF, c.prepared.inputsArchive, 'inputs']));
    validateArchiveMembers(publicMembers, inputMembers, c, prepared, { report: preparedBytes.length, manifest: manifestBytes.length, inside: insideBytes.length });
    const extracted = path.join(privateDir, 'stage-selected');
    command(c.python.executable, ['-I', '-S', '-c', helpers.ZIP_EXTRACTOR, c.stage.archive, extracted]);
    const stageManifest = parse(regular(path.join(extracted, 'package/manifest.json'))), proofBytes = regular(path.join(extracted, 'build-provenance.json'));
    const buildLog = regular(path.join(extracted, 'build.log')), stageReportBytes = regular(path.join(extracted, 'report.json'));
    assert.equal(hash(stageReportBytes), prepared.stage.reportSha256);
    const compiled = new Map(walk(path.join(extracted, 'package/dist')).map(p => ['dist/' + p, regular(path.join(extracted, 'package/dist', p))]));
    const build = helpers.validateStage(stageManifest, proofBytes, buildLog, compiled, c, parse(stageReportBytes));
    assert.equal(build.node, policy.dependencyBaseline.compilerNode, 'LAUNCH_COMPILER_NODE_DRIFT');
    assert.equal(inside.compiler.sourceCount, build.sourcesBefore.length, 'LAUNCH_COMPILER_SOURCE_COUNT');
    assert.deepEqual([...compiled].map(([path, bytes]) => ({ path, sha256: hash(bytes) })).sort(comparePath), policy.dependencyBaseline.compiledOutputs, 'LAUNCH_EMITTED_BASELINE_DRIFT');
    const selected = rows.filter(r => helpers.sourceAllowed(r.path));
    const blobs = helpers.parseGitBatch(command('/usr/bin/git', ['cat-file', '--batch'], { input: selected.map(r => r.blob).join('\n') + '\n', maxBuffer: helpers.BOUNDS.expandedBytes }), selected);
    const context = canonicalContext(rows, blobs, compiled, proofBytes, buildLog, c.sourceSha, sourceTree, manifest, helpers);
    const source = path.join(c.output, 'public-context'); fs.mkdirSync(source, { mode: 0o755 });
    for (const [p, bytes] of context.bytesByPath) write(path.join(source, p), bytes, 0o644);
    write(path.join(source, 'runtime-source-manifest.json'), manifestBytes, 0o644);
    // Only this newly reconstructed public context is made traversable by image uid10001.
    const normalize = dir => { const st = fs.lstatSync(dir); assert.ok(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid()); fs.chmodSync(dir, 0o755);
      for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name), item = fs.lstatSync(file); assert.ok(item.uid === process.getuid() && !item.isSymbolicLink());
        if (item.isDirectory()) normalize(file); else { assert.ok(item.isFile()); fs.chmodSync(file, 0o644); } } }; normalize(source);
    const imageDigest = digest(c.prepared.image, helpers.BOUNDS.imageBytes); assert.deepEqual(imageDigest, { sha256: prepared.imageArchive.sha256, bytes: prepared.imageArchive.bytes });
    const seedDigest = digest(c.prepared.seed, MAX_FILE); assert.deepEqual(seedDigest, { sha256: inside.seed.sha256, bytes: inside.seed.bytes });
    for (const suffix of ['-journal', '-wal', '-shm']) assert.equal(fs.existsSync(c.prepared.seed + suffix), false, 'LAUNCH_SEED_NOT_CLOSED');
    const seed = path.join(privateDir, 'seed', 'accounts.sqlite'); write(seed, regular(c.prepared.seed));
    const freeze = buildFreeze(c, policy, prepared, manifest, plan), freezeBytes = Buffer.from(JSON.stringify(freeze, null, 2) + '\n');
    const freezePath = path.join(privateDir, 'freeze.json'); write(freezePath, freezeBytes);
    const runner = await import('./run.mjs'); runner.verifyClosure(source, freeze);
    assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '', 'LAUNCH_CHECKOUT_CHANGED'); assert.equal(git(['rev-parse', 'HEAD']), c.sourceSha);
    report.source = { sourceSha: c.sourceSha, sourceTree, contextSha256: manifest.contextSha256, files: manifest.files.length };
    report.inputs = { stageArtifactId: c.stage.artifactId, publicArtifactId: c.prepared.publicArtifactId, inputsArtifactId: c.prepared.inputsArtifactId,
      imageId: freeze.runtimeImageId, imageArchive: imageDigest, seed: seedDigest, freezeSha256: hash(freezeBytes) };
    // All provenance guards above precede even the first Docker call. Load cannot run an entrypoint.
    const prior = command('/usr/bin/docker', ['image', 'inspect', freeze.runtimeImageId], { allowMissingImage: true });
    if (!prior) { removeImage = true; loadedImage = freeze.runtimeImageId; command('/usr/bin/docker', ['image', 'load', '--input', c.prepared.image], { timeout: 180000 }); }
    const image = parse(command('/usr/bin/docker', ['image', 'inspect', freeze.runtimeImageId]))[0];
    helpers.validateImage(image, c.sourceSha, manifest.contextSha256); assert.equal(image.Id, freeze.runtimeImageId);
    assert.deepEqual(image.Config, prepared.image.config, 'LAUNCH_IMAGE_CONFIG_DRIFT');
    // run.main revalidates fresh backing device/cgroups and actual worker FULL proof before HTTP.
    report.workloadInvoked = true; const result = await runner.main({ freeze: freezePath, freezeSha256: hash(freezeBytes), source, seed,
      output: path.join(c.output, 'workload'), disk: c.disk, device: c.device });
    report.status = result.status; report.safetyStatus = result.safetyStatus; report.workloadReport = 'workload/report.json';
  } catch (error) {
    let saved;
    if (report.workloadInvoked) try { saved = parse(regular(path.join(c.output, 'workload/report.json'))); } catch { /* Missing evidence cannot become PASS. */ }
    const binding = report.inputs && report.source ? { sourceSha: c.sourceSha, freezeSha256: report.inputs.freezeSha256,
      imageId: report.inputs.imageId, contextSha256: report.source.contextSha256 } : null;
    Object.assign(report, classifyLauncherFailure(error, saved, binding));
    report.failureCode = /^LAUNCH_[A-Z_]+/.exec(String(error.message))?.[0] || 'LAUNCH_PREREQUISITE_OR_WORKLOAD_FAILED';
    write(path.join(privateDir, 'failure.txt'), String(error.stack || error).slice(0, 65536));
  } finally {
    if (removeImage && loadedImage) {
      prepDeadline = performance.now() + 30000;
      try { command('/usr/bin/docker', ['image', 'rm', loadedImage]); report.cleanup.push({ imageId: loadedImage, removed: true }); }
      catch { report.cleanup.push({ imageId: loadedImage, removed: false }); report.status = report.safetyStatus === 'FAIL' ? 'FAIL' : 'INCOMPLETE'; }
    }
    write(path.join(c.output, 'launcher-report.json'), JSON.stringify(report, null, 2) + '\n'); process.umask(oldMask);
  }
  return report;
}
export async function main(args = process.argv.slice(2)) {
  assert.ok(args.length === 2 && args[0] === '--launch', 'LAUNCH_EXPLICIT_CONFIG_REQUIRED'); absolute(args[1]);
  return launch(parse(regular(args[1], 65536)));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(report => { console.log(JSON.stringify({ schema: SCHEMA, status: report.status, workloadInvoked: report.workloadInvoked }));
    if (report.status !== 'PASS') process.exitCode = 1;
  }).catch(() => { console.error('LAUNCH_ADMISSION_FAILED; no permissive defaults or retry'); process.exitCode = 1; });
}
