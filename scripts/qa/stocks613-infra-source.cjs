'use strict';
// Exact-head CI admission. Never executes SQL, imports .env or contacts a DB.
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const BASE = '4189ef756f1f0f769354a389bd2113572ab7f478';
const REVIEW = '4b92e69a0e3c1bf1f6f8376b846bdb6be7d968eb';
const BRANCH = 'codex/stocks613-infra-migrations-20261024';
const REPO = 'nazardzuba79-tech/-';
const ALLOWED = new Set(['.github/workflows/stocks613-infra-review.yml',
  'scripts/qa/stocks613-migration-rehearsal.cjs','scripts/qa/stocks613-infra.test.cjs',
  'scripts/qa/stocks613-infra-source.cjs','scripts/qa/stocks613-infra-source.test.cjs',
  'services/stocks-global/healthcheck.cjs','services/stocks-global/Dockerfile.release',
  'deploy/stocks-pages-gateway.compose.yaml.example','docs/STOCKS_613_INFRA_MIGRATIONS_REVIEW.md',
  'docs/STOCKS_613_PRODUCTION_GATES.md','docs/AI_HANDOFF.md']);
const PROTECTED = ['scripts/qa/stocks-build-only-prepare.cjs', 'scripts/qa/stocks-release-package.cjs',
  'scripts/qa/stocks-migration-review.cjs','scripts/qa/fixtures/stocks-production-files-20261020.json',
  'scripts/qa/stocks613-migration-rehearsal.cjs','services/stocks-global/testing/disposable-postgres.cjs'];
function sourceEvent(env, event) {
  if (env.GITHUB_REPOSITORY !== REPO) throw Error('SOURCE_REPOSITORY_MISMATCH');
  let expected, mode;
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    if (event.number !== 613 || event.pull_request?.head?.repo?.full_name !== REPO ||
        event.pull_request?.base?.ref !== 'main') throw Error('UNAPPROVED_PR_SOURCE');
    expected = event.pull_request.head.sha; mode = 'pull_request';
  } else if (env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/' + BRANCH) {
    expected = env.GITHUB_SHA; mode = 'isolated_push';
  } else throw Error('UNAPPROVED_SOURCE_EVENT');
  if (!/^[a-f0-9]{40}$/.test(expected) || expected !== env.SOURCE_SHA || expected !== env.CONTROL_SHA) throw Error('SOURCE_CONTROL_HEAD_MISMATCH');
  return { expected, mode };
}
function verify(root, env, event) {
  const source = sourceEvent(env, event);
  const git = args => cp.execFileSync('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  if (git(['rev-parse','HEAD']).toString().trim() !== source.expected) throw Error('SOURCE_CHECKOUT_HEAD_MISMATCH');
  git(['merge-base','--is-ancestor', REVIEW, 'HEAD']);
  if (source.mode === 'isolated_push') {
    const changed = git(['diff','--name-only',BASE,'HEAD']).toString().trim().split('\n').filter(Boolean);
    if (changed.some(file => !ALLOWED.has(file))) throw Error('UNREVIEWED_SOURCE_DELTA');
  }
  // PRs may advance normal source files. SQL set/bytes and the existing checkers
  // remain immutable in BOTH modes; this also rejects additional arbitrary SQL.
  if (!git(['rev-parse',`${REVIEW}:prisma/migrations`]).equals(git(['rev-parse','HEAD:prisma/migrations']))) throw Error('MIGRATION_TREE_CHANGED');
  for (const file of PROTECTED) if (!git(['show',`${REVIEW}:${file}`]).equals(git(['show',`HEAD:${file}`]))) throw Error('STRICT_SOURCE_CHANGED ' + file);
  return { source: source.expected, mode: source.mode, migrationTreeUnchanged: true, strictCheckersUnchanged: true };
}
module.exports = { BASE, REVIEW, BRANCH, sourceEvent, verify };
if (require.main === module) {
  try {
    if (process.versions.node !== '22.23.3') throw Error('NODE_VERSION_MISMATCH');
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    console.log(JSON.stringify(verify(path.resolve(__dirname, '../..'), process.env, event)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
