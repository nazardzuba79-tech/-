const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');
const workflows = path.join(root, '.github/workflows');
const loadYaml = yaml.load || yaml.safeLoad;
for (const file of fs.readdirSync(workflows).filter(name => /\.ya?ml$/.test(name))) {
  const source = fs.readFileSync(path.join(workflows, file), 'utf8');
  // Do not reintroduce the old draft branch's bypass into production test jobs.
  assert(!source.includes("github.head_ref != 'codex/mobile-clients-review'"), `${file}: legacy PR quarantine must not disable production checks`);
  assert(!source.includes("github.ref != 'refs/heads/codex/mobile-clients-review'"), `${file}: legacy branch quarantine must not disable production checks`);
  if (file !== 'mobile-clients-review.yml') continue;
  const workflow = loadYaml(source);
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.deepEqual(workflow.on.pull_request.branches, ['main']);
  for (const trigger of [workflow.on.push, workflow.on.pull_request]) {
    for (const required of ['frontend/src/**', 'frontend/mobile-review/**', 'src/auth/telegramInitData.ts', 'scripts/*mobile*', '.github/workflows/mobile-clients-review.yml']) {
      assert(trigger.paths.includes(required), `Missing review dependency coverage: ${required}`);
    }
  }
  assert(!/secrets\.|environment:|services:|wrangler|deploy|hooks\.render|neon\.tech/i.test(source), 'Review CI must have no secrets, environments, service or deployment commands');
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), ['fixtures-only']);
  const job = workflow.jobs['fixtures-only'];
  assert(!job.if, 'Fixture checks must not be skipped by branch guards');
  assert(job['timeout-minutes'] <= 15);
  assert(source.includes('mobile-review-checks.cjs'));
  assert(source.includes('qa-mobile-review.cjs'));
  for (const step of job.steps) {
    if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
    if (/npm (ci|install)/.test(step.run || '')) assert(step.run.includes('--ignore-scripts'), 'Dependency install must not execute lifecycle scripts');
  }
}
for (const file of ['frontend/index.html', 'frontend/src/main.tsx', 'frontend/vite.config.ts']) {
  assert(!/mobile-review|mobile\/sw\.js/.test(fs.readFileSync(path.join(root, file), 'utf8')), `${file}: production must not import review clients`);
}
console.log('CI safety: independent fixture checks; production jobs retain their coverage; review has no secrets or production entry.');
