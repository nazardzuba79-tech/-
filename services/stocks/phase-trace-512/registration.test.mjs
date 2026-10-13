import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,unlinkSync,existsSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { prepareCandidate } from './registration-source.mjs';
import { schedule } from './registration-run.mjs';
import { validateBounds } from './run.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),work=mkdtempSync(join(tmpdir(),'stocks-registration-source-test-'));
const baseline=join(work,'baseline'),candidate=join(work,'candidate'),worker='services/stocks-global/account-worker.mjs';
const revision='e'.repeat(40),hash=text=>createHash('sha256').update(text.toString('utf8').replace(/\r\n/g,'\n')).digest('hex');
function command(bin,args,options={}){const result=spawnSync(bin,args,{encoding:'utf8',timeout:30000,...options});assert.equal(result.status,0,result.stderr||result.error?.message);return result.stdout;}
mkdirSync(baseline);command('git',['archive','--format=tar','--output='+join(work,'source.tar'),'06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb','services/stocks','services/stocks-global','services/stocks-simulator'],{cwd:root});command('tar',['-xf',join(work,'source.tar'),'-C',baseline]);cpSync(baseline,candidate,{recursive:true});
writeFileSync(join(candidate,worker),readFileSync(join(root,worker)));
writeFileSync(join(candidate,'services/stocks/REVIEW-STAGING-512.md'),'Explicit diagnostic-only fixture content.');
writeFileSync(join(candidate,'services/stocks/summarize-launch.cjs'),'// changed diagnostic fixture, excluded from images');

test('paired candidate source contains exactly baseline92 files with only reviewed worker replacement',()=>{
 const output=join(work,'verified'),manifest=prepareCandidate(baseline,candidate,output,revision);
 assert.equal(manifest.runtimeChanges.length,1);assert.equal(manifest.runtimeChanges[0].file,worker);assert.equal(manifest.serviceFiles.length,92);
 assert.equal(manifest.excludedNonRuntimeChanges.length,2);assert(!existsSync(join(output,'services/stocks/REVIEW-STAGING-512.md')));
 for(const file of manifest.serviceFiles)assert.equal(file.sha256,hash(readFileSync(join(file.file===worker?candidate:baseline,file.file))));
 assert.deepEqual(readFileSync(join(output,'services/stocks/summarize-launch.cjs')),readFileSync(join(baseline,'services/stocks/summarize-launch.cjs')));
 command(process.execPath,['--check',join(output,worker)]);command(process.execPath,['--check',join(here,'registration-run.mjs')]);
 assert.throws(()=>prepareCandidate(baseline,candidate,output,revision),/REGISTRATION_OUTPUT_NOT_EMPTY/);
 assert.throws(()=>prepareCandidate(baseline,candidate,join(candidate,'inside'),revision),/REGISTRATION_OUTPUT_MUST_BE_OUTSIDE_INPUT/);
 assert.throws(()=>prepareCandidate(baseline,candidate,join(work,'badrevision'),'main'),/REGISTRATION_EXACT_CANDIDATE_REVISION_REQUIRED/);
});

test('other runtime modification, addition, deletion and unreviewed worker hash fail closed',()=>{
 const engine=join(candidate,'services/stocks-global/engine.mjs'),originalEngine=readFileSync(engine);
 writeFileSync(engine,Buffer.concat([originalEngine,Buffer.from('\n// unrelated runtime change')]));
 assert.throws(()=>prepareCandidate(baseline,candidate,join(work,'badengine'),revision),/REGISTRATION_OTHER_RUNTIME_CHANGE services\/stocks-global\/engine.mjs/);writeFileSync(engine,originalEngine);
 const extra=join(candidate,'services/stocks-global/unreviewed.mjs');writeFileSync(extra,'// unexpected runtime');
 assert.throws(()=>prepareCandidate(baseline,candidate,join(work,'badextra'),revision),/REGISTRATION_OTHER_RUNTIME_CHANGE services\/stocks-global\/unreviewed.mjs/);unlinkSync(extra);
 unlinkSync(engine);assert.throws(()=>prepareCandidate(baseline,candidate,join(work,'missing'),revision),/REGISTRATION_CANDIDATE_FILE_MISSING/);writeFileSync(engine,originalEngine);
 const code=readFileSync(join(candidate,worker));writeFileSync(join(candidate,worker),Buffer.concat([code,Buffer.from('\n// unreviewed')]));
 assert.throws(()=>prepareCandidate(baseline,candidate,join(work,'wronghash'),revision),/REGISTRATION_UNREVIEWED_CANDIDATE_HASH/);writeFileSync(join(candidate,worker),code);
});

test('baseline guard rejects drift; schedule preserves three counterbalanced pairs and original resource gates',()=>{
 const file=join(baseline,'services/stocks-global/engine.mjs'),original=readFileSync(file);writeFileSync(file,Buffer.concat([original,Buffer.from('\n// changed')]));
 assert.throws(()=>prepareCandidate(baseline,candidate,join(work,'badbaseline'),revision),/REGISTRATION_BASELINE_CHANGED/);writeFileSync(file,original);
 assert.deepEqual(schedule().map(x=>[x.repeat,x.mode]),[[0,'baseline'],[0,'candidate'],[1,'candidate'],[1,'baseline'],[2,'baseline'],[2,'candidate']]);
 const limits={cpuMax:'5000 100000',memoryMax:'268435456',ioMax:'8:0 rbps=1048576 wbps=131072'};assert.doesNotThrow(()=>validateBounds(limits));assert.throws(()=>validateBounds({...limits,cpuMax:'10000 100000'}),/ORIGINAL_LIMITS_UNVERIFIED/);
});
