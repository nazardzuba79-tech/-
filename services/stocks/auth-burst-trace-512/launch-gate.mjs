// Eligibility only: no process, Docker, network, workload, or production access.
// The CI adapter must independently verify/download artifact members, inspect the
// prepared image, and supply complete GitHub run history under a concurrency lock.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { TRACE_PLAN, tracePlanHash } from './trace-plan.mjs';

export const BASELINE_SHA = 'f045d7255f1195ef3c7b6cca5a5e63f4c851a2a8';
export const FAILURE_BASELINE_SHA = '28e6f3bab18bad777f9b02e31851dfe8874f2b0e';
export const PRIOR_BACKEND_FAILURE = Object.freeze({ status: 'FAIL',
  artifactSHA256: '621f2f054bdf1227cbcdb0f38e1c24296cf28c98c6fa297dcc643894a2c846c2',
  artifactId: 11880028341, runId: 38533286576, jobId: 115752113535 });
export const PRIOR_BROWSER_FAILURE = Object.freeze({ status: 'FAIL',
  artifactSHA256: '5eee6f0a485202ba84f9cf5260f2cd1511f1f66c7dd9ab6eb141ccf9c2888f26',
  artifactId: 11879126370, runId: 38533286576, jobId: 115750950411 });
export const POLICY_PATH = 'services/stocks/auth-burst-trace-512/launch-policy.json';
export const WORKFLOW_PATH = '.github/workflows/stocks-review.yml';
export const ADMISSION_PATH = 'docs/evidence/stocks-auth-lifetime-20261014/reviewed-qa-followup.json';
export const REPOSITORY = 'nazardzuba79-tech/-';
export const HEAD_REF = 'dot/stocks-owner-usdt-portfolio-20261013';
export const BASE_IMAGE = 'docker.io/library/node@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd';
export const DISABLED_POLICY = Object.freeze({ schema: 1, status: 'disabled', reviewId: 'unreviewed' });
export const SELF_BINDINGS = Object.freeze([POLICY_PATH, ADMISSION_PATH]);
export const LIMITS = Object.freeze({ preparationMs: 1500000, startupMs: 30000, runMs: 300000,
  overallMs: 600000, drainMs: 10000, requestMs: 3000, healthMs: 500,
  healthMaximum: 40, healthCadenceMs: 250, warmup: 50, ordinary: 50, bursts: 1,
  variant: 'C', retries: 0, serviceCpuMax: '5000 100000', auxiliaryCpuMax: '50000 100000',
  memory: 268435456, swap: '0', serviceCpu: '0', auxiliaryCpu: '1',
  readBps: 1048576, writeBps: 131072 });
