'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fixtureProcess, main, stockRuntimeSources } = require('./qa-stocks-local-stage-recovery.cjs');

test('local fixture runtime retains two-trader admission with identity and projection dependencies', () => {
  const files = stockRuntimeSources();
  for (const name of ['server', 'identity', 'trader-policy', 'viewer-projection', 'account-worker-runtime']) {
    assert.equal(files.filter(file => file === `services/stocks-global/${name}.mjs`).length, 1, name);
  }
  assert.ok(files.every(file => !file.endsWith('.test.mjs') && !file.endsWith('/probe.mjs')));
  assert.equal(new Set(files).size, files.length);
});

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-local-stage-guard-'));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('existing fixture output is refused without changing saved evidence', async t => {
  const dir = temporary(t), marker = path.join(dir, 'retained.txt');
  fs.writeFileSync(marker, 'previous fixture evidence');
  await assert.rejects(main(dir), /refuse existing output or fixture data/);
  assert.deepEqual(fs.readdirSync(dir), ['retained.txt']);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'previous fixture evidence');
});

test('relative output is refused before package or data creation', async () => {
  await assert.rejects(main('relative-fixture-output'), /must be absolute/);
});

test('stop acknowledgement cannot hide a leaked child handle; exit wait is bounded and own child terminates', async t => {
  const dir = temporary(t), scripts = path.join(dir, 'scripts'); fs.mkdirSync(scripts);
  fs.writeFileSync(path.join(scripts, 'qa-stocks-local-stage-fixture.cjs'), `
    if (process.env.NODE_OPTIONS || process.env.DATABASE_URL) throw Error('unexpected environment');
    process.on('message', message => {
      process.send({ id: message.id, result: true });
      process.disconnect();
      setInterval(() => {}, 1000);
    });
  `);
  const report = {}, fixture = fixtureProcess(dir, path.join(dir, 'unused'), report);
  try {
    assert.equal(await fixture.command('stop'), true);
    await assert.rejects(fixture.waitForExit(100), /FIXTURE_EXIT_TIMEOUT/);
    assert.equal(fixture.child.exitCode, null);
    const exited = await fixture.terminate();
    assert.ok(exited.signal !== null || exited.code !== null);
    assert.ok(report.child, 'termination is retained in raw child outcome');
  } finally {
    if (fixture.child.exitCode === null && fixture.child.signalCode === null) await fixture.terminate();
  }
});
