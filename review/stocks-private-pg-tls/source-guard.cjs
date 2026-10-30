'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const manifest = require('./application.json');
const APP = '133cb85a95003c229829b1ecef3d8d0e6308db95';
function verifySource({ command, source, harness, expectedHead }) {
  assert.equal(manifest.app, APP);
  assert.match(expectedHead, /^[a-f0-9]{40}$/);
  const git = (cwd, args) => command('git', args, { cwd });
  assert.equal(git(source, ['rev-parse', 'HEAD']).trim(), APP);
  assert.equal(git(source, ['rev-parse', 'HEAD^{tree}']).trim(), manifest.tree);
  assert.equal(git(harness, ['rev-parse', 'HEAD']).trim(), expectedHead);
  for (const dir of [source, harness]) assert.equal(git(dir, ['status', '--porcelain', '--untracked-files=all']).trim(), '', 'DIRTY_SOURCE');
  git(harness, ['merge-base', '--is-ancestor', APP, expectedHead]);
  const changed = git(harness, ['diff', '--no-renames', '--name-only', '-z', APP, expectedHead]).split('\0').filter(Boolean);
  assert.ok(changed.length > 0);
  for (const file of changed) assert.ok(file.startsWith('review/stocks-private-pg-tls/') ||
    file === '.github/workflows/stocks-private-pg-tls.yml' || file === 'docs/AI_HANDOFF.md', 'PROTECTED_APPLICATION_PATH: ' + file);
  const delta = git(source, ['diff', '--no-renames', '--name-only', '-z', manifest.base, APP]).split('\0').filter(Boolean).sort();
  assert.deepEqual(delta, Object.keys(manifest.files).sort(), 'APPLICATION_DELTA_CHANGED');
  for (const file of delta) {
    // git show bytes via Buffer, never platform EOL conversion.
    const bytes = git(source, ['show', APP + ':' + file]);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest.files[file], 'APP_BLOB_CHANGED: ' + file);
  }
  return { sourceHead: APP, sourceTree: manifest.tree, harnessHead: expectedHead, changed, runtimeDelta: manifest.runtime };
}
module.exports = { APP, verifySource };
