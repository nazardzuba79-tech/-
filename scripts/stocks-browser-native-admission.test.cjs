'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const gate = require('./stocks-browser-native-admission.cjs');
const head = 'a'.repeat(40);
const scope = () => ({ eventName: 'pull_request', repository: gate.REPOSITORY, headRef: gate.BRANCH, head,
  event: { number: 528, pull_request: { number: 528, head: { sha: head, ref: gate.BRANCH, repo: { full_name: gate.REPOSITORY } },
    base: { ref: gate.BASE_REF, repo: { full_name: gate.REPOSITORY } } } } });
test('inheritance admits only exact same-repository PR528 and complete head/base metadata', () => {
  gate.validateScope(scope());
  for (const change of [x => x.eventName = 'push', x => x.repository = 'fork/-', x => x.headRef = undefined,
    x => x.event.number = 512, x => x.event.pull_request.number = 497, x => x.event.pull_request.base.ref = 'main',
    x => x.event.pull_request.head.repo.full_name = 'fork/-', x => x.event.pull_request.base.repo.full_name = 'fork/-',
    x => delete x.event.pull_request.head.ref, x => x.head = gate.BASE_SHA]) {
    const value = scope(); change(value); assert.throws(() => gate.validateScope(value));
  }
});
const metadata = () => ({ run: { id: gate.PIN.run, run_attempt: 1, status: 'completed', conclusion: 'failure',
  event: 'pull_request', head_sha: gate.BASE_SHA, head_branch: gate.BRANCH,
  repository: { id: gate.PIN.repositoryId }, head_repository: { id: gate.PIN.repositoryId } },
  job: { id: gate.PIN.job, run_id: gate.PIN.run, name: 'stocks-full-backend-offline', status: 'completed', conclusion: 'success' },
  artifact: { id: gate.PIN.artifact, name: 'stocks-full-backend-' + gate.BASE_SHA, expired: false,
    size_in_bytes: gate.PIN.zipBytes, digest: 'sha256:' + gate.PIN.zipSha256,
    workflow_run: { id: gate.PIN.run, repository_id: gate.PIN.repositoryId, head_repository_id: gate.PIN.repositoryId,
      head_branch: gate.BRANCH, head_sha: gate.BASE_SHA } } });
