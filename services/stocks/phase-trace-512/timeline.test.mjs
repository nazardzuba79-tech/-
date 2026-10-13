import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { install,transform,SOURCE_REVISION } from './timeline-install.mjs';
import { reconcile } from './timeline-analysis.mjs';
import { schedule } from './timeline-run.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),work=mkdtempSync(join(tmpdir(),'stocks-timeline512-test-'));
const source=join(work,'source'),shadow=join(work,'client'),exec=promisify(execFile),hash=value=>createHash('sha256').update(value).digest('hex');
mkdirSync(source);
function command(bin,args,options={}){const r=spawnSync(bin,args,{encoding:'utf8',timeout:30000,...options});assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout;}
command('git',['archive','--format=tar','--output='+join(work,'source.tar'),SOURCE_REVISION,'services/stocks','services/stocks-global','services/stocks-simulator'],{cwd:root});
command('tar',['-xf',join(work,'source.tar'),'-C',source]);
const manifest=install(source,shadow),reader='services/stocks/realistic-readers.mjs';
const helper=join(work,'reader-child.mjs');writeFileSync(helper,`import { pathToFileURL } from 'node:url';
const {runReaders}=await import(pathToFileURL(process.argv[2]));
console.log(JSON.stringify(await runReaders({base:process.argv[3],users:5,seconds:1,pattern:'mixed',instrumentsCount:20,cadenceMs:Number(process.argv[4]??2000)})));\n`);
const env=enabled=>({...process.env,STOCKS_TIMELINE_512:enabled?'1':'0',STOCKS_TIMELINE_512_FIXTURE:'isolated-issue505'});
const summary=result=>({requests:result.requests,ok:result.ok,errors:result.errors,statuses:result.statuses,failures:result.failures,httpErrorCodes:result.httpErrorCodes,byOperation:Object.fromEntries(Object.entries(result.byOperation).map(([key,value])=>[key,{ok:value.ok,errors:value.errors,failures:value.failures,httpErrorCodes:value.httpErrorCodes}]))});

test('exact source guard transforms only reader capture and retains all service/financial bytes',()=>{
 assert.equal(manifest.sourceFiles.length,92);assert.equal(manifest.sourceRevision,SOURCE_REVISION);assert.equal(manifest.serverMustUsePristineArchive,true);
 for(const f of manifest.sourceFiles){assert.equal(hash(readFileSync(join(source,f.file))),f.rawSha256);if(f.file!==reader)assert.deepEqual(readFileSync(join(source,f.file)),readFileSync(join(shadow,f.file)),f.file);}
 for(const file of ['timeline-install.mjs','timeline-recorder.mjs','timeline-analysis.mjs','timeline-run.mjs'])command(process.execPath,['--check',join(here,file)]);
 command(process.execPath,['--check',join(shadow,reader)]);
 const canonical=readFileSync(join(source,reader),'utf8').replace(/\r\n/g,'\n');
 assert.equal(hash(canonical),manifest.originalReaderSha256);assert.equal(hash(readFileSync(join(shadow,reader))),manifest.shadowReaderSha256);
 const changed=readFileSync(join(shadow,reader),'utf8').replace("timeline512.cancellation(__timeline512,'deadline');",'');
 for(const original of ['const deadline=setTimeout','if(turn%3<2)','turn++;const delay=','if(process.env.STOCK_REALISTIC_REQUIRE_PASS'])assert(changed.includes(canonical.split('\n').find(line=>line.includes(original)).trim()),original);
 assert.deepEqual(schedule().map(row=>row.repeat),[0,1,2]);
 const recorder=readFileSync(join(here,'timeline-recorder.mjs'),'utf8');
 const originalCodes=canonical.match(/const PUBLIC_ERROR_CODES=new Set\((\[[^;]+\])\);/)[1];
 const recordedCodes=recorder.match(/const publicCodes=new Set\((\[[^;]+\])\);/)[1];
 assert.equal(recordedCodes,originalCodes.slice(0,-1)+",'UNRECORDED']");
});

test('source drift, extra files and absent anchors fail before a shadow is produced',()=>{
 assert.throws(()=>transform(readFileSync(join(source,reader),'utf8').replace('const start=performance.now();requests++;','const start=0;requests++;')),/TIMELINE_ANCHOR_COUNT relative attempt start/);
 const original=readFileSync(join(source,reader));writeFileSync(join(source,reader),Buffer.concat([original,Buffer.from('\n// changed\n')]));
 assert.throws(()=>install(source,join(work,'bad-source')),/TIMELINE_UNVERIFIED_SOURCE/);writeFileSync(join(source,reader),original);
 writeFileSync(join(source,'services/stocks/unexpected.mjs'),'');
 assert.throws(()=>install(source,join(work,'bad-fileset')),/TIMELINE_FILESET_MISMATCH/);
 assert.throws(()=>install(source,join(source,'nested')),/TIMELINE_SHADOW_MUST_BE_OUTSIDE_SOURCE/);
 assert.throws(()=>install(source,shadow),/TIMELINE_SHADOW_MUST_BE_EMPTY/);
});

