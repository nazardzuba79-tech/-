// Built-in Node tests: no installation, database, network, credentials or browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { init, run, finalize } = require('./otc-ci-evidence.cjs');
const root = path.resolve(__dirname, '..');
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-review-runner-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(dir, file, body) {
  const target = path.join(dir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}
function fixture(t, { generationExit = 0, testsPass = true, rejectJest = false, diagnostics = [] } = {}) {
  const dir = temporary(t);
  put(dir, 'scripts/verify-review.cjs', fs.readFileSync(path.join(__dirname, 'verify-review.cjs')));
  put(dir, 'prisma/schema.prisma', 'generator client {\n  provider = "prisma-client-js"\n}\n');
  put(dir, 'tsconfig.json', '{}'); put(dir, 'tsconfig.jest.json', '{}');
  put(dir, 'node_modules/@prisma/client/sentinel', 'shared client unchanged');
  put(dir, 'node_modules/prisma/build/index.js', `
    const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
    assert.equal(process.env.DIRECT_URL, undefined); assert.equal(process.env.RENDER_API_KEY, undefined);
    assert.equal(process.env.TEST_TOKEN, undefined); assert.equal(process.env.PGPASSWORD, undefined);
    assert.equal(process.env.DATABASE_URL, 'postgresql://fixture:fixture@127.0.0.1:1/review_unavailable');
    assert.equal(process.env.NODE_ENV,'test');
    const schema=process.argv[process.argv.indexOf('--schema')+1];
    assert.ok(fs.readFileSync(schema,'utf8').includes('output = "./client"'));
    assert.ok(schema.includes('review-client-'));
    fs.mkdirSync(path.join(path.dirname(schema),'client'));
    if (${generationExit}) console.error('fixture generation failure');
    process.exit(${generationExit});
  `);
  put(dir, 'node_modules/typescript/index.js', `module.exports={sys:{readFile(){}},
    readConfigFile:()=>({config:{compilerOptions:{}}}),
    parseJsonConfigFileContent:()=>({options:{},fileNames:[],errors:[]}),
    createProgram:(_files,options)=>{require('node:assert/strict').match(options.paths['@prisma/client'][0],/review-client-/);return {emit:()=>({diagnostics:[]})}},
    getPreEmitDiagnostics:()=>${JSON.stringify(diagnostics)},formatDiagnosticsWithColorAndContext:()=>'fixture type error'};`);
  put(dir, 'jest.config.js', `module.exports={transform:{'^.+\\\\.tsx?$':['ts-jest',{}]}};`);
  put(dir, 'node_modules/jest/index.js', `module.exports={runCLI:async()=>{
    ${rejectJest ? "throw new Error('fixture Jest startup failure');" : ''}
    return {results:{success:${testsPass},numPassedTests:${testsPass ? 1 : 0},numFailedTests:${testsPass ? 0 : 1},testResults:[]}};
  }};`);
  return dir;
}
function verify(dir, mode, extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts/verify-review.cjs'), mode, 'fixture-test'], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env,
      OTC_CI_EVIDENCE_DIR: '', DATABASE_URL: 'fixture-must-be-replaced', DIRECT_URL: 'fixture-must-be-removed',
      RENDER_API_KEY: 'fake', TEST_TOKEN: 'fake', PGPASSWORD: 'fake', ...extraEnv },
  });
}
test('clean checkout bootstrap creates the missing cache and isolates generated client and credentials', t => {
  const dir = fixture(t);
  assert.equal(fs.existsSync(path.join(dir, 'node_modules/.cache')), false);
  const result = verify(dir, 'build');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Backend build: PASS/);
  assert.equal(fs.readFileSync(path.join(dir, 'node_modules/@prisma/client/sentinel'), 'utf8'), 'shared client unchanged');
  assert.equal(fs.readdirSync(path.join(dir, 'node_modules/.cache')).length, 1);
});
test('generation failure remains nonzero and retains diagnostic', t => {
  const result = verify(fixture(t, { generationExit: 7 }), 'build');
  assert.equal(result.status, 7); assert.match(result.stderr, /fixture generation failure/);
});
test('disposable service imports share the isolated client without a generated default client', t => {
  const dir = temporary(t);
  put(dir, 'scripts/fixtures/isolated-prisma.cjs', fs.readFileSync(path.join(__dirname, 'fixtures/isolated-prisma.cjs')));
  const defaultModule = "throw new Error('ungenerated default client must never load');";
  put(dir, 'node_modules/@prisma/client/index.js', defaultModule);
  put(dir, 'generated/index.js', "module.exports={PrismaClient:class IsolatedClient{},Prisma:{TransactionIsolationLevel:{ReadCommitted:'ReadCommitted'}}};");
  put(dir, 'service.cjs', "module.exports=require('@prisma/client');");
  put(dir, 'check.cjs', `
    const assert=require('node:assert/strict');
    const isolated=require('./scripts/fixtures/isolated-prisma.cjs')(require.resolve('./generated'));
    assert.strictEqual(require('./service.cjs'),isolated);
    assert.strictEqual(require('./service.cjs').PrismaClient,isolated.PrismaClient);
    assert.equal(isolated.Prisma.TransactionIsolationLevel.ReadCommitted,'ReadCommitted');
  `);
  const result = spawnSync(process.execPath, [path.join(dir, 'check.cjs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'node_modules/@prisma/client/index.js'), 'utf8'), defaultModule);
});
test('compilation failure cannot be reported as PASS', t => {
  const result = verify(fixture(t, { diagnostics: [{}] }), 'build');
  assert.equal(result.status, 1); assert.match(result.stderr, /fixture type error/);
});
test('Jest rejection remains nonzero with full error', t => {
  const result = verify(fixture(t, { rejectJest: true }), 'test');
  assert.equal(result.status, 1); assert.match(result.stderr, /fixture Jest startup failure/);
});
test('failed tests preserve failed result JSON in fresh evidence', t => {
  const dir = fixture(t, { testsPass: false }), evidence = init(temporary(t), { checkoutSha: 'fixture-sha', runId: 'test' });
  const result = verify(dir, 'test', { OTC_CI_EVIDENCE_DIR: evidence });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(evidence, 'jest-results.json')));
  assert.equal(report.success, false); assert.equal(report.numFailedTests, 1);
});
test('successful tests persist actual counts', t => {
  const dir = fixture(t), evidence = init(temporary(t), { checkoutSha: 'fixture-sha', runId: 'test' });
  const result = verify(dir, 'test', { OTC_CI_EVIDENCE_DIR: evidence });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(evidence, 'jest-results.json'))).numPassedTests, 1);
});
test('each attempt gets an empty directory, never historical PASS evidence', t => {
  const parent = temporary(t);
  put(parent, 'docs/qa/otc-cash/result.json', '{"success":true}');
  const metadata = { checkoutSha: 'fixture-sha', runId: '42', runAttempt: '2' };
  const first = init(parent, metadata), second = init(parent, metadata);
  assert.notEqual(first, second); assert.deepEqual(fs.readdirSync(second), ['run.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(second, 'run.json'))).checkoutSha, 'fixture-sha');
});
test('failed command preserves exit code, stdout, stderr and actual outcome; skipped browser cannot pass', async t => {
  const dir = init(temporary(t), { checkoutSha: 'fixture-sha', runId: '42' });
  const code = await run(dir, 'failed-build', 'node', ['-e', 'console.log("fixture output");console.error("fixture stack");process.exit(9)']);
  assert.equal(code, 9);
  assert.match(fs.readFileSync(path.join(dir, 'failed-build.log'), 'utf8'), /fixture output[\s\S]*fixture stack|fixture stack[\s\S]*fixture output/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'failed-build.json'))).exitCode, 9);
  finalize(dir, { build: { outcome: 'failure' }, browser: { outcome: 'skipped' } });
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'run.json')));
  assert.equal(report.status, 'FAIL'); assert.equal(report.steps.browser.outcome, 'skipped');
  assert.equal(fs.existsSync(path.join(dir, 'result.json')), false);
});
test('spawn failure is recorded and nonzero', async t => {
  const dir = init(temporary(t), {});
  assert.equal(await run(dir, 'missing-command', path.join(dir, 'nonexistent-executable'), []), 1);
  assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'missing-command.json'))).launchError, /ENOENT/);
});
test('successful command and complete step outcomes report PASS without reusing a step log', async t => {
  const dir = init(temporary(t), {});
  assert.equal(await run(dir, 'pass', 'node', ['-e', 'process.exit(0)']), 0);
  await assert.rejects(run(dir, 'pass', 'node', ['-e', 'process.exit(0)']), /EEXIST/);
  finalize(dir, { build: { outcome: 'success' }, browser: { outcome: 'success' } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'run.json'))).status, 'PASS');
});
test('skipped or empty outcomes are INCOMPLETE, never a fresh PASS', t => {
  const dir = init(temporary(t), {});
  for (const steps of [{}, { build: { outcome: 'success' }, browser: { outcome: 'skipped' } }]) {
    finalize(dir, steps);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'run.json'))).status, 'INCOMPLETE');
  }
});
test('workflow uploads only fresh evidence, checks exact head and clean cache, retains all financial gates', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/otc-cash-review.yml'), 'utf8');
  assert.doesNotMatch(workflow, /path: docs\/qa\/otc-cash|continue-on-error/);
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /existsSync\('node_modules\/\.cache'\), false/);
  assert.match(workflow, /path: \$\{\{ steps.evidence.outputs.directory \}\}/);
  for (const gate of ['--verify', '--otc', '--preservation', 'qa-otc-cash.cjs', 'adminUsers.test.ts']) assert.ok(workflow.includes(gate));
  assert.match(workflow, /OTC_CI_STEPS: \$\{\{ toJSON\(steps\) \}\}/);
  const browser = fs.readFileSync(path.join(__dirname, 'qa-otc-cash.cjs'), 'utf8');
  assert.doesNotMatch(browser, /docs\/qa\/otc-cash/);
  assert.match(browser, /fs.mkdtempSync/);
});
