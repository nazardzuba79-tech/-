// Cheap, read-only installed-browser prerequisite. No browser launch or trust-store work.
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { assertLinux, inspectChrome, CHROME } = require('./qa-stocks-public-nss.cjs');

function assertScratch(actual, expected) {
  assert.equal(actual.resolved, expected.path, 'scratch path changed');
  assert.equal(actual.directory, true); assert.equal(actual.symlink, false);
  assert.equal(actual.uid, expected.uid); assert.equal(actual.mode, 0o700);
  assert.equal(actual.ino, expected.ino); assert.equal(actual.dev, expected.dev);
  assert.equal(actual.marker, expected.marker, 'scratch ownership marker changed');
}
function privateEnvironment(home) {
  return { HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CACHE_HOME: path.join(home, 'cache'), XDG_RUNTIME_DIR: path.join(home, 'run'),
    TMPDIR: path.join(home, 'tmp'), PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
}
function main(output) {
  assertLinux(process.platform); assert.ok(path.isAbsolute(output), 'absolute evidence output required');
  assert.ok(!fs.existsSync(output), 'fresh evidence output required');
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.mkdirSync(output, { mode: 0o700 });
  const report = { schema: 1, status: 'NOT_RUN', startedAt: new Date().toISOString(),
    node: process.version, platform: process.platform, browserLaunched: false, installationPerformed: false,
    permissionChanges: false, globalTrustChanged: false, chrome: null, cleanup: { status: 'NOT_CREATED' } };
  let home, expected;
  try {
    const temporary = fs.realpathSync(os.tmpdir());
    home = fs.mkdtempSync(path.join(temporary, 'voltex-stocks-chrome-preflight-'));
    assert.equal(fs.lstatSync(home).mode & 0o777, 0o700, 'fresh scratch must already be private');
    const relative = path.relative(path.resolve(output), home);
    assert.ok(relative !== '' && (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)), 'scratch must not be uploaded');
    const marker = randomUUID(), st = fs.lstatSync(home);
    expected = { path: home, uid: process.getuid(), ino: st.ino, dev: st.dev, marker };
    fs.writeFileSync(path.join(home, 'owned-preflight'), marker, { flag: 'wx', mode: 0o600 });
    for (const name of ['config', 'data', 'cache', 'run', 'tmp']) fs.mkdirSync(path.join(home, name), { mode: 0o700 });
    report.scratch = { path: home, uid: st.uid, mode: (st.mode & 0o777).toString(8), outsideEvidence: true };
    report.cleanup.status = 'PENDING';
    report.chrome = inspectChrome(CHROME, privateEnvironment(home));
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.failure = { message: error.message, code: error.code || null, stack: error.stack };
    if (error.chromePreflight) report.chromePreflight = error.chromePreflight;
  } finally {
    if (home) try {
      assert.ok(expected, 'scratch ownership record unavailable');
      const st = fs.lstatSync(home), markerFile = path.join(home, 'owned-preflight'), markerStat = fs.lstatSync(markerFile);
      assert.ok(markerStat.isFile() && !markerStat.isSymbolicLink() && markerStat.size <= 128, 'bounded ownership marker');
      assertScratch({ resolved: fs.realpathSync(home), directory: st.isDirectory(), symlink: st.isSymbolicLink(), uid: st.uid,
        mode: st.mode & 0o777, ino: st.ino, dev: st.dev, marker: fs.readFileSync(markerFile, 'utf8') }, expected);
      fs.rmSync(home, { recursive: true, force: false });
      report.cleanup = { status: 'REMOVED', ownedPathVerified: true, existsAfter: fs.existsSync(home) };
      assert.equal(report.cleanup.existsAfter, false);
    } catch (error) { report.status = 'FAIL'; report.cleanup = { status: 'FAIL', message: error.message }; }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ status: report.status, output, failure: report.failure?.message, cleanup: report.cleanup.status }));
  return report;
}
module.exports = { assertScratch, privateEnvironment, main };
if (require.main === module) {
  try { assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--output'); if (main(process.argv[3]).status !== 'PASS') process.exitCode = 1; }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
