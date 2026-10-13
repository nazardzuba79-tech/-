// CI scheduling only. A skipped evidence job is never a capacity PASS.
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const PLAN_PATH = 'services/stocks/review-plan-512.json';
export const BASELINE = '06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb';
const BRANCH = 'dot/stocks-owner-usdt-portfolio-20261013';
const REPOSITORY = 'nazardzuba79-tech/-';
const idle = reason => ({ legacy: false, diagnostic: false, timeline: false, registration: false, model: false, targeted: false, matched: false, reason });

export function selectReview({ event, repository, plan, previousPlan }) {
  const pr = event.pull_request;
  if (repository !== REPOSITORY || pr?.number !== 512 || pr.head?.ref !== BRANCH
      || pr.head?.repo?.full_name !== REPOSITORY) {
    return { ...idle('Existing workflow policy; outside owner-scoped PR512'), legacy: true };
  }
  if (!plan || Object.keys(plan).sort().join(',') !== 'baseline,id,schema,stage'
      || plan.schema !== 1 || plan.baseline !== BASELINE
      || !/^[a-z0-9-]{1,80}$/.test(plan.id ?? '')
      || !['diagnostic', 'timeline', 'registration', 'model', 'model-evidence-v2', 'diagnostic-and-model', 'targeted-http', 'matched-acceptance', 'report-only'].includes(plan.stage)) {
    throw Error('Invalid PR512 reviewed performance plan; no heavy jobs may start');
  }
  if (event.action !== 'synchronize' || !/^[0-9a-f]{40}$/.test(event.before ?? '')) {
    return idle('No synchronize transition: heavy evidence requires an explicit new plan commit');
  }
  if (previousPlan && previousPlan.id === plan.id) {
    if (['schema', 'id', 'baseline', 'stage'].some(key => previousPlan[key] !== plan[key])) throw Error('Changed plan requires a new reviewed id');
    return idle('Plan unchanged: reuse named evidence, do not repeat heavy jobs for documentation/tests');
  }
  const result = idle('Explicit reviewed plan transition: ' + plan.id);
  result.diagnostic = ['diagnostic', 'diagnostic-and-model'].includes(plan.stage);
  result.timeline = plan.stage === 'timeline';
  result.registration = plan.stage === 'registration';
  result.model = ['model', 'model-evidence-v2', 'diagnostic-and-model'].includes(plan.stage);
  result.targeted = plan.stage === 'targeted-http';
  result.matched = plan.stage === 'matched-acceptance';
  // Original scripts, baselines, limits and pass criteria remain unmodified.
  result.legacy = result.matched;
  return result;
}

export function selectFromRepository({ event, repository, cwd = process.cwd() }) {
  const scoped = repository === REPOSITORY && event.pull_request?.number === 512
    && event.pull_request?.head?.ref === BRANCH
    && event.pull_request?.head?.repo?.full_name === REPOSITORY;
  if (!scoped) return selectReview({ event, repository });
  const plan = JSON.parse(readFileSync(resolve(cwd, PLAN_PATH), 'utf8'));
  let previousPlan = null;
  if (event.action === 'synchronize' && /^[0-9a-f]{40}$/.test(event.before ?? '')) {
    // Resolve the prior commit first: missing git history must fail closed, not
    // masquerade as a first plan and start another expensive workload.
    execFileSync('git', ['cat-file', '-e', event.before + '^{commit}'], { cwd, stdio: 'pipe' });
    const paths = execFileSync('git', ['ls-tree', '--name-only', event.before, '--', PLAN_PATH], { cwd, encoding: 'utf8' });
    if (paths.trim()) previousPlan = JSON.parse(execFileSync('git', ['show', event.before + ':' + PLAN_PATH], { cwd, encoding: 'utf8' }));
  }
  return selectReview({ event, repository, plan, previousPlan });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const result = selectFromRepository({ event, repository: process.env.GITHUB_REPOSITORY });
  console.log(JSON.stringify({ ...result, capacityAcceptance: 'NOT_EVALUATED_BY_SCHEDULER' }, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    ['legacy', 'diagnostic', 'timeline', 'registration', 'model', 'targeted', 'matched'].map(k => `${k}=${result[k]}\n`).join(''));
}
