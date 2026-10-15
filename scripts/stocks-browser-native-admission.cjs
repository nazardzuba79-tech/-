'use strict';
// Scheduling only: inherited db67 backend evidence is never a current-head rerun.
// The older PR512 admission and its 128-path limit are deliberately independent.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const assert = require('node:assert/strict'), crypto = require('node:crypto'), zlib = require('node:zlib');
const REPOSITORY = 'nazardzuba79-tech/-';
const BRANCH = 'codex/stocks-review-20261015', BASE_REF = 'dot/stocks-owner-usdt-portfolio-20261013';
const BASE_SHA = 'db67cc02ed82eea6b2cfdfdc30599592357bbe68';
const PLAN_PATH = 'scripts/stocks-browser-native-review.json';
const PIN = Object.freeze({ run: 38709047400, job: 116335580825, artifact: 11960034954, repositoryId: 1341543679,
  zipBytes: 772680, zipSha256: '88596473a3d742d66062d7aa4dc53ddc4d584385185f449f636b4f8e92b19e8d',
  artifactManifestSha256: '4c994c025bdcf7e948f48a83daad73eb66cdbb5a9a7bf8915beaedbb3817a43b',
  sourceManifestSha256: '09da545b3113378eda6dc5d8661cd0cf4da38426702971a3fc9d91dbf273961e' });
const COUNTS = Object.freeze({ numTotalTestSuites: 252, numPassedTestSuites: 239, numFailedTestSuites: 0,
  numPendingTestSuites: 13, numTotalTests: 3744, numPassedTests: 3612, numFailedTests: 0, numPendingTests: 132, numTodoTests: 0 });
const BROWSER_STEPS = Object.freeze(['native-provision', 'chrome-preflight', 'native-qualification', 'panel-overview',
  'navigation', 'widgets', 'widget-navigation', 'overload', 'owner-wallet', 'public-host', 'native-cleanup']);
