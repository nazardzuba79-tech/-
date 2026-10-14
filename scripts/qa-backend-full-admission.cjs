'use strict';
// QA scheduling only. Prior full-backend FAIL remains FAIL; NOT_RUN is never PASS.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const BASELINE_SHA = '0dd1c1d5edf51593ef28896bfee4af8ed9e56b26';
const PRIOR_FAILURE = Object.freeze({ status: 'FAIL', artifactSHA256: '034d6da0590dcda83e155c6d680022a7258d33970cac78a28806a11dc6938c63', runId: 38507741590, jobId: 115669010443 });
const REVIEW_ID = 'stocks-qa-followup-0dd1c1d5-20261014-v1';
const MANIFEST_PATH = 'docs/evidence/stocks-contract-proofs-20261014/backend-full/admission-review.json';
const ALLOWED_PATHS = Object.freeze({
  'scripts/qa-backend-full-offline.cjs': 'report-only',
  'scripts/qa-backend-full-offline.test.cjs': 'report-only',
  'scripts/qa-backend-full-admission.cjs': 'admission-control',
  'scripts/qa-backend-full-admission.test.cjs': 'admission-control',
  '.github/workflows/stocks-review.yml': 'workflow-control',
  'services/stocks/auth-http-fixture-512/authority-entry.cjs': 'auth-fixture',
  'services/stocks/auth-http-fixture-512/authority.cjs': 'auth-fixture',
  'services/stocks/auth-http-fixture-512/plan.mjs': 'auth-fixture',
  'services/stocks/auth-http-fixture-512/probe.mjs': 'auth-fixture',
  'services/stocks/auth-http-fixture-512/stock-child.mjs': 'auth-fixture',
  'services/stocks/auth-http-fixture-512/authority.test.cjs': 'auth-fixture',
  'services/stocks/auth-http-fixture-512/fixture.test.mjs': 'auth-fixture',
  'services/stocks/auth-http-fixture-512/run.mjs': 'auth-fixture',
  'services/stocks/auth-http-fixture-512/Dockerfile': 'auth-fixture',
  'services/stocks/auth-http-fixture-512/README.md': 'documentation',
  'docs/evidence/stocks-contract-proofs-20261014/backend-full/README.md': 'documentation',
  'docs/evidence/stocks-contract-proofs-20261014/backend-full/offline-helper-guards.txt': 'raw-evidence',
  'docs/evidence/stocks-contract-proofs-20261014/backend-full/offline-helper-source-manifest.json': 'raw-evidence',
  'docs/evidence/stocks-contract-proofs-20261014/backend-full/windows-r1-incomplete.json': 'raw-evidence',
  'docs/evidence/stocks-contract-proofs-20261014/backend-full/linux-0dd-result.json': 'raw-evidence',
  'docs/evidence/stocks-contract-proofs-20261014/backend-full/linux-0dd-review.json': 'raw-evidence',
  'docs/evidence/stocks-contract-proofs-20261014/public-host/linux-0dd-preflight-failure.json': 'raw-evidence',
});
const REPORT_ONLY_HASHES = Object.freeze({
  'scripts/qa-backend-full-offline.cjs': '3a81f397b95ff17574f554376befa43b2a812fc47733f3ecc324fadd99f1258b',
  'scripts/qa-backend-full-offline.test.cjs': 'b8d946492c90e3866ee78dd66db3f2811829a750d1f2281aace293dc38fc01b2',
});
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
  exactKeys(m, ['schemaVersion', 'reviewId', 'baselineSHA', 'priorFailure', 'manifestPath', 'files']);
  assert.equal(m.schemaVersion, 1); assert.equal(m.reviewId, REVIEW_ID);
  assert.equal(m.baselineSHA, BASELINE_SHA); assert.deepEqual(m.priorFailure, PRIOR_FAILURE);
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
    if (Object.hasOwn(REPORT_ONLY_HASHES, f.path)) assert.equal(f.headSHA256, REPORT_ONLY_HASHES[f.path], 'report-only helper bytes changed');
    byPath.set(f.path, f);
  }
  return byPath;
}
function decide({ base, head, manifest, changes }) {
  const report = { schemaVersion: 1, mode: 'full', comparedSHAs: { base: base || null, head: head || null }, priorFailure: { baselineSHA: BASELINE_SHA, ...PRIOR_FAILURE }, previousFailurePreserved: true, releaseGatePass: false, currentFullBackendResult: 'NOT_RUN', changedPaths: [], reason: null, reviewId: null, manifestIsCryptographicSignature: false };
  try {
    assert.ok(SHA.test(base || '') && SHA.test(head || ''), 'exact Git SHAs required');
    assert.equal(base, BASELINE_SHA, 'unknown backend baseline');
    assert.ok(Array.isArray(changes) && changes.length <= 128, 'change inventory unavailable or excessive');
    report.changedPaths = changes.map(c => safePath(c.path));
    assert.equal(new Set(report.changedPaths).size, changes.length, 'duplicate changed path');
    // No wildcard skip. Runtime, tests, locks, schema, compiler/build prerequisites,
    // and any other unknown path require full validation even if a manifest lists them.
    for (const c of changes) {
      if (c.path !== MANIFEST_PATH && !Object.hasOwn(ALLOWED_PATHS, c.path)) { report.reason = 'UNREVIEWABLE_OR_PROTECTED_PATH'; return report; }
      if (Object.hasOwn(REPORT_ONLY_HASHES, c.path) && c.headSHA256 !== REPORT_ONLY_HASHES[c.path]) { report.reason = 'BACKEND_HELPER_OR_PREREQUISITE_CHANGED'; return report; }
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
    report.mode = 'not_run'; report.reason = 'EXACT_REVIEWED_QA_ONLY_FOLLOWUP';
    report.note = 'Full backend intentionally NOT_RUN for these exact reviewed QA-only bytes. Prior 0dd1 full backend remains FAIL. Other CI gates are unchanged.';
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
  const changes = paths.map(f => { const a = blob(base, f), b = blob(head, f); return { path: f, baseMode: a.mode, headMode: b.mode, baseSHA256: a.hash, headSHA256: b.hash }; });
  const review = blob(head, MANIFEST_PATH); assert.ok(review.bytes && review.bytes.length <= 256 * 1024, 'frozen review manifest unavailable');
  return { base, head, changes, manifest: JSON.parse(review.bytes.toString()) };
}
function main(argv = process.argv.slice(2), root = path.resolve(__dirname, '..')) {
  let base = null, head = null, report;
  try {
    assert.equal(argv.length, 6, 'usage: --base <sha> --head <sha> --manifest <repository-relative-path>');
    const option = key => { const i = argv.indexOf(key); assert.ok(i >= 0 && argv[i + 1]); return argv[i + 1]; };
    base = option('--base'); head = option('--head');
    report = decide(collectGit({ root, base, head, manifestPath: option('--manifest') }));
  } catch (e) {
    report = decide({ base, head, changes: [], manifest: null });
    report.mode = 'full'; report.reason = 'GIT_OR_INPUT_NOT_PROVEN'; report.error = String(e.message).slice(0, 2000);
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}
module.exports = { BASELINE_SHA, PRIOR_FAILURE, REVIEW_ID, MANIFEST_PATH, ALLOWED_PATHS, REPORT_ONLY_HASHES, decide, validateManifest, collectGit, main };
if (require.main === module) main();
