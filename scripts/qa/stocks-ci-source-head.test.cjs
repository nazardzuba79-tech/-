// Offline tests of the exact workflow assertions. No Actions dispatch, database
// or network; only read-only git commands and temporary assertion receipts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '../..');
const read = name => yaml.load(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8'));
const release = read('stocks-focused-review.yml');
const legacy = read('stocks-legacy-unsupported.yml');
const expectedExpression = '${{ github.event_name == \'workflow_dispatch\' && github.sha || github.event.pull_request.head.sha }}';
const repoExpression = '${{ github.event_name == \'workflow_dispatch\' && github.repository || github.event.pull_request.head.repo.full_name }}';
const head = cp.execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root, encoding:'utf8'}).trim();
const other = '0'.repeat(40);
const jobs = [
  ['financial-review', release.jobs['financial-review']],
  ['node22-hetzner-module-load', release.jobs['node22-hetzner-module-load']],
  ['legacy-unsupported', legacy.jobs['legacy-unsupported']],
];
const code = step => {
  assert.match(step.run, /^node <<'NODE'\n[\s\S]+\nNODE\n$/);
  return step.run.slice("node <<'NODE'\n".length, -'NODE\n'.length);
};
function execute(source, changes = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-ci-sha-'));
  const output = path.join(dir, 'output'), summary = path.join(dir, 'summary');
  const env = {...process.env, EXPECTED_SOURCE_SHA:head, SOURCE_EVENT:'pull_request',
    SOURCE_REPO:'nazardzuba79-tech/-', GITHUB_REPOSITORY:'nazardzuba79-tech/-',
    GITHUB_SHA:other, GITHUB_OUTPUT:output, GITHUB_STEP_SUMMARY:summary, ...changes};
  // A secret/options-bearing runner environment is not needed to test SHA checks.
  delete env.NODE_OPTIONS;
  try {
    const r = cp.spawnSync(process.execPath, ['-e', source], {cwd:root, env, encoding:'utf8', timeout:10000, windowsHide:true});
    assert.ifError(r.error);
    return {...r, output:fs.existsSync(output) ? fs.readFileSync(output,'utf8') : '',
      summary:fs.existsSync(summary) ? fs.readFileSync(summary,'utf8') : ''};
  } finally {
    // Exact fixture-owned files only; never recurse into a checkout.
    for (const f of [output, summary]) if (fs.existsSync(f)) fs.unlinkSync(f);
    fs.rmdirSync(dir);
  }
}

test('only PR and existing manual review events, read-only permissions and immutable capture', () => {
  for (const workflow of [release, legacy]) {
    assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request','workflow_dispatch']);
    assert.deepEqual(workflow.permissions, {contents:'read'});
    assert.equal(workflow.env.EXPECTED_SOURCE_SHA, expectedExpression);
    assert(!JSON.stringify(workflow).includes('secrets.'));
    assert(!JSON.stringify(workflow).includes('continue-on-error'));
    for (const job of Object.values(workflow.jobs)) {
      assert.equal(job.permissions, undefined);
      assert.equal(job.env?.EXPECTED_SOURCE_SHA, undefined);
    }
  }
});

for (const [name, job] of jobs) {
  const check = job.steps.find(s => s.id === 'source-check');
  test(`${name}: pinned checkout and assertion precede all dependency/test steps`, () => {
    const checkout = job.steps[0];
    assert.equal(checkout.uses, 'actions/checkout@v4');
    assert.equal(checkout.with.ref, '${{ env.EXPECTED_SOURCE_SHA }}');
    assert.equal(checkout.with['persist-credentials'], false);
    assert.equal(job.steps[1], check);
    assert.equal(check.env.SOURCE_REPO, repoExpression);
    assert.equal(check.env.SOURCE_EVENT, '${{ github.event_name }}');
    for (const step of job.steps.filter(s => s.uses === 'actions/upload-artifact@v4')) {
      assert(step.with.name.includes('${{ env.EXPECTED_SOURCE_SHA }}'));
      assert(!step.with.name.includes('github.sha'));
    }
    if (name !== 'legacy-unsupported') {
      assert.equal(job.outputs['source-sha'], '${{ steps.source-check.outputs.sha }}');
    }
  });
  for (const event of ['pull_request','workflow_dispatch']) {
    test(`${name}: ${event} verifies the captured commit against actual Git HEAD`, () => {
      const r = execute(code(check), {SOURCE_EVENT:event, GITHUB_SHA:event === 'pull_request' ? other : head});
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`Expected source SHA: ${head}\\nActual checkout SHA: ${head}`));
      assert.equal(r.output, `sha=${head}\n`);
    });
  }
  for (const [label, changes] of [
    ['merge/other checkout SHA', {EXPECTED_SOURCE_SHA:other}],
    ['missing expected SHA', {EXPECTED_SOURCE_SHA:''}],
    ['malformed expected SHA', {EXPECTED_SOURCE_SHA:'main'}],
    ['fork repository', {SOURCE_REPO:'another-owner/fork'}],
    ['missing repository', {SOURCE_REPO:''}],
    ['unsupported push event', {SOURCE_EVENT:'push'}],
  ]) {
    test(`${name}: rejects ${label} without a success receipt`, () => {
      const r = execute(code(check), changes);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /STOCKS_CI_SOURCE_HEAD_MISMATCH/);
      assert.match(r.stdout, /Expected source SHA:/);
      assert.match(r.stdout, /Actual checkout SHA:/);
      assert.equal(r.output, '');
    });
  }
}

