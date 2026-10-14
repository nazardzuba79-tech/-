import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BASELINE_SHA, WORKFLOW_PATH, normalizedWorkflow } from './launch-gate.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const text = fs.readFileSync(new URL('../../../.github/workflows/stocks-review.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const job = text.match(/^  stocks-auth-one-burst:\n([\s\S]*?)(?=^  stocks-backend-admission:)/m)?.[0];

test('all prior workflow jobs and their original finite-head pins remain byte-identical', () => {
  assert.ok(job);
  const before = execFileSync('git', ['show', `${BASELINE_SHA}:${WORKFLOW_PATH}`], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 ** 2 }).replace(/\r\n/g, '\n');
  assert.equal(text.replace(job, ''), before);
});

test('one-burst workflow retains serial preparation, source gates and a single explicit run', () => {
  const workflow = normalizedWorkflow(text);
  assert.match(workflow.declaredPolicySha256, /^[a-f0-9]{64}$/);
  assert.match(job, /needs: \[stocks-auth-preparation, stocks-auth-http-paired, stocks-backend-admission, isolated-simulator, frontend-regression, bounded-stock-runtime\]/);
  assert.match(job, /github\.event\.action == 'synchronize' && github\.run_attempt == 1/);
  assert.match(job, /group: stocks-one-burst-pr512\n      cancel-in-progress: false/);
  assert.equal((job.match(/launcher\.mjs --run /g) || []).length, 1);
  assert.equal((job.match(/launcher\.mjs --prepare /g) || []).length, 1);
  assert.match(job, /timeout-minutes: 40/);
  assert.ok(job.indexOf('validatePreparationSource') < job.indexOf('downloadArtifact'));
  assert.ok(job.indexOf('downloadArtifact') < job.indexOf('launcher.mjs --prepare'));
  assert.ok(job.indexOf('launcher.mjs --prepare') < job.indexOf('workflow-config.mjs run-config'));
  assert.ok(job.indexOf('workflow-config.mjs run-config') < job.indexOf('launcher.mjs --run'));
  assert.equal((job.match(/if: steps\.trace_source\.outputs\.eligible == 'true'/g) || []).length, 5);
  assert.ok(!/workflow_dispatch|continue-on-error|sudo |prisma |wrangler |ssh |pull_request_target/.test(job));
  assert.match(job, /permissions:\n      contents: read\n      actions: read/);
  assert.ok(!job.includes('...context, runAttempt'), 'GitHub Context repo is a prototype getter and must not be lost by spreading');
  assert.match(job, /repo: context\.repo/);
});

test('evidence upload excludes image archive, seed database and Docker configuration', () => {
  const upload = job.slice(job.indexOf('      - name: Preserve public diagnostic'));
  assert.match(upload, /if: always\(\)/);
  assert.ok(!/runtime-image\.tar|accounts\.sqlite|run-config\.json|prepare-config\.json|docker-config/.test(upload));
  assert.match(upload, /source-eligibility\.json/);
  assert.match(upload, /result\.json/);
  for (const file of ['driver-attempts.jsonl', 'driver-cgroups.jsonl', 'observer-*.json']) assert.ok(upload.includes(file));
});
test('actual workflow selected-member reader permits only the digest-bound empty build.log', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-inline-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const body = job.match(/\.map\(p => \{\n([\s\S]*?)\n            \}\);/)?.[1];
  assert.ok(body, 'selected-member inline reader must remain covered');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const read = new Function('p', 'stageDirectory', 'fs', 'path', 'assert', 'hash', body);
  fs.writeFileSync(path.join(dir, 'build.log'), '');
  assert.deepEqual(read('build.log', dir, fs, path, assert, hash), { path: 'build.log', bytes: 0,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  for (const name of ['report.json', 'build-provenance.json', 'compiled.js', 'nested/build.log']) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), '');
    assert.throws(() => read(name, dir, fs, path, assert, hash), undefined, name);
  }
});
