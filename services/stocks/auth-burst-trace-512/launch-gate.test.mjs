// Pure metadata/git fixtures only: no Docker, HTTP, SQLite, load, or git writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BASELINE_SHA, FAILURE_BASELINE_SHA, PRIOR_BACKEND_FAILURE, PRIOR_BROWSER_FAILURE,
  POLICY_PATH, WORKFLOW_PATH, ADMISSION_PATH, REPOSITORY,
  HEAD_REF, BASE_IMAGE, DISABLED_POLICY, LIMITS, hash, parseTree, normalizedWorkflow,
  canonicalTree, treeDelta, financialRows, admissionClassification, validateLaunch, validatePreparationSource,
  validateLocalLaunch } from './launch-gate.mjs';
import { tracePlanHash } from './trace-plan.mjs';

const BEFORE = '1111111111111111111111111111111111111111';
const HEAD = '2222222222222222222222222222222222222222';
const json = value => JSON.stringify(value);
const blob = text => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
const workflow = digest => `name: review\nenv:\n  AUTH_BURST_POLICY_SHA256: ${digest}\njobs: {}\n`;
const h = label => hash(`synthetic pure test: ${label}`);
const clone = value => structuredClone(value);

function fixture({ extra = {}, missing = [], handoff = 'original\nappend\n' } = {}) {
  const baseline = new Map(Object.entries({
    'services/stocks-global/server.mjs': 'synthetic unchanged server\n',
    'services/stocks-global/engine.mjs': 'synthetic unchanged financial logic\n',
    'package-lock.json': 'synthetic unchanged dependency lock\n',
    'tsconfig.json': 'synthetic unchanged compiler\n',
    'src/features/stocks/Stocks.tsx': 'synthetic unchanged UI\n',
    'docs/AI_HANDOFF.md': 'original\n',
    [ADMISSION_PATH]: '{}',
    [WORKFLOW_PATH]: 'name: original\njobs: {}\n',
  }));
  const before = new Map(baseline);
  before.set(WORKFLOW_PATH, workflow('0'.repeat(64)));
  before.set(POLICY_PATH, json(DISABLED_POLICY));
  before.set('services/stocks/auth-burst-trace-512/launch-gate.mjs', 'synthetic reviewed source\n');
  before.set('services/stocks/auth-burst-trace-512/trace-plan.mjs', 'synthetic reviewed plan\n');
  before.set('docs/AI_HANDOFF.md', handoff);
  for (const [path, text] of Object.entries(extra)) before.set(path, text);
  for (const path of missing) before.delete(path);
  const trees = new Map([[BASELINE_SHA, baseline], [FAILURE_BASELINE_SHA, new Map(baseline)], [BEFORE, before], [HEAD, new Map(before)]]);
  const rows = ref => [...trees.get(ref)].map(([path, text]) => ({ path, mode: '100644', blob: blob(text) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const policy = { schema: 1, status: 'reviewed', reviewId: 'stocks-one-burst-512-pure-test', admissionReviewId: 'stocks-one-burst-pure-test',
    baselineSha: BASELINE_SHA, frozenSourceSha: BEFORE,
    sourceTreeSha256: hash(json(canonicalTree(rows(BEFORE), normalizedWorkflow(before.get(WORKFLOW_PATH)).sha256))),
    workflowTemplateSha256: normalizedWorkflow(before.get(WORKFLOW_PATH)).sha256,
    reviewedDelta: treeDelta(rows(BASELINE_SHA), rows(BEFORE)).filter(row => row.path !== WORKFLOW_PATH),
    financialRuntime: financialRows(rows(BASELINE_SHA)), planSha256: tracePlanHash(), limits: clone(LIMITS),
    native: { nodeVersion: 'v24.10.0', nodeSha256: h('node'), bcryptSha256: h('bcrypt'),
      nativeFilesSha256: h('native files'), dependencyInventorySha256: h('deps'),
      compiledClosureSha256: h('compiled'), baseImage: BASE_IMAGE } };
  const input = { event: { eventName: 'pull_request', action: 'synchronize', repository: REPOSITORY,
    number: 512, headRepository: REPOSITORY, baseRepository: REPOSITORY, headRef: HEAD_REF,
    headSha: HEAD, beforeSha: BEFORE, runId: '123456', runAttempt: 1, workflowPath: WORKFLOW_PATH },
  approvedPolicySha256: '', history: { workflowPath: WORKFLOW_PATH, headSha: HEAD,
    complete: true, runIds: ['123456'] }, artifacts: {} };
  const seal = () => {
    trees.get(HEAD).set(POLICY_PATH, json(policy));
    input.approvedPolicySha256 = hash(json(policy));
    trees.get(HEAD).set(WORKFLOW_PATH, workflow(input.approvedPolicySha256));
    const base = trees.get(FAILURE_BASELINE_SHA), current = trees.get(HEAD);
    const files = [...new Set([...base.keys(), ...current.keys()])].sort()
      .filter(path => path !== ADMISSION_PATH && base.get(path) !== current.get(path)).map(path => {
        let classification = 'intentionally-unknown-test-path';
        try { classification = admissionClassification(path); } catch {}
        return { path, classification, baseSHA256: base.has(path) ? hash(base.get(path)) : null,
          headSHA256: current.has(path) ? hash(current.get(path)) : null };
      });
    current.set(ADMISSION_PATH, json({ schemaVersion: 2, reviewId: policy.admissionReviewId,
      baselineSHA: FAILURE_BASELINE_SHA, priorFailure: PRIOR_BACKEND_FAILURE,
      priorBrowserFailure: PRIOR_BROWSER_FAILURE, manifestPath: ADMISSION_PATH, files }));
  };
  seal();
  const makeReceipt = (artifactId, role, proof) => ({ artifactId, runId: input.event.runId,
    sourceSha: HEAD, archiveSha256: h(`${role} archive`), downloadedSha256: h(`${role} archive`),
    bytes: 100, proofSha256: hash(json(proof)), proofText: json(proof) });
  const compiled = { schema: 'stocks-one-burst-compiled-512-v1', sourceSha: HEAD,
    sourceTreeSha256: policy.sourceTreeSha256, closureSha256: policy.native.compiledClosureSha256,
    buildProvenanceSha256: h('build provenance') };
  input.artifacts.compiled = makeReceipt('1001', 'compiled', compiled);
  const prep = { schema: 'stocks-one-burst-preparation-512-v1', sourceSha: HEAD,
    sourceTreeSha256: policy.sourceTreeSha256, compiledArtifactId: '1001',
    compiledArchiveSha256: input.artifacts.compiled.archiveSha256,
    buildProvenanceSha256: compiled.buildProvenanceSha256, closureSha256: compiled.closureSha256,
    imageId: `sha256:${h('image')}`, imageArchiveSha256: h('image tar'), native: clone(policy.native),
    sourceContextSha256: h('source context'), seedSha256: h('seed'), derivedManifestSha256: h('derived') };
  input.artifacts.preparation = makeReceipt('1002', 'preparation', prep);
  input.artifacts.inputs = makeReceipt('1003', 'inputs', { schema: 'stocks-one-burst-inputs-512-v1',
    ...Object.fromEntries(['sourceSha', 'sourceTreeSha256', 'imageId', 'imageArchiveSha256',
      'seedSha256', 'sourceContextSha256', 'derivedManifestSha256'].map(key => [key, prep[key]])) });
  const calls = [];
  const git = args => {
    calls.push([...args]);
    if (args[0] === 'rev-parse') return HEAD;
    if (args[0] === 'merge-base') return args[1];
    if (args[0] === 'ls-tree') return rows(args.at(-1)).map(row => `${row.mode} blob ${row.blob}\t${row.path}\0`).join('');
    if (args[0] === 'cat-file') {
      const split = args[2].indexOf(':'); const ref = args[2].slice(0, split), path = args[2].slice(split + 1);
      if (!trees.get(ref)?.has(path)) throw new Error('safe fake missing path');
      return trees.get(ref).get(path);
    }
    throw new Error('unexpected command');
  };
  const setProof = (role, mutate) => {
    const receipt = input.artifacts[role], proof = JSON.parse(receipt.proofText);
    mutate(proof); receipt.proofText = json(proof); receipt.proofSha256 = hash(receipt.proofText);
  };
  return { input, policy, git, calls, trees, rows, seal, setProof,
    run: () => validateLaunch(input, policy, { git }) };
}
function blocked(f, reason) {
  const result = f.run();
  assert.equal(result.eligible, false, json(result)); assert.equal(result.status, 'NOT_RUN');
  assert.equal(result.releaseGatePass, false); assert.equal(result.capacityAcceptance, 'NOT_EVALUATED');
  assert.equal(result.backendStatus, 'PRIOR_FAIL_RETAINED'); assert.equal(result.browserStatus, 'PRIOR_FAIL_RETAINED');
  if (reason) assert.equal(result.reason, reason);
}
function localFixture() {
  const f = fixture(); f.input.jobName = 'auth-burst';
  const original = JSON.parse(f.input.artifacts.preparation.proofText);
  const paths = { preparation: [
    ['stocks-auth-preparation-output/preparation.json', h('report')],
    ['stocks-auth-preparation-output/public-context/runtime-source-manifest.json', h('manifest')],
    ['stocks-auth-preparation-output/private/runtime-output/inside-proof.json', h('inside')],
    ['stocks-auth-preparation-output/trace-overlay/derived-manifest.json', original.derivedManifestSha256],
  ], inputs: [['runtime-image.tar', original.imageArchiveSha256],
    ['runtime-output/private/seed/accounts.sqlite', original.seedSha256]] };
  for (const role of ['preparation', 'inputs']) {
    const proof = JSON.parse(f.input.artifacts[role].proofText);
    const files = paths[role].map(([path, sha256]) => ({ path, bytes: 100, sha256 }));
    proof.schema = `stocks-one-burst-${role}-local-512-v1`; proof.filesSha256 = hash(json(files));
    const proofText = json(proof);
    f.input.artifacts[role] = { kind: 'local', runId: f.input.event.runId, jobName: f.input.jobName,
      sourceSha: HEAD, files, proofText, proofSha256: hash(proofText) };
  }
  f.run = () => validateLocalLaunch(f.input, f.policy, { git: f.git }); return f;
}

test('disabled default does not read git or authorize any workload', () => {
  const result = validateLaunch(undefined, DISABLED_POLICY, { git: () => assert.fail('must not read') });
  assert.equal(result.eligible, false); assert.equal(result.status, 'NOT_RUN'); assert.equal(result.reason, 'POLICY_DISABLED');
  assert.equal(validateLaunch(undefined, undefined).eligible, false);
});
test('exact frozen transition with concrete same-run receipts is eligible, never release/capacity PASS', () => {
  const f = fixture(), result = f.run();
  assert.equal(result.eligible, true, json(result)); assert.equal(result.status, 'ELIGIBLE');
  assert.equal(result.releaseGatePass, false); assert.equal(result.capacityAcceptance, 'NOT_EVALUATED');
  assert.equal(result.backendStatus, 'PRIOR_FAIL_RETAINED'); assert.equal(result.browserStatus, 'PRIOR_FAIL_RETAINED');
  assert.equal(result.sourceSha, HEAD); assert.equal(result.limits.ordinary, 50); assert.equal(result.limits.bursts, 1);
  assert.ok(f.calls.every(args => ['rev-parse', 'merge-base', 'ls-tree', 'cat-file'].includes(args[0])));
});
test('source-only preparation never grants workload eligibility or accepts guessed artifacts', () => {
  const f = fixture(), { artifacts, ...input } = f.input;
  const result = validatePreparationSource(input, f.policy, { git: f.git });
  assert.equal(result.preparationEligible, true, json(result)); assert.equal(result.eligible, false);
  assert.equal(result.status, 'PREPARATION_ELIGIBLE'); assert.equal(result.releaseGatePass, false);
  assert.equal(result.capacityAcceptance, 'NOT_EVALUATED'); assert.equal(result.imageId, undefined);
  assert.equal(validatePreparationSource(f.input, f.policy, { git: f.git }).preparationEligible, false);
  assert.equal(validateLaunch(input, f.policy, { git: f.git }).eligible, false);
  const drift = clone(input); drift.event.runAttempt = 2;
  assert.equal(validatePreparationSource(drift, f.policy, { git: f.git }).preparationEligible, false);
});
test('same-job local prepared files retain exact source/compiled binding without fictitious archive IDs', () => {
  const f = localFixture(), result = f.run(); assert.equal(result.eligible, true, json(result));
  assert.equal(result.receiptKind, 'LOCAL_SAME_JOB'); assert.equal(result.compiledArtifactId, '1001');
  assert.equal(result.artifactIds, undefined); assert.equal(result.releaseGatePass, false);
  assert.equal(validateLaunch(f.input, f.policy, { git: f.git }).eligible, false);
});
test('local receipts reject other jobs/runs/heads, unknown kinds and fabricated remote metadata', () => {
  const changes = [f => { f.input.artifacts.preparation.jobName = 'other-job'; },
    f => { f.input.artifacts.inputs.runId = '9999'; }, f => { f.input.artifacts.inputs.sourceSha = BEFORE; },
    f => { f.input.artifacts.preparation.kind = 'remote'; }, f => { f.input.artifacts.inputs.artifactId = 'made-up'; },
    f => { f.input.artifacts.preparation.archiveSha256 = h('pretend archive'); },
    f => { f.input.event.runAttempt = 2; }, f => { f.input.jobName = '../job'; }];
  for (const change of changes) { const f = localFixture(); change(f); blocked(f); }
});
test('local canonical files, proof hashes and image/seed/derived links fail closed on tampering', () => {
  const changes = [f => { f.input.artifacts.preparation.files.pop(); },
    f => { f.input.artifacts.inputs.files[0].path = '../image'; },
    f => { f.input.artifacts.inputs.files[0].bytes = 0; }, f => { f.input.artifacts.preparation.proofText += ' '; },
    f => { f.input.artifacts.inputs.files[0].sha256 = h('different image');
      f.setProof('inputs', p => { p.filesSha256 = hash(json(f.input.artifacts.inputs.files)); }); },
    f => { f.input.artifacts.preparation.files.at(-1).sha256 = h('different derived');
      f.setProof('preparation', p => { p.filesSha256 = hash(json(f.input.artifacts.preparation.files)); }); }];
  for (const change of changes) { const f = localFixture(); change(f); blocked(f); }
});
test('unknown fields are rejected throughout trusted metadata and proof schemas', () => {
  const targets = [f => f.input, f => f.policy, f => f.policy.native, f => f.policy.limits,
    f => f.input.event, f => f.input.history, f => f.input.artifacts,
    ...['compiled', 'preparation', 'inputs'].map(role => f => f.input.artifacts[role])];
  for (const target of targets) { const f = fixture(); target(f).injected = 'ignored?'; blocked(f); }
  for (const role of ['compiled', 'preparation', 'inputs']) {
    const f = fixture(); f.setProof(role, p => { p.injected = true; }); blocked(f, 'UNKNOWN_OR_MISSING_FIELD');
  }
});
test('missing, malformed or guessed artifact receipts are never eligibility', () => {
  for (const value of [null, {}, [], 'unknown']) { const f = fixture(); f.input.artifacts = value; blocked(f); }
  for (const field of ['artifactId', 'runId', 'archiveSha256', 'proofSha256']) {
    const f = fixture(); f.input.artifacts.compiled[field] = 'pending'; blocked(f);
  }
});
test('PR, repository, branch, event and workflow scope are exact', () => {
  const changes = { number: 497, repository: 'attacker/-', headRepository: 'attacker/-',
    baseRepository: 'attacker/-', headRef: 'main', eventName: 'workflow_dispatch', action: 'opened',
    workflowPath: '.github/workflows/other.yml' };
  for (const [key, value] of Object.entries(changes)) { const f = fixture(); f.input.event[key] = value; blocked(f); }
});
test('replays, reopened PRs, stale history, repeated runs and later commits remain NOT_RUN', () => {
  const changes = [f => { f.input.event.runAttempt = 2; }, f => { f.input.event.action = 'reopened'; },
    f => { f.input.history.complete = false; }, f => { f.input.history.headSha = BEFORE; },
    f => { f.input.history.runIds.push('123457'); }, f => { f.input.history.runIds = []; },
    f => { f.input.history.runIds = ['123455']; }, f => { f.input.event.beforeSha = BASELINE_SHA; },
    f => { f.trees.get(BEFORE).set(POLICY_PATH, json(f.policy)); }];
  for (const mutate of changes) { const f = fixture(); mutate(f); blocked(f); }
});
test('checkout, ancestry, tree modes, duplicate entries and adapter failure are fail closed', () => {
  const f = fixture();
  for (const bad of [args => args[0] === 'rev-parse' ? BEFORE : f.git(args),
    args => args[0] === 'merge-base' ? HEAD : f.git(args),
    args => args[0] === 'ls-tree' ? `120000 blob ${'a'.repeat(40)}\tlink\0` : f.git(args),
    () => { throw new Error('secret-safe message must not escape'); }]) {
    const result = validateLaunch(f.input, f.policy, { git: bad });
    assert.equal(result.eligible, false); assert.ok(!json(result).includes('secret-safe'));
  }
  assert.throws(() => parseTree(`100644 blob ${'a'.repeat(40)}\ta\0`.repeat(2)));
  assert.throws(() => parseTree(`100644 blob ${'a'.repeat(40)}\t../a\0`));
});
test('approved policy bytes and exactly one normalized workflow digest literal are required', () => {
  const mutations = [f => { f.input.approvedPolicySha256 = h('different'); },
    f => { f.trees.get(HEAD).set(POLICY_PATH, `${json(f.policy)}\n`); },
    f => { f.trees.get(HEAD).set(WORKFLOW_PATH, workflow(h('different'))); },
    f => { f.trees.get(HEAD).set(WORKFLOW_PATH, workflow(f.input.approvedPolicySha256) + 'extra: true\n'); },
    f => { f.trees.get(HEAD).set(WORKFLOW_PATH, workflow(f.input.approvedPolicySha256).repeat(2)); }];
  for (const mutate of mutations) { const f = fixture(); mutate(f); blocked(f); }
});
test('new source bytes after freeze fail even when the later tree digest is substituted', () => {
  const f = fixture(); f.trees.get(HEAD).set('services/stocks/auth-burst-trace-512/trace-plan.mjs', 'changed after review');
  f.policy.sourceTreeSha256 = hash(json(canonicalTree(f.rows(HEAD), f.policy.workflowTemplateSha256))); f.seal();
  blocked(f, 'SOURCE_CHANGED_AFTER_FREEZE');
});
test('baseline financial, runtime, UI, lock, compiler and unrelated changes cannot be approved by adding delta rows', () => {
  for (const path of ['services/stocks-global/server.mjs', 'services/stocks-global/engine.mjs',
    'src/features/stocks/Stocks.tsx', 'package-lock.json', 'tsconfig.json', 'new-unreviewed.txt',
    'services/stocks/auth-http-fixture-512/run.mjs', 'scripts/qa-backend-full-offline.cjs',
    '.github/workflows/deploy.yml']) {
    blocked(fixture({ extra: { [path]: 'changed before freeze and explicitly included in policy delta' } }),
      'PROTECTED_OR_UNKNOWN_PATH_CHANGE');
  }
});
test('source tree, exact reviewed delta, financial blob manifest and append-only handoff cannot drift', () => {
  const mutations = [f => { f.policy.sourceTreeSha256 = h('wrong tree'); f.seal(); },
    f => { f.policy.reviewedDelta = []; f.seal(); },
    f => { f.policy.financialRuntime[0].blob = 'a'.repeat(40); f.seal(); }];
  for (const mutate of mutations) { const f = fixture(); mutate(f); blocked(f); }
  blocked(fixture({ handoff: 'rewritten history' }), 'HANDOFF_NOT_APPEND_ONLY');
  blocked(fixture({ missing: ['services/stocks-global/engine.mjs'] }), 'PROTECTED_OR_UNKNOWN_PATH_CHANGE');
});
test('excluded admission self-binding is constrained by exact source bytes and retained real FAIL evidence', () => {
  const mutations = [m => { m.schemaVersion = 3; }, m => { m.reviewId = 'unreviewed'; },
    m => { m.baselineSHA = BASELINE_SHA; }, m => { m.priorFailure.status = 'PASS'; },
    m => { m.priorFailure.artifactSHA256 = h('replacement failure'); },
    m => { m.priorBrowserFailure.artifactId++; }, m => { m.priorBrowserFailure.extra = 'injected'; },
    m => { m.manifestPath = 'some-other-manifest.json'; }, m => { m.files.pop(); },
    m => { m.files.push(clone(m.files[0])); }, m => { m.files[0].headSHA256 = h('wrong'); },
    m => { m.files[0].baseSHA256 = h('wrong'); }, m => { m.files[0].classification = 'runtime'; },
    m => { m.files[0].extra = true; }, m => { m.extra = 'arbitrary'; }];
  for (const mutate of mutations) {
    const f = fixture(), manifest = JSON.parse(f.trees.get(HEAD).get(ADMISSION_PATH));
    mutate(manifest); f.trees.get(HEAD).set(ADMISSION_PATH, json(manifest)); blocked(f);
  }
});
test('unreviewed resource/plan changes or current-head self-binding are rejected', () => {
  for (const key of Object.keys(LIMITS)) {
    const f = fixture(); f.policy.limits[key] = typeof LIMITS[key] === 'number' ? LIMITS[key] + 1 : 'changed';
    blocked(f, 'LIMITS_CHANGED');
  }
  const f = fixture(); f.policy.planSha256 = h('different plan'); blocked(f, 'PLAN_CHANGED');
  const g = fixture(); g.policy.sourceSha = HEAD; blocked(g, 'UNKNOWN_OR_MISSING_FIELD');
});
test('artifact head/run/archive/proof tampering and reused IDs are rejected', () => {
  const changes = [f => { f.input.artifacts.compiled.sourceSha = BEFORE; },
    f => { f.input.artifacts.preparation.runId = '123455'; },
    f => { f.input.artifacts.inputs.downloadedSha256 = h('tampered'); },
    f => { f.input.artifacts.compiled.proofText += ' '; },
    f => { f.input.artifacts.inputs.artifactId = f.input.artifacts.compiled.artifactId; }];
  for (const mutate of changes) { const f = fixture(); mutate(f); blocked(f); }
});
test('compiled closure and native/source/image/seed proof crossbindings reject tampering', () => {
  for (const [role, field, value] of [
    ['compiled', 'sourceTreeSha256', h('other tree')], ['compiled', 'closureSha256', h('other closure')],
    ['preparation', 'compiledArtifactId', '9999'], ['preparation', 'compiledArchiveSha256', h('other archive')],
    ['preparation', 'buildProvenanceSha256', h('other build')], ['inputs', 'imageId', `sha256:${h('other image')}`],
    ['inputs', 'seedSha256', h('other seed')], ['inputs', 'derivedManifestSha256', h('other derived')],
    ['inputs', 'imageArchiveSha256', h('other image tar')], ['inputs', 'sourceContextSha256', h('other context')],
  ]) { const f = fixture(); f.setProof(role, proof => { proof[field] = value; }); blocked(f); }
  for (const field of Object.keys(fixture().policy.native)) {
    const f = fixture(); f.setProof('preparation', proof => { proof.native[field] = 'tampered'; });
    blocked(f, 'NATIVE_RUNTIME_DRIFT');
  }
});