const QA_PATHS = new Set([WORKFLOW_PATH, 'scripts/qa-backend-full-admission.cjs',
  'scripts/qa-backend-full-admission.test.cjs', 'docs/AI_HANDOFF.md',
  'docs/evidence/stocks-auth-lifetime-20261014/FOLLOWUP.md',
  'docs/evidence/stocks-auth-lifetime-20261014/BURST-TRACE.md']);
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[1-9][0-9]{0,19}$/;
const MARKER = /\bAUTH_BURST_POLICY_SHA256: ([a-f0-9]{64})\b/g;
export const hash = value => createHash('sha256').update(value).digest('hex');
const reject = code => { const error = new Error(code); error.code = code; throw error; };
const check = (ok, code) => { if (!ok) reject(code); };
function keys(value, names) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...names].sort()), 'UNKNOWN_OR_MISSING_FIELD');
}
function equal(a, b, code) { check(isDeepStrictEqual(a, b), code); }
function digest(value) { check(typeof value === 'string' && SHA.test(value), 'INVALID_DIGEST'); }
function commit(value) { check(typeof value === 'string' && COMMIT.test(value), 'INVALID_COMMIT'); }
function id(value) { check(typeof value === 'string' && ID.test(value), 'INVALID_ID'); }
function relative(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\\')
    && !value.includes('\0') && !value.startsWith('/') && !value.includes(':')
    && value.split('/').every(x => x && x !== '.' && x !== '..'), 'INVALID_PATH');
}
const canonical = value => JSON.stringify(value);
const comparePaths = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export function parseTree(bytes) {
  const rows = String(bytes).split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    check(Boolean(match), 'NON_REGULAR_TREE_ENTRY');
    relative(match[3]); return { path: match[3], mode: match[1], blob: match[2] };
  }).sort(comparePaths);
  check(rows.length > 0 && rows.length <= 100000 && new Set(rows.map(x => x.path)).size === rows.length,
    'INVALID_TREE');
  return rows;
}
export function normalizedWorkflow(bytes) {
  const text = String(bytes), matches = [...text.matchAll(MARKER)];
  check(matches.length === 1, 'POLICY_DIGEST_LITERAL_COUNT');
  return { declaredPolicySha256: matches[0][1],
    sha256: hash(text.replace(MARKER, 'AUTH_BURST_POLICY_SHA256: <reviewed-policy-digest>')) };
}
export function canonicalTree(rows, workflowSha256) {
  digest(workflowSha256);
  return rows.filter(row => !SELF_BINDINGS.includes(row.path)).map(row => row.path === WORKFLOW_PATH
    ? { path: row.path, mode: row.mode, normalizedSha256: workflowSha256 } : row);
}
export function treeDelta(baselineRows, currentRows) {
  const before = new Map(baselineRows.map(x => [x.path, x]));
  const after = new Map(currentRows.map(x => [x.path, x]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().filter(path =>
    !SELF_BINDINGS.includes(path) && !isDeepStrictEqual(before.get(path), after.get(path)))
    .map(path => ({ path, before: before.get(path) ?? null, after: after.get(path) ?? null }));
}
export function financialRows(rows) {
  // All product paths are also forbidden in the delta; these explicit blobs make
  // the financial/auth/SQLite contract reviewable without trusting a changed flag.
  return rows.filter(row => row.path.startsWith('services/stocks-global/'));
}
function allowedQa(path) {
  return QA_PATHS.has(path) || (path.startsWith('services/stocks/auth-burst-trace-512/')
    && /\.(?:mjs|json|md)$/.test(path) && !SELF_BINDINGS.includes(path));
}
export function admissionClassification(path) {
  if (path === WORKFLOW_PATH) return 'workflow-control';
  if (path === 'scripts/qa-backend-full-admission.cjs' || path === 'scripts/qa-backend-full-admission.test.cjs') return 'admission-control';
  if (path === 'docs/AI_HANDOFF.md') return 'append-only-handoff';
  if (path === 'services/stocks/auth-http-fixture-512/cancellation-barrier.test.mjs') return 'auth-fixture-test';
  if (path === POLICY_PATH || (allowedQa(path) && path.startsWith('services/stocks/auth-burst-trace-512/'))) return 'auth-burst-trace-fixture';
  if (QA_PATHS.has(path) && path.startsWith('docs/')) return 'documentation';
  reject('ADMISSION_UNKNOWN_PATH');
}
function validateAdmission(bytes, policy, before, current, read, headSha) {
  const manifest = JSON.parse(String(bytes));
  keys(manifest, ['schemaVersion', 'reviewId', 'baselineSHA', 'priorFailure', 'priorBrowserFailure', 'manifestPath', 'files']);
  equal(manifest.schemaVersion, 2, 'ADMISSION_SCHEMA');
  equal(manifest.reviewId, policy.admissionReviewId, 'ADMISSION_REVIEW_ID');
  equal(manifest.baselineSHA, FAILURE_BASELINE_SHA, 'ADMISSION_BASELINE');
  equal(manifest.priorFailure, PRIOR_BACKEND_FAILURE, 'BACKEND_FAIL_EVIDENCE_CHANGED');
  equal(manifest.priorBrowserFailure, PRIOR_BROWSER_FAILURE, 'BROWSER_FAIL_EVIDENCE_CHANGED');
  equal(manifest.manifestPath, ADMISSION_PATH, 'ADMISSION_MANIFEST_PATH');
  check(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 100, 'ADMISSION_FILE_COUNT');
  const oldRows = new Map(before.map(row => [row.path, row]));
  const newRows = new Map(current.map(row => [row.path, row]));
  const paths = [...new Set([...oldRows.keys(), ...newRows.keys()])].sort()
    .filter(path => path !== ADMISSION_PATH && !isDeepStrictEqual(oldRows.get(path), newRows.get(path)));
  equal(manifest.files.map(row => row.path).sort(), paths, 'ADMISSION_EXACT_PATHS');
  for (const row of manifest.files) {
    keys(row, ['path', 'classification', 'baseSHA256', 'headSHA256']);
    relative(row.path); equal(row.classification, admissionClassification(row.path), 'ADMISSION_CLASSIFICATION');
    check(newRows.has(row.path), 'ADMISSION_DELETION');
    equal(row.baseSHA256, oldRows.has(row.path) ? hash(read(FAILURE_BASELINE_SHA, row.path)) : null, 'ADMISSION_BASE_BYTES');
    equal(row.headSHA256, hash(read(headSha, row.path)), 'ADMISSION_HEAD_BYTES');
  }
}
function validatePolicy(policy) {
  keys(policy, ['schema', 'status', 'reviewId', 'admissionReviewId', 'baselineSha', 'frozenSourceSha', 'sourceTreeSha256',
    'workflowTemplateSha256', 'reviewedDelta', 'financialRuntime', 'planSha256', 'limits', 'native']);
  equal(policy.schema, 1, 'POLICY_SCHEMA'); equal(policy.status, 'reviewed', 'POLICY_NOT_REVIEWED');
  check(typeof policy.reviewId === 'string' && /^stocks-one-burst-512-[a-z0-9-]{1,80}$/.test(policy.reviewId), 'REVIEW_ID');
  check(typeof policy.admissionReviewId === 'string' && /^[a-z0-9][a-z0-9-]{1,120}$/.test(policy.admissionReviewId), 'ADMISSION_REVIEW_ID');
  equal(policy.baselineSha, BASELINE_SHA, 'BASELINE_CHANGED'); commit(policy.frozenSourceSha);
  check(policy.frozenSourceSha !== BASELINE_SHA, 'SOURCE_NOT_FROZEN');
  for (const key of ['sourceTreeSha256', 'workflowTemplateSha256', 'planSha256']) digest(policy[key]);
  equal(policy.planSha256, tracePlanHash(), 'PLAN_CHANGED'); equal(policy.limits, LIMITS, 'LIMITS_CHANGED');
  check(Array.isArray(policy.reviewedDelta) && policy.reviewedDelta.length > 0 && policy.reviewedDelta.length <= 100,
    'INVALID_REVIEWED_DELTA');
  check(Array.isArray(policy.financialRuntime) && policy.financialRuntime.length > 0, 'MISSING_FINANCIAL_BINDING');
  keys(policy.native, ['nodeVersion', 'nodeSha256', 'bcryptSha256', 'nativeFilesSha256',
    'dependencyInventorySha256', 'compiledClosureSha256', 'baseImage']);
  check(/^v24\.[0-9]+\.[0-9]+$/.test(policy.native.nodeVersion), 'NODE_VERSION');
  for (const key of ['nodeSha256', 'bcryptSha256', 'nativeFilesSha256', 'dependencyInventorySha256',
    'compiledClosureSha256']) digest(policy.native[key]);
  equal(policy.native.baseImage, BASE_IMAGE, 'BASE_IMAGE_UNPINNED');
}
function receipt(row, role, event) {
  keys(row, ['artifactId', 'runId', 'sourceSha', 'archiveSha256', 'downloadedSha256', 'bytes',
    'proofSha256', 'proofText']);
  id(row.artifactId); id(row.runId); equal(row.runId, event.runId, 'ARTIFACT_RUN_MISMATCH');
  equal(row.sourceSha, event.headSha, 'ARTIFACT_HEAD_MISMATCH');
  for (const key of ['archiveSha256', 'downloadedSha256', 'proofSha256']) digest(row[key]);
  equal(row.archiveSha256, row.downloadedSha256, 'ARCHIVE_DIGEST_MISMATCH');
  check(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 3 * 1024 ** 3, 'ARCHIVE_SIZE');
  check(typeof row.proofText === 'string' && Buffer.byteLength(row.proofText) <= 1024 * 1024, 'PROOF_SIZE');
  equal(hash(row.proofText), row.proofSha256, 'PROOF_DIGEST_MISMATCH');
  const proof = JSON.parse(row.proofText);
  equal(proof.schema, `stocks-one-burst-${role}-512-v1`, 'PROOF_SCHEMA');
  equal(proof.sourceSha, event.headSha, 'PROOF_HEAD_MISMATCH');
  return proof;
}
function validateArtifacts(artifacts, policy, event) {
  keys(artifacts, ['compiled', 'preparation', 'inputs']);
  const compiled = receipt(artifacts.compiled, 'compiled', event);
  const prep = receipt(artifacts.preparation, 'preparation', event);
  const inputs = receipt(artifacts.inputs, 'inputs', event);
  check(new Set(Object.values(artifacts).map(x => x.artifactId)).size === 3, 'ARTIFACT_ID_REUSED');
  return { ...bindProofs(compiled, prep, inputs, policy, artifacts.compiled),
    artifactIds: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.artifactId])) };
}
function bindProofs(compiled, prep, inputs, policy, compiledReceipt) {
  keys(compiled, ['schema', 'sourceSha', 'sourceTreeSha256', 'closureSha256', 'buildProvenanceSha256']);
  keys(prep, ['schema', 'sourceSha', 'sourceTreeSha256', 'compiledArtifactId', 'compiledArchiveSha256',
    'buildProvenanceSha256', 'closureSha256', 'imageId', 'imageArchiveSha256', 'native',
    'sourceContextSha256', 'seedSha256', 'derivedManifestSha256']);
  keys(inputs, ['schema', 'sourceSha', 'sourceTreeSha256', 'imageId', 'imageArchiveSha256',
    'seedSha256', 'sourceContextSha256', 'derivedManifestSha256']);
  for (const proof of [compiled, prep, inputs]) equal(proof.sourceTreeSha256, policy.sourceTreeSha256, 'ARTIFACT_SOURCE_DRIFT');
  equal(compiled.closureSha256, policy.native.compiledClosureSha256, 'COMPILED_CLOSURE_DRIFT');
  equal(prep.closureSha256, compiled.closureSha256, 'PREPARATION_COMPILED_DRIFT');
  digest(compiled.buildProvenanceSha256);
  equal(prep.buildProvenanceSha256, compiled.buildProvenanceSha256, 'PROVENANCE_DRIFT');
  equal(prep.compiledArtifactId, compiledReceipt.artifactId, 'PREPARATION_ARTIFACT_ID');
  equal(prep.compiledArchiveSha256, compiledReceipt.archiveSha256, 'PREPARATION_ARCHIVE_DRIFT');
  equal(prep.native, policy.native, 'NATIVE_RUNTIME_DRIFT');
  check(/^sha256:[a-f0-9]{64}$/.test(prep.imageId), 'IMAGE_ID');
  for (const field of ['imageArchiveSha256', 'seedSha256', 'sourceContextSha256', 'derivedManifestSha256']) digest(prep[field]);
  for (const field of ['imageId', 'imageArchiveSha256', 'seedSha256', 'sourceContextSha256', 'derivedManifestSha256'])
    equal(inputs[field], prep[field], 'INPUT_IMAGE_OR_NATIVE_PROOF_DRIFT');
  return { imageId: prep.imageId, sourceContextSha256: prep.sourceContextSha256,
    derivedManifestSha256: prep.derivedManifestSha256, seedSha256: prep.seedSha256 };
}
const LOCAL_PATHS = Object.freeze({ preparation: [
  'stocks-auth-preparation-output/preparation.json',
  'stocks-auth-preparation-output/public-context/runtime-source-manifest.json',
  'stocks-auth-preparation-output/private/runtime-output/inside-proof.json',
  'stocks-auth-preparation-output/trace-overlay/derived-manifest.json',
], inputs: ['runtime-image.tar', 'runtime-output/private/seed/accounts.sqlite'] });
function localReceipt(row, role, event, jobName) {
  keys(row, ['kind', 'runId', 'jobName', 'sourceSha', 'files', 'proofSha256', 'proofText']);
  equal(row.kind, 'local', 'LOCAL_RECEIPT_KIND'); id(row.runId);
  equal(row.runId, event.runId, 'LOCAL_RUN_MISMATCH'); equal(row.jobName, jobName, 'LOCAL_JOB_MISMATCH');
  equal(row.sourceSha, event.headSha, 'LOCAL_HEAD_MISMATCH'); digest(row.proofSha256);
  check(Array.isArray(row.files), 'LOCAL_FILES');
  equal(row.files.map(file => file.path).sort(), [...LOCAL_PATHS[role]].sort(), 'LOCAL_EXACT_PATHS');
  for (const file of row.files) {
    keys(file, ['path', 'bytes', 'sha256']); relative(file.path); digest(file.sha256);
    check(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= (role === 'inputs' ? 3 * 1024 ** 3 : 16 * 1024 ** 2), 'LOCAL_FILE_SIZE');
  }
  check(typeof row.proofText === 'string' && Buffer.byteLength(row.proofText) <= 1024 * 1024, 'LOCAL_PROOF_SIZE');
  equal(hash(row.proofText), row.proofSha256, 'LOCAL_PROOF_DIGEST');
  const proof = JSON.parse(row.proofText);
  equal(proof.schema, `stocks-one-burst-${role}-local-512-v1`, 'LOCAL_PROOF_SCHEMA');
  equal(proof.sourceSha, event.headSha, 'LOCAL_PROOF_HEAD');
  equal(proof.filesSha256, hash(JSON.stringify(row.files)), 'LOCAL_FILES_DIGEST');
  delete proof.filesSha256;
  return proof;
}
function validateLocalArtifacts(artifacts, policy, event, jobName) {
  check(typeof jobName === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(jobName), 'LOCAL_JOB_NAME');
  keys(artifacts, ['compiled', 'preparation', 'inputs']);
  const compiled = receipt(artifacts.compiled, 'compiled', event);
  const prep = localReceipt(artifacts.preparation, 'preparation', event, jobName);
  const inputs = localReceipt(artifacts.inputs, 'inputs', event, jobName);
  const result = bindProofs(compiled, prep, inputs, policy, artifacts.compiled);
  const files = new Map(artifacts.inputs.files.map(file => [file.path, file]));
  equal(files.get('runtime-image.tar').sha256, prep.imageArchiveSha256, 'LOCAL_IMAGE_FILE_DIGEST');
  equal(files.get('runtime-output/private/seed/accounts.sqlite').sha256, prep.seedSha256, 'LOCAL_SEED_FILE_DIGEST');
  const derived = artifacts.preparation.files.find(file => file.path.endsWith('/trace-overlay/derived-manifest.json'));
  equal(derived.sha256, prep.derivedManifestSha256, 'LOCAL_DERIVED_FILE_DIGEST');
  return { ...result, receiptKind: 'LOCAL_SAME_JOB', jobName,
    compiledArtifactId: artifacts.compiled.artifactId,
    localFileBindings: { preparation: artifacts.preparation.files, inputs: artifacts.inputs.files } };
}

