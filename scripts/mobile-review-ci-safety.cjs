const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const branch = 'codex/mobile-clients-review';
const root = path.resolve(__dirname, '..');
const workflows = path.join(root, '.github/workflows');
for (const file of fs.readdirSync(workflows).filter(name => /\.ya?ml$/.test(name))) {
  const source = fs.readFileSync(path.join(workflows, file), 'utf8');
  const workflow = yaml.safeLoad(source);
  assert(!workflow.on?.pull_request_target && !workflow.on?.workflow_run, `${file}: privileged trigger must be audited`);
  if (file === 'mobile-clients-review.yml') {
    assert(!/secrets\.|environment:|wrangler|deploy|hooks\.render|neon\.tech/i.test(source), 'Review CI must have no secrets, environments or deployment commands');
    assert.equal(workflow.permissions.contents, 'read');
    assert(source.includes('mobile-review-checks.cjs'));
    assert(source.includes('qa-mobile-review.cjs'));
    continue;
  }
  for (const [job, config] of Object.entries(workflow.jobs)) {
    assert(config.if?.includes(`github.head_ref != '${branch}'`), `${file}/${job}: PR guard missing`);
    assert(config.if?.includes(`github.ref != 'refs/heads/${branch}'`), `${file}/${job}: push/manual guard missing`);
  }
}
for (const file of ['frontend/index.html', 'frontend/src/main.tsx', 'frontend/vite.config.ts']) {
  assert(!/mobile-review|mobile\/sw\.js/.test(fs.readFileSync(path.join(root, file), 'utf8')), `${file}: production must not import review clients`);
}
console.log('CI safety: all legacy jobs excluded for this branch; isolated review has no secrets or production entry.');
