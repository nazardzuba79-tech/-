import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('evidence keeps timed-out attempts visible and never mixes supplemental CPU allocations',t=>{
  const prefix=join(tmpdir(),'stocks-evidence-test-'),dir=mkdtempSync(prefix);
  t.after(()=>{assert(resolve(dir).startsWith(resolve(prefix)));rmSync(dir,{recursive:true,force:true});});
  mkdirSync(join(dir,'realistic'));
  const row=(quota,failures,pass)=>({variant:'after',allocationVcpu:quota,reader:{users:50,pattern:'mixed',failures,httpErrorCodes:{},latencyMs:{p50:10,p95:20,p99:30},allAttemptLatencyMs:{p50:10,p95:3000,p99:3000}},server:{cpuMs:20,elapsedMs:1000,maxRssBytes:1048576,sqlCalls:5},acceptance:{pass}});
  writeFileSync(join(dir,'realistic/results.json'),JSON.stringify({ioMode:'fixture-only',results:[row(.05,{DEADLINE_3000MS:80},false),row(.05,{TimeoutError:2},false),row(.1,{},true)]}));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./review-evidence.mjs',import.meta.url)),dir,'fixture-only'],{encoding:'utf8',env:{...process.env,GITHUB_EVENT_PATH:''}});
  assert.equal(result.status,0,result.stderr);
  const report=readFileSync(join(dir,'README.md'),'utf8');
  const original=report.split('\n').find(line=>line.startsWith('| after/0.05/50/mixed'));
  const supplemental=report.split('\n').find(line=>line.startsWith('| after/0.1/50/mixed'));
  assert(original.includes('| 0/2 |'),'failed original allocation cannot become a passing aggregate');
  assert(original.includes('| 82/0/0 |'),'both known deadline codes must remain visible');
  assert(supplemental.includes('| 1/1 |')&&supplemental.includes('| 0/0/0 |'));
  assert(report.includes('"DEADLINE_3000MS": 80')&&report.includes('"TimeoutError": 2'),'raw safe error keys remain available');
});
