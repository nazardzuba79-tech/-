// Pure translation of VERIFIED archive receipts and selected text/member bytes.
// This module never downloads, opens a DB/native library, extracts an archive, or
// runs preparation. The caller must hash actual downloaded archives and selected
// members first. A wrapper is derived metadata, not a member of those archives.
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { hash, BASE_IMAGE } from './launch-gate.mjs';
import { BASELINE, OVERLAYS, HELPERS } from './closure.mjs';
import { SUBJECTS, ISSUER, planHash } from '../auth-http-fixture-512/plan.mjs';

export const PREPARE_SCHEMA = 'stocks-auth-http-prepare-512-v1';
export const MEMBER_PATHS = Object.freeze({
  stageReport: 'report.json', stageManifest: 'package/manifest.json',
  buildProvenance: 'build-provenance.json', buildLog: 'build.log',
  preparationReport: 'stocks-auth-preparation-output/preparation.json',
  runtimeManifest: 'stocks-auth-preparation-output/public-context/runtime-source-manifest.json',
  insideProof: 'stocks-auth-preparation-output/private/runtime-output/inside-proof.json',
  derivedManifest: 'stocks-auth-preparation-output/trace-overlay/derived-manifest.json',
  image: 'runtime-image.tar', seed: 'runtime-output/private/seed/accounts.sqlite',
});
export const COMPILED_PATHS = Object.freeze(['dist/api/asyncRoute.js', 'dist/api/middleware/auth.js',
  'dist/api/routes/account.js', 'dist/services/AdminPasswordVault.js',
  'dist/services/ContactEmailPolicy.js', 'dist/services/TwoFactorService.js']);
