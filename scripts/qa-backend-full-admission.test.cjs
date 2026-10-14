'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { BASELINE_SHA, PRIOR_FAILURE, REVIEW_ID, MANIFEST_PATH, REPORT_ONLY_HASHES, decide, collectGit, main } = require('./qa-backend-full-admission.cjs');
const HEAD = 'a'.repeat(40), OLD = 'b'.repeat(64), NEW = 'c'.repeat(64);
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
function change(path, classification = 'documentation', headSHA256 = NEW) {
  return { path, classification, baseSHA256: OLD, headSHA256 };
}
function candidate(files = [change('docs/evidence/stocks-contract-proofs-20261014/backend-full/README.md')]) {
  return {
    base: BASELINE_SHA, head: HEAD,
    manifest: { schemaVersion: 1, reviewId: REVIEW_ID, baselineSHA: BASELINE_SHA, priorFailure: { ...PRIOR_FAILURE }, manifestPath: MANIFEST_PATH, files },
    changes: [...files.map(({ classification, ...f }) => ({ ...f, baseMode: f.baseSHA256 ? '100644' : null, headMode: f.headSHA256 ? '100644' : null })), { path: MANIFEST_PATH, baseMode: null, headMode: '100644', baseSHA256: null, headSHA256: 'd'.repeat(64) }],
  };
}
test('exact reviewed documentation retains prior FAIL and never presents NOT_RUN as PASS', () => {
  const r = decide(candidate());
  assert.equal(r.mode, 'not_run'); assert.equal(r.currentFullBackendResult, 'NOT_RUN');
  assert.equal(r.priorFailure.status, 'FAIL'); assert.equal(r.priorFailure.artifactSHA256, PRIOR_FAILURE.artifactSHA256);
  assert.equal(r.previousFailurePreserved, true); assert.equal(r.releaseGatePass, false); assert.equal(r.manifestIsCryptographicSignature, false);
});
test('only frozen report-only helper/test bytes can reuse prior full-run failure evidence', () => {
  const files = Object.entries(REPORT_ONLY_HASHES).map(([file, hash]) => change(file, 'report-only', hash));
  assert.equal(decide(candidate(files)).mode, 'not_run');
  for (const i of [0, 1]) { const c = candidate(files.map(f => ({ ...f }))); c.manifest.files[i].headSHA256 = NEW; c.changes[i].headSHA256 = NEW; assert.equal(decide(c).mode, 'full'); assert.equal(decide(c).reason, 'BACKEND_HELPER_OR_PREREQUISITE_CHANGED'); }
});
test('known auth fixture and selector/workflow controls require exact individually reviewed bytes', () => {
  for (const [file, classification] of [
    ['services/stocks/auth-http-fixture-512/authority.cjs', 'auth-fixture'],
    ['scripts/qa-backend-full-admission.cjs', 'admission-control'],
    ['scripts/qa-backend-full-admission.test.cjs', 'admission-control'],
    ['.github/workflows/stocks-review.yml', 'workflow-control'],
  ]) {
    const c = candidate([change(file, classification)]); assert.equal(decide(c).mode, 'not_run');
    c.changes[0].headSHA256 = 'e'.repeat(64); assert.equal(decide(c).mode, 'full');
  }
});
test('runtime/test/lock/schema/compiler/build and unknown paths always demand full even if claimed reviewed', () => {
  for (const file of ['src/index.ts', 'src/foo.test.ts', 'frontend/src/App.tsx', 'services/stocks/server.mjs', 'package.json', 'package-lock.json', 'frontend/package-lock.json', 'prisma/schema.prisma', 'tsconfig.json', 'jest.config.js', 'scripts/qa-backend-full-offline.Dockerfile', 'Dockerfile', 'scripts/unreviewed.cjs', 'docs/unreviewed.md', '.github/workflows/other.yml']) {
    const r = decide(candidate([change(file, 'documentation')]));
    assert.equal(r.mode, 'full', file); assert.equal(r.reason, 'UNREVIEWABLE_OR_PROTECTED_PATH', file);
  }
});
test('missing, expanded, stale, malformed or tampered review metadata cannot skip', () => {
  for (const alter of [
    c => c.manifest = null,
    c => c.base = 'b'.repeat(40),
    c => c.manifest.reviewId += '-other',
    c => c.manifest.priorFailure.status = 'PASS',
    c => c.manifest.priorFailure.artifactSHA256 = NEW,
    c => c.manifest.baselineSHA = HEAD,
    c => c.manifest.files = [],
    c => c.manifest.files[0].baseSHA256 = NEW,
    c => c.manifest.files[0].headSHA256 = OLD,
    c => c.manifest.files[0].classification = 'auth-fixture',
    c => c.manifest.files.push({ ...c.manifest.files[0] }),
    c => c.manifest.unreviewedField = true,
    c => c.changes[0].headMode = '120000',
    c => c.changes[0].headMode = '100755',
    c => c.changes[0].path = '../README.md',
    c => c.changes.push({ ...c.changes[0] }),
  ]) { const c = candidate(); alter(c); assert.equal(decide(c).mode, 'full'); }
});
function gitFixture({ badGit = false, badHead = false, missingManifest = false, tamperBlob = false, nonAncestor = false } = {}) {
  const file = 'docs/evidence/stocks-contract-proofs-20261014/backend-full/README.md';
  const old = Buffer.from('old reviewed text'), fresh = Buffer.from('new reviewed text');
  const m = candidate([change(file, 'documentation', sha256(fresh))]).manifest; m.files[0].baseSHA256 = sha256(old);
  const blobs = new Map([['1'.repeat(40), old], ['2'.repeat(40), tamperBlob ? Buffer.from('tampered') : fresh], ['3'.repeat(40), Buffer.from(JSON.stringify(m))]]);
  const run = args => {
    if (badGit) return { status: 127, stdout: Buffer.alloc(0) };
    if (args[0] === 'rev-parse') return { status: 0, stdout: Buffer.from((badHead ? BASELINE_SHA : HEAD) + '\n') };
    if (args[0] === 'merge-base') return { status: nonAncestor ? 1 : 0, stdout: Buffer.alloc(0) };
    if (args[0] === 'diff') return { status: 0, stdout: Buffer.from(file + '\0' + MANIFEST_PATH + '\0') };
    if (args[0] === 'ls-tree') {
      const [rev, f] = [args[2], args[4]];
      const id = f === file ? (rev === BASELINE_SHA ? '1' : '2') : rev === HEAD && !missingManifest ? '3' : null;
      return { status: 0, stdout: Buffer.from(id ? '100644 blob ' + id.repeat(40) + '\t' + f + '\0' : '') };
    }
    if (args[0] === 'cat-file') return { status: 0, stdout: blobs.get(args[2]) };
    throw new Error('unexpected Git command');
  };
  return { root: '/unused', base: BASELINE_SHA, head: HEAD, manifestPath: MANIFEST_PATH, run };
}
test('admission hashes canonical Git blobs and loads the review manifest from exact head', () => {
  assert.equal(decide(collectGit(gitFixture())).mode, 'not_run');
  assert.equal(decide(collectGit(gitFixture({ tamperBlob: true }))).mode, 'full');
  for (const flag of ['badGit', 'badHead', 'missingManifest', 'nonAncestor']) assert.throws(() => collectGit(gitFixture({ [flag]: true })));
});
test('missing Git/input fails closed to full without claiming current backend success', () => {
  const logs = [], prior = console.log;
  try {
    console.log = value => logs.push(value);
    const r = main(['--base', BASELINE_SHA, '--head', HEAD, '--manifest', MANIFEST_PATH], '/definitely-unavailable-voltex-git-root');
    assert.equal(r.mode, 'full'); assert.equal(r.reason, 'GIT_OR_INPUT_NOT_PROVEN'); assert.equal(r.currentFullBackendResult, 'NOT_RUN');
    assert.equal(JSON.parse(logs[0]).priorFailure.status, 'FAIL');
  } finally { console.log = prior; }
});
