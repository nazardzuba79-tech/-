'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const yaml = require('js-yaml');
const { REVIEW, BRANCH, sourceEvent, verify } = require('./stocks613-infra-source.cjs');
const root = path.resolve(__dirname, '../..');
const expression = '${{ github.event.pull_request.head.sha || github.sha }}';
test('every new #613 PR head runs the complete migration/image job, with exact checkout and no deployment', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/stocks613-infra-review.yml'), 'utf8'));
  assert.deepEqual(workflow.on.pull_request, { branches: ['main'] }); // No paths-ignore: even a later unrelated commit must run.
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs['additive-ddl-and-image'];
  assert.equal(job.if, "github.event_name == 'push' || github.event.pull_request.number == 613");
  assert.equal(job.env.SOURCE_SHA, expression); assert.equal(job.env.CONTROL_SHA, expression);
  assert.equal(job.steps.find(s => s.uses?.startsWith('actions/checkout@')).with.ref, expression);
  assert.equal(job.env.STOCKS_DISPOSABLE_PG_URL, 'postgresql://stocks_ci:synthetic-only@127.0.0.1:5432/stocks_disposable_infra613');
  assert.equal(job.env.STOCKS_PG_DISPOSABLE_CONFIRM, 'stocks_disposable_infra613');
  assert.equal(job.env.STOCKS_ORDER_EXECUTION_ENABLED, 'false');
  for (const pattern of [/stocks613-infra-source\.cjs/, /stocks613-migration-rehearsal\.cjs/, /stocks-build-only-prepare\.cjs/, /docker build/, /default-off-boot/]) assert.match(JSON.stringify(job.steps), pattern);
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|continue-on-error|workflow_dispatch|docker push|wrangler deploy/);
  const stages = job.steps.filter(s => /Exact source|Guard and liveness|Verify original|Apply only|Build immutable/.test(s.name || ''));
  assert.equal(stages.length, 5); assert.ok(stages.every(s => !s.if)); // No skipped admission/rehearsal/build on target PR.
  const docker = fs.readFileSync(path.join(root,'services/stocks-global/Dockerfile.release'),'utf8');
  const pin = 'node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392';
  assert.match(docker, new RegExp('^FROM '+pin+' AS build$', 'm'));
  assert.match(docker, new RegExp('^FROM '+pin+' AS runtime$', 'm'));
  assert.doesNotMatch(docker, /ARG NODE_IMAGE|FROM \$\{/); // No mutable tag or build-arg image substitution.
});
const event = sha => ({ number: 613, pull_request: { head: { sha, repo: { full_name: 'nazardzuba79-tech/-' } }, base: { ref: 'main' } } });
const env = sha => ({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'nazardzuba79-tech/-', GITHUB_SHA: 'f'.repeat(40), SOURCE_SHA: sha, CONTROL_SHA: sha });
test('PR event rejects merge SHA, fork and mismatched control SHA; public CI cannot select another source', () => {
  assert.equal(sourceEvent(env(REVIEW), event(REVIEW)).expected, REVIEW);
  assert.throws(() => sourceEvent({ ...env(REVIEW), SOURCE_SHA: 'f'.repeat(40) }, event(REVIEW)), /SOURCE_CONTROL/);
  assert.throws(() => sourceEvent({ ...env(REVIEW), CONTROL_SHA: '0'.repeat(40) }, event(REVIEW)), /SOURCE_CONTROL/);
  const fork = event(REVIEW); fork.pull_request.head.repo.full_name = 'someone/fork';
  assert.throws(() => sourceEvent(env(REVIEW), fork), /UNAPPROVED_PR/);
  assert.throws(() => sourceEvent(env(REVIEW), { ...event(REVIEW), number: 614 }), /UNAPPROVED_PR/);
  assert.throws(() => sourceEvent({ ...env(REVIEW), GITHUB_EVENT_NAME: 'workflow_dispatch' }, {}), /UNAPPROVED_SOURCE_EVENT/);
});
test('real Git descendants: future PR source accepted, push allowlist retained, SQL/checker mutations rejected', () => {
  // Bare shared clone: no full worktree, DB or network; parent objects are read-only.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks613-source-'));
  cp.execFileSync('git', ['clone','--bare','--shared',root,dir], { stdio: 'pipe' });
  const git = (args, input) => cp.execFileSync('git', args, { cwd: dir, input, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid' } }).trim();
  function descendant(file, body) {
    git(['read-tree',REVIEW]);
    const blob = git(['hash-object','-w','--stdin'],body);
    git(['update-index','--add','--cacheinfo',`100644,${blob},${file}`]);
    const tree = git(['write-tree']), sha = git(['commit-tree',tree,'-p',REVIEW], 'fixture\n');
    git(['update-ref','HEAD',sha]); return sha;
  }
  const next = descendant('docs/later-legitimate-review.md', 'later unrelated PR change\n');
  assert.equal(verify(dir,env(next),event(next)).mode, 'pull_request');
  assert.throws(() => verify(dir,{ ...env(next),GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/'+BRANCH,GITHUB_SHA:next },{}), /UNREVIEWED_SOURCE_DELTA/);
  assert.throws(() => verify(dir,env(REVIEW),event(REVIEW)), /SOURCE_CHECKOUT_HEAD_MISMATCH/);
  for (const file of ['prisma/migrations/20261016000000_stocks_test_cash_authority/migration.sql','prisma/migrations/20990101000000_unapproved/migration.sql']) {
    const sha = descendant(file,'SELECT 1;\n');
    assert.throws(() => verify(dir,env(sha),event(sha)), /MIGRATION_TREE_CHANGED/);
  }
  const changedChecker = descendant('scripts/qa/stocks-release-package.cjs','// weakened checker\n');
  assert.throws(() => verify(dir,env(changedChecker),event(changedChecker)), /STRICT_SOURCE_CHANGED/);
  for (const file of ['scripts/qa/stocks613-migration-rehearsal.cjs','services/stocks-global/testing/disposable-postgres.cjs']) {
    const sha = descendant(file,'// unsafe replacement of original SQL / DB isolation guard\n');
    assert.throws(() => verify(dir,env(sha),event(sha)), /STRICT_SOURCE_CHANGED/);
  }
});