const compare = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const bad = code => { const e = new Error(code); e.code = code; throw e; };
const check = (ok, code) => { if (!ok) bad(code); };
const same = (a, b, code) => check(isDeepStrictEqual(a, b), code);
function keys(value, names) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...names].sort()), 'RECEIPT_UNKNOWN_OR_MISSING_FIELD');
}
function sha(value) { check(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'RECEIPT_DIGEST'); }
function id(value) { check(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value), 'RECEIPT_ID'); }
function relative(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\\')
    && !value.includes('\0') && !value.includes(':') && !value.startsWith('/')
    && value.split('/').every(part => part && part !== '.' && part !== '..'), 'RECEIPT_PATH');
}
function rows(value, maximum = 10000) {
  check(Array.isArray(value) && value.length > 0 && value.length <= maximum, 'RECEIPT_ROWS_BOUND');
  const map = new Map();
  for (const row of value) {
    relative(row.path); sha(row.sha256);
    check(!map.has(row.path), 'RECEIPT_DUPLICATE_PATH'); map.set(row.path, row);
  }
  return map;
}
function byteLength(value, maximum, allowEmptyBuildLog = false) {
  check(Buffer.isBuffer(value) || value instanceof Uint8Array, 'RECEIPT_BYTES_REQUIRED');
  check(value.byteLength >= (allowEmptyBuildLog ? 0 : 1) && value.byteLength <= maximum, 'RECEIPT_BYTES_BOUND');
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
function parse(value) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
  catch { bad('RECEIPT_INVALID_JSON'); }
}
export function artifactNames(sourceSha) {
  check(/^[a-f0-9]{40}$/.test(sourceSha || ''), 'RECEIPT_SOURCE_SHA');
  return { compiled: `stocks-local-stage-${sourceSha}`, preparation: `stocks-auth-burst-preparation-${sourceSha}`,
    inputs: `stocks-auth-burst-inputs-${sourceSha}` };
}
function archive(row, role, input) {
  keys(row, ['artifactId', 'runId', 'sourceSha', 'name', 'expired', 'archiveSha256',
    'downloadedSha256', 'bytes', 'selectedMembers']);
  id(row.artifactId); id(row.runId); sha(row.archiveSha256); sha(row.downloadedSha256);
  same(row.sourceSha, input.sourceSha, 'RECEIPT_ARCHIVE_HEAD'); same(row.runId, input.runId, 'RECEIPT_ARCHIVE_RUN');
  same(row.name, artifactNames(input.sourceSha)[role], 'RECEIPT_ARCHIVE_NAME');
  same(row.expired, false, 'RECEIPT_EXPIRED');
  same(row.archiveSha256, row.downloadedSha256, 'RECEIPT_DOWNLOADED_ARCHIVE_DIGEST');
  const maximum = role === 'compiled' ? 256 * 1024 ** 2 : role === 'preparation' ? 128 * 1024 ** 2 : 3 * 1024 ** 3;
  check(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= maximum, 'RECEIPT_ARCHIVE_SIZE');
  return selectedInventory(row.selectedMembers, role);
}
function selectedInventory(members, role) {
  const inventory = rows(members, 32);
  for (const member of members) {
    keys(member, ['path', 'bytes', 'sha256']);
    const emptyBuildLog = role === 'compiled' && member.path === MEMBER_PATHS.buildLog;
    check(Number.isSafeInteger(member.bytes) && member.bytes >= (emptyBuildLog ? 0 : 1)
      && member.bytes <= (role === 'inputs' ? 3 * 1024 ** 3 : 16 * 1024 ** 2), 'RECEIPT_MEMBER_SIZE');
    if (member.bytes === 0) same(member.sha256, hash(Buffer.alloc(0)), 'RECEIPT_EMPTY_BUILD_LOG_DIGEST');
  }
  return inventory;
}
function selectedBytes(inventory, memberPath, bytes) {
  const value = byteLength(bytes, 16 * 1024 ** 2, memberPath === MEMBER_PATHS.buildLog), row = inventory.get(memberPath);
  check(Boolean(row), 'RECEIPT_MEMBER_MISSING'); same(value.length, row.bytes, 'RECEIPT_MEMBER_LENGTH');
  same(hash(value), row.sha256, 'RECEIPT_MEMBER_DIGEST'); return value;
}
function output(row, role, proof) {
  const proofText = JSON.stringify({ schema: `stocks-one-burst-${role}-512-v1`, ...proof });
  return { artifactId: row.artifactId, runId: row.runId, sourceSha: row.sourceSha,
    archiveSha256: row.archiveSha256, downloadedSha256: row.downloadedSha256, bytes: row.bytes,
    proofSha256: hash(proofText), proofText };
}
export function compiledClosureRows(compiled) {
  keys(compiled, COMPILED_PATHS); const result = Object.entries(compiled).map(([path, sha256]) => ({ path, sha256 })).sort(compare);
  result.forEach(row => sha(row.sha256)); return result;
}
export function nativeBinding(inside, baseImage) {
  same(baseImage, BASE_IMAGE, 'RECEIPT_BASE_IMAGE');
  keys(inside.runtime, ['node', 'nodeSha256', 'platform', 'arch', 'uid', 'gid']);
  same(inside.runtime.node, 'v24.21.0', 'RECEIPT_NODE_VERSION');
  same(inside.runtime.platform, 'linux', 'RECEIPT_PLATFORM'); same(inside.runtime.arch, 'x64', 'RECEIPT_ARCH');
  check(Number.isSafeInteger(inside.runtime.uid) && inside.runtime.uid > 0
    && Number.isSafeInteger(inside.runtime.gid) && inside.runtime.gid > 0, 'RECEIPT_ROOT_RUNTIME');
  keys(inside.dependencies, ['files', 'inventorySha256', 'nativeFiles', 'bcryptSha256']);
  check(Array.isArray(inside.dependencies.files) && inside.dependencies.files.length > 0
    && inside.dependencies.files.length <= 50000, 'RECEIPT_DEPENDENCY_BOUND');
  const inventory = new Map();
  for (const row of inside.dependencies.files) {
    relative(row.path); check(!inventory.has(row.path), 'RECEIPT_DUPLICATE_DEPENDENCY'); inventory.set(row.path, row);
    if (Object.hasOwn(row, 'symlink')) {
      keys(row, ['path', 'symlink']);
      check(typeof row.symlink === 'string' && row.symlink.length > 0 && row.symlink.length <= 512
        && !row.symlink.includes('\\') && !row.symlink.includes('\0') && !row.symlink.includes(':')
        && !row.symlink.startsWith('/'), 'RECEIPT_DEPENDENCY_LINK');
    } else {
      keys(row, ['path', 'bytes', 'sha256']); sha(row.sha256);
      check(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 64 * 1024 ** 2, 'RECEIPT_DEPENDENCY_SIZE');
    }
  }
  for (const row of inventory.values()) {
    let target = row; const seen = new Set();
    while (Object.hasOwn(target, 'symlink')) {
      check(!seen.has(target.path) && seen.size < 32, 'RECEIPT_DEPENDENCY_LINK_CYCLE'); seen.add(target.path);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(target.path), target.symlink));
      relative(resolved); target = inventory.get(resolved); check(Boolean(target), 'RECEIPT_DEPENDENCY_LINK_TARGET');
    }
  }
  same(hash(JSON.stringify(inside.dependencies.files)), inside.dependencies.inventorySha256, 'RECEIPT_DEPENDENCY_INVENTORY');
  same(inside.dependencies.nativeFiles, inside.dependencies.files.filter(row => /\.node$/.test(row.path)), 'RECEIPT_NATIVE_INVENTORY');
  check(inside.dependencies.nativeFiles.length > 0
    && inside.dependencies.nativeFiles.every(row => !Object.hasOwn(row, 'symlink')
      && /^bcrypt\/prebuilds\/[a-z0-9-]+\/bcrypt(?:\.glibc|\.musl)?\.node$/.test(row.path)),
  'RECEIPT_UNREVIEWED_NATIVE_OR_PRISMA');
  const bcrypt = inventory.get('bcrypt/prebuilds/linux-x64/bcrypt.glibc.node');
  check(Boolean(bcrypt), 'RECEIPT_BCRYPT_MISSING'); same(bcrypt.sha256, inside.dependencies.bcryptSha256, 'RECEIPT_BCRYPT_DIGEST');
  sha(inside.runtime.nodeSha256);
  return { nodeVersion: inside.runtime.node, nodeSha256: inside.runtime.nodeSha256,
    bcryptSha256: bcrypt.sha256, nativeFilesSha256: hash(JSON.stringify(inside.dependencies.nativeFiles)),
    dependencyInventorySha256: inside.dependencies.inventorySha256,
    compiledClosureSha256: hash(JSON.stringify(compiledClosureRows(inside.compiler.compiled))), baseImage };
}

