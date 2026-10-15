import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORRECTNESS_BRANCH, CORRECTNESS_BASE, HEAVY_FLAGS } from './review-plan.mjs';
import { REQUIRED_JOBS, DISCOVERY_PATH, verifyCorrectness, verifyDiscoveryReport } from './review-correctness.mjs';
import nativeAdmission from '../../scripts/stocks-browser-native-admission.cjs';

const repository = 'nazardzuba79-tech/-', head = 'a'.repeat(40);
const input = () => ({ repository, eventName: 'pull_request', headRef: CORRECTNESS_BRANCH, head,
  event: { pull_request: { number: 525,
    head: { ref: CORRECTNESS_BRANCH, sha: head, repo: { full_name: repository } },
    base: { ref: CORRECTNESS_BASE, repo: { full_name: repository } } } },
  needs: Object.fromEntries(REQUIRED_JOBS.map(name => [name, { result: 'success',
    outputs: name === 'stocks-review-selection' ? Object.fromEntries(HEAVY_FLAGS.map(flag => [flag, 'false'])) : {} }])) });
// Sanitized shape/inventory from retained candidate-jest.json, SHA256
// 21712514e0f64a2d63c0e1293e59fca236f54a08078ea9e3ab8c5bd6182f2400.
// Only the absolute checkout prefix and unrelated timing fields are omitted.
const discovery = () => {
  const assertions = [
    { title: 'Spot projection values VTA and cash in its own scope without changing real funds', status: 'pending', ancestorTitles: ['optional VTA PostgreSQL suite discovery', 'VTA Spot and native Futures share the actual disposable database'] },
    { title: 'VTA never reaches external collateral prices; ordinary ETH and native open/close still work', status: 'pending', ancestorTitles: ['optional VTA PostgreSQL suite discovery', 'VTA Spot and native Futures share the actual disposable database'] },
    { title: 'sale USDT follows existing native cash policy once, including initialization and restart', status: 'pending', ancestorTitles: ['optional VTA PostgreSQL suite discovery', 'VTA Spot and native Futures share the actual disposable database'] },
    { title: 'prelisting value is unavailable; read-only receipt recovery is account-scoped and persists', status: 'pending', ancestorTitles: ['optional VTA PostgreSQL suite discovery', 'VTA Spot and native Futures share the actual disposable database'] },
    { title: 'registers the real skipped suite without constructing Prisma or accessing the database', status: 'passed', ancestorTitles: ['optional VTA PostgreSQL suite discovery'] },
  ];
  return { success: true, numTotalTestSuites: 1, numPassedTestSuites: 1,
  numFailedTestSuites: 0, numPendingTestSuites: 0, numRuntimeErrorTestSuites: 0, wasInterrupted: false,
  numTotalTests: 5, numPassedTests: 1,
  numFailedTests: 0, numPendingTests: 4, numTodoTests: 0,
  testResults: [{ name: '/repo/' + DISCOVERY_PATH, status: 'focused', message: '',
    assertionResults: assertions.map(row => ({ ...row, fullName: [...row.ancestorTitles, row.title].join(' '), failureMessages: [] })) }] };
};

