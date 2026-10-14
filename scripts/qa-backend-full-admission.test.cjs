'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { BASELINE_SHA, PRIOR_FAILURE, PRIOR_BROWSER_FAILURE, REVIEW_ID, MANIFEST_PATH, REPOSITORY, BRANCH, PROTECTED_HELPERS, decide, readScope, collectGit, main } = require('./qa-backend-full-admission.cjs');
const HEAD = 'a'.repeat(40), OLD = 'b'.repeat(64), NEW = 'c'.repeat(64);
const scope = () => ({ eventName: 'pull_request', repository: REPOSITORY, number: 512, headRepository: REPOSITORY, headRef: BRANCH, headSHA: HEAD });
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
function change(path, classification = 'documentation', headSHA256 = NEW) {
  return { path, classification, baseSHA256: OLD, headSHA256 };
}
function candidate(files = [change('docs/evidence/stocks-auth-lifetime-20261014/FOLLOWUP.md')]) {
  return {
    base: BASELINE_SHA, head: HEAD, scope: scope(),
    manifest: { schemaVersion: 2, reviewId: REVIEW_ID, baselineSHA: BASELINE_SHA, priorFailure: { ...PRIOR_FAILURE }, priorBrowserFailure: { ...PRIOR_BROWSER_FAILURE }, manifestPath: MANIFEST_PATH, files },
    changes: [...files.map(({ classification, ...f }) => ({ ...f, baseMode: f.baseSHA256 ? '100644' : null, headMode: f.headSHA256 ? '100644' : null })), { path: MANIFEST_PATH, baseMode: null, headMode: '100644', baseSHA256: null, headSHA256: 'd'.repeat(64) }],
  };
}
test('exact reviewed documentation retains prior FAIL and never presents NOT_RUN as PASS', () => {
  const r = decide(candidate());
  assert.equal(r.mode, 'not_run'); assert.equal(r.currentFullBackendResult, 'NOT_RUN');
  assert.equal(r.browserMode, 'not_run'); assert.equal(r.currentBrowserResult, 'NOT_RUN');
  assert.equal(r.priorFailure.status, 'FAIL'); assert.equal(r.priorFailure.artifactSHA256, PRIOR_FAILURE.artifactSHA256);
  assert.deepEqual(r.priorBrowserFailure, { baselineSHA: BASELINE_SHA, ...PRIOR_BROWSER_FAILURE });
  assert.equal(r.previousBrowserFailurePreserved, true);
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
  const completedJobs = {
    'stocks-auth-preparation': 'dc5327b7def5ac4f5b448f820bbd279b7072d7f9',
    'stocks-auth-http-paired': 'dc5327b7def5ac4f5b448f820bbd279b7072d7f9',
    'stocks-auth-one-burst': '75e2453ed85c03d12114f2e29ba9acf0f6e6f31f',
  };
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/stocks-review.yml'), 'utf8').replace(/\r\n/g, '\n');
  for (const [name, completedHead] of Object.entries(completedJobs)) {
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
test('only named barrier test and admission/workflow controls can use exact individually reviewed bytes', () => {
  for (const [file, classification] of [
    ['services/stocks/auth-http-fixture-512/cancellation-barrier.test.mjs', 'auth-fixture-test'],
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
    assert.equal(r.mode, 'full', file); assert.equal(r.browserMode, 'run', file); assert.equal(r.reason, 'UNREVIEWABLE_OR_PROTECTED_PATH', file);
  }
});
test('previous finite experiment fixtures are not permitted by the narrow 28 followup', () => {
  for (const file of ['prepare.mjs', 'prepare.test.mjs', 'run.mjs', 'fixture.test.mjs', 'authority-entry.cjs',
    'authority.test.cjs', 'durability-observer.cjs', 'durability-observer.test.cjs', 'launcher.mjs', 'launcher.test.mjs', 'launch-policy.json']) {
    const r = decide(candidate([change('services/stocks/auth-http-fixture-512/' + file, 'auth-fixture')]));
    assert.equal(r.mode, 'full', file); assert.equal(r.browserMode, 'run', file);
    assert.equal(r.reason, 'UNREVIEWABLE_OR_PROTECTED_PATH', file);
  }
});

test('named one-burst QA files need exact reviewed bytes; future sibling files never inherit admission', () => {
  for (const name of ['recorder.mjs', 'instrument.mjs', 'launch-policy.json', 'workflow-config.mjs', 'proxy-correlation.test.mjs']) {
    const c = candidate([change('services/stocks/auth-burst-trace-512/' + name, 'auth-burst-trace-fixture')]);
    assert.equal(decide(c).mode, 'not_run');
    assert.equal(decide(c).releaseGatePass, false);
    c.changes[0].headSHA256 = 'f'.repeat(64);
    assert.equal(decide(c).mode, 'full');
  }
  for (const name of ['unreviewed.mjs', 'future-test.test.mjs', 'extra-policy.json']) {
    const r = decide(candidate([change('services/stocks/auth-burst-trace-512/' + name, 'auth-burst-trace-fixture')]));
    assert.equal(r.mode, 'full'); assert.equal(r.browserMode, 'run');
  }
});
test('outside the exact same-repository PR512 branch and head neither backend nor browser can skip', () => {
  for (const alter of [
    c => c.scope = undefined, c => c.scope.number = 497, c => c.scope.number = 515,
    c => c.scope.number = '512', c => c.scope.eventName = 'push', c => c.scope.repository = 'fork/-',
    c => c.scope.headRepository = 'fork/-', c => c.scope.headRef = 'main',
    c => c.scope.headSHA = BASELINE_SHA, c => c.scope.unreviewedField = true,
  ]) {
    const c = candidate(); alter(c); const r = decide(c);
    assert.equal(r.mode, 'full'); assert.equal(r.browserMode, 'run'); assert.equal(r.releaseGatePass, false);
  }
});
test('browser workflow requires successful exact scoped admission and retains ordinary execution elsewhere', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/stocks-review.yml'), 'utf8').replace(/\r\n/g, '\n');
  const browser = workflow.match(/^  stocks-ui-browser:\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:|$(?![\s\S]))/m)?.[1];
  assert.ok(browser);
  assert.match(browser, /^    needs: \[isolated-simulator, stocks-backend-admission\]$/m);
  const condition = browser.match(/^    if: >-?\n([\s\S]*?)(?=^    \S)/m)?.[1].trim().replace(/\s+/g, ' ');
  assert.equal(condition, "always() && !cancelled() && !(github.event_name == 'pull_request' && github.event.pull_request.number == 512 && github.repository == 'nazardzuba79-tech/-' && github.event.pull_request.head.repo.full_name == github.repository && needs.stocks-backend-admission.result == 'success' && needs.stocks-backend-admission.outputs.mode == 'not_run' && needs.stocks-backend-admission.outputs.browser_mode == 'not_run')");
  assert.match(workflow, /browser_mode: \$\{\{ steps\.admission\.outputs\.browser_mode \}\}/);
  assert.match(workflow, /r\.browserMode!==\(r\.mode==="not_run"\?"not_run":"run"\)/);
  assert.match(workflow, /needs\.stocks-backend-admission\.result != 'success' \|\| needs\.stocks-backend-admission\.outputs\.mode != 'not_run'/);
});
test('GitHub event scope is read without using untrusted event data as output or commands', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-admission-scope-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true }); });
  const eventPath = path.join(dir, 'event.json');
  const event = { pull_request: { number: 512, head: { repo: { full_name: REPOSITORY }, ref: BRANCH, sha: HEAD } }, ignored: 'not copied' };
  fs.writeFileSync(eventPath, JSON.stringify(event));
  const env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_PATH: eventPath };
  assert.deepEqual(readScope(env), scope());
  fs.writeFileSync(eventPath, '{'); assert.throws(() => readScope(env));
  assert.throws(() => readScope({}));
});
test('missing, expanded, stale, malformed or tampered review metadata cannot skip', () => {
  for (const alter of [
    c => c.manifest = null,
    c => c.base = 'b'.repeat(40),
    c => c.manifest.reviewId += '-other',
    c => c.manifest.priorFailure.status = 'PASS',
    c => c.manifest.priorFailure.artifactSHA256 = NEW,
    c => c.manifest.priorFailure.artifactId++,
    c => c.manifest.priorFailure.runId++,
    c => c.manifest.priorFailure.jobId++,
    c => c.manifest.priorFailure.extra = true,
    c => c.manifest.priorBrowserFailure = undefined,
    c => c.manifest.priorBrowserFailure.status = 'PASS',
    c => c.manifest.priorBrowserFailure.artifactSHA256 = NEW,
    c => c.manifest.priorBrowserFailure.artifactId++,
    c => c.manifest.priorBrowserFailure.runId++,
    c => c.manifest.priorBrowserFailure.jobId++,
    c => c.manifest.priorBrowserFailure.extra = true,
    c => c.manifest.schemaVersion = 1,
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
  ]) { const c = candidate(); alter(c); const r = decide(c); assert.equal(r.mode, 'full'); assert.equal(r.browserMode, 'run'); }
});
function gitFixture({ badGit = false, badHead = false, missingManifest = false, tamperBlob = false, nonAncestor = false, handoff = false, rewriteHandoff = false } = {}) {
  const file = handoff ? 'docs/AI_HANDOFF.md' : 'docs/evidence/stocks-auth-lifetime-20261014/FOLLOWUP.md';
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
  assert.equal(decide({ ...collectGit(gitFixture()), scope: scope() }).mode, 'not_run');
  assert.equal(decide({ ...collectGit(gitFixture({ tamperBlob: true })), scope: scope() }).mode, 'full');
  for (const flag of ['badGit', 'badHead', 'missingManifest', 'nonAncestor']) assert.throws(() => collectGit(gitFixture({ [flag]: true })));
});
test('canonical collector computes append-only from actual Git blob bytes', () => {
  const append = collectGit(gitFixture({ handoff: true }));
  assert.equal(append.changes[0].appendOnly, true); assert.equal(decide({ ...append, scope: scope() }).mode, 'not_run');
  const rewrite = collectGit(gitFixture({ handoff: true, rewriteHandoff: true }));
  assert.equal(rewrite.changes[0].appendOnly, false); assert.equal(decide({ ...rewrite, scope: scope() }).mode, 'full');
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
