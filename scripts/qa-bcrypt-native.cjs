#!/usr/bin/env node
'use strict';

// Isolated native-install gate only. Never imports the server, Prisma or auth routes.
// Run inside the unchanged backend Docker image with --entrypoint node --network none.
// The fixture is public test data, generated and verified with actual bcrypt 5.1.1.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXPECTED_FIXTURE_SHA256 = '5a5743083e2fb7e3d65c9cf624397d43d5083a956620b3d92a07ccb68093ddd7';
const LEGACY_PACKAGES = new Set(['bcrypt-nodejs', 'bcryptjs', '@mapbox/node-pre-gyp', 'node-pre-gyp', 'tar']);
const checks = [];

function check(name, condition) {
  assert.equal(condition, true, name);
  checks.push(name);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function installedPackages(directory, packages = []) {
  // Traverse actual installed application packages, not dev-only entries in the lock.
  // Global npm's own dependencies are not part of the application production graph.
  if (!fs.existsSync(directory)) return packages;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
    const target = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      installedPackages(target, packages);
      continue;
    }
    const manifest = path.join(target, 'package.json');
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      packages.push({ name: pkg.name, version: pkg.version, path: target });
    }
    installedPackages(path.join(target, 'node_modules'), packages);
  }
  return packages;
}

async function main() {
  check('exactly one explicit public fixture argument', process.argv.length === 3);
  check('Node major is 20', process.versions.node.split('.')[0] === '20');
  check('platform is Linux', process.platform === 'linux');
  check('production architecture is x64', process.arch === 'x64');
  check('Alpine release file exists', fs.existsSync('/etc/alpine-release'));
  const alpineRelease = fs.readFileSync('/etc/alpine-release', 'utf8').trim();
  const muslLoaders = fs.readdirSync('/lib').filter((name) => /^ld-musl-.+\.so\.1$/.test(name));
  check('musl dynamic loader exists', muslLoaders.length > 0);
  const runtimeReport = process.report.getReport();
  check('glibc runtime is absent', !runtimeReport.header.glibcVersionRuntime);
  check('no database connection variables provided', !process.env.DATABASE_URL && !process.env.DIRECT_URL);
  check('production dependency installation', process.env.NODE_ENV === 'production');

  const fixtureBytes = fs.readFileSync(path.resolve(process.argv[2]));
  const fixtureFile = JSON.parse(fixtureBytes.toString('utf8'));
  check('fixture schema is 1', fixtureFile.schemaVersion === 1);
  check('legacy generator was bcrypt 5.1.1', fixtureFile.provenance.generatorVersion === '5.1.1');
  const fixtureDigest = sha256(JSON.stringify(fixtureFile.fixtures));
  check('approved fixture contents unchanged', fixtureDigest === EXPECTED_FIXTURE_SHA256);
  check('fixture provenance fingerprint matches', fixtureDigest === fixtureFile.provenance.fixturesSha256);
  check('eight independent legacy fixtures', fixtureFile.fixtures.length === 8);

  const bcryptManifestPath = require.resolve('bcrypt/package.json');
  const bcryptManifest = JSON.parse(fs.readFileSync(bcryptManifestPath, 'utf8'));
  check('installed bcrypt is exactly 6.0.0', bcryptManifest.version === '6.0.0');
  const bcrypt = require('bcrypt');
  const nativeBindings = Object.keys(require.cache).filter((filename) => filename.endsWith('.node') && filename.includes('/bcrypt/'));
  check('exactly one real bcrypt native binding loaded', nativeBindings.length === 1);
  check('loaded binding is musl prebuild', nativeBindings[0].endsWith('/bcrypt.musl.node'));

  const installed = installedPackages('/app/node_modules').sort((a, b) => a.path.localeCompare(b.path));
  const prohibited = installed.filter((pkg) => LEGACY_PACKAGES.has(pkg.name));
  assert.deepEqual(prohibited, [], 'legacy node-pre-gyp/tar chain and substitute libraries must be absent');
  checks.push('no node-pre-gyp, tar or substitute bcrypt library in installed application graph');
  check('only installed bcrypt node is 6.0.0', installed.filter((pkg) => pkg.name === 'bcrypt').length === 1);

  const fixtures = [];
  for (const fixture of fixtureFile.fixtures) {
    check(`${fixture.id}: original UTF-8 byte count`, Buffer.byteLength(fixture.password, 'utf8') === fixture.utf8Bytes);
    check(`${fixture.id}: cost policy unchanged`, fixture.cost === (fixture.purpose === 'password' ? 12 : 10));
    check(`${fixture.id}: old hash cost preserved`, bcrypt.getRounds(fixture.hash) === fixture.cost);
    check(`${fixture.id}: old hash correct password accepted`, await bcrypt.compare(fixture.password, fixture.hash));
    check(`${fixture.id}: old hash wrong password rejected`, !(await bcrypt.compare(fixture.wrongPassword, fixture.hash)));
    for (const alias of fixture.aliases || []) {
      check(`${fixture.id}: existing 72-byte alias semantics`, await bcrypt.compare(alias, fixture.hash));
    }
    for (const alias of fixture.rejectedAliases || []) {
      check(`${fixture.id}: existing NUL suffix semantics`, !(await bcrypt.compare(alias, fixture.hash)));
    }
    const newHash = await bcrypt.hash(fixture.password, fixture.cost);
    check(`${fixture.id}: new native hash cost preserved`, bcrypt.getRounds(newHash) === fixture.cost);
    check(`${fixture.id}: new hash correct password accepted`, await bcrypt.compare(fixture.password, newHash));
    check(`${fixture.id}: new hash wrong password rejected`, !(await bcrypt.compare(fixture.wrongPassword, newHash)));
    for (const alias of fixture.aliases || []) {
      check(`${fixture.id}: new hash retains 72-byte alias semantics`, await bcrypt.compare(alias, newHash));
    }
    for (const alias of fixture.rejectedAliases || []) {
      check(`${fixture.id}: new hash rejects truncated NUL alias`, !(await bcrypt.compare(alias, newHash)));
    }
    fixtures.push({ id: fixture.id, purpose: fixture.purpose, cost: fixture.cost, utf8Bytes: fixture.utf8Bytes, legacy: 'PASS', newHash: 'PASS' });
  }

  // The exact minimum smoke operation requested by the owner, separate from cost-12 app fixtures.
  const smokePassword = 'VoltexSecurityTestA1';
  const smokeHash = await bcrypt.hash(smokePassword, 10);
  check('owner native smoke test', await bcrypt.compare(smokePassword, smokeHash));

  const result = {
    result: 'BCRYPT_NATIVE_OK',
    timestamp: new Date().toISOString(),
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    alpineRelease,
    muslLoaders,
    glibcRuntime: null,
    bcrypt: bcryptManifest.version,
    nativeBinding: nativeBindings[0],
    nativeBindingSha256: sha256(fs.readFileSync(nativeBindings[0])),
    fixtureFileSha256: sha256(fixtureBytes),
    legacyFixturesSha256: fixtureDigest,
    fixtureGeneratorVersion: fixtureFile.provenance.generatorVersion,
    fixtures,
    installedApplicationPackageCount: installed.length,
    legacyPackagesFound: prohibited,
    migrationOrServerStarted: false,
    checkCount: checks.length,
    checks,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`BCRYPT_NATIVE_FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
