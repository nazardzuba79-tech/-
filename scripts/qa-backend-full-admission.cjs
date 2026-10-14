'use strict';
// QA scheduling only. Prior full-backend FAIL remains FAIL; NOT_RUN is never PASS.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const BASELINE_SHA = '28e6f3bab18bad777f9b02e31851dfe8874f2b0e';
const PRIOR_FAILURE = Object.freeze({ status: 'FAIL', artifactSHA256: '621f2f054bdf1227cbcdb0f38e1c24296cf28c98c6fa297dcc643894a2c846c2', artifactId: 11880028341, runId: 38533286576, jobId: 115752113535 });
const PRIOR_BROWSER_FAILURE = Object.freeze({ status: 'FAIL', artifactSHA256: '5eee6f0a485202ba84f9cf5260f2cd1511f1f66c7dd9ab6eb141ccf9c2888f26', artifactId: 11879126370, runId: 38533286576, jobId: 115750950411 });
const REVIEW_ID = 'stocks-auth-lifetime-28e6f3ba-20261014-v1';
const MANIFEST_PATH = 'docs/evidence/stocks-auth-lifetime-20261014/reviewed-qa-followup.json';
const REPOSITORY = 'nazardzuba79-tech/-';
const BRANCH = 'dot/stocks-owner-usdt-portfolio-20261013';
const ALLOWED_PATHS = Object.freeze({
  'services/stocks/auth-burst-trace-512/README.md': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/adapter.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/adapter.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/analyze.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/analyze.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/build-overlay.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/build-overlay.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/closure.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/environment-data.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/image-lease.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/image-lease.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/instrument.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/instrument.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/launch-gate.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/launch-gate.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/launch-policy.json': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/launcher.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/launcher.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/prepare-receipts.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/prepare-receipts.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/proxy-correlation.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/recorder.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/service-overlay.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/service-overlay.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/sources.json': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/trace-driver.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/trace-plan.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/trace-run.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/trace-run.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/workflow-config.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/workflow-config.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/workflow-source.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/workflow-source.test.mjs': 'auth-burst-trace-fixture',
  'services/stocks/auth-burst-trace-512/workflow.test.mjs': 'auth-burst-trace-fixture',
  'docs/evidence/stocks-auth-lifetime-20261014/BURST-TRACE.md': 'documentation',
  'scripts/qa-backend-full-admission.cjs': 'admission-control',
  'scripts/qa-backend-full-admission.test.cjs': 'admission-control',
  '.github/workflows/stocks-review.yml': 'workflow-control',
  'services/stocks/auth-http-fixture-512/cancellation-barrier.test.mjs': 'auth-fixture-test',
  'docs/AI_HANDOFF.md': 'append-only-handoff',
  'docs/evidence/stocks-auth-lifetime-20261014/FOLLOWUP.md': 'documentation',
});
const PROTECTED_HELPERS = Object.freeze(['scripts/qa-backend-full-offline.cjs', 'scripts/qa-backend-full-offline.test.cjs']);
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
function safePath(p) {
  assert.ok(typeof p === 'string' && p && !/[\x00-\x1f\x7f\\:]/.test(p) && !path.posix.isAbsolute(p));
  assert.ok(p.split('/').every(x => x && x !== '.' && x !== '..'));
  return p;
}
function exactKeys(value, keys) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), keys.sort());
}
function validateManifest(m) {
  exactKeys(m, ['schemaVersion', 'reviewId', 'baselineSHA', 'priorFailure', 'priorBrowserFailure', 'manifestPath', 'files']);
  assert.equal(m.schemaVersion, 2); assert.equal(m.reviewId, REVIEW_ID);
  assert.equal(m.baselineSHA, BASELINE_SHA); assert.deepEqual(m.priorFailure, PRIOR_FAILURE);
  assert.deepEqual(m.priorBrowserFailure, PRIOR_BROWSER_FAILURE);
  assert.equal(m.manifestPath, MANIFEST_PATH); assert.ok(Array.isArray(m.files) && m.files.length <= 128);
  const byPath = new Map();
  for (const f of m.files) {
    exactKeys(f, ['path', 'classification', 'baseSHA256', 'headSHA256']); safePath(f.path);
    assert.ok(!byPath.has(f.path), 'duplicate reviewed path');
    assert.ok(Object.hasOwn(ALLOWED_PATHS, f.path), 'unknown reviewed path');
    assert.equal(f.classification, ALLOWED_PATHS[f.path]);
    assert.ok(f.baseSHA256 === null || HASH.test(f.baseSHA256));
    assert.ok(f.headSHA256 === null || HASH.test(f.headSHA256));
    assert.ok(f.baseSHA256 !== f.headSHA256, 'review must bind a changed path');
    byPath.set(f.path, f);
  }
  return byPath;
}
function validateScope(scope, head) {
  exactKeys(scope, ['eventName', 'repository', 'number', 'headRepository', 'headRef', 'headSHA']);
  assert.equal(scope.eventName, 'pull_request'); assert.equal(scope.repository, REPOSITORY);
  assert.equal(scope.number, 512); assert.equal(scope.headRepository, REPOSITORY);
  assert.equal(scope.headRef, BRANCH); assert.equal(scope.headSHA, head);
}
function readScope(env = process.env) {
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  return { eventName: env.GITHUB_EVENT_NAME, repository: env.GITHUB_REPOSITORY, number: event.pull_request?.number,
    headRepository: event.pull_request?.head?.repo?.full_name, headRef: event.pull_request?.head?.ref,
    headSHA: event.pull_request?.head?.sha };
}
function decide({ base, head, manifest, changes, scope }) {
  const report = { schemaVersion: 2, mode: 'full', browserMode: 'run', comparedSHAs: { base: base || null, head: head || null }, priorFailure: { baselineSHA: BASELINE_SHA, ...PRIOR_FAILURE }, priorBrowserFailure: { baselineSHA: BASELINE_SHA, ...PRIOR_BROWSER_FAILURE }, previousFailurePreserved: true, previousBrowserFailurePreserved: true, releaseGatePass: false, currentFullBackendResult: 'NOT_RUN', currentBrowserResult: 'NOT_RUN', changedPaths: [], reason: null, reviewId: null, manifestIsCryptographicSignature: false };
  try {
    assert.ok(SHA.test(base || '') && SHA.test(head || ''), 'exact Git SHAs required');
    assert.equal(base, BASELINE_SHA, 'unknown backend baseline');
    validateScope(scope, head);
    assert.ok(Array.isArray(changes) && changes.length <= 128, 'change inventory unavailable or excessive');
    report.changedPaths = changes.map(c => safePath(c.path));
    assert.equal(new Set(report.changedPaths).size, changes.length, 'duplicate changed path');
    // No wildcard skip. Only the named fixture-test followup can be reviewed;
    // runtime, other tests, locks, schema and build prerequisites require full.
    for (const c of changes) {
      if (PROTECTED_HELPERS.includes(c.path)) { report.reason = 'BACKEND_HELPER_OR_PREREQUISITE_CHANGED'; return report; }
      if (c.path === 'docs/AI_HANDOFF.md') assert.equal(c.appendOnly, true, 'handoff must preserve the exact prior prefix');
      if (c.path !== MANIFEST_PATH && !Object.hasOwn(ALLOWED_PATHS, c.path)) { report.reason = 'UNREVIEWABLE_OR_PROTECTED_PATH'; return report; }
      assert.ok([null, '100644', '100755'].includes(c.baseMode) && [null, '100644', '100755'].includes(c.headMode), 'non-regular Git object');
      assert.ok(c.baseSHA256 === null || HASH.test(c.baseSHA256));
      assert.ok(c.headSHA256 === null || HASH.test(c.headSHA256));
      assert.equal(c.baseMode === null, c.baseSHA256 === null); assert.equal(c.headMode === null, c.headSHA256 === null);
      assert.ok(c.baseMode === null || c.headMode === null || c.baseMode === c.headMode, 'file mode change');
    }
    const reviewed = validateManifest(manifest); report.reviewId = manifest.reviewId;
    const expected = changes.filter(c => c.path !== MANIFEST_PATH);
    assert.deepEqual([...reviewed.keys()].sort(), expected.map(c => c.path).sort(), 'reviewed paths do not exactly match Git diff');
    for (const c of expected) {
      const f = reviewed.get(c.path);
      assert.equal(c.baseSHA256, f.baseSHA256, 'reviewed base bytes mismatch: ' + c.path);
      assert.equal(c.headSHA256, f.headSHA256, 'reviewed head bytes mismatch: ' + c.path);
    }
    report.mode = 'not_run'; report.browserMode = 'not_run'; report.reason = 'EXACT_REVIEWED_QA_ONLY_FOLLOWUP';
    report.note = 'Full backend and browser intentionally NOT_RUN only for these exact reviewed PR512 QA-only bytes. The completed 28e6f3ba backend/browser remain FAIL; older a9d5/03bd/0dd failure evidence is retained. Frontend, isolated tests and release gates are unchanged.';
  } catch (e) { report.reason = 'ADMISSION_NOT_PROVEN'; report.error = String(e.message).slice(0, 2000); }
  return report;
}
function collectGit({ root, base, head, manifestPath, run = (args) => cp.spawnSync('git', args, { cwd: root, encoding: null, timeout: 30000, maxBuffer: 64 * 1024 ** 2, windowsHide: true }) }) {
  assert.ok(SHA.test(base || '') && SHA.test(head || '')); assert.equal(base, BASELINE_SHA); assert.equal(manifestPath, MANIFEST_PATH);
  const git = args => { const r = run(args); assert.ok(!r.error && r.status === 0, 'Git verification unavailable: ' + args[0]); return Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout || ''); };
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), head, 'checkout differs from requested head');
  git(['merge-base', '--is-ancestor', base, head]);
  const paths = git(['diff', '--name-only', '--no-renames', '-z', base, head, '--']).toString().split('\0').filter(Boolean).map(safePath);
  assert.ok(paths.length <= 128);
  const blob = (rev, f) => {
    const record = git(['ls-tree', '-z', rev, '--', f]).toString();
    if (!record) return { mode: null, bytes: null, hash: null };
    const m = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(record);
    assert.ok(m && m[3] === f, 'non-regular or ambiguous Git path');
    const bytes = git(['cat-file', 'blob', m[2]]); assert.ok(bytes.length <= 32 * 1024 ** 2, 'review blob too large');
    return { mode: m[1], bytes, hash: sha256(bytes) };
  };
  const changes = paths.map(f => { const a = blob(base, f), b = blob(head, f); return { path: f, baseMode: a.mode, headMode: b.mode, baseSHA256: a.hash, headSHA256: b.hash,
    ...(f === 'docs/AI_HANDOFF.md' ? { appendOnly: Boolean(a.bytes && b.bytes && b.bytes.length > a.bytes.length && b.bytes.subarray(0, a.bytes.length).equals(a.bytes)) } : {}) }; });
  const review = blob(head, MANIFEST_PATH); assert.ok(review.bytes && review.bytes.length <= 256 * 1024, 'frozen review manifest unavailable');
  return { base, head, changes, manifest: JSON.parse(review.bytes.toString()) };
}
function main(argv = process.argv.slice(2), root = path.resolve(__dirname, '..')) {
  let base = null, head = null, report;
  try {
    assert.equal(argv.length, 6, 'usage: --base <sha> --head <sha> --manifest <repository-relative-path>');
    const option = key => { const i = argv.indexOf(key); assert.ok(i >= 0 && argv[i + 1]); return argv[i + 1]; };
    base = option('--base'); head = option('--head');
    report = decide({ ...collectGit({ root, base, head, manifestPath: option('--manifest') }), scope: readScope() });
  } catch (e) {
    report = decide({ base, head, changes: [], manifest: null });
    report.mode = 'full'; report.reason = 'GIT_OR_INPUT_NOT_PROVEN'; report.error = String(e.message).slice(0, 2000);
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}
module.exports = { BASELINE_SHA, PRIOR_FAILURE, PRIOR_BROWSER_FAILURE, REVIEW_ID, MANIFEST_PATH, REPOSITORY, BRANCH, ALLOWED_PATHS, PROTECTED_HELPERS, decide, validateManifest, validateScope, readScope, collectGit, main };
if (require.main === module) main();
