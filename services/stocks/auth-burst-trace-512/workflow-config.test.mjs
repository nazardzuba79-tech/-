// Pure config/mocked-I/O guards. No real file, native, SQLite, image or runtime
// preparation is claimed. Receipt semantics have independent pure test coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { hash, POLICY_PATH } from './launch-gate.mjs';
import { MEMBER_PATHS, COMPILED_PATHS, artifactNames } from './prepare-receipts.mjs';
import { buildPrepareConfig, buildRunConfig, constructConfig, main, validateReadSize } from './workflow-config.mjs';

const h = label => hash(`synthetic config fixture ${label}`), json = value => Buffer.from(JSON.stringify(value));
const sourceSha = '4444444444444444444444444444444444444444', runId = '888888';
function fixture({ emptyBuildLog = false } = {}) {
  const repository = path.resolve('/synthetic-config/repository'), outside = path.resolve('/synthetic-config/output');
  const sourceInput = { event: { headSha: sourceSha, runId }, approvedPolicySha256: h('policy'), history: {} };
  const policy = { sourceTreeSha256: h('tree') }, members = {};
  for (const key of ['stageReport', 'stageManifest', 'buildProvenance', 'buildLog']) members[key] = json({ unitFixture: key });
  if (emptyBuildLog) members.buildLog = Buffer.alloc(0);
  members.compiled = Object.fromEntries(COMPILED_PATHS.map(p => [p, Buffer.from('synthetic code ' + p)]));
  const compiledArchive = { artifactId: '100001', runId, sourceSha, name: artifactNames(sourceSha).compiled, expired: false,
    archiveSha256: h('zip'), downloadedSha256: h('zip'), bytes: 1000, selectedMembers: [] };
  for (const key of Object.keys(members).filter(key => key !== 'compiled')) compiledArchive.selectedMembers.push({
    path: MEMBER_PATHS[key], bytes: members[key].length, sha256: hash(members[key]) });
  for (const [p, value] of Object.entries(members.compiled)) compiledArchive.selectedMembers.push({
    path: `package/${p}`, bytes: value.length, sha256: hash(value) });
  const prepRoot = path.join(outside, 'preparation');
  const base = { repository, sourceInput, policy, compiledArchive };
  const prepare = { ...base, stageArchivePath: path.join(outside, 'stage.zip'), buildProvenanceSha256: hash(members.buildProvenance),
    python: { executable: path.join(outside, 'python'), sha256: h('python') }, device: '/dev/sda', preparationOutput: prepRoot };
  const report = { imageArchive: { relativePath: 'private/runtime-image.tar', sha256: h('image tar'), bytes: 400000 },
    seedPath: 'private/runtime-output/private/seed/accounts.sqlite', backing: { device: '/dev/sda', deviceNumber: '8:0' } };
  const preparationResult = { schema: 'stocks-one-burst-launcher-512-v1', mode: 'prepare', status: 'PREPARED_NOT_AUTHORIZED',
    workloadExecuted: false, eligibility: { preparationEligible: true, eligible: false, sourceSha, runId, policySha256: h('policy') },
    preparationPath: path.join(prepRoot, 'preparation.json'), overlay: { manifestPath: path.join(prepRoot, 'trace-overlay/derived-manifest.json') } };
  const run = { ...base, jobName: 'auth-burst', preparationResult, members: { ...members,
    preparationReport: json(report), runtimeManifest: json({ synthetic: 'manifest' }),
    insideProof: json({ synthetic: 'inside' }), derivedManifest: json({ synthetic: 'derived' }) },
    selectedMembers: { preparation: [], inputs: [] }, preparationOutput: prepRoot, imagePath: path.join(prepRoot, 'private/runtime-image.tar'),
    disk: path.join(outside, 'disk'), device: '/dev/sda', adapterOutput: path.join(outside, 'run'), attemptMarker: path.join(outside, 'attempt.json'),
    resultPath: path.join(outside, 'result.json'), dockerConfigDirectory: path.join(outside, 'docker-config'),
    driverFiles: ['trace-driver.mjs', 'trace-plan.mjs'].map(name => ({ source: path.join(repository, 'services/stocks/auth-burst-trace-512', name),
      target: `/source/services/stocks/auth-burst-trace-512/${name}`, sha256: h(name) })) };
  let receiptCalls = 0;
  const createReceipts = (input, receivedPolicy) => {
    receiptCalls++; assert.equal(input.sourceSha, sourceSha); assert.equal(input.runId, runId); assert.equal(input.jobName, 'auth-burst');
    assert.equal(receivedPolicy.sourceTreeSha256, h('tree')); assert.equal(input.compiledArchive.artifactId, '100001');
    return { compiled: { artifactId: '100001' }, preparation: { kind: 'local', proofText: JSON.stringify({
      sourceContextSha256: h('context'), imageId: `sha256:${h('image')}`, native: { nodeSha256: h('node'), bcryptSha256: h('bcrypt') }, seedSha256: h('seed') }) },
    inputs: { kind: 'local' } };
  };
  return { repository, outside, members, prepRoot, base, prepare, run, createReceipts, calls: () => receiptCalls };
}
test('prepare config binds existing artifact receipt and explicit Python/device without authorizing execution', () => {
  const f = fixture(), result = buildPrepareConfig(f.prepare);
  assert.equal(result.mode, 'prepare'); assert.equal(result.preparation.stage.artifactId, '100001');
  assert.equal(result.preparation.stage.sha256, h('zip')); assert.equal(result.preparation.python.sha256, h('python'));
  assert.equal(result.preparation.device, '/dev/sda'); assert.equal(result.gate.input, f.base.sourceInput);
  assert.equal(result.eligible, undefined); assert.equal(result.preparation.stage.sourceSha, sourceSha);
});
test('run config binds local receipt result, finite freeze, explicit image lease and scoped driver files', () => {
  const f = fixture(), result = buildRunConfig(f.run, { createReceipts: f.createReceipts });
  assert.equal(f.calls(), 1); assert.equal(result.mode, 'run'); assert.equal(result.imageOwnership, 'verified-archive-lease');
  assert.equal(result.imageLease.archiveSha256, h('image tar')); assert.equal(result.freeze.device, '8:0');
  assert.equal(result.gate.input.jobName, 'auth-burst'); assert.equal(result.gate.input.artifacts.preparation.kind, 'local');
  assert.equal(result.gate.input.artifacts.preparation.artifactId, undefined);
  assert.equal(result.adapter.seedPath, path.join(f.prepRoot, 'private/runtime-output/private/seed/accounts.sqlite'));
  assert.equal(result.freeze.reviewedPacketSha256, h('policy')); assert.equal(result.adapter.driverFiles.length, 2);
});
test('unknown config fields and mismatched/stale/guessed compiled receipt metadata fail', () => {
  const changes = [f => { f.prepare.extra = true; }, f => { f.prepare.compiledArchive.artifactId = 'pending'; },
    f => { f.prepare.compiledArchive.runId = '7777'; }, f => { f.prepare.compiledArchive.sourceSha = 'a'.repeat(40); },
    f => { f.prepare.compiledArchive.expired = true; }, f => { f.prepare.compiledArchive.name = 'other'; },
    f => { f.prepare.compiledArchive.downloadedSha256 = h('bad'); }, f => { f.prepare.compiledArchive.unexpected = true; },
    f => { f.prepare.python.command = 'shell'; }];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => buildPrepareConfig(f.prepare)); }
});
test('paths cannot mutate repository, redirect seed/image, collide attempt/results or replace drivers', () => {
  const changes = [f => { f.run.adapterOutput = path.join(f.repository, 'output'); },
    f => { f.run.preparationOutput = f.repository; }, f => { f.run.imagePath = path.join(f.outside, 'other.tar'); },
    f => { f.run.attemptMarker = f.run.resultPath; }, f => { f.run.driverFiles[0].source = path.join(f.outside, 'injected.mjs'); },
    f => { f.run.driverFiles[1].target = '/other'; }, f => { f.run.device = '/dev/../../etc/passwd'; },
    f => { f.run.preparationResult.preparationPath = path.join(f.outside, 'different.json'); }];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => buildRunConfig(f.run, { createReceipts: f.createReceipts })); }
});
test('preparation result is not a workload result or reusable cross-head/run/policy admission', () => {
  const changes = [r => { r.status = 'PASS'; }, r => { r.workloadExecuted = true; }, r => { r.eligibility.eligible = true; },
    r => { r.eligibility.preparationEligible = false; }, r => { r.eligibility.sourceSha = 'a'.repeat(40); },
    r => { r.eligibility.runId = '7777'; }, r => { r.eligibility.policySha256 = h('old policy'); }];
  for (const change of changes) { const f = fixture(); change(f.run.preparationResult);
    assert.throws(() => buildRunConfig(f.run, { createReceipts: f.createReceipts })); assert.equal(f.calls(), 0); }
});