test('all actual correctness jobs pass without implying capacity or release readiness', () => {
  const result = verifyCorrectness(input());
  assert.equal(result.sourceSHA, head);
  assert.equal(result.capacityAcceptance, 'NOT_RUN');
  assert.equal(result.publicationReadiness, 'NOT_EVALUATED');
  assert.equal(result.priorPerformanceFailures, 'RETAINED');
});
test('every missing, skipped, cancelled or failed job prevents a green correctness gate', () => {
  for (const name of REQUIRED_JOBS) {
    for (const result of ['skipped', 'failure', 'cancelled', undefined]) {
      const candidate = input(); candidate.needs[name].result = result;
      assert.throws(() => verifyCorrectness(candidate));
    }
    const candidate = input(); delete candidate.needs[name];
    assert.throws(() => verifyCorrectness(candidate));
  }
  const candidate = input(); candidate.needs.unreviewed = { result: 'success' };
  assert.throws(() => verifyCorrectness(candidate));
});
test('every heavy flag, wrong source, push event and forged scope fails closed', () => {
  for (const flag of HEAVY_FLAGS) {
    for (const value of ['true', undefined, false]) {
      const candidate = input(); candidate.needs['stocks-review-selection'].outputs[flag] = value;
      assert.throws(() => verifyCorrectness(candidate));
    }
  }
  for (const change of [c => { c.head = 'b'.repeat(40); }, c => { c.eventName = 'push'; },
    c => { c.event.pull_request.base.ref = 'main'; }, c => { c.event.pull_request.head.repo.full_name = 'fork/-'; },
    c => { delete c.event.pull_request.head; }, c => { delete c.event.pull_request.head.ref; },
    c => { c.headRef = 'other'; }, c => { delete c.headRef; }]) {
    const candidate = input(); change(candidate); assert.throws(() => verifyCorrectness(candidate));
  }
});
test('discovery requires the one actual proof and exactly four intentionally unexecuted PG cases', () => {
  assert.equal(verifyDiscoveryReport(discovery()).status, 'PASS');
  const passedLabel = discovery(); passedLabel.testResults[0].status = 'passed';
  assert.throws(() => verifyDiscoveryReport(passedLabel));
  for (const change of [r => { r.success = false; }, r => { r.numPassedTests = 0; },
    r => { r.numPendingTests = 5; }, r => { r.numRuntimeErrorTestSuites = 1; },
    r => { r.testResults[0].name = '/repo/different.test.ts'; },
    r => { r.wasInterrupted = true; }, r => { r.numPendingTestSuites = 1; },
    r => { r.testResults[0].status = 'failed'; }, r => { r.testResults[0].status = 'skipped'; },
    r => { r.testResults[0].message = 'collection error'; },
    r => { r.testResults[0].assertionResults[4].status = 'pending'; },
    r => { r.testResults[0].assertionResults[4].title = 'unrelated passing test'; },
    r => { r.testResults[0].assertionResults[0].title = 'unrelated skipped case'; },
    r => { r.testResults[0].assertionResults[0].ancestorTitles = ['other suite']; },
    r => { r.testResults[0].assertionResults[0].failureMessages = ['hidden failure']; }]) {
    const candidate = discovery(); change(candidate); assert.throws(() => verifyDiscoveryReport(candidate));
  }
});