test('real HTTP capture reconciles deadline, actual headers, safe503/422/429 codes, chart failure and success with original reader',async()=>{
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),user=Number(String(req.headers.authorization??'').split('-').at(-1));
  if(url.pathname.endsWith('/state')){
   if(user===2){res.writeHead(200,{'content-type':'application/json'});res.flushHeaders();return;}
   // Make one full original iteration deterministic. Near-end timer rounding must
   // not decide whether a second iteration starts in this focused 1s fixture.
   setTimeout(()=>{
    if(user===0){res.writeHead(503);res.end(JSON.stringify({error:'ACCOUNT_BUSY',secret:'PRIVATE_MARKER'}));return;}
    if(user===1){res.writeHead(422);res.end(JSON.stringify({error:'PRIVATE_MARKER'}));return;}
    if(user===4){res.end('PRIVATE_MARKER bad JSON');return;}
    res.end('{}');
   },1100);return;
  }
  if(user===0){res.writeHead(429);res.end(JSON.stringify({error:'RATE_LIMIT'}));return;}
  res.end(JSON.stringify({instrumentId:url.searchParams.get('id'),interval:url.searchParams.get('interval'),candles:[]}));
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const run=async path=>JSON.parse((await exec(process.execPath,[helper,join(path,reader),base],{env:env(true),timeout:15000,maxBuffer:1024*1024})).stdout);
  const original=await run(source),captured=await run(shadow);
  assert.deepEqual(summary(captured),summary(original));assert.equal(captured.requests,10);assert.equal(captured.errors,5);
  assert.equal(captured.failures.DEADLINE_3000MS,1);assert.equal(captured.httpErrorCodes['HTTP_503:ACCOUNT_BUSY'],1);assert.equal(captured.httpErrorCodes['HTTP_422:UNRECORDED'],1);assert.equal(captured.httpErrorCodes['HTTP_429:RATE_LIMIT'],1);
  const checked=reconcile(captured);assert.equal(checked.pass,true,JSON.stringify(checked));
  const deadline=captured.requestTimeline.rows.find(row=>row[6]==='DEADLINE_3000MS');assert.equal(deadline[4],200);assert.equal(deadline[8],1);assert.equal(deadline[9],0);assert(deadline[2]-deadline[1]>=2900);
  assert.equal(checked.bins.byStart[0].errors,5);assert.equal(checked.bins.byEnd[1].errors,1);
  assert(!JSON.stringify(captured.requestTimeline).includes('PRIVATE_MARKER'));assert(!JSON.stringify(captured.requestTimeline).includes('fixture-user'));
  const broken=structuredClone(captured);broken.requestTimeline.rows.pop();assert.equal(reconcile(broken).pass,false);
  const changed=structuredClone(captured);changed.requestTimeline.rows[0][2]=-1;assert.equal(reconcile(changed).pass,false);
  const lost=structuredClone(captured);lost.requestTimeline.dropped=1;assert.equal(reconcile(lost).pass,false);
  const counters=structuredClone(captured);counters.errors++;assert.equal(reconcile(counters).pass,false);
 }finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
});

test('recorder requires both gates, bounds rows and redacts arbitrary transport/public text',()=>{
 const file=join(work,'recorder-child.mjs');writeFileSync(file,`import * as t from ${JSON.stringify(pathToFileURL(join(here,'timeline-recorder.mjs')).href)};
for(let i=0;i<2050;i++){const row=t.begin('state',i);t.headers(row,503);t.responseComplete(row);t.publicError(row,'PRIVATE_MARKER');t.failure(row,{code:'PRIVATE_MARKER',message:'SECRET'});t.finish(row,1);}
console.log(JSON.stringify(t.snapshot()));\n`);
 const value=e=>JSON.parse(command(process.execPath,[file],{env:e}));
 const on=value(env(true));assert.equal(on.rows.length,2048);assert.equal(on.dropped,2);assert.equal(on.begun,2050);assert.equal(on.ended,2050);assert.equal(on.complete,false);assert.equal(on.rows[0][6],'UNRECORDED');assert.equal(on.rows[0][7],'UNRECORDED');assert(!JSON.stringify(on).includes('PRIVATE_MARKER'));
 for(const environment of [env(false),{...env(true),STOCKS_TIMELINE_512_FIXTURE:'incorrect'}]){const off=value(environment);assert.equal(off.enabled,false);assert.equal(off.rows.length,0);assert.equal(off.begun,0);}
});

test('successful history pagination reconciles independently of timing-dependent attempt count',async()=>{
 const server=createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');setTimeout(()=>res.end(JSON.stringify(url.pathname.endsWith('/state')?{}:{instrumentId:url.searchParams.get('id'),interval:url.searchParams.get('interval'),candles:[]})),200);});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 try{
  const result=JSON.parse((await exec(process.execPath,[helper,join(shadow,reader),'http://127.0.0.1:'+server.address().port,'100'],{env:env(true),timeout:10000,maxBuffer:1024*1024})).stdout);
  assert(result.byOperation['history-page'].ok>=5);assert.equal(result.errors,0);assert.equal(reconcile(result).pass,true);assert(result.requestTimeline.rows.some(row=>row[3]===3));
 }finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
});

test('response bound records cancellation without exporting response bytes',async()=>{
 const server=createServer((req,res)=>res.end(Buffer.alloc(2*1024*1024+1,'a')));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 try{
  const file=join(work,'bound-child.mjs');writeFileSync(file,`import {performance} from 'node:perf_hooks';import {request} from ${JSON.stringify(pathToFileURL(join(shadow,reader)).href)};import * as t from ${JSON.stringify(pathToFileURL(join(shadow,'services/stocks/phase-trace-512/timeline-recorder.mjs')).href)};
const start=performance.now(),row=t.begin('state',0);try{await request(new URL(process.argv[2]),{__timeline512:row});}catch(error){t.failure(row,error);}finally{t.finish(row,performance.now()-start);}console.log(JSON.stringify(t.snapshot()));\n`);
  const result=JSON.parse((await exec(process.execPath,[file,'http://127.0.0.1:'+server.address().port],{env:env(true),timeout:10000})).stdout);
  assert.equal(result.complete,true);assert.equal(result.rows[0][8],2);assert.equal(result.rows[0][5],2);assert.equal(result.rows[0][6],'Error');assert.equal(result.rows[0][9],0);assert.equal(result.rows.length,1);
 }finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
});
