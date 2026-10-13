import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { selectReview, selectFromRepository, PLAN_PATH, BASELINE } from './review-plan.mjs';
const repository = 'nazardzuba79-tech/-';
const event = { action: 'synchronize', before: BASELINE, pull_request: { number: 512,
  head: { ref: 'dot/stocks-owner-usdt-portfolio-20261013', repo: { full_name: repository } } } };
const plan = { schema: 1, id: 'controlled-first-stage', baseline: BASELINE, stage: 'diagnostic-and-model' };

test('only a reviewed new plan launches A diagnostics and B model, not acceptance', () => {
  assert.deepEqual(selectReview({ event, repository, plan }), {
    legacy: false, diagnostic: true, timeline: false, registration: false, model: true, targeted: false, matched: false,
    reason: 'Explicit reviewed plan transition: controlled-first-stage',
  });
});
test('targeted HTTP requires a new PR512 plan and cannot repeat A or full B matrices', () => {
  const next = { ...plan, id: 'targeted-http-local-review', stage: 'targeted-http' };
  const result = selectReview({ event, repository, plan: next, previousPlan: plan });
  assert.equal(result.targeted, true);
  for (const key of ['legacy','diagnostic','timeline','registration','model','matched']) assert.equal(result[key], false);
  assert.equal(selectReview({ event, repository, plan: next, previousPlan: next }).targeted, false);
  const other = { ...event, pull_request: { ...event.pull_request, number: 497 } };
  assert.equal(selectReview({ event: other, repository, plan: next }).legacy, true);
  assert.equal(selectReview({ event: other, repository, plan: next }).targeted, false);
});
test('documentation/test follow-ups with unchanged plan cannot launch expensive jobs', () => {
  const result = selectReview({ event, repository, plan, previousPlan: { ...plan } });
  for (const key of ['legacy','diagnostic','timeline','registration','model','matched']) assert.equal(result[key], false);
  assert.equal(selectReview({ event, repository, plan,
    previousPlan: { stage: plan.stage, baseline: plan.baseline, id: plan.id, schema: plan.schema } }).legacy, false);
});
test('timeline follow-up cannot repeat completed phase controls or the running model', () => {
  const next = { ...plan, id: 'targeted-pristine-timeline', stage: 'timeline' };
  const result = selectReview({ event, repository, plan: next, previousPlan: plan });
  assert.equal(result.timeline, true);
  for (const key of ['legacy','diagnostic','registration','model','matched']) assert.equal(result[key], false);
  assert.equal(selectReview({ event, repository, plan: next, previousPlan: next }).timeline, false);
});
test('registration candidate launches only its targeted pairs and does not repeat other evidence', () => {
  const next = { ...plan, id: 'targeted-registration-pairs', stage: 'registration' };
  const result = selectReview({ event, repository, plan: next, previousPlan: plan });
  assert.equal(result.registration, true);
  for (const key of ['legacy','diagnostic','timeline','model','matched']) assert.equal(result[key], false);
  assert.equal(selectReview({ event, repository, plan: next, previousPlan: next }).registration, false);
});
test('original criteria run only in explicit matched acceptance stage within PR512', () => {
  const result = selectReview({ event, repository, plan: { ...plan, stage: 'matched-acceptance' } });
  assert.equal(result.legacy, true); assert.equal(result.matched, true);
  assert.equal(result.model, false); assert.equal(result.diagnostic, false);
});
test('other PRs, branches and repos retain their existing workflow scheduling', () => {
  for (const other of [
    { ...event, pull_request: { ...event.pull_request, number: 497 } },
    { ...event, pull_request: { ...event.pull_request, head: { ...event.pull_request.head, ref: 'other' } } },
    { ...event, pull_request: { ...event.pull_request, head: { ...event.pull_request.head, repo: { full_name: 'fork/-' } } } },
    {},
  ]) assert.equal(selectReview({ event: other, repository }).legacy, true);
});
test('reopen/label events do not relaunch existing measurements', () => {
  for (const action of ['opened','reopened','labeled','edited']) {
    const result = selectReview({ event: { ...event, action }, repository, plan });
    assert.equal(result.diagnostic || result.timeline || result.registration || result.model || result.legacy || result.matched, false);
  }
});
test('malformed or silently repurposed plan fails closed', () => {
  assert.throws(() => selectReview({ event, repository, plan: { ...plan, stage: 'anything' } }), /Invalid/);
  assert.throws(() => selectReview({ event, repository, plan: { ...plan, baseline: 'HEAD' } }), /Invalid/);
  assert.throws(() => selectReview({ event, repository, plan, previousPlan: { ...plan, stage: 'model' } }), /new reviewed id/);
});
test('actual git transition distinguishes first plan from doc-only change; missing commit is fatal', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'stocks-review-plan-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    git('init'); git('config','user.name','Fixture'); git('config','user.email','fixture@invalid');
    writeFileSync(join(cwd,'README.md'),'initial\n'); git('add','.'); git('commit','-m','initial');
    const before = git('rev-parse','HEAD');
    mkdirSync(dirname(join(cwd,PLAN_PATH)), { recursive: true });
    writeFileSync(join(cwd,PLAN_PATH),JSON.stringify(plan));
    assert.equal(selectFromRepository({ event: { ...event, before }, repository, cwd }).diagnostic,true);
    git('add','.');git('commit','-m','reviewed-plan');
    const planned = git('rev-parse','HEAD');
    writeFileSync(join(cwd,'README.md'),'documentation only\n');git('add','.');git('commit','-m','documentation');
    assert.equal(selectFromRepository({ event: { ...event, before: planned }, repository, cwd }).diagnostic,false);
    assert.throws(()=>selectFromRepository({ event: { ...event, before: 'a'.repeat(40) }, repository, cwd }));
  } finally { rmSync(cwd,{recursive:true,force:true}); }
});

test('targeted model evidence v2 launches only model and never repeats on unchanged plan', () => {
  const next = { ...plan, id: 'targeted-model-evidence-v2', stage: 'model-evidence-v2' };
  const result = selectReview({ event, repository, plan: next, previousPlan: plan });
  assert.equal(result.model, true);
  for (const key of ['legacy','diagnostic','timeline','registration','matched']) assert.equal(result[key], false);
  assert.equal(selectReview({ event, repository, plan: next, previousPlan: next }).model, false);
});
