'use strict';
const assert = require('node:assert/strict');

// APP is immutable; only this review harness, its workflow and handoff may differ.
function verifySource({ command, source, harness, app, expectedHead }) {
  for (const sha of [app, expectedHead]) assert.match(sha, /^[0-9a-f]{40}$/);
  const git = (cwd, args) => command('git', args, { cwd });
  const sourceHead = git(source, ['rev-parse', 'HEAD']).trim();
  const harnessHead = git(harness, ['rev-parse', 'HEAD']).trim();
  assert.equal(sourceHead, app, 'application checkout must be exact APP');
  assert.equal(harnessHead, expectedHead, 'review checkout must be exact PR event head');
  for (const cwd of [source, harness]) {
    assert.equal(git(cwd, ['status', '--porcelain', '--untracked-files=all']).trim(), '',
      'source and harness checkouts must be clean');
  }
  // Failure must propagate, including when the object/ancestry is unavailable.
  git(harness, ['merge-base', '--is-ancestor', app, harnessHead]);
  // No rename detection: both old and new paths are checked, including deletions.
  const changed = git(harness, ['diff', '--no-renames', '--name-only', '-z', app, harnessHead])
    .split('\0').filter(Boolean);
  assert.ok(changed.length > 0, 'review must contain harness changes');
  for (const file of changed) {
    assert.ok(file.startsWith('review/stocks-pg-tls-98c577d4/') ||
      file === '.github/workflows/stocks-positive-pg-tls.yml' ||
      file === 'docs/AI_HANDOFF.md', `protected application path changed: ${file}`);
  }
  return { sourceHead, harnessHead, changed };
}

module.exports = { verifySource };
