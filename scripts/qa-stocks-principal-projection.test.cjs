'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { main, verifyBuild } = require('./qa-stocks-principal-projection.cjs');
const proofFile = process.env.QA_STOCKS_BUILD_PROOF;
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-principal-contract-'));
test.after(() => {
  assert.equal(path.dirname(parent), path.resolve(os.tmpdir()));
  assert.ok(path.basename(parent).startsWith('stocks-principal-contract-'));
  fs.rmSync(parent, { recursive: true, force: true });
});

test('actual compiled auth and original /me match compact counterfactual across authorization changes and maximum avatar', { timeout: 35000 }, () => {
  assert.ok(proofFile && path.isAbsolute(proofFile), 'explicit fresh local-stage build proof required');
  const report = main(path.join(parent, 'authority'), proofFile);
  assert.equal(report.counterfactualProjection, true);
  assert.equal(report.productionEndpointExists, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.capacityTest, false);
  assert.equal(report.cases.length, 26);
  const cases = new Map(report.cases.map(row => [row.name, row]));
  const bob = cases.get('valid-bob-forged-owner-role-ignored');
  assert.deepEqual(bob.expectedPrincipal, { issuer: 'compact-principal-counterfactual-fixture', subject: 'bob' });
  for (const mode of ['profile', 'compact']) {
    assert.deepEqual(bob.modes[mode].principal, bob.expectedPrincipal);
    assert.equal(Object.hasOwn(bob.modes[mode].principal, 'role'), false);
    assert.equal(Object.hasOwn(bob.modes[mode].principal, 'canTrade'), false);
  }
  for (const name of ['pending-2fa', 'subject-session-mismatch', 'expired-jwt', 'invalid-signature', 'revoked-session', 'missing-session', 'remembered-admin-idle-expired', 'remembered-demoted-ordinary-expired', 'legacy-deleted', 'legacy-revoked-after-unblock']) {
    assert.equal(cases.get(name).modes.compact.status, 401, name);
    assert.equal(cases.get(name).modes.profile.status, 401, name);
  }
  for (const name of ['deleted-user-orphan-session', 'deleted-between-middleware-and-handler']) assert.equal(cases.get(name).modes.compact.status, 404, name);
  assert.equal(cases.get('maximum-avatar-blocked').modes.compact.status, 403);
  const large = cases.get('maximum-avatar-valid');
  assert.equal(large.modes.compact.bytes, 14); assert.ok(large.modes.profile.bytes > 1024 * 1024);
  assert.deepEqual(large.modes.profile.principal, large.modes.compact.principal);
  for (const mode of ['profile', 'compact']) assert.deepEqual(cases.get('immediate-authorization-changes-' + mode).checks, ['revoke', 'block', 'delete']);
  assert.equal(report.audit.unexpectedPrisma, 0); assert.equal(report.audit.deniedNetwork, 0);
  assert.ok(report.audit.sessionReads > 0 && report.audit.policyReads > 0 && report.audit.sessionTouches > 0);
});

test('stale source, altered emitted closure and failed build proofs reject before fixture launch', () => {
  const original = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
  const directory = path.join(parent, 'invalid-proof'); fs.mkdirSync(directory);
  fs.copyFileSync(path.join(path.dirname(proofFile), 'build.log'), path.join(directory, 'build.log'));
  const changes = [
    proof => { proof.sourcesBefore[0].sha256 = '0'.repeat(64); },
    proof => { proof.outputs.find(row => row.path === 'dist/api/middleware/auth.js').sha256 = '0'.repeat(64); },
    proof => { proof.exitCode = 1; },
  ];
  changes.forEach((change, i) => {
    const proof = structuredClone(original); change(proof);
    const file = path.join(directory, i + '.json'); fs.writeFileSync(file, JSON.stringify(proof));
    assert.throws(() => verifyBuild(file));
  });
});

test('verified compiled artifact works with a source-only checkout and rejects artifact byte tampering', () => {
  const reference = verifyBuild(proofFile);
  const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
  const repository = path.resolve(__dirname, '..');
  const sourceOnly = path.join(parent, 'source-only'), artifact = path.join(parent, 'compiled-package');
  fs.mkdirSync(sourceOnly); fs.mkdirSync(artifact);
  const copy = (relative, destination) => {
    const target = path.resolve(destination, relative);
    assert.ok(target.startsWith(destination + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repository, relative), target, fs.constants.COPYFILE_EXCL);
  };
  for (const row of proof.sourcesBefore) copy(row.path, sourceOnly);
  for (const row of proof.compilerFiles) copy('node_modules/typescript/' + row.file, sourceOnly);
  for (const file of ['tsconfig.json', 'package-lock.json', 'services/stocks-global/identity.mjs']) copy(file, sourceOnly);
  for (const file of Object.keys(reference.compiled)) copy(file, artifact);
  assert.equal(fs.existsSync(path.join(sourceOnly, 'dist')), false);
  assert.deepEqual(verifyBuild(proofFile, sourceOnly, artifact), reference);
  assert.equal(fs.existsSync(path.join(sourceOnly, 'dist')), false, 'verification never builds or populates root dist');
  fs.appendFileSync(path.join(artifact, 'dist/api/middleware/auth.js'), '\n// fixture tamper');
  assert.throws(() => verifyBuild(proofFile, sourceOnly, artifact), /actual compiled module must match fresh build/);
});

test('existing or relative output and unguarded child execution fail closed', () => {
  assert.throws(() => main('relative-output', proofFile));
  assert.throws(() => main(parent, proofFile), /EEXIST/);
  const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot || 'C:\\Windows' } : {};
  const result = spawnSync(process.execPath, [path.join(__dirname, 'qa-stocks-principal-projection.cjs'), '--child', path.join(parent, 'unguarded'), proofFile], { env, encoding: 'utf8', timeout: 3000 });
  assert.notEqual(result.status, 0); assert.equal(fs.existsSync(path.join(parent, 'unguarded')), false);
  const sentinel = 'NOT-A-REAL-SECRET-DO-NOT-LOG';
  const rejected = spawnSync(process.execPath, [path.join(__dirname, 'qa-stocks-principal-projection.cjs'), '--child', path.join(parent, 'wrong-environment'), proofFile], {
    env: { ...env, STOCKS_PRINCIPAL_PROJECTION_FIXTURE: 'true', JWT_SECRET: sentinel, DATABASE_URL: sentinel }, encoding: 'utf8', timeout: 3000,
  });
  assert.notEqual(rejected.status, 0); assert.equal((rejected.stdout + rejected.stderr).includes(sentinel), false);
  assert.equal(fs.existsSync(path.join(parent, 'wrong-environment')), false);
});