const workflow = readFileSync(new URL('../../.github/workflows/stocks-review.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const job = name => {
  const body = workflow.match(new RegExp('^  ' + name + ':\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|$(?![\\s\\S]))', 'm'))?.[1];
  assert.ok(body, 'job missing: ' + name); return body;
};
const condition = body => body.match(/^    if: >-?\n([\s\S]*?)(?=^    \S)/m)?.[1].trim().replace(/\s+/g, ' ');
test('exact-head targeted discovery and required jobs cannot inherit merge-ref evidence', () => {
  assert.ok(workflow.split('\n')[3].includes(DISCOVERY_PATH));
  for (const name of [...REQUIRED_JOBS, 'stocks-correctness-result']) {
    const body = job(name);
    assert.match(body, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
    assert.match(body, /persist-credentials: false/);
    assert.match(body, /git rev-parse HEAD/);
  }
  const targeted = job('stocks-pg-discovery');
  assert.equal(condition(targeted), "github.event_name == 'pull_request' && github.repository == 'nazardzuba79-tech/-' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.base.repo.full_name == github.repository && github.event.pull_request.head.ref == 'codex/stocks-review-20261015' && github.event.pull_request.base.ref == 'dot/stocks-owner-usdt-portfolio-20261013'");
  assert.ok(targeted.includes('--runTestsByPath ' + DISCOVERY_PATH));
  assert.match(targeted, /--discovery-report/);
  assert.match(targeted, /unset VOLTEX_PG_TEST_URL/);
  for (const name of ['stocks-pg-discovery', 'stocks-correctness-result']) {
    assert.ok(job(name).includes(CORRECTNESS_BRANCH));
  }
});
test('new stacked branch requires full backend unless exact independently successful db67 inheritance is proven', () => {
  const backend = job('stocks-full-backend-offline');
  assert.equal(condition(backend), "always() && github.event_name == 'pull_request' && ((github.event.pull_request.number == 512 && (needs.stocks-backend-admission.result != 'success' || needs.stocks-backend-admission.outputs.mode != 'not_run')) || (github.repository == 'nazardzuba79-tech/-' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.base.repo.full_name == github.repository && github.event.pull_request.head.ref == 'codex/stocks-review-20261015' && github.event.pull_request.base.ref == 'dot/stocks-owner-usdt-portfolio-20261013' && (needs.stocks-native-backend-admission.result != 'success' || needs.stocks-native-backend-admission.outputs.mode != 'inherited_db67')))");
  assert.ok(backend.includes(CORRECTNESS_BRANCH));
  assert.ok(backend.includes(CORRECTNESS_BASE));
  assert.match(backend, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(backend, /github\.event\.pull_request\.base\.repo\.full_name == github\.repository/);
  assert.match(backend, /needs\.stocks-backend-admission\.result != 'success' \|\| needs\.stocks-backend-admission\.outputs\.mode != 'not_run'/);
  assert.match(job('stocks-backend-admission'), /if: github\.event_name == 'pull_request' && github\.event\.pull_request\.number == 512/);
  assert.ok(!job('stocks-backend-admission').includes(CORRECTNESS_BRANCH));
  const gate = job('stocks-correctness-result');
  assert.equal(condition(gate), "always() && !cancelled() && github.event_name == 'pull_request' && (github.event.pull_request.head.ref == 'codex/stocks-review-20261015' || github.head_ref == 'codex/stocks-review-20261015')");
  assert.match(gate, /always\(\) && !cancelled\(\)/);
  assert.match(gate, /STOCKS_CORRECTNESS_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  for (const name of REQUIRED_JOBS) assert.ok(gate.includes(name));
});

function inheritedInput() {
  const value = input(); value.event.number = 528; value.event.pull_request.number = 528;
  value.needs['stocks-full-backend-offline'].result = 'skipped';
  value.needs['stocks-native-backend-admission'].outputs.mode = 'inherited_db67';
  value.inheritedInputs = { baseTreeSha256: 'a'.repeat(64), protectedTreeSha256: 'b'.repeat(64),
    protectedFiles: 5075, reviewedChanges: ['scripts/qa-stocks-public-nss.cjs'], sourceManifestSha256: nativeAdmission.PIN.sourceManifestSha256 };
  value.inherited = { ...value.inheritedInputs, sourceSHA: head, mode: 'inherited_db67', backendExecution: 'NOT_RUN_CURRENT_HEAD',
    inheritedSourceSHA: nativeAdmission.BASE_SHA, artifactId: nativeAdmission.PIN.artifact, artifactSha256: nativeAdmission.PIN.zipSha256,
    runId: nativeAdmission.PIN.run, jobId: nativeAdmission.PIN.job, counts: nativeAdmission.COUNTS,
    databaseAcceptance: 'NOT_RUN', capacityAcceptance: 'NOT_RUN' };
  return value;
}
test('verified inherited backend retains all reported skips and still requires fresh head browser', () => {
  const result = verifyCorrectness(inheritedInput());
  assert.equal(result.backendEvidence.execution, 'NOT_RUN_CURRENT_HEAD');
  assert.equal(result.backendEvidence.inheritedFrom, nativeAdmission.BASE_SHA);
  assert.equal(result.backendEvidence.counts.numPendingTests, 132);
  assert.equal(result.backendEvidence.counts.numPendingTestSuites, 13);
  for (const change of [x => { delete x.inherited; }, x => { delete x.inheritedInputs; },
    x => x.inheritedInputs.protectedTreeSha256 = 'c'.repeat(64), x => x.inheritedInputs.protectedFiles--,
    x => x.inheritedInputs.reviewedChanges = [], x => x.inherited.sourceSHA = nativeAdmission.BASE_SHA,
    x => x.inherited.artifactSha256 = 'd'.repeat(64), x => x.inherited.counts = { ...nativeAdmission.COUNTS, numPendingTests: 0 },
    x => x.event.number = 512, x => x.needs['stocks-ui-browser'].result = 'skipped',
    x => x.needs['stocks-ui-browser'].result = 'failure', x => x.needs['stocks-native-backend-admission'].result = 'failure',
    x => x.needs['stocks-native-backend-admission'].outputs.mode = 'full']) {
    const value = inheritedInput(); change(value); assert.throws(() => verifyCorrectness(value));
  }
});
test('native browser workflow preserves the seven cases and does not change sandbox or host security policy', () => {
  const browser = job('stocks-ui-browser');
  assert.match(browser, /^    runs-on: ubuntu-22\.04$/m); assert.match(browser, /^    timeout-minutes: 30$/m);
  for (const name of nativeAdmission.BROWSER_STEPS) assert.match(browser, new RegExp('^        id: ' + name + '$', 'm'));
  assert.match(browser, /VOLTEX_STOCKS_NATIVE_BROWSER: '1'/);
  assert.match(browser, /^      PLAYWRIGHT_BROWSERS_PATH: \/usr\/lib\/voltex-stocks-browser-b7726070ca707965e9a17b38e4f15ba283bf6f65c339626c092862af7b19badc\/browsers$/m);
  assert.match(browser, /sudo \/usr\/bin\/env -i PATH=\/usr\/bin:\/bin LANG=C LC_ALL=C \/usr\/bin\/python3 -I scripts\/stocks-browser-native\/provision\.py/);
  assert.ok(browser.indexOf('id: native-qualification') < browser.indexOf('npm ci'));
  assert.ok(browser.indexOf('id: native-cleanup') < browser.indexOf('--browser-result'));
  assert.match(browser, /id: native-cleanup\n        if: always\(\)/);
  assert.match(browser, /NATIVE_BROWSER_STEPS: \$\{\{ toJSON\(steps\) \}\}/);
  assert.doesNotMatch(browser, /seccomp|--no-sandbox|apparmor=|sysctl|continue-on-error|\/tmp\/stocks-ui-qa/);
  assert.match(browser, /--browser-executable \/usr\/lib\/voltex-stocks-browser-[a-f0-9]{64}\/chrome\/chrome/);
  const admission = job('stocks-native-backend-admission');
  assert.match(admission, /actions: read/); assert.match(admission, /contents: read/);
  assert.match(admission, /fetch-depth: 0/); assert.match(admission, /node scripts\/stocks-browser-native-admission\.cjs/);
  assert.match(job('stocks-correctness-result'), /STOCKS_NATIVE_ADMISSION: stocks-native-admission-evidence/);
  assert.match(workflow.split('\n')[3], /'scripts\/stocks-browser-native\/\*\*', 'scripts\/stocks-browser-native-\*'/);
});
test('consumed diagnostic pins and unchanged plan identity cannot be expanded by the review branch', () => {
  assert.match(job('stocks-auth-one-burst'), /head\.sha == '75e2453ed85c03d12114f2e29ba9acf0f6e6f31f'/);
  for (const name of ['stocks-auth-preparation', 'stocks-auth-http-paired']) {
    assert.match(job(name), /head\.sha == 'dc5327b7def5ac4f5b448f820bbd279b7072d7f9'/);
    assert.ok(!job(name).includes(CORRECTNESS_BRANCH));
  }
  const plan = JSON.parse(readFileSync(new URL('./review-plan-512.json', import.meta.url)));
  assert.deepEqual(plan, { schema: 1, id: 'pr512-targeted-http-attribution-20261014',
    baseline: '06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb', stage: 'targeted-http' });
});
