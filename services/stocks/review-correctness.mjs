// CI correctness evidence only. This never certifies performance or publication.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { HEAVY_FLAGS, validateCorrectnessScope } from './review-plan.mjs';
import nativeAdmission from '../../scripts/stocks-browser-native-admission.cjs';

export const REQUIRED_JOBS = ['stocks-pg-discovery', 'stocks-review-selection', 'isolated-simulator',
  'frontend-regression', 'bounded-stock-runtime', 'stocks-full-backend-offline', 'stocks-ui-browser', 'stocks-native-backend-admission'];
export const DISCOVERY_PATH = 'src/services/testMarkets/__tests__/vtaNativeCoexistence.discovery.test.ts';
const DISCOVERY_TEST = 'registers the real skipped suite without constructing Prisma or accessing the database';
const DISCOVERY_SUITE = 'optional VTA PostgreSQL suite discovery';
const OPTIONAL_PG_SUITE = 'VTA Spot and native Futures share the actual disposable database';
const OPTIONAL_PG_TESTS = [
  'Spot projection values VTA and cash in its own scope without changing real funds',
  'VTA never reaches external collateral prices; ordinary ETH and native open/close still work',
  'sale USDT follows existing native cash policy once, including initialization and restart',
  'prelisting value is unavailable; read-only receipt recovery is account-scoped and persists',
];

export function verifyDiscoveryReport(report) {
  assert.equal(report.success, true, 'targeted discovery Jest run failed');
  assert.equal(report.numTotalTestSuites, 1);
  assert.equal(report.numPassedTestSuites, 1);
  assert.equal(report.numFailedTestSuites, 0);
  assert.equal(report.numPendingTestSuites, 0);
  assert.equal(report.numRuntimeErrorTestSuites, 0);
  assert.equal(report.wasInterrupted, false);
  assert.equal(report.numTotalTests, 5);
  assert.equal(report.numPassedTests, 1, 'the discovery proof must actually execute');
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 4, 'only the four optional PostgreSQL cases may skip');
  assert.equal(report.numTodoTests, 0);
  assert.equal(report.testResults.length, 1);
  const suite = report.testResults[0];
  assert.ok(suite.name.replaceAll('\\', '/').endsWith('/' + DISCOVERY_PATH));
  // The installed Jest formatter labels this mixed 1-pass/4-pending suite
  // "focused". A different label is inconsistent with this exact inventory.
  assert.equal(suite.status, 'focused');
  assert.equal(suite.message, '');
  assert.equal(suite.assertionResults.length, 5);
  const passed = suite.assertionResults.filter(row => row.status === 'passed');
  assert.equal(passed.length, 1);
  assert.equal(passed[0].title, DISCOVERY_TEST);
  assert.deepEqual(passed[0].ancestorTitles, [DISCOVERY_SUITE]);
  const pending = suite.assertionResults.filter(row => row.status === 'pending');
  assert.deepEqual(pending.map(row => row.title).sort(), [...OPTIONAL_PG_TESTS].sort());
  for (const row of pending) assert.deepEqual(row.ancestorTitles, [DISCOVERY_SUITE, OPTIONAL_PG_SUITE]);
  for (const row of suite.assertionResults) {
    assert.deepEqual(row.failureMessages, []);
    assert.equal(row.fullName, [...row.ancestorTitles, row.title].join(' '));
  }
  return { status: 'PASS', passedAssertions: 1, optionalPostgresAssertionsNotRun: 4, databaseAcceptance: 'NOT_RUN' };
}

export function verifyCorrectness({ event, repository, eventName, headRef, head, needs, inherited, inheritedInputs }) {
  assert.equal(eventName, 'pull_request');
  validateCorrectnessScope({ event, repository, headRef });
  assert.equal(head, event.pull_request.head.sha, 'checkout differs from the exact PR head');
  assert.deepEqual(Object.keys(needs).sort(), [...REQUIRED_JOBS].sort(), 'required correctness job inventory changed');
  for (const name of REQUIRED_JOBS.filter(name => name !== 'stocks-full-backend-offline')) assert.equal(needs[name]?.result, 'success', name + ' did not complete successfully');
  let backendEvidence = { execution: 'CURRENT_HEAD', sourceSHA: head };
  if (needs['stocks-full-backend-offline']?.result === 'skipped') {
    nativeAdmission.validateScope({ event, repository, eventName, headRef, head });
    assert.equal(needs['stocks-native-backend-admission'].outputs?.mode, 'inherited_db67');
    nativeAdmission.verifyInheritedReport(inherited, head);
    assert.ok(inheritedInputs, 'independently recomputed protected input closure required');
    for (const key of ['baseTreeSha256', 'protectedTreeSha256', 'protectedFiles', 'reviewedChanges', 'sourceManifestSha256']) {
      assert.deepEqual(inherited[key], inheritedInputs[key], 'inherited input proof mismatch: ' + key);
    }
    backendEvidence = { execution: 'NOT_RUN_CURRENT_HEAD', inheritedFrom: nativeAdmission.BASE_SHA,
      artifactId: nativeAdmission.PIN.artifact, artifactSha256: nativeAdmission.PIN.zipSha256,
      counts: nativeAdmission.COUNTS, databaseAcceptance: 'NOT_RUN', protectedInputs: inheritedInputs };
  } else assert.equal(needs['stocks-full-backend-offline']?.result, 'success', 'full backend neither succeeded nor has verified inherited evidence');
  for (const flag of HEAVY_FLAGS) assert.equal(needs['stocks-review-selection'].outputs?.[flag], 'false', flag + ' must not schedule consumed performance evidence');
  return { sourceSHA: head, status: 'PASS_CORRECTNESS_ONLY', capacityAcceptance: 'NOT_RUN',
    publicationReadiness: 'NOT_EVALUATED', priorPerformanceFailures: 'RETAINED', requiredJobs: REQUIRED_JOBS, backendEvidence };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request');
  validateCorrectnessScope({ event, repository: process.env.GITHUB_REPOSITORY, headRef: process.env.GITHUB_HEAD_REF });
  assert.equal(head, event.pull_request.head.sha);
  const needs = process.argv[2] === '--discovery-report' ? null : JSON.parse(process.env.STOCKS_CORRECTNESS_NEEDS);
  let inherited, inheritedInputs;
  if (needs?.['stocks-full-backend-offline']?.result === 'skipped') {
    const directory = process.env.STOCKS_NATIVE_ADMISSION;
    assert.equal(directory, 'stocks-native-admission-evidence');
    inherited = JSON.parse(readFileSync(directory + '/result.json'));
    const sourceBytes = readFileSync(directory + '/inherited-source-manifest.json');
    assert.equal(nativeAdmission.sha(sourceBytes), nativeAdmission.PIN.sourceManifestSha256);
    inheritedInputs = nativeAdmission.collectGit(process.cwd(), head, JSON.parse(sourceBytes));
  }
  const result = process.argv[2] === '--discovery-report'
    ? { sourceSHA: head, ...verifyDiscoveryReport(JSON.parse(readFileSync(process.argv[3], 'utf8'))) }
    : verifyCorrectness({ event, repository: process.env.GITHUB_REPOSITORY,
      eventName: process.env.GITHUB_EVENT_NAME, headRef: process.env.GITHUB_HEAD_REF,
      head, needs, inherited, inheritedInputs });
  console.log(JSON.stringify(result, null, 2));
}
