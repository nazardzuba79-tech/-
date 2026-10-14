// Explicit config construction only. Never calls Docker, HTTP, a database, a
// launcher or a workload. CLI hashing is outside all diagnostic timing windows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BASE_IMAGE, POLICY_PATH, hash } from './launch-gate.mjs';
import { TRACE_PLAN_ID, tracePlanHash, validateTraceFreeze } from './trace-plan.mjs';
import { MEMBER_PATHS, COMPILED_PATHS, PREPARE_SCHEMA, createLocalLaunchReceipts,
  artifactNames } from './prepare-receipts.mjs';

const SCHEMA = 'stocks-one-burst-launcher-512-v1';
const FIXTURE = 'services/stocks/auth-burst-trace-512';
const keys = (v, expected) => assert.deepEqual(Object.keys(v || {}).sort(), [...expected].sort(), 'CONFIG_UNKNOWN_OR_MISSING_FIELD');
const digest = value => assert.match(value || '', /^[a-f0-9]{64}$/, 'CONFIG_DIGEST');
const absolute = value => { assert.ok(typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0'), 'CONFIG_ABSOLUTE_PATH'); return path.resolve(value); };
function outside(value, repository) {
  const resolved = absolute(value), root = absolute(repository);
  assert.ok(resolved !== root && !resolved.startsWith(root + path.sep), 'CONFIG_OUTSIDE_REPOSITORY'); return resolved;
}
function device(value) {
  assert.ok(typeof value === 'string' && /^\/dev\/[a-zA-Z0-9/_-]+$/.test(value) && !value.includes('..'), 'CONFIG_BLOCK_DEVICE'); return value;
}
function identity(input) {
  absolute(input.repository);
  keys(input.sourceInput, ['event', 'approvedPolicySha256', 'history']);
  keys(input.compiledArchive, ['artifactId', 'runId', 'sourceSha', 'name', 'expired', 'archiveSha256',
    'downloadedSha256', 'bytes', 'selectedMembers']);
  assert.match(input.sourceInput?.event?.headSha || '', /^[a-f0-9]{40}$/, 'CONFIG_SOURCE_SHA');
  assert.match(input.sourceInput.event.runId || '', /^[1-9][0-9]{1,19}$/, 'CONFIG_RUN_ID');
  digest(input.sourceInput.approvedPolicySha256);
  assert.equal(input.compiledArchive.sourceSha, input.sourceInput.event.headSha, 'CONFIG_COMPILED_HEAD');
  assert.equal(input.compiledArchive.runId, input.sourceInput.event.runId, 'CONFIG_COMPILED_RUN');
  assert.match(input.compiledArchive.artifactId || '', /^[1-9][0-9]{1,19}$/, 'CONFIG_ARTIFACT_ID');
  assert.equal(input.compiledArchive.name, artifactNames(input.sourceInput.event.headSha).compiled, 'CONFIG_COMPILED_NAME');
  assert.equal(input.compiledArchive.expired, false, 'CONFIG_EXPIRED_ARTIFACT');
  digest(input.compiledArchive.archiveSha256); digest(input.compiledArchive.downloadedSha256);
  assert.equal(input.compiledArchive.archiveSha256, input.compiledArchive.downloadedSha256, 'CONFIG_ARCHIVE_DIGEST');
  assert.ok(Number.isSafeInteger(input.compiledArchive.bytes) && input.compiledArchive.bytes > 0
    && input.compiledArchive.bytes <= 256 * 1024 ** 2, 'CONFIG_ARCHIVE_SIZE');
}

export function buildPrepareConfig(input) {
  keys(input, ['repository', 'sourceInput', 'policy', 'compiledArchive', 'stageArchivePath',
    'buildProvenanceSha256', 'python', 'device', 'preparationOutput']);
  identity(input); keys(input.python, ['executable', 'sha256']); absolute(input.python.executable); digest(input.python.sha256);
  digest(input.buildProvenanceSha256); outside(input.stageArchivePath, input.repository); device(input.device);
  return { schema: SCHEMA, mode: 'prepare', repository: absolute(input.repository),
    gate: { input: input.sourceInput, policy: input.policy }, preparation: { schema: PREPARE_SCHEMA,
      sourceSha: input.sourceInput.event.headSha, stage: { archive: absolute(input.stageArchivePath),
        sha256: input.compiledArchive.downloadedSha256, sourceSha: input.compiledArchive.sourceSha,
        runId: input.compiledArchive.runId, artifactId: input.compiledArchive.artifactId,
        buildProvenanceSha256: input.buildProvenanceSha256 }, baseImage: BASE_IMAGE,
      python: { ...input.python, executable: absolute(input.python.executable) },
      output: outside(input.preparationOutput, input.repository), device: input.device } };
}

export function buildRunConfig(input, { createReceipts = createLocalLaunchReceipts } = {}) {
  keys(input, ['repository', 'sourceInput', 'policy', 'compiledArchive', 'jobName', 'preparationResult',
    'members', 'selectedMembers', 'preparationOutput', 'imagePath', 'disk', 'device', 'adapterOutput',
    'attemptMarker', 'resultPath', 'dockerConfigDirectory', 'driverFiles']);
  identity(input); assert.match(input.jobName || '', /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/, 'CONFIG_JOB_NAME');
  const prepared = input.preparationResult, root = outside(input.preparationOutput, input.repository);
  assert.equal(prepared.schema, SCHEMA, 'CONFIG_PREPARATION_RESULT_SCHEMA'); assert.equal(prepared.mode, 'prepare');
  assert.equal(prepared.status, 'PREPARED_NOT_AUTHORIZED'); assert.equal(prepared.workloadExecuted, false);
  assert.equal(prepared.eligibility?.preparationEligible, true, 'CONFIG_PREPARATION_NOT_ELIGIBLE');
  assert.equal(prepared.eligibility.eligible, false, 'CONFIG_PREPARATION_NOT_WORKLOAD');
  assert.equal(prepared.eligibility.sourceSha, input.sourceInput.event.headSha, 'CONFIG_PREPARATION_HEAD');
  assert.equal(prepared.eligibility.runId, input.sourceInput.event.runId, 'CONFIG_PREPARATION_RUN');
  assert.equal(prepared.eligibility.policySha256, input.sourceInput.approvedPolicySha256, 'CONFIG_PREPARATION_POLICY');
  assert.equal(absolute(prepared.preparationPath), path.join(root, 'preparation.json'), 'CONFIG_PREPARATION_PATH');
  assert.equal(absolute(prepared.overlay?.manifestPath), path.join(root, 'trace-overlay/derived-manifest.json'), 'CONFIG_OVERLAY_PATH');
  const report = JSON.parse(Buffer.from(input.members.preparationReport).toString('utf8'));
  assert.equal(report.imageArchive?.relativePath, 'private/runtime-image.tar', 'CONFIG_IMAGE_PATH');
  assert.equal(report.seedPath, 'private/runtime-output/private/seed/accounts.sqlite', 'CONFIG_SEED_PATH');
  assert.equal(absolute(input.imagePath), path.join(root, 'private/runtime-image.tar'), 'CONFIG_IMAGE_PATH');
  assert.equal(report.backing?.device, input.device, 'CONFIG_PREPARATION_DEVICE'); device(input.device);
  assert.match(report.backing?.deviceNumber || '', /^\d+:\d+$/, 'CONFIG_DEVICE_NUMBER');
  const artifacts = createReceipts({ sourceSha: input.sourceInput.event.headSha, runId: input.sourceInput.event.runId,
    jobName: input.jobName, sourceTreeSha256: input.policy.sourceTreeSha256,
    compiledArchive: input.compiledArchive, selectedMembers: input.selectedMembers, members: input.members }, input.policy);
  const prepProof = JSON.parse(artifacts.preparation.proofText);
  const freeze = { schema: 1, planId: TRACE_PLAN_ID, planSha256: tracePlanHash(), sourceSha: input.sourceInput.event.headSha,
    contextSha256: prepProof.sourceContextSha256, imageId: prepProof.imageId,
    nodeSha256: prepProof.native.nodeSha256, bcryptSha256: prepProof.native.bcryptSha256,
    seedSha256: prepProof.seedSha256, reviewedPacketSha256: input.sourceInput.approvedPolicySha256,
    device: report.backing.deviceNumber };
  validateTraceFreeze(freeze);
  const driverExpected = ['trace-driver.mjs', 'trace-plan.mjs'].map(name => ({ source: path.join(absolute(input.repository), FIXTURE, name),
    target: `/source/${FIXTURE}/${name}` }));
  assert.equal(input.driverFiles?.length, 2, 'CONFIG_DRIVER_FILES');
  for (let i = 0; i < 2; i++) {
    keys(input.driverFiles[i], ['source', 'target', 'sha256']); digest(input.driverFiles[i].sha256);
    assert.equal(absolute(input.driverFiles[i].source), driverExpected[i].source, 'CONFIG_DRIVER_SOURCE');
    assert.equal(input.driverFiles[i].target, driverExpected[i].target, 'CONFIG_DRIVER_TARGET');
  }
  const attemptMarker = outside(input.attemptMarker, input.repository), resultPath = outside(input.resultPath, input.repository);
  assert.notEqual(attemptMarker, resultPath, 'CONFIG_ATTEMPT_RESULT_COLLISION');
  return { schema: SCHEMA, mode: 'run', repository: absolute(input.repository),
    gate: { input: { ...input.sourceInput, jobName: input.jobName, artifacts }, policy: input.policy }, freeze,
    adapter: { sourceRoot: path.join(root, 'public-context'), preparationPath: prepared.preparationPath,
      preparationSha256: hash(input.members.preparationReport), seedPath: path.join(root, report.seedPath),
      overlay: prepared.overlay, disk: outside(input.disk, input.repository), device: input.device,
      outputDirectory: outside(input.adapterOutput, input.repository), driverFiles: input.driverFiles },
    attemptMarker, resultPath, imageOwnership: 'verified-archive-lease',
    imageLease: { archivePath: absolute(input.imagePath), archiveSha256: report.imageArchive.sha256,
      archiveBytes: report.imageArchive.bytes, dockerConfigDirectory: outside(input.dockerConfigDirectory, input.repository) } };
}

function regular(file, maximum) {
  const resolved = absolute(file), stat = fs.lstatSync(resolved);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum, 'CONFIG_REGULAR_FILE_BOUND');
  assert.equal(fs.realpathSync(resolved), resolved, 'CONFIG_SYMLINK_PARENT'); return { resolved, stat };
}
export const fileIO = Object.freeze({
  read(file, maximum = 16 * 1024 ** 2) { return fs.readFileSync(regular(file, maximum).resolved); },
  measure(file, maximum) {
    const { resolved, stat } = regular(file, maximum), fd = fs.openSync(resolved, 'r');
    const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 ** 2); let total = 0;
    try {
      for (;;) { const count = fs.readSync(fd, buffer, 0, buffer.length, null); if (!count) break;
        total += count; assert.ok(total <= maximum, 'CONFIG_HASH_FILE_GREW'); digest.update(buffer.subarray(0, count)); }
      const after = fs.fstatSync(fd); assert.equal(after.size, stat.size); assert.equal(total, stat.size);
      assert.equal(after.mtimeMs, stat.mtimeMs); assert.equal(after.ino, stat.ino);
    } finally { fs.closeSync(fd); }
    return { bytes: total, sha256: digest.digest('hex') };
  },
  save(file, config) {
    const resolved = absolute(file); assert.equal(fs.realpathSync(path.dirname(resolved)), path.dirname(resolved));
    const bytes = Buffer.from(JSON.stringify(config, null, 2) + '\n'); assert.ok(bytes.length <= 8 * 1024 ** 2, 'CONFIG_OUTPUT_BOUND');
    fs.writeFileSync(resolved, bytes, { flag: 'wx', mode: 0o600 }); return { bytes: bytes.length, sha256: hash(bytes) };
  },
});
const readJson = (io, file, maximum = 4 * 1024 ** 2) => JSON.parse(io.read(file, maximum).toString('utf8'));
function loadCommon(request, io) {
  const repository = absolute(request.repository), sourceInput = readJson(io, request.sourceInputPath),
    policy = readJson(io, path.join(repository, POLICY_PATH)), compiledArchive = readJson(io, request.compiledReceiptPath);
  outside(request.stageArchivePath, repository); outside(request.stageDirectory, repository);
  const measured = io.measure(request.stageArchivePath, 256 * 1024 ** 2);
  assert.equal(measured.sha256, compiledArchive.archiveSha256, 'CONFIG_STAGE_ARCHIVE_BYTES');
  assert.equal(measured.sha256, compiledArchive.downloadedSha256, 'CONFIG_STAGE_DOWNLOADED_BYTES');
  assert.equal(measured.bytes, compiledArchive.bytes, 'CONFIG_STAGE_ARCHIVE_LENGTH');
  const stage = absolute(request.stageDirectory), members = {};
  for (const key of ['stageReport', 'stageManifest', 'buildProvenance', 'buildLog']) members[key] = io.read(path.join(stage, MEMBER_PATHS[key]));
  members.compiled = Object.fromEntries(COMPILED_PATHS.map(p => [p, io.read(path.join(stage, 'package', p))]));
  // Bind the actual selected stage bytes even before preparation's own verifier.
  const byPath = new Map(compiledArchive.selectedMembers.map(row => [row.path, row]));
  assert.equal(byPath.size, compiledArchive.selectedMembers.length, 'CONFIG_DUPLICATE_STAGE_MEMBER');
  for (const [key, bytes] of Object.entries(members).filter(([key]) => key !== 'compiled'))
    assert.deepEqual(byPath.get(MEMBER_PATHS[key]), { path: MEMBER_PATHS[key], bytes: bytes.length, sha256: hash(bytes) }, 'CONFIG_STAGE_MEMBER');
  for (const [p, bytes] of Object.entries(members.compiled))
    assert.deepEqual(byPath.get(`package/${p}`), { path: `package/${p}`, bytes: bytes.length, sha256: hash(bytes) }, 'CONFIG_STAGE_COMPILED_MEMBER');
  return { repository, sourceInput, policy, compiledArchive, members };
}