function common(input, policy) {
  check(/^[a-f0-9]{40}$/.test(input.sourceSha || ''), 'RECEIPT_SOURCE_SHA'); id(input.runId); sha(input.sourceTreeSha256);
  same(input.sourceTreeSha256, policy.sourceTreeSha256, 'RECEIPT_REVIEWED_TREE');
  keys(input.members, ['stageReport', 'stageManifest', 'buildProvenance', 'buildLog', 'compiled',
    'preparationReport', 'runtimeManifest', 'insideProof', 'derivedManifest']);
}
function preparedProofs(input, policy, inv) {
  const expected = {
    compiled: ['stageReport', 'stageManifest', 'buildProvenance', 'buildLog'].map(k => MEMBER_PATHS[k]).concat(COMPILED_PATHS.map(p => `package/${p}`)),
    preparation: ['preparationReport', 'runtimeManifest', 'insideProof', 'derivedManifest'].map(k => MEMBER_PATHS[k]),
    inputs: [MEMBER_PATHS.image, MEMBER_PATHS.seed],
  };
  for (const role of Object.keys(inv)) same([...inv[role].keys()].sort(), expected[role].sort(), 'RECEIPT_UNEXPECTED_SELECTED_MEMBERS');
  const bytes = {};
  for (const key of Object.keys(input.members).filter(k => k !== 'compiled')) {
    const role = ['stageReport', 'stageManifest', 'buildProvenance', 'buildLog'].includes(key) ? 'compiled' : 'preparation';
    bytes[key] = selectedBytes(inv[role], MEMBER_PATHS[key], input.members[key]);
  }
  keys(input.members.compiled, COMPILED_PATHS);
  const compiled = Object.fromEntries(COMPILED_PATHS.map(p => [p, hash(selectedBytes(inv.compiled, `package/${p}`, input.members.compiled[p]))]));
  const stage = parse(bytes.stageReport), pkg = parse(bytes.stageManifest), build = parse(bytes.buildProvenance);
  const report = parse(bytes.preparationReport), manifest = parse(bytes.runtimeManifest), inside = parse(bytes.insideProof), derived = parse(bytes.derivedManifest);
  same(stage.status, 'PASS', 'RECEIPT_STAGE_FAILED'); same(stage.fixtureOnly, true, 'RECEIPT_STAGE_NOT_FIXTURE');
  same(stage.productionAccess, false, 'RECEIPT_STAGE_PRODUCTION'); same(stage.capacityClaim, false, 'RECEIPT_STAGE_CAPACITY_CLAIM');
  same(stage.browserClaim, false, 'RECEIPT_STAGE_BROWSER_CLAIM');
  check(Array.isArray(stage.cases) && stage.cases.length === 5 && stage.cases.every(row => row.status === 'PASS'), 'RECEIPT_STAGE_CASES');
  keys(pkg, ['fixtureOnly', 'sourceSha', 'workingTreeChanges', 'packageEntry', 'accountEntry',
    'buildProvenanceSha256', 'migration', 'productionEntrypoint', 'nodeModulesCopied', 'dependencies', 'files']);
  same(pkg.sourceSha, input.sourceSha, 'RECEIPT_STAGE_SOURCE'); same(pkg.fixtureOnly, true, 'RECEIPT_PACKAGE_NOT_FIXTURE');
  same(pkg.workingTreeChanges, [], 'RECEIPT_STAGE_DIRTY'); same(pkg.nodeModulesCopied, false, 'RECEIPT_NODE_MODULES_COPIED');
  same(pkg.migration, 'NOT_USED', 'RECEIPT_MIGRATION'); same(pkg.productionEntrypoint, 'NOT_USED', 'RECEIPT_PRODUCTION_ENTRY');
  same(pkg.buildProvenanceSha256, hash(bytes.buildProvenance), 'RECEIPT_BUILD_PROVENANCE');
  keys(build, ['command', 'startedAt', 'endedAt', 'exitCode', 'signal', 'compilerVersion', 'compilerFiles',
    'node', 'tsconfig', 'packageLockSha256', 'logSha256', 'sourcesBefore', 'outputs', 'sourcesAfterHash', 'sourcesUnchanged']);
  same(build.exitCode, 0, 'RECEIPT_COMPILE_FAILED'); same(build.signal, null, 'RECEIPT_COMPILE_SIGNAL');
  same(build.sourcesUnchanged, true, 'RECEIPT_COMPILE_SOURCE_CHANGED'); same(build.logSha256, hash(bytes.buildLog), 'RECEIPT_BUILD_LOG');
  check(/^v22\.[0-9]+\.[0-9]+$/.test(build.node || ''), 'RECEIPT_COMPILER_NODE');
  const packaged = rows(pkg.files), emitted = rows(build.outputs), sourceRows = rows(manifest.files);
  same(pkg.files.filter(row => row.path.startsWith('dist/')).map(row => row.path).sort(), COMPILED_PATHS, 'RECEIPT_COMPILED_PATHS');
  for (const p of COMPILED_PATHS) {
    same(packaged.get(p)?.sha256, compiled[p], 'RECEIPT_PACKAGED_EMIT'); same(emitted.get(p)?.sha256, compiled[p], 'RECEIPT_BUILD_EMIT');
    same(packaged.get(p)?.bytes, input.members.compiled[p].byteLength, 'RECEIPT_PACKAGED_EMIT_SIZE');
    same(sourceRows.get(p)?.sha256, compiled[p], 'RECEIPT_CONTEXT_EMIT');
  }
  keys(manifest, ['schema', 'sourceSha', 'sourceTree', 'files', 'contextSha256']);
  same(manifest.schema, PREPARE_SCHEMA, 'RECEIPT_MANIFEST_SCHEMA'); same(manifest.sourceSha, input.sourceSha, 'RECEIPT_MANIFEST_SOURCE');
  same(hash(JSON.stringify(manifest.files)), manifest.contextSha256, 'RECEIPT_CONTEXT_DIGEST');
  for (const row of rows(build.sourcesBefore).values()) same(sourceRows.get(row.path)?.sha256, row.sha256, 'RECEIPT_BUILD_SOURCE');
  same(sourceRows.get('tsconfig.json')?.sha256, build.tsconfig?.sha256, 'RECEIPT_TSCONFIG');
  same(sourceRows.get('package-lock.json')?.sha256, build.packageLockSha256, 'RECEIPT_LOCK');
  same(sourceRows.get('compiled-proof.json')?.sha256, hash(bytes.buildProvenance), 'RECEIPT_CONTEXT_BUILD_PROOF');
  same(sourceRows.get('build.log')?.sha256, hash(bytes.buildLog), 'RECEIPT_CONTEXT_BUILD_LOG');
  same(sourceRows.get('build.log')?.bytes, bytes.buildLog.length, 'RECEIPT_CONTEXT_BUILD_LOG_SIZE');
  same(report.schema, PREPARE_SCHEMA, 'RECEIPT_PREPARE_SCHEMA'); same(report.status, 'PREPARED_NOT_AUTHORIZED', 'RECEIPT_PREPARE_STATUS');
  same(report.sourceSha, input.sourceSha, 'RECEIPT_PREPARE_SOURCE'); same(report.inside, inside, 'RECEIPT_INSIDE_COPY');
  same(report.contextSha256, manifest.contextSha256, 'RECEIPT_PREPARE_CONTEXT');
  keys(report.stage, ['archive', 'sha256', 'sourceSha', 'runId', 'artifactId', 'buildProvenanceSha256', 'reportSha256']);
  same(report.stage.sha256, input.archives.compiled.archiveSha256, 'RECEIPT_PREPARE_STAGE_ARCHIVE');
  for (const key of ['sourceSha', 'runId', 'artifactId']) same(report.stage[key], input.archives.compiled[key], 'RECEIPT_PREPARE_STAGE_IDENTITY');
  same(report.stage.buildProvenanceSha256, hash(bytes.buildProvenance), 'RECEIPT_PREPARE_BUILD_PROOF');
  same(report.stage.reportSha256, hash(bytes.stageReport), 'RECEIPT_PREPARE_STAGE_REPORT');
  keys(inside, ['schema', 'status', 'planId', 'planHash', 'contextSha256', 'runtime', 'compiler',
    'runtimeClosure', 'dependencies', 'seed', 'sourceReadability', 'workload']);
  same(inside.schema, PREPARE_SCHEMA, 'RECEIPT_INSIDE_SCHEMA'); same(inside.status, 'PREPARED_NOT_AUTHORIZED', 'RECEIPT_INSIDE_STATUS');
  same(inside.planId, 'stocks-auth-http-fixture-512-v2', 'RECEIPT_PREPARATION_PLAN'); same(inside.planHash, planHash(), 'RECEIPT_PREPARATION_PLAN_HASH');
  same(inside.contextSha256, manifest.contextSha256, 'RECEIPT_INSIDE_CONTEXT');
  same(inside.compiler.compiled, Object.fromEntries(Object.keys(inside.compiler.compiled).map(p => [p, compiled[p]])), 'RECEIPT_INSIDE_COMPILED');
  same(inside.compiler.proofSha256, hash(bytes.buildProvenance), 'RECEIPT_INSIDE_BUILD_PROOF');
  same(inside.compiler.buildNode, build.node, 'RECEIPT_INSIDE_COMPILER_NODE');
  same(inside.workload, { authHttpInvoked: false, stocksHttpInvoked: false, providerInvoked: false,
    compiledAuthLoaded: false, tradingCommands: 0 }, 'RECEIPT_PREPARATION_RAN_WORKLOAD');
  const native = nativeBinding(inside, report.image?.baseImage); same(native, policy.native, 'RECEIPT_NATIVE_POLICY');
  same(inside.runtimeClosure.fixturePackagingProof, true, 'RECEIPT_RUNTIME_CLOSURE');
  same(inside.runtimeClosure.npmDependencies, [], 'RECEIPT_RUNTIME_CLOSURE_DEPENDENCIES');
  for (const row of rows(inside.runtimeClosure.files).values()) same(sourceRows.get(row.path)?.sha256, row.sha256, 'RECEIPT_RUNTIME_SOURCE');
  same(report.image.freezeBaseImageAlias, BASE_IMAGE.replace('docker.io/library/', ''), 'RECEIPT_BASE_IMAGE_ALIAS');
  check(/^sha256:[a-f0-9]{64}$/.test(report.image.id || ''), 'RECEIPT_IMAGE_ID');
  same(report.imageArchive?.sha256, inv.inputs.get(MEMBER_PATHS.image).sha256, 'RECEIPT_IMAGE_MEMBER_DIGEST');
  same(report.imageArchive?.bytes, inv.inputs.get(MEMBER_PATHS.image).bytes, 'RECEIPT_IMAGE_MEMBER_SIZE');
  same(inside.seed.closed, true, 'RECEIPT_SEED_NOT_CLOSED'); same(inside.seed.integrity, 'ok', 'RECEIPT_SEED_INTEGRITY');
  same(inside.seed.subjects, SUBJECTS, 'RECEIPT_SEED_SUBJECTS'); same(inside.seed.journal, 'delete', 'RECEIPT_SEED_JOURNAL');
  same(inside.seed.synchronous, 2, 'RECEIPT_SEED_DURABILITY'); same(inside.seed.fixedTime, 1791936000000, 'RECEIPT_SEED_TIME');
  same(inside.seed.api, 'openAccountWorker.forPrincipal', 'RECEIPT_SEED_API');
  same(inside.seed.actualWorkerConnectionPragma, 'UNMEASURED', 'RECEIPT_SEED_PRAGMA_CLAIM');
  same(inside.seed.workerSynchronous, 'SOURCE_CONFIGURED_FULL', 'RECEIPT_SEED_SOURCE_DURABILITY');
  same(inside.seed.sha256, inv.inputs.get(MEMBER_PATHS.seed).sha256, 'RECEIPT_SEED_MEMBER_DIGEST');
  same(inside.seed.bytes, inv.inputs.get(MEMBER_PATHS.seed).bytes, 'RECEIPT_SEED_MEMBER_SIZE');
  check(Array.isArray(inside.seed.accounts) && inside.seed.accounts.length === 50, 'RECEIPT_SEED_ACCOUNTS');
  same(inside.seed.accounts.map(row => row.id).sort(), SUBJECTS.map(subject => hash(JSON.stringify([ISSUER, subject]))).sort(), 'RECEIPT_SEED_OWNER_IDS');
  inside.seed.accounts.forEach(row => { keys(row, ['id', 'ledgerSha256']); sha(row.ledgerSha256); });
  check(Array.isArray(report.cleanup) && report.cleanup.length === 5, 'RECEIPT_PREPARE_CLEANUP');
  same(report.cleanup.filter(row => row.kind === 'container').map(row => row.role).sort(), ['authority', 'driver', 'prepare', 'service'], 'RECEIPT_PREPARE_CLEANUP_ROLES');
  const imageCleanup = report.cleanup.filter(row => row.kind === 'image'); check(imageCleanup.length === 1, 'RECEIPT_PREPARE_CLEANUP_IMAGE');
  same(imageCleanup[0].id, report.image.id, 'RECEIPT_CLEANUP_IMAGE_ID');
  for (const row of report.cleanup) {
    same(row.status, 'REMOVED', 'RECEIPT_CLEANUP_INCOMPLETE'); check(!row.error, 'RECEIPT_CLEANUP_ERROR');
    if (row.kind === 'container') { same(row.terminal?.exitCode, 0, 'RECEIPT_CONTAINER_EXIT'); same(row.terminal?.oomKilled, false, 'RECEIPT_CONTAINER_OOM'); }
  }
  keys(derived, ['schema', 'baseline', 'sourceSha', 'contextSha256', 'overlays', 'helpers']);
  same(derived.schema, 'stocks-one-burst-derived-512-v1', 'RECEIPT_DERIVED_SCHEMA'); same(derived.baseline, BASELINE, 'RECEIPT_DERIVED_BASELINE');
  same(derived.sourceSha, input.sourceSha, 'RECEIPT_DERIVED_HEAD'); same(derived.contextSha256, manifest.contextSha256, 'RECEIPT_DERIVED_CONTEXT');
  check(Array.isArray(derived.overlays) && Array.isArray(derived.helpers), 'RECEIPT_DERIVED_ROWS');
  same(derived.overlays.map(row => row.path).sort(), [...OVERLAYS].sort(), 'RECEIPT_DERIVED_OVERLAYS');
  same(derived.helpers.map(row => row.path).sort(), [...HELPERS].sort(), 'RECEIPT_DERIVED_HELPERS');
  for (const row of derived.overlays) {
    keys(row, ['path', 'originalSha256', 'outputSha256', 'bytes', 'hunksSha256']);
    sha(row.originalSha256); sha(row.outputSha256); sha(row.hunksSha256);
    same(row.originalSha256, sourceRows.get(row.path)?.sha256, 'RECEIPT_DERIVED_ORIGINAL');
    check(row.outputSha256 !== row.originalSha256 && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 16 * 1024 ** 2, 'RECEIPT_DERIVED_OUTPUT');
  }
  for (const row of derived.helpers) { keys(row, ['path', 'sha256', 'bytes']); sha(row.sha256);
    check(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 1024 ** 2, 'RECEIPT_DERIVED_HELPER_SIZE'); }
  const common = { sourceSha: input.sourceSha, sourceTreeSha256: input.sourceTreeSha256 };
  const compiledProof = { ...common, closureSha256: native.compiledClosureSha256, buildProvenanceSha256: hash(bytes.buildProvenance) };
  const inputsProof = { ...common, imageId: report.image.id, imageArchiveSha256: report.imageArchive.sha256,
    seedSha256: inside.seed.sha256, sourceContextSha256: manifest.contextSha256, derivedManifestSha256: hash(bytes.derivedManifest) };
  return { compiled: compiledProof,
    preparation: { ...compiledProof,
      compiledArtifactId: input.archives.compiled.artifactId, compiledArchiveSha256: input.archives.compiled.archiveSha256,
      ...inputsProof, native }, inputs: inputsProof,
  };
}