function mockIO(f) {
  const files = new Map(), measured = new Map(), calls = [];
  const sourceInputPath = path.join(f.outside, 'source-input.json'), compiledReceiptPath = path.join(f.outside, 'compiled-receipt.json'),
    stageDirectory = path.join(f.outside, 'stage-selected');
  files.set(sourceInputPath, json(f.base.sourceInput)); files.set(compiledReceiptPath, json(f.base.compiledArchive));
  files.set(path.join(f.repository, POLICY_PATH), json(f.base.policy));
  for (const key of Object.keys(f.members).filter(key => key !== 'compiled')) files.set(path.join(stageDirectory, MEMBER_PATHS[key]), f.members[key]);
  for (const [p, value] of Object.entries(f.members.compiled)) files.set(path.join(stageDirectory, 'package', p), value);
  measured.set(f.prepare.stageArchivePath, { bytes: 1000, sha256: h('zip') });
  measured.set(f.prepare.python.executable, { bytes: 100, sha256: h('python') });
  const io = { read(file, max = 16 * 1024 ** 2, allowEmptyBuildLog = false) {
    calls.push(['read', file]); assert.ok(files.has(file), 'unexpected read');
    validateReadSize(file, files.get(file).length, max, allowEmptyBuildLog); return files.get(file);
  },
    measure(file) { calls.push(['measure', file]); assert.ok(measured.has(file), 'unexpected measured file'); return measured.get(file); },
    save(file, value) { calls.push(['save', file]); return { bytes: json(value).length, sha256: hash(json(value)) }; } };
  return { io, calls, files, measured, request: { repository: f.repository, sourceInputPath, compiledReceiptPath,
    stageArchivePath: f.prepare.stageArchivePath, stageDirectory, python: f.prepare.python,
    device: f.prepare.device, preparationOutput: f.prepare.preparationOutput } };
}
test('CLI construction hashes actual selected bytes via injected I/O and writes only an explicit new config', () => {
  const f = fixture(), m = mockIO(f), config = constructConfig('prepare-config', m.request, { io: m.io });
  assert.equal(config.preparation.stage.buildProvenanceSha256, hash(f.members.buildProvenance));
  const requestPath = path.join(f.outside, 'request.json'), outputPath = path.join(f.outside, 'config.json');
  m.files.set(requestPath, json(m.request)); const result = main(['prepare-config', requestPath, outputPath], { io: m.io });
  assert.ok(result.bytes > 0); assert.deepEqual(m.calls.at(-1), ['save', outputPath]);
  assert.ok(m.calls.every(row => ['read', 'measure', 'save'].includes(row[0])));
});