test('successful backend job is bound to exact attempt and artifact; failed overall browser run stays failed', () => {
  assert.equal(gate.verifyMetadata(metadata()), true);
  for (const change of [x => x.run.run_attempt = 2, x => x.run.status = 'in_progress', x => x.run.event = 'push',
    x => x.run.head_sha = head, x => x.run.head_repository.id++, x => x.job.conclusion = 'failure',
    x => x.job.run_id++, x => x.job.id++, x => x.artifact.expired = true, x => x.artifact.digest = 'sha256:' + '0'.repeat(64),
    x => x.artifact.workflow_run.head_sha = head, x => x.artifact.size_in_bytes++]) {
    const value = metadata(); change(value); assert.throws(() => gate.verifyMetadata(value));
  }
});
function closure() {
  const protectedNames = ['package.json', 'package-lock.json', 'frontend/package.json', 'frontend/package-lock.json',
    'tsconfig.json', 'tsconfig.jest.json', 'jest.config.js', 'jest.setup.ts', 'prisma/schema.prisma',
    '.gitattributes', 'scripts/qa-backend-full-offline.cjs', 'src/example.test.ts', 'frontend/src/lib/example.ts'];
  const qa = 'scripts/qa-stocks-public-nss.cjs', names = [qa, ...protectedNames];
  while (names.length < 5097) names.push('fixtures/file-' + String(names.length).padStart(5, '0') + '.json');
  const prior = new Map(names.map((name, i) => [name, { path: name, mode: '100644', blob: i.toString(16).padStart(40, '0'), bytes: 1 }]));
  const current = structuredClone(prior), content = Buffer.from('reviewed browser QA only');
  current.set(qa, { ...current.get(qa), blob: 'e'.repeat(40), bytes: content.length });
  current.set(gate.PLAN_PATH, { path: gate.PLAN_PATH, mode: '100644', blob: 'f'.repeat(40), bytes: 1 });
  const ordered = [...prior.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const source = { sha: gate.BASE_SHA, excluded: [], tests: Array.from({ length: 252 }, (_, i) => 'src/test-' + i + '.test.ts'),
    files: [...prior.values()].map(x => ({ path: x.path, gitBlob: x.blob, bytes: x.bytes, executable: false, sha256: 'c'.repeat(64) })) };
  const plan = { schema: 1, reviewId: 'pr528-native-browser-db67-inputs-20261015', baseSHA: gate.BASE_SHA,
    baseTreeSha256: gate.sha(JSON.stringify(ordered)), changes: [{ path: qa, beforeBlob: prior.get(qa).blob,
      beforeMode: '100644', afterSha256: gate.sha(content), afterMode: '100644' }] };
  const oldWorkflow = "name: fixture\non:\n  pull_request:\n    paths: ['scripts/qa-stocks*']\njobs:\n  stocks-full-backend-offline:\n    needs: stocks-backend-admission\n    if: >-\n      github.event.pull_request.base.ref == 'dot/stocks-owner-usdt-portfolio-20261013'))\n    runs-on: ubuntu-latest\n    steps:\n      - run: exact-backend\n  next:\n    runs-on: fixture\n";
  const newWorkflow = oldWorkflow.replace("'scripts/qa-stocks*'", "'scripts/qa-stocks*', 'scripts/stocks-browser-native/**', 'scripts/stocks-browser-native-*'")
    .replace('needs: stocks-backend-admission', 'needs: [stocks-backend-admission, stocks-native-backend-admission]')
    .replace("ref == 'dot/stocks-owner-usdt-portfolio-20261013'))", "ref == 'dot/stocks-owner-usdt-portfolio-20261013' &&\n      (needs.stocks-native-backend-admission.result != 'success' || needs.stocks-native-backend-admission.outputs.mode != 'inherited_db67')))");
  return { prior, current, source, plan, readHead: () => content, oldWorkflow, newWorkflow };
}
test('complete protected inventory binds all source, backend tests, compiler/config and locks', () => {
  const value = closure(), proof = gate.verifyClosure(value);
  assert.ok(proof.protectedFiles > 5000); assert.match(proof.protectedTreeSha256, /^[a-f0-9]{64}$/);
  for (const name of ['package.json', 'package-lock.json', 'frontend/package-lock.json', 'tsconfig.json', 'tsconfig.jest.json',
    'jest.setup.ts', 'prisma/schema.prisma', '.gitattributes', 'scripts/qa-backend-full-offline.cjs', 'src/example.test.ts', 'frontend/src/lib/example.ts']) {
    const changed = closure(); changed.current.get(name).blob = 'd'.repeat(40); assert.throws(() => gate.verifyClosure(changed), undefined, name);
  }
});
test('only the four reviewed metadata paths can inherit; an unknown fifth requires FULL', () => {
  const names = ['scripts/stocks-browser-native/metadata/google-key.asc',
    'scripts/stocks-browser-native/metadata/InRelease', 'scripts/stocks-browser-native/metadata/Packages.gz',
    'scripts/stocks-browser-native/metadata/.gitattributes'];
  assert.deepEqual([...gate.ALLOWED_PATHS].filter(name => name.startsWith('scripts/stocks-browser-native/metadata/')).sort(), [...names].sort());
  function add(value, name, reviewed) {
    const content = value.readHead(name);
    value.current.set(name, { path: name, mode: '100644', blob: 'd'.repeat(40), bytes: content.length });
    if (reviewed) value.plan.changes.push({ path: name, beforeBlob: null, beforeMode: null,
      afterSha256: gate.sha(content), afterMode: '100644' });
  }
  const value = closure();
  for (const name of names) add(value, name, true);
  assert.ok(gate.verifyClosure(value).protectedFiles > 5000);
  for (const reviewed of [false, true]) {
    const changed = closure();
    for (const name of names) add(changed, name, true);
    add(changed, 'scripts/stocks-browser-native/metadata/extra.json', reviewed);
    assert.throws(() => gate.verifyClosure(changed));
  }
});
test('only the exact public GPG witness fixture is admitted; another fixture requires FULL', () => {
  const name = 'scripts/stocks-browser-native/fixtures/gpg-status-926291d6.json';
  assert.deepEqual([...gate.ALLOWED_PATHS].filter(value => value.startsWith('scripts/stocks-browser-native/fixtures/')), [name]);
  function add(value, file, reviewed) {
    const content = value.readHead(file);
    value.current.set(file, { path: file, mode: '100644', blob: 'd'.repeat(40), bytes: content.length });
    if (reviewed) value.plan.changes.push({ path: file, beforeBlob: null, beforeMode: null,
      afterSha256: gate.sha(content), afterMode: '100644' });
  }
  const value = closure(); add(value, name, true); assert.ok(gate.verifyClosure(value).protectedFiles > 5000);
  for (const reviewed of [false, true]) {
    const changed = closure(); add(changed, name, true);
    add(changed, 'scripts/stocks-browser-native/fixtures/unreviewed.json', reviewed);
    assert.throws(() => gate.verifyClosure(changed));
  }
});
test('unknown additions/deletions/mode changes, invented allowlists and mismatched evidence require FULL', () => {
  for (const change of [
    x => x.current.set('outside-src/new-input.json', { path: 'outside-src/new-input.json', mode: '100644', blob: 'd'.repeat(40), bytes: 1 }),
    x => x.current.delete('package.json'), x => x.current.get('package.json').mode = '100755',
    x => x.current.get('scripts/qa-stocks-public-nss.cjs').mode = '100755',
    x => x.plan.changes[0].path = 'package.json', x => x.plan.changes[0].afterSha256 = '0'.repeat(64),
    x => x.plan.baseTreeSha256 = '0'.repeat(64), x => x.source.files[0].gitBlob = '0'.repeat(40) === x.source.files[0].gitBlob ? '1'.repeat(40) : '0'.repeat(40),
    x => x.source.files.pop(), x => x.source.tests.pop(),
    x => x.newWorkflow = x.newWorkflow.replace('exact-backend', 'weakened-backend'),
    x => x.newWorkflow = x.newWorkflow.replace('    runs-on: ubuntu-latest', '    env:\n      NODE_OPTIONS: injected\n    runs-on: ubuntu-latest'),
    x => x.newWorkflow = x.newWorkflow.replace('    runs-on: ubuntu-latest', '    defaults:\n      run:\n        working-directory: elsewhere\n    runs-on: ubuntu-latest'),
    x => x.newWorkflow = x.newWorkflow.replace('\njobs:', '\nenv:\n  NODE_OPTIONS: injected\njobs:'),
    x => x.newWorkflow = x.newWorkflow.replace('\njobs:', '\ndefaults:\n  run:\n    shell: injected\njobs:'),
  ]) { const value = closure(); change(value); assert.throws(() => gate.verifyClosure(value)); }
});
test('Git inventory rejects symlinks, submodules, duplicates and malformed records', () => {
  const oid = 'a'.repeat(40); assert.equal(gate.parseTree(`100644 blob ${oid} 1\tpackage.json\0`).size, 1);
  for (const data of [`120000 blob ${oid} 1\tlink\0`, `160000 commit ${oid} -\tmodule\0`,
    `100644 blob ${oid} 1\tx\0` + `100644 blob ${oid} 1\tx\0`, `100644 blob ${oid} 1\tx\ny\0`]) assert.throws(() => gate.parseTree(data));
});
test('untrusted archive/evidence bytes cannot become inherited proof', () => {
  assert.throws(() => gate.readZip(Buffer.from('not an archive')));
  assert.throws(() => gate.readZip(Buffer.alloc(gate.PIN.zipBytes)));
  assert.throws(() => gate.verifyEvidence(new Map()));
  assert.equal(gate.COUNTS.numPendingTestSuites, 13); assert.equal(gate.COUNTS.numPendingTests, 132);
});
test('native browser completion requires every real case, cleanup and the shared deadline', () => {
  const good = () => ({ sourceSHA: head, deadlineMs: 10000, now: 9000,
    steps: Object.fromEntries(gate.BROWSER_STEPS.map(name => [name, { outcome: 'success' }])) });
  assert.equal(gate.browserResult(good()).status, 'PASS_NATIVE_BROWSER_CURRENT_HEAD');
  for (const name of gate.BROWSER_STEPS) for (const outcome of ['skipped', 'failure', 'cancelled', undefined]) {
    const value = good(); value.steps[name].outcome = outcome; assert.throws(() => gate.browserResult(value));
  }
  for (const patch of [{ now: 10001 }, { deadlineMs: NaN }, { now: undefined }]) assert.throws(() => gate.browserResult({ ...good(), ...patch }));
});
test('older PR512 finite admission retains its original 128 changed-path bound', () => {
  const source = fs.readFileSync(path.join(__dirname, 'qa-backend-full-admission.cjs'), 'utf8');
  assert.match(source, /128/); assert.doesNotMatch(source, /inherited_db67|stocks-browser-native/);
});
