'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { BASELINE_SHA, PRIOR_FAILURE, REVIEW_ID, MANIFEST_PATH, PROTECTED_HELPERS, decide, collectGit, main } = require('./qa-backend-full-admission.cjs');
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
test('every backend helper or helper-test edit requires full, including previously report-only edits', () => {
  for (const file of PROTECTED_HELPERS) {
    const r = decide(candidate([change(file, 'report-only')]));
    assert.equal(r.mode, 'full'); assert.equal(r.reason, 'BACKEND_HELPER_OR_PREREQUISITE_CHANGED');
  }
});
test('runtime authentication edits always require full backend even when presented as reviewed QA', () => {
  for (const file of ['services/stocks-global/identity.mjs', 'services/stocks-global/server.mjs']) {
    for (const classification of ['documentation', 'auth-fixture', 'report-only']) {
      const r = decide(candidate([change(file, classification)]));
      assert.equal(r.mode, 'full', file + ' must not use QA-only admission');
      assert.equal(r.reason, 'UNREVIEWABLE_OR_PROTECTED_PATH');
      assert.equal(r.releaseGatePass, false);
      assert.deepEqual(r.priorFailure, { baselineSHA: BASELINE_SHA, ...PRIOR_FAILURE });
    }
  }
});
test('completed finite auth jobs cannot automatically launch for a later candidate SHA', () => {
  const completedHead = 'dc5327b7def5ac4f5b448f820bbd279b7072d7f9';
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/stocks-review.yml'), 'utf8').replace(/\r\n/g, '\n');
  for (const name of ['stocks-auth-preparation', 'stocks-auth-http-paired']) {
    const job = workflow.match(new RegExp('^  ' + name + ':\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|$(?![\\s\\S]))', 'm'))?.[1];
    assert.ok(job, name + ' retained as historical diagnostic');
    const condition = job.match(/^    if: >-?\n([\s\S]*?)(?=^    \S)/m)?.[1].trim().replace(/\s+/g, ' ');
    assert.ok(condition, name + ' has an explicit job-level condition');
    assert.ok(!condition.includes('||'), name + ' cannot bypass its completed-head predicate');
    const terms = condition.split('&&').map(term => term.trim());
    const expected = "github.event.pull_request.head.sha == '" + completedHead + "'";
    assert.equal(terms.filter(term => term === expected).length, 1, name + ' is bound to the completed exact head');
    const predicates = terms.filter(term => /head\.sha/.test(term));
    assert.deepEqual(predicates, [expected], name + ' has no alternative head selector');
    // This required conjunct is false on every later candidate. SKIPPED is
    // scheduling only; prior FAIL and capacity gates remain unchanged.
    for (const nextHead of [HEAD, '0'.repeat(40), 'f'.repeat(40)]) {
      assert.notEqual(nextHead, completedHead);
    }
  }
});
test('handoff must preserve its exact canonical prefix and cannot be added, deleted or rewritten', () => {
  const c = candidate([change('docs/AI_HANDOFF.md', 'append-only-handoff')]);
  assert.equal(decide(c).mode, 'full');
  c.changes[0].appendOnly = false; assert.equal(decide(c).mode, 'full');
  c.changes[0].appendOnly = true; assert.equal(decide(c).mode, 'not_run');
});
test('known preparation and selector/workflow controls require exact individually reviewed bytes', () => {
  for (const [file, classification] of [
    ['services/stocks/auth-http-fixture-512/prepare.mjs', 'preparation-only'],
    ['services/stocks/auth-http-fixture-512/prepare.test.mjs', 'preparation-only'],
    ...['run.mjs', 'fixture.test.mjs', 'authority-entry.cjs', 'authority.test.cjs', 'durability-observer.cjs',
      'durability-observer.test.cjs', 'launcher.mjs', 'launcher.test.mjs', 'launch-policy.json']
      .map(file => ['services/stocks/auth-http-fixture-512/' + file, 'auth-fixture']),
    ['scripts/qa-backend-full-admission.cjs', 'admission-control'],
    ['scripts/qa-backend-full-admission.test.cjs', 'admission-control'],
    ['.github/workflows/stocks-review.yml', 'workflow-control'],
  ]) {
    const c = candidate([change(file, classification)]); assert.equal(decide(c).mode, 'not_run');
    c.changes[0].headSHA256 = 'e'.repeat(64); assert.equal(decide(c).mode, 'full');
  }
});
test('runtime/test/lock/schema/compiler/build and unknown paths always demand full even if claimed reviewed', () => {
  for (const file of ['services/stocks/auth-http-fixture-512/authority.cjs', 'services/stocks/auth-http-fixture-512/unreviewed.mjs', 'services/stocks/auth-http-fixture-512/plan.mjs', 'src/index.ts', 'src/foo.test.ts', 'frontend/src/App.tsx', 'services/stocks/server.mjs', 'services/stocks-global/accounts.mjs', 'services/stocks-global/account-worker-runtime.mjs', 'package.json', 'package-lock.json', 'frontend/package-lock.json', 'prisma/schema.prisma', 'tsconfig.json', 'jest.config.js', 'scripts/qa-backend-full-offline.Dockerfile', 'Dockerfile', 'scripts/unreviewed.cjs', 'docs/unreviewed.md', '.github/workflows/other.yml']) {
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
function gitFixture({ badGit = false, badHead = false, missingManifest = false, tamperBlob = false, nonAncestor = false, handoff = false, rewriteHandoff = false } = {}) {
  const file = handoff ? 'docs/AI_HANDOFF.md' : 'docs/evidence/stocks-contract-proofs-20261014/backend-full/README.md';
  const old = Buffer.from('old reviewed text'), fresh = Buffer.from(handoff && !rewriteHandoff ? 'old reviewed text\nnew evidence' : 'new reviewed text');
  const m = candidate([change(file, handoff ? 'append-only-handoff' : 'documentation', sha256(fresh))]).manifest; m.files[0].baseSHA256 = sha256(old);
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
test('canonical collector computes append-only from actual Git blob bytes', () => {
  const append = collectGit(gitFixture({ handoff: true }));
  assert.equal(append.changes[0].appendOnly, true); assert.equal(decide(append).mode, 'not_run');
  const rewrite = collectGit(gitFixture({ handoff: true, rewriteHandoff: true }));
  assert.equal(rewrite.changes[0].appendOnly, false); assert.equal(decide(rewrite).mode, 'full');
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