// Reusable pure evidence verification. Preparation/input digests may have been
// measured locally by a reviewed file/image adapter; no archive ID is invented.
// This helper never grants launch eligibility and never calls local files archives.
export function verifyPreparedProofs(input, policy) {
  keys(input, ['sourceSha', 'runId', 'sourceTreeSha256', 'compiledArchive', 'selectedMembers', 'members']);
  common(input, policy); keys(input.selectedMembers, ['preparation', 'inputs']);
  const inv = { compiled: archive(input.compiledArchive, 'compiled', input),
    preparation: selectedInventory(input.selectedMembers.preparation, 'preparation'),
    inputs: selectedInventory(input.selectedMembers.inputs, 'inputs') };
  const proofs = preparedProofs({ ...input, archives: { compiled: input.compiledArchive } }, policy, inv);
  return { schema: 'stocks-one-burst-selected-evidence-512-v1', eligible: false, releaseGatePass: false,
    evidenceType: 'SELECTED_TEXT_BYTES_AND_MEASURED_INPUT_DIGESTS', sourceSha: input.sourceSha,
    runId: input.runId, sourceTreeSha256: input.sourceTreeSha256, proofs };
}

// Optional remote-three-artifact adapter. Call only after actual upload, download,
// archive verification and exact selected-member measurement. It does not upload.
export function createLaunchReceipts(input, policy) {
  keys(input, ['sourceSha', 'runId', 'sourceTreeSha256', 'archives', 'members']);
  common(input, policy); keys(input.archives, ['compiled', 'preparation', 'inputs']);
  const inv = Object.fromEntries(Object.entries(input.archives).map(([role, row]) => [role, archive(row, role, input)]));
  check(new Set(Object.values(input.archives).map(row => row.artifactId)).size === 3, 'RECEIPT_REUSED_ARTIFACT_ID');
  const proofs = preparedProofs(input, policy, inv);
  return Object.fromEntries(Object.entries(proofs).map(([role, proof]) => [role, output(input.archives[role], role, proof)]));
}

export function createLocalLaunchReceipts(input, policy) {
  keys(input, ['sourceSha', 'runId', 'jobName', 'sourceTreeSha256', 'compiledArchive', 'selectedMembers', 'members']);
  check(typeof input.jobName === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(input.jobName), 'RECEIPT_JOB_NAME');
  const { jobName, ...evidence } = input;
  const verified = verifyPreparedProofs(evidence, policy), result = {
    compiled: output(input.compiledArchive, 'compiled', verified.proofs.compiled),
  };
  for (const role of ['preparation', 'inputs']) {
    const files = input.selectedMembers[role].map(row => ({ ...row })).sort(compare);
    const proofText = JSON.stringify({ schema: `stocks-one-burst-${role}-local-512-v1`,
      ...verified.proofs[role], filesSha256: hash(JSON.stringify(files)) });
    result[role] = { kind: 'local', runId: input.runId, jobName, sourceSha: input.sourceSha,
      files, proofSha256: hash(proofText), proofText };
  }
  return result;
}