// Exact QA-only surface. No runtime/compiler/config/package/lock/schema/backend test path can be exempted.
const ALLOWED_PATHS = new Set([
  '.github/workflows/stocks-review.yml', PLAN_PATH,
  'docs/AI_HANDOFF.md',
  'scripts/stocks-browser-native-admission.cjs', 'scripts/stocks-browser-native-admission.test.cjs',
  'services/stocks/review-correctness.mjs', 'services/stocks/review-correctness.test.mjs',
  'services/stocks/auth-burst-trace-512/workflow.test.mjs',
  ...['qa-stocks-public-nss', 'qa-stocks-browser-launch', 'qa-stocks-chrome-preflight'].flatMap(n => ['scripts/' + n + '.cjs', 'scripts/' + n + '.test.cjs']),
  ...['manifest.json', 'chain.cjs', 'installation.cjs', 'extract.py', 'provision.py', 'qualification.cjs',
    'README.md', 'native.test.cjs', 'provision_test.py', 'playwright/package.json', 'playwright/package-lock.json']
    .map(n => 'scripts/stocks-browser-native/' + n),
]);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function exactKeys(value, keys) { assert.ok(value && typeof value === 'object' && !Array.isArray(value)); assert.deepEqual(Object.keys(value).sort(), [...keys].sort()); }
function validateScope({ event, eventName, repository, headRef, head }) {
  assert.equal(eventName, 'pull_request'); assert.equal(repository, REPOSITORY);
  const pr = event?.pull_request; assert.equal(event?.number, 528); assert.equal(pr?.number, 528);
  assert.equal(pr?.head?.repo?.full_name, REPOSITORY); assert.equal(pr?.base?.repo?.full_name, REPOSITORY);
  assert.equal(pr?.head?.ref, BRANCH); assert.equal(headRef, BRANCH); assert.equal(pr?.base?.ref, BASE_REF);
  assert.match(head, /^[a-f0-9]{40}$/); assert.notEqual(head, BASE_SHA); assert.equal(pr.head.sha, head);
}
function verifyMetadata({ run, job, artifact }) {
  assert.equal(run.id, PIN.run); assert.equal(run.run_attempt, 1); assert.equal(run.status, 'completed');
  assert.equal(run.event, 'pull_request'); assert.equal(run.head_sha, BASE_SHA); assert.equal(run.head_branch, BRANCH);
  assert.equal(run.repository?.id, PIN.repositoryId); assert.equal(run.head_repository?.id, PIN.repositoryId);
  // Overall run was FAIL because its browser failed. Only the independently successful backend job is inherited.
  assert.equal(job.id, PIN.job); assert.equal(job.run_id, PIN.run); assert.equal(job.name, 'stocks-full-backend-offline');
  assert.equal(job.status, 'completed'); assert.equal(job.conclusion, 'success');
  assert.equal(artifact.id, PIN.artifact); assert.equal(artifact.name, 'stocks-full-backend-' + BASE_SHA);
  assert.equal(artifact.expired, false); assert.equal(artifact.size_in_bytes, PIN.zipBytes);
  assert.equal(artifact.digest, 'sha256:' + PIN.zipSha256);
  assert.deepEqual(artifact.workflow_run, { id: PIN.run, repository_id: PIN.repositoryId,
    head_repository_id: PIN.repositoryId, head_branch: BRANCH, head_sha: BASE_SHA });
  return true;
}
function readZip(bytes) {
  assert.equal(bytes.length, PIN.zipBytes); assert.equal(sha(bytes), PIN.zipSha256, 'retained artifact ZIP changed');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  assert.ok(end >= 0); assert.equal(end + 22 + bytes.readUInt16LE(end + 20), bytes.length);
  assert.equal(bytes.readUInt16LE(end + 4), 0); assert.equal(bytes.readUInt16LE(end + 6), 0);
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  assert.equal(bytes.readUInt16LE(end + 8), count); assert.equal(count, 21); assert.equal(start + size, end);
  const files = new Map(); let pos = start, total = 0;
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(pos), 0x02014b50);
    const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10), compressed = bytes.readUInt32LE(pos + 20), length = bytes.readUInt32LE(pos + 24);
    const names = bytes.readUInt16LE(pos + 28), extra = bytes.readUInt16LE(pos + 30), comment = bytes.readUInt16LE(pos + 32), local = bytes.readUInt32LE(pos + 42);
    const name = bytes.subarray(pos + 46, pos + 46 + names).toString('utf8');
    assert.match(name, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/); assert.ok(!files.has(name));
    assert.equal(flags & ~0x808, 0); assert.ok(method === 0 || method === 8); assert.ok(length <= 16 * 1024 * 1024);
    total += length; assert.ok(total <= 32 * 1024 * 1024); assert.ok(local + 30 < start);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50); assert.equal(bytes.readUInt16LE(local + 6), flags); assert.equal(bytes.readUInt16LE(local + 8), method);
    const localNames = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28);
    assert.equal(bytes.subarray(local + 30, local + 30 + localNames).toString('utf8'), name);
    const dataAt = local + 30 + localNames + localExtra; assert.ok(dataAt + compressed <= start);
    const payload = bytes.subarray(dataAt, dataAt + compressed);
    const raw = method === 0 ? Buffer.from(payload) : zlib.inflateRawSync(payload, { maxOutputLength: 16 * 1024 * 1024 });
    assert.equal(raw.length, length); files.set(name, raw); pos += 46 + names + extra + comment;
  }
  assert.equal(pos, end); return files; // In-memory only; no archive extraction onto the runner.
}
function verifyEvidence(files) {
  const get = name => { assert.ok(files.has(name), 'missing retained artifact member: ' + name); return files.get(name); };
  assert.equal(sha(get('artifact-manifest.json')), PIN.artifactManifestSha256);
  const inventory = JSON.parse(get('artifact-manifest.json')); assert.equal(inventory.length, 20);
  assert.deepEqual([...files.keys()].sort(), ['artifact-manifest.json', ...inventory.map(x => x.path)].sort());
  for (const item of inventory) { assert.equal(get(item.path).length, item.bytes); assert.equal(sha(get(item.path)), item.sha256, item.path); }
  assert.equal(sha(get('source-manifest.json')), PIN.sourceManifestSha256);
  const source = JSON.parse(get('source-manifest.json')), result = JSON.parse(get('result.json')), jest = JSON.parse(get('jest.json'));
  assert.equal(source.sha, BASE_SHA); assert.equal(source.files.length, 5097); assert.equal(source.tests.length, 252);
  assert.equal(result.sourceSHA, BASE_SHA); assert.equal(result.status, 'PASS_WITH_REPORTED_DATABASE_SKIPS');
  assert.deepEqual(result.counts, COUNTS); assert.equal(result.originalCriteriaUnchanged, true);
  assert.equal(result.databaseAcceptance, 'NOT_RUN'); assert.equal(result.capacityClaim, false);
  assert.equal(result.containerExitCode, 0); assert.equal(result.attachResult.code, 0); assert.equal(result.attachResult.signal, null);
  for (const key of ['oomKilled', 'timedOut', 'logOverflow']) assert.equal(result[key], false); assert.deepEqual(result.cleanupErrors, []);
  for (const [key, value] of Object.entries(COUNTS)) assert.equal(jest[key], value);
  assert.equal(jest.success, true); assert.equal(jest.wasInterrupted, false); assert.equal(jest.numRuntimeErrorTestSuites, 0);
  assert.equal(jest.testResults.length, 252); assert.deepEqual(jest.openHandles, []);
  return { source, counts: COUNTS, skippedSuites: result.skippedSuites, partiallySkippedSuites: result.partiallySkippedSuites };
}
function parseTree(raw) {
  const rows = new Map();
  for (const line of raw.toString('utf8').split('\0').filter(Boolean)) {
    const m = /^(100644|100755) blob ([a-f0-9]{40}) +([0-9]+)\t([^\0\r\n]+)$/.exec(line);
    assert.ok(m, 'only ordinary exact Git blobs may be inherited'); assert.ok(!rows.has(m[4]));
    rows.set(m[4], { path: m[4], mode: m[1], blob: m[2], bytes: Number(m[3]) });
  }
  assert.ok(rows.size > 0 && rows.size < 20000); return rows;
}
function verifyBackendWorkflow(oldWorkflow, newWorkflow) {
  const oldText = oldWorkflow.replace(/\r\n/g, '\n'), newText = newWorkflow.replace(/\r\n/g, '\n');
  const header = text => { const at = text.indexOf('\njobs:\n'); assert.ok(at >= 0); return text.slice(0, at); };
  const trigger = "'scripts/qa-stocks*'";
  assert.equal(header(oldText).split(trigger).length, 2);
  assert.equal(header(newText), header(oldText).replace(trigger,
    trigger + ", 'scripts/stocks-browser-native/**', 'scripts/stocks-browser-native-*'"), 'global execution inputs changed');
  const block = text => { const m = text.match(/^  stocks-full-backend-offline:\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:|$(?![\s\S]))/m); assert.ok(m); return m[1]; };
  const before = block(oldText), after = block(newText);
  const needs = '    needs: stocks-backend-admission\n'; assert.equal(before.split(needs).length, 2);
  const condition = "      github.event.pull_request.base.ref == 'dot/stocks-owner-usdt-portfolio-20261013'))\n";
  assert.equal(before.split(condition).length, 2);
  const expected = before.replace(needs, '    needs: [stocks-backend-admission, stocks-native-backend-admission]\n')
    .replace(condition, "      github.event.pull_request.base.ref == 'dot/stocks-owner-usdt-portfolio-20261013' &&\n      (needs.stocks-native-backend-admission.result != 'success' || needs.stocks-native-backend-admission.outputs.mode != 'inherited_db67')))\n");
  assert.equal(after, expected, 'complete backend job changed outside exact reviewed scheduling clauses');
}
function verifyClosure({ prior, current, plan, source, readHead, readPrior, oldWorkflow, newWorkflow }) {
  exactKeys(plan, ['schema', 'reviewId', 'baseSHA', 'baseTreeSha256', 'changes']);
  assert.equal(plan.schema, 1); assert.equal(plan.reviewId, 'pr528-native-browser-db67-inputs-20261015'); assert.equal(plan.baseSHA, BASE_SHA);
  const ordered = rows => [...rows.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assert.equal(sha(JSON.stringify(ordered(prior))), plan.baseTreeSha256, 'complete baseline Git inventory changed');
  assert.ok(Array.isArray(plan.changes) && plan.changes.length > 0 && plan.changes.length <= ALLOWED_PATHS.size - 1);
  const reviewed = new Map();
  for (const row of plan.changes) {
    exactKeys(row, ['path', 'beforeBlob', 'beforeMode', 'afterSha256', 'afterMode']);
    assert.ok(ALLOWED_PATHS.has(row.path) && row.path !== PLAN_PATH && !reviewed.has(row.path));
    assert.match(row.afterSha256, /^[a-f0-9]{64}$/); assert.equal(row.afterMode, '100644'); reviewed.set(row.path, row);
  }
  const changed = [...new Set([...prior.keys(), ...current.keys()])].filter(p => JSON.stringify(prior.get(p)) !== JSON.stringify(current.get(p))).sort();
  assert.deepEqual(changed, [...reviewed.keys(), PLAN_PATH].sort(), 'unknown, missing or additional changed input requires FULL');
  assert.equal(prior.has(PLAN_PATH), false); assert.equal(current.get(PLAN_PATH)?.mode, '100644');
  for (const [name, row] of reviewed) {
    const before = prior.get(name), after = current.get(name); assert.ok(after, 'deletion requires FULL');
    assert.equal(before?.blob || null, row.beforeBlob); assert.equal(before?.mode || null, row.beforeMode);
    assert.equal(after.mode, row.afterMode); const contents = readHead(name, after); assert.equal(sha(contents), row.afterSha256, name);
    if (name === 'docs/AI_HANDOFF.md') {
      const original = readPrior(name); assert.ok(contents.length > original.length && contents.length - original.length <= 16384);
      assert.ok(contents.subarray(0, original.length).equals(original), 'handoff history must remain byte-identical');
    }
  }
  assert.equal(source.sha, BASE_SHA); assert.equal(source.files.length, 5097); assert.equal(source.tests.length, 252);
  const seen = new Set();
  for (const row of source.files) {
    assert.ok(!seen.has(row.path)); seen.add(row.path); const git = prior.get(row.path); assert.ok(git, row.path);
    assert.equal(git.blob, row.gitBlob); assert.equal(git.bytes, row.bytes); assert.equal(git.mode === '100755', row.executable);
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual([...prior.keys()].filter(p => !seen.has(p)).sort(), [...source.excluded].sort());
  // All job fields (including before runs-on) and global execution settings stay exact.
  verifyBackendWorkflow(oldWorkflow, newWorkflow);
  const protectedRows = ordered(current).filter(row => !ALLOWED_PATHS.has(row.path));
  assert.deepEqual(protectedRows, ordered(prior).filter(row => !ALLOWED_PATHS.has(row.path)));
  return { baseTreeSha256: plan.baseTreeSha256, protectedTreeSha256: sha(JSON.stringify(protectedRows)),
    protectedFiles: protectedRows.length, reviewedChanges: changed, sourceManifestSha256: PIN.sourceManifestSha256 };
}
function collectGit(root, head, source) {
  const git = args => cp.execFileSync('git', args, { cwd: root, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), head); git(['merge-base', '--is-ancestor', BASE_SHA, head]);
  const tree = ref => parseTree(git(['ls-tree', '-r', '-z', '-l', '--full-tree', ref]));
  const read = (ref, name) => git(['show', ref + ':' + name]);
  const plan = JSON.parse(read(head, PLAN_PATH));
  return verifyClosure({ prior: tree(BASE_SHA), current: tree(head), plan, source,
    readHead: name => read(head, name), readPrior: name => read(BASE_SHA, name), oldWorkflow: read(BASE_SHA, '.github/workflows/stocks-review.yml').toString(), newWorkflow: read(head, '.github/workflows/stocks-review.yml').toString() });
}
async function boundedBody(response, maximum) {
  const chunks = []; let size = 0; for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= maximum, 'bounded GitHub response exceeded'); chunks.push(chunk); } return Buffer.concat(chunks);
}
async function fetchEvidence(token) {
  assert.ok(typeof token === 'string' && token.length > 0, 'read-only Actions token unavailable');
  const api = 'https://api.github.com/repos/' + REPOSITORY + '/actions/';
  async function get(suffix) {
    try {
      let response; try { response = await fetch(api + suffix, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } }); } catch { throw Error('GITHUB_METADATA_REQUEST_FAILED'); }
      assert.equal(response.status, 200, 'GitHub metadata HTTP status ' + response.status);
      try { return JSON.parse(await boundedBody(response, 1024 * 1024)); } catch { throw Error('GITHUB_METADATA_BODY_INVALID_OR_TOO_LARGE'); }
    } catch (error) { error.proofStage = 'github-' + suffix.split('/')[0]; throw error; }
  }
  const [run, job, artifact] = await Promise.all([get('runs/' + PIN.run), get('jobs/' + PIN.job), get('artifacts/' + PIN.artifact)]);
  verifyMetadata({ run, job, artifact });
  let redirect;
  try { redirect = await fetch(api + 'artifacts/' + PIN.artifact + '/zip', { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } }); }
  catch { const error = Error('GITHUB_ARTIFACT_REDIRECT_REQUEST_FAILED'); error.proofStage = 'github-artifact-redirect'; throw error; }
  assert.equal(redirect.status, 302); let location;
  try { location = new URL(redirect.headers.get('location')); } catch { throw Error('GITHUB_ARTIFACT_REDIRECT_INVALID'); }
  if (location.protocol !== 'https:' || location.username || location.password ||
      !(location.hostname.endsWith('.blob.core.windows.net') || location.hostname.endsWith('.githubusercontent.com'))) {
    throw Error('GITHUB_ARTIFACT_REDIRECT_NOT_ADMITTED');
  }
  try {
    let download; try { download = await fetch(location, { redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw Error('GITHUB_ARTIFACT_DOWNLOAD_FAILED'); }
    assert.equal(download.status, 200, 'GitHub artifact HTTP status ' + download.status);
    let bytes; try { bytes = await boundedBody(download, PIN.zipBytes); } catch { throw Error('GITHUB_ARTIFACT_BODY_INVALID_OR_TOO_LARGE'); }
    return { metadata: { run, job, artifact }, bytes };
  } catch (error) { error.proofStage = 'github-artifact-download'; throw error; }
}
function verifyInheritedReport(report, head) {
  assert.equal(report.sourceSHA, head); assert.equal(report.mode, 'inherited_db67'); assert.equal(report.backendExecution, 'NOT_RUN_CURRENT_HEAD');
  assert.equal(report.inheritedSourceSHA, BASE_SHA); assert.equal(report.artifactSha256, PIN.zipSha256);
  assert.equal(report.artifactId, PIN.artifact); assert.equal(report.runId, PIN.run); assert.equal(report.jobId, PIN.job);
  assert.equal(report.sourceManifestSha256, PIN.sourceManifestSha256); assert.deepEqual(report.counts, COUNTS);
  assert.match(report.protectedTreeSha256, /^[a-f0-9]{64}$/); assert.ok(report.protectedFiles > 5000);
  assert.equal(report.databaseAcceptance, 'NOT_RUN'); assert.equal(report.capacityAcceptance, 'NOT_RUN'); return true;
}
async function main({ root = process.cwd(), scope, token, output }) {
  const report = { schema: 1, sourceSHA: scope.head, mode: 'full', backendExecution: 'REQUIRED_CURRENT_HEAD', reason: 'INHERITANCE_NOT_PROVEN' };
  let inheritedSource, stage = 'scope';
  try {
    validateScope(scope); stage = 'github-metadata-and-artifact'; const evidence = await fetchEvidence(token);
    stage = 'retained-zip-integrity'; const files = readZip(evidence.bytes);
    stage = 'retained-raw-evidence'; const verified = verifyEvidence(files);
    stage = 'exhaustive-git-input-closure';
    const inputs = collectGit(root, scope.head, verified.source);
    Object.assign(report, inputs, { mode: 'inherited_db67', backendExecution: 'NOT_RUN_CURRENT_HEAD', reason: 'EXACT_REVIEWED_QA_ONLY_IDENTICAL_PROTECTED_INPUTS',
      inheritedSourceSHA: BASE_SHA, runId: PIN.run, jobId: PIN.job, artifactId: PIN.artifact, artifactSha256: PIN.zipSha256,
      counts: verified.counts, skippedSuites: verified.skippedSuites, partiallySkippedSuites: verified.partiallySkippedSuites,
      databaseAcceptance: 'NOT_RUN', capacityAcceptance: 'NOT_RUN' });
    stage = 'inherited-report'; verifyInheritedReport(report, scope.head);
    inheritedSource = files.get('source-manifest.json');
  } catch (error) {
    report.mode = 'full'; report.backendExecution = 'REQUIRED_CURRENT_HEAD';
    report.error = { code: error instanceof assert.AssertionError ? 'PROOF_MISMATCH' : 'PROOF_UNAVAILABLE',
      stage: error.proofStage || stage, message: String(error.message).slice(0, 4000), stack: String(error.stack || '').slice(0, 8000) };
  }
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.mode === 'inherited_db67') fs.writeFileSync(path.join(output, 'inherited-source-manifest.json'), inheritedSource);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'mode=' + report.mode + '\n');
  return report;
}
function browserResult({ steps, sourceSHA, deadlineMs, now = Date.now() }) {
  assert.match(sourceSHA, /^[a-f0-9]{40}$/); assert.ok(Number.isSafeInteger(deadlineMs) && Number.isSafeInteger(now));
  assert.ok(now <= deadlineMs, 'original shared browser budget exceeded');
  for (const name of BROWSER_STEPS) assert.equal(steps?.[name]?.outcome, 'success', name + ' did not actually succeed');
  return { sourceSHA, status: 'PASS_NATIVE_BROWSER_CURRENT_HEAD', deadlineMs, completedAtMs: now,
    steps: Object.fromEntries(BROWSER_STEPS.map(name => [name, steps[name].outcome])), capacityAcceptance: 'NOT_RUN' };
}
module.exports = { REPOSITORY, BRANCH, BASE_REF, BASE_SHA, PLAN_PATH, PIN, COUNTS, ALLOWED_PATHS, sha,
  BROWSER_STEPS, browserResult, validateScope, verifyMetadata, readZip, verifyEvidence, parseTree, verifyBackendWorkflow, verifyClosure, collectGit, verifyInheritedReport, main };
if (require.main === module) {
  if (process.argv[2] === '--browser-result') {
    let report;
    try { report = browserResult({ steps: JSON.parse(process.env.NATIVE_BROWSER_STEPS), sourceSHA: process.env.QA_SOURCE_SHA, deadlineMs: Number(process.env.QA_BROWSER_DEADLINE_MS) }); }
    catch (error) { report = { sourceSHA: process.env.QA_SOURCE_SHA, status: 'FAIL', error: error.message }; process.exitCode = 1; }
    fs.mkdirSync('stocks-ui-evidence', { recursive: true }); fs.writeFileSync('stocks-ui-evidence/native-result.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } else {
  const scope = { event: JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH)), eventName: process.env.GITHUB_EVENT_NAME,
    repository: process.env.GITHUB_REPOSITORY, headRef: process.env.GITHUB_HEAD_REF, head: process.env.QA_SOURCE_SHA };
  main({ scope, token: process.env.GITHUB_TOKEN, output: path.resolve('stocks-native-admission-evidence') })
    .then(report => console.log(JSON.stringify(report))).catch(() => { console.error('NATIVE_ADMISSION_FAILED'); process.exitCode = 1; });
  }
}