/** Requests contain paths, never secret environment dumps or shell command strings. */
export function constructConfig(mode, request, { io = fileIO, createReceipts = createLocalLaunchReceipts } = {}) {
  const common = ['repository', 'sourceInputPath', 'compiledReceiptPath', 'stageArchivePath', 'stageDirectory'];
  if (mode === 'prepare-config') {
    keys(request, [...common, 'python', 'device', 'preparationOutput']);
    const loaded = loadCommon(request, io);
    keys(request.python, ['executable', 'sha256']);
    assert.equal(io.measure(request.python.executable, 256 * 1024 ** 2).sha256, request.python.sha256, 'CONFIG_PYTHON_BYTES');
    const { members, ...base } = loaded;
    return buildPrepareConfig({ ...base, stageArchivePath: request.stageArchivePath,
      buildProvenanceSha256: hash(members.buildProvenance), python: request.python,
      device: request.device, preparationOutput: request.preparationOutput });
  }
  assert.equal(mode, 'run-config', 'CONFIG_EXPLICIT_MODE');
  keys(request, [...common, 'preparationOutput', 'jobName', 'disk', 'device', 'adapterOutput', 'attemptMarker', 'resultPath', 'dockerConfigDirectory']);
  const loaded = loadCommon(request, io), root = outside(request.preparationOutput, loaded.repository);
  const preparationResult = readJson(io, path.join(root, 'trace-preparation-result.json'));
  const selectedMembers = { preparation: [], inputs: [] };
  const localPaths = { preparationReport: 'preparation.json', runtimeManifest: 'public-context/runtime-source-manifest.json',
    insideProof: 'private/runtime-output/inside-proof.json', derivedManifest: 'trace-overlay/derived-manifest.json' };
  for (const [key, name] of Object.entries(localPaths)) {
    const value = io.read(path.join(root, name)); loaded.members[key] = value;
    selectedMembers.preparation.push({ path: MEMBER_PATHS[key], bytes: value.length, sha256: hash(value) });
  }
  const imagePath = path.join(root, 'private/runtime-image.tar');
  selectedMembers.inputs.push({ path: MEMBER_PATHS.image, ...io.measure(imagePath, 3 * 1024 ** 3) });
  selectedMembers.inputs.push({ path: MEMBER_PATHS.seed,
    ...io.measure(path.join(root, 'private/runtime-output/private/seed/accounts.sqlite'), 16 * 1024 ** 2) });
  const driverFiles = ['trace-driver.mjs', 'trace-plan.mjs'].map(name => {
    const source = path.join(loaded.repository, FIXTURE, name);
    return { source, target: `/source/${FIXTURE}/${name}`, sha256: hash(io.read(source)) };
  });
  return buildRunConfig({ ...loaded, jobName: request.jobName, preparationResult, selectedMembers,
    preparationOutput: root, imagePath, disk: request.disk, device: request.device, adapterOutput: request.adapterOutput,
    attemptMarker: request.attemptMarker, resultPath: request.resultPath, dockerConfigDirectory: request.dockerConfigDirectory,
    driverFiles }, { createReceipts });
}

export function main(args = process.argv.slice(2), { io = fileIO } = {}) {
  assert.ok(args.length === 3 && ['prepare-config', 'run-config'].includes(args[0]), 'CONFIG_EXPLICIT_MODE_REQUEST_OUTPUT');
  const request = readJson(io, absolute(args[1])), target = outside(args[2], request.repository);
  assert.notEqual(target, absolute(args[1]), 'CONFIG_INPUT_OUTPUT_COLLISION');
  const config = constructConfig(args[0], request, { io });
  return io.save(target, config);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const saved = main(); process.stdout.write(JSON.stringify({ status: 'CONFIG_WRITTEN', workloadExecuted: false, ...saved }) + '\n'); }
  catch (error) { process.stderr.write(JSON.stringify({ status: 'NOT_RUN', code: /^[A-Z][A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'CONFIG_INVALID' }) + '\n'); process.exitCode = 1; }
}