const aggregate = release.jobs['pg-release-required'];
test('required aggregate depends on both full PG jobs and their actual SHA receipts', () => {
  assert.deepEqual(aggregate.needs, ['financial-review','node22-hetzner-module-load']);
  assert.equal(aggregate.if, 'always()');
  const env = aggregate.steps[0].env;
  assert.equal(env.FINANCIAL_SHA, '${{ needs.financial-review.outputs.source-sha }}');
  assert.equal(env.NODE22_SHA, '${{ needs.node22-hetzner-module-load.outputs.source-sha }}');
  assert.equal(env.FINANCIAL_RESULT, '${{ needs.financial-review.result }}');
  assert.equal(env.NODE22_RESULT, '${{ needs.node22-hetzner-module-load.result }}');
});
const success = {FINANCIAL_RESULT:'success', NODE22_RESULT:'success', FINANCIAL_SHA:head, NODE22_SHA:head};
test('aggregate accepts only matching successful source receipts', () => {
  const r = execute(code(aggregate.steps[0]), success);
  assert.equal(r.status, 0, r.stderr);
  assert(r.summary.includes(`PASS at source ${head}`));
});
for (const [label, changes] of [
  ['financial FAIL', {FINANCIAL_RESULT:'failure'}],
  ['Node22 skipped', {NODE22_RESULT:'skipped'}],
  ['Node22 cancelled', {NODE22_RESULT:'cancelled'}],
  ['financial missing receipt', {FINANCIAL_SHA:''}],
  ['Node22 different commit', {NODE22_SHA:other}],
  ['all missing SHAs', {EXPECTED_SOURCE_SHA:'',FINANCIAL_SHA:'',NODE22_SHA:''}],
]) {
  test(`aggregate rejects ${label}`, () => {
    const r = execute(code(aggregate.steps[0]), {...success,...changes});
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /STOCKS_CI_REQUIRED_HEAD_OR_RESULT_MISMATCH/);
    assert.equal(r.summary, '');
  });
}

test('supported PG zero-failure/zero-skip gates and genuine legacy exit remain intact', () => {
  let pgSteps = 0;
  for (const [, job] of jobs.slice(0,2)) {
    for (const step of job.steps.filter(s => s.run?.includes('tee /tmp/stocks-'))) {
      pgSteps++;
      assert(step.run.includes('set -euo pipefail'));
      for (const criterion of ['^# skipped 0$', '^# fail 0$', '^# pass [1-9][0-9]*$']) {
        assert(step.run.includes(criterion));
      }
    }
  }
  assert.equal(pgSteps, 3);
  const legacyJob = legacy.jobs['legacy-unsupported'];
  const run = legacyJob.steps.find(s => s.id === 'legacy').run;
  assert.equal(run, 'set -euo pipefail\nnode --test --test-reporter=tap services/stocks-global/two-trader-auth-lifetime.test.mjs | tee legacy-unsupported.tap\n');
  assert(legacyJob.steps.some(s => s.if === 'always()' && s.uses === 'actions/upload-artifact@v4'));
  const blob = cp.execFileSync('git', ['hash-object','services/stocks-global/two-trader-auth-lifetime.test.mjs'], {cwd:root,encoding:'utf8'}).trim();
  assert.equal(blob, 'd1af5fc7353857d3e5ae60e03fc2c0c2f2c16034');
});