test('only the exact build.log read can be empty and still requires its measured ZIP inventory binding', () => {
  const f = fixture({ emptyBuildLog: true }), m = mockIO(f);
  assert.equal(constructConfig('prepare-config', m.request, { io: m.io }).mode, 'prepare');
  assert.doesNotThrow(() => validateReadSize(path.join(f.outside, 'build.log'), 0, 100, true));
  assert.throws(() => validateReadSize(path.join(f.outside, 'build.log'), 0, 100));
  for (const name of ['build-provenance.json', 'report.json', 'package/manifest.json', 'auth.js', 'runtime-image.tar', 'accounts.sqlite']) {
    assert.throws(() => validateReadSize(path.join(f.outside, name), 0, 100, true));
    assert.throws(() => validateReadSize(path.join(f.outside, name), 0, 100));
  }
  for (const change of [
    value => { value.files.set(path.join(value.request.stageDirectory, 'build.log'), Buffer.from('tampered')); },
    value => {
      const receipt = JSON.parse(value.files.get(value.request.compiledReceiptPath));
      receipt.selectedMembers.find(row => row.path === 'build.log').sha256 = h('wrong empty hash');
      value.files.set(value.request.compiledReceiptPath, json(receipt));
    },
    value => {
      const receipt = JSON.parse(value.files.get(value.request.compiledReceiptPath));
      receipt.selectedMembers.find(row => row.path === 'build.log').bytes = 1;
      value.files.set(value.request.compiledReceiptPath, json(receipt));
    },
  ]) {
    const next = mockIO(fixture({ emptyBuildLog: true })); change(next);
    assert.throws(() => constructConfig('prepare-config', next.request, { io: next.io }));
  }
});
test('run construction measures local image/seed and uses original preparation paths without archive IDs', () => {
  const f = fixture(), m = mockIO(f), { python, ...common } = m.request;
  m.files.set(path.join(f.prepRoot, 'trace-preparation-result.json'), json(f.run.preparationResult));
  for (const [key, name] of Object.entries({ preparationReport: 'preparation.json',
    runtimeManifest: 'public-context/runtime-source-manifest.json', insideProof: 'private/runtime-output/inside-proof.json',
    derivedManifest: 'trace-overlay/derived-manifest.json' })) m.files.set(path.join(f.prepRoot, name), f.run.members[key]);
  m.measured.set(f.run.imagePath, { bytes: 400000, sha256: h('image tar') });
  const seedPath = path.join(f.prepRoot, 'private/runtime-output/private/seed/accounts.sqlite');
  m.measured.set(seedPath, { bytes: 40960, sha256: h('seed') });
  for (const row of f.run.driverFiles) m.files.set(row.source, Buffer.from('synthetic driver source'));
  const request = { ...common, jobName: f.run.jobName, disk: f.run.disk, adapterOutput: f.run.adapterOutput,
    attemptMarker: f.run.attemptMarker, resultPath: f.run.resultPath, dockerConfigDirectory: f.run.dockerConfigDirectory };
  const result = constructConfig('run-config', request, { io: m.io, createReceipts: (input, policy) => {
    assert.deepEqual(input.selectedMembers.inputs, [{ path: MEMBER_PATHS.image, bytes: 400000, sha256: h('image tar') },
      { path: MEMBER_PATHS.seed, bytes: 40960, sha256: h('seed') }]);
    assert.equal(input.selectedMembers.preparation.length, 4); return f.createReceipts(input, policy);
  } });
  assert.equal(result.imageLease.archivePath, f.run.imagePath); assert.equal(result.gate.input.artifacts.inputs.kind, 'local');
  assert.ok(m.calls.some(row => row[0] === 'measure' && row[1] === seedPath));
});
test('CLI rejects silent modes, tampered downloaded bytes/member text/Python and output in source', () => {
  assert.throws(() => main([]));
  for (const mutate of [m => { m.measured.set(m.request.stageArchivePath, { bytes: 1000, sha256: h('different') }); },
    m => { m.files.set(path.join(m.request.stageDirectory, MEMBER_PATHS.buildProvenance), Buffer.from('{}')); },
    m => { m.measured.set(m.request.python.executable, { bytes: 100, sha256: h('different python') }); }]) {
    const f = fixture(), m = mockIO(f); mutate(m);
    assert.throws(() => constructConfig('prepare-config', m.request, { io: m.io }));
  }
  const f = fixture(), m = mockIO(f), requestPath = path.join(f.outside, 'request.json'); m.files.set(requestPath, json(m.request));
  assert.throws(() => main(['prepare-config', requestPath, path.join(f.repository, 'config.json')], { io: m.io }));
});
