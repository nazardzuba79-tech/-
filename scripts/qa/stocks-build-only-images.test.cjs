'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boundedText, recordNegativeSmoke, execute } = require('./stocks-build-only-images.cjs');
test('build workflow uses the same immutable reviewed head for source and helpers, label only', () => {
  const fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
  const data=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/stocks-docker-build-only.yml'),'utf8');
  const workflow=yaml.load(data),job=workflow.jobs.images,head='${{ github.event.pull_request.head.sha }}';
  assert.deepEqual(workflow.on,{pull_request:{types:['labeled']}});
  assert.deepEqual(workflow.permissions,{contents:'read'});
  assert.deepEqual(Object.keys(workflow.jobs),['images']);
  assert.equal(job['runs-on'],'ubuntu-24.04');
  assert.equal(job.env.SOURCE_SHA,head);assert.equal(job.env.CONTROL_SHA,head);
  const checkouts=job.steps.filter(s=>s.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length,2);
  for(const checkout of checkouts){assert.equal(checkout.with.ref,head);assert.equal(checkout.with['persist-credentials'],false);}
  assert.match(job.if,/stocks-build-only-approved/);
  assert.equal(job.environment,undefined);
  assert.ok(!/secrets\.|continue-on-error|docker push|uses:.*upload-artifact/.test(data));
});
test('unexpected module failure retains both images, stderr and exit without becoming PASS', () => {
  const result = execute('unused', (_, receipt) => {
    receipt.images.push({target:'api',imageId:'sha256:fixture-api',cmd:['node','dist/index.js'],entrypoint:['docker-entrypoint.sh']},
      {target:'gateway',imageId:'sha256:fixture-gateway',node:'v22.23.3'});
    recordNegativeSmoke(receipt,'no-authority',{status:1,stdout:'',stderr:"Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/services/stocks-simulator/engine.mjs'\n"},
      'STOCKS_RELEASE_AUTHORITY_REQUIRED');
  });
  assert.equal(result.imageBuildOrSmoke,'FAIL');
  assert.equal(result.images.length,2);
  assert.equal(result.images[0].cmd[1],'dist/index.js');
  assert.equal(result.failClosed[0].exit,1);
  assert.match(result.failClosed[0].stderr,/ERR_MODULE_NOT_FOUND.*stocks-simulator/);
  assert.equal(result.positivePgStartup,'NOT_RUN');
});
test('negative smoke needs exact error line, exit 1, and no listening marker', () => {
  for (const result of [
    {status:0,stderr:'STOCKS_RELEASE_AUTHORITY_REQUIRED'},
    {status:1,stderr:'prefix STOCKS_RELEASE_AUTHORITY_REQUIRED'},
    {status:1,stderr:'STOCKS_RELEASE_AUTHORITY_REQUIRED',stdout:'STOCKS_RELEASE_LISTENING 4437'},
    {status:null,stderr:'STOCKS_RELEASE_AUTHORITY_REQUIRED',signal:'SIGTERM',error:Error('timeout')},
  ]) {
    const receipt={failClosed:[]};
    assert.throws(()=>recordNegativeSmoke(receipt,'probe',result,'STOCKS_RELEASE_AUTHORITY_REQUIRED'),/FAIL_CLOSED/);
    assert.equal(receipt.failClosed[0].status,'FAIL');
  }
  const receipt={failClosed:[]};
  recordNegativeSmoke(receipt,'probe',{status:1,stderr:'STOCKS_RELEASE_AUTHORITY_REQUIRED\n',stdout:''},'STOCKS_RELEASE_AUTHORITY_REQUIRED');
  assert.equal(receipt.failClosed[0].status,'PASS');
});
test('diagnostics redact credentials and bound huge stderr without losing partial receipt', () => {
  const text=boundedText('https://username:privatepass@example.invalid/ Bearer privatebearer password=privatevalue gateway_key=privatekey '+ 'x'.repeat(20000));
  for(const secret of ['privatepass','privatebearer','privatevalue','privatekey'])assert.ok(!text.includes(secret));
  assert.ok(Buffer.byteLength(text)<=8220);assert.match(text,/\[TRUNCATED\]/);
  const result=execute('unused',(_,receipt)=>{receipt.images.push({target:'api'});throw Error('token=privatevalue');});
  assert.equal(result.images.length,1);assert.equal(result.imageBuildOrSmoke,'FAIL');
  assert.ok(!result.error.includes('privatevalue'));
});
test('CLI emits a failure receipt and summary before Docker on a forbidden runner', () => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stocks-receipt-')),summary=path.join(dir,'summary');
  try {
    const result=cp.spawnSync(process.execPath,[path.join(__dirname,'stocks-build-only-images.cjs'),dir],{
      encoding:'utf8',windowsHide:true,timeout:10000,
      env:{...process.env,GITHUB_ACTIONS:'false',GITHUB_STEP_SUMMARY:summary},
    });
    assert.equal(result.status,1,result.stderr);
    const receipt=JSON.parse(result.stdout);
    assert.equal(receipt.imageBuildOrSmoke,'FAIL');
    assert.match(receipt.error,/ISOLATED_GITHUB_LINUX_RUNNER_REQUIRED/);
    assert.equal(receipt.positivePgStartup,'NOT_RUN');
    assert.match(fs.readFileSync(summary,'utf8'),/ISOLATED_GITHUB_LINUX_RUNNER_REQUIRED/);
  } finally {
    if(fs.existsSync(summary))fs.unlinkSync(summary);
    fs.rmdirSync(dir);
  }
});