/**
 * git(args) is a synchronous READ-ONLY adapter returning stdout bytes, throwing on
 * failure. Only rev-parse, merge-base, ls-tree and cat-file are requested here.
 * Event and history must come from GitHub, never workflow_dispatch user inputs.
 * Artifact receipts/proof members must come from the verified download adapter;
 * matching these metadata is not a substitute for inspecting archive/image bytes.
 * A successful result authorizes exactly this diagnostic, not backend/browser or
 * capacity acceptance. Their existing FAIL evidence must remain unchanged.
 */
function validate(input, policy, { git } = {}, mode = 'remote') {
  const result = { schema: 1, eligible: false, preparationEligible: false, status: 'NOT_RUN', releaseGatePass: false,
    capacityAcceptance: 'NOT_EVALUATED', backendStatus: 'PRIOR_FAIL_RETAINED', browserStatus: 'PRIOR_FAIL_RETAINED' };
  try {
    if (isDeepStrictEqual(policy, DISABLED_POLICY)) return { ...result, reason: 'POLICY_DISABLED' };
    validatePolicy(policy);
    keys(input, mode === 'prepare' ? ['event', 'approvedPolicySha256', 'history']
      : mode === 'local' ? ['event', 'approvedPolicySha256', 'history', 'artifacts', 'jobName']
        : ['event', 'approvedPolicySha256', 'history', 'artifacts']);
    digest(input.approvedPolicySha256);
    const event = input.event;
    keys(event, ['eventName', 'action', 'repository', 'number', 'headRepository', 'baseRepository',
      'headRef', 'headSha', 'beforeSha', 'runId', 'runAttempt', 'workflowPath']);
    check(event.eventName === 'pull_request' && event.action === 'synchronize', 'EVENT_NOT_SYNCHRONIZE');
    check(event.repository === REPOSITORY && event.headRepository === REPOSITORY
      && event.baseRepository === REPOSITORY && event.number === 512 && event.headRef === HEAD_REF,
    'PR_SCOPE_MISMATCH');
    equal(event.workflowPath, WORKFLOW_PATH, 'WORKFLOW_MISMATCH');
    equal(event.runAttempt, 1, 'REPLAY_ATTEMPT'); id(event.runId); commit(event.headSha); commit(event.beforeSha);
    equal(event.beforeSha, policy.frozenSourceSha, 'TRANSITION_NOT_FROZEN_SOURCE');
    check(event.headSha !== event.beforeSha, 'NO_POLICY_TRANSITION');
    keys(input.history, ['workflowPath', 'headSha', 'complete', 'runIds']);
    equal(input.history.workflowPath, WORKFLOW_PATH, 'HISTORY_WORKFLOW');
    equal(input.history.headSha, event.headSha, 'HISTORY_HEAD');
    equal(input.history.complete, true, 'INCOMPLETE_RUN_HISTORY');
    equal(input.history.runIds, [event.runId], 'REPLAY_OR_DUPLICATE_RUN');
    check(typeof git === 'function', 'GIT_ADAPTER_MISSING');
    equal(String(git(['rev-parse', 'HEAD'])).trim(), event.headSha, 'CHECKOUT_HEAD_MISMATCH');
    equal(String(git(['merge-base', BASELINE_SHA, event.headSha])).trim(), BASELINE_SHA, 'BASELINE_NOT_ANCESTOR');
    equal(String(git(['merge-base', event.beforeSha, event.headSha])).trim(), event.beforeSha, 'FROZEN_SOURCE_NOT_ANCESTOR');
    const read = (ref, path) => git(['cat-file', 'blob', `${ref}:${path}`]);
    const currentPolicy = read(event.headSha, POLICY_PATH);
    equal(hash(currentPolicy), input.approvedPolicySha256, 'POLICY_BYTES_NOT_APPROVED');
    equal(JSON.parse(String(currentPolicy)), policy, 'POLICY_INPUT_DRIFT');
    equal(JSON.parse(String(read(event.beforeSha, POLICY_PATH))), DISABLED_POLICY, 'POLICY_ALREADY_REVIEWED');
    const currentWorkflow = normalizedWorkflow(read(event.headSha, WORKFLOW_PATH));
    const priorWorkflow = normalizedWorkflow(read(event.beforeSha, WORKFLOW_PATH));
    equal(currentWorkflow.declaredPolicySha256, input.approvedPolicySha256, 'WORKFLOW_POLICY_DIGEST');
    equal(currentWorkflow.sha256, policy.workflowTemplateSha256, 'WORKFLOW_TEMPLATE_DRIFT');
    equal(priorWorkflow.sha256, currentWorkflow.sha256, 'WORKFLOW_CHANGED_AFTER_FREEZE');
    const trees = [BASELINE_SHA, event.beforeSha, event.headSha].map(ref => parseTree(git(['ls-tree', '-rz', '--full-tree', ref])));
    const [baseline, prior, current] = trees;
    equal(canonicalTree(current, currentWorkflow.sha256), canonicalTree(prior, priorWorkflow.sha256), 'SOURCE_CHANGED_AFTER_FREEZE');
    equal(hash(canonical(canonicalTree(current, currentWorkflow.sha256))), policy.sourceTreeSha256, 'SOURCE_TREE_NOT_REVIEWED');
    const delta = treeDelta(baseline, current).filter(row => row.path !== WORKFLOW_PATH);
    for (const row of delta) check(allowedQa(row.path) && row.after !== null, 'PROTECTED_OR_UNKNOWN_PATH_CHANGE');
    equal(delta, policy.reviewedDelta, 'REVIEWED_DELTA_DRIFT');
    equal(financialRows(current), financialRows(baseline), 'FINANCIAL_RUNTIME_CHANGED');
    equal(policy.financialRuntime, financialRows(baseline), 'FINANCIAL_BINDING_DRIFT');
    const failureTree = parseTree(git(['ls-tree', '-rz', '--full-tree', FAILURE_BASELINE_SHA]));
    validateAdmission(read(event.headSha, ADMISSION_PATH), policy, failureTree, current, read, event.headSha);
    const handoff = delta.find(row => row.path === 'docs/AI_HANDOFF.md');
    if (handoff?.before) check(String(read(event.headSha, handoff.path)).startsWith(String(read(BASELINE_SHA, handoff.path))), 'HANDOFF_NOT_APPEND_ONLY');
    // Validate imported plan bounds as well as the reviewed policy's literal limits.
    equal(TRACE_PLAN.counts.ordinary, 50, 'PLAN_ORDINARY_COUNT'); equal(TRACE_PLAN.counts.bursts, 1, 'PLAN_BURST_COUNT');
    equal(TRACE_PLAN.bounds.totalMs, LIMITS.overallMs, 'PLAN_OVERALL_BOUND');
    const binding = {
      sourceSha: event.headSha, frozenSourceSha: event.beforeSha, runId: event.runId,
      reviewId: policy.reviewId, policySha256: input.approvedPolicySha256,
      planSha256: policy.planSha256, sourceTreeSha256: policy.sourceTreeSha256, limits: LIMITS };
    if (mode === 'prepare') return { ...result, ...binding, preparationEligible: true,
      status: 'PREPARATION_ELIGIBLE', reason: 'EXACT_SOURCE_ONLY_NO_WORKLOAD_PERMISSION' };
    const artifacts = mode === 'local' ? validateLocalArtifacts(input.artifacts, policy, event, input.jobName)
      : validateArtifacts(input.artifacts, policy, event);
    return { ...result, ...binding, ...artifacts, preparationEligible: true, eligible: true,
      status: 'ELIGIBLE', reason: 'EXACT_REVIEWED_TRANSITION' };
  } catch (error) {
    // Never copy arbitrary git/parser messages, paths, credentials or proof text.
    return { ...result, reason: /^[A-Z][A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'INVALID_OR_MISSING_INPUT' };
  }
}

// No artifact fields are accepted here: source approval cannot claim an image or
// compiled artifact already exists. The bounded preparation job uses this first.
export function validatePreparationSource(input, policy, options) {
  return validate(input, policy, options, 'prepare');
}
export function validateLaunch(input, policy, options) {
  return validate(input, policy, options, 'remote');
}
export function validateLocalLaunch(input, policy, options) {
  return validate(input, policy, options, 'local');
}
