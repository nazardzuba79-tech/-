import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,readdirSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { instrument,transform } from './instrument.mjs';
import { COLUMNS,EVENTS,RECORD_BYTES,HEADER_BYTES,BOUNDS } from './recorder.mjs';

const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../../..');
function temp(){return mkdtempSync(resolve(tmpdir(),'stocks-phase-test-'));}
function environment(extra={}){return {...process.env,STOCKS_PHASE_TRACE:'0',STOCKS_PHASE_TRACE_ROLE:'client',STOCKS_PHASE_TRACE_FIXTURE:'isolated-issue505',...extra};}
function child(code,env){return spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:environment(env),timeout:20000});}
test('exact-source shadow transform verifies all files and never changes the source',()=>{
 const dir=temp();try{
  const manifest=instrument(repo,resolve(dir,'shadow'));
  assert.equal(manifest.sourceRevision,'010eb8716755c48aeb62baaf8602fb7ff837859f');
  assert.equal(manifest.files.length,16);assert.equal(manifest.files.filter(f=>f.changed).length,5);
  const reader=manifest.files.find(f=>f.file==='services/stocks/realistic-readers.mjs');
  assert.equal(reader.anchors.length,5);
  const original=readFileSync(resolve(repo,reader.file),'utf8').replace(/\r\n/g,'\n');
  const result=readFileSync(resolve(dir,'shadow',reader.file),'utf8');
  assert.equal(result.slice(result.indexOf('export async function runReaders')),original.slice(original.indexOf('export async function runReaders')));
  for(const item of manifest.files){
   const originalNow=readFileSync(resolve(repo,item.file),'utf8').replace(/\r\n/g,'\n');
   assert.equal(createHash('sha256').update(originalNow).digest('hex'),item.sourceSha256);
   if(item.changed){const syntax=spawnSync(process.execPath,['--check',resolve(dir,'shadow',item.file)],{encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);}
  }
  assert.throws(()=>instrument(repo,repo),/OUTSIDE_SOURCE/);
  assert.throws(()=>instrument(repo,resolve(dir,'shadow')),/MUST_BE_EMPTY/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('transform fails closed on source anchor drift and source fingerprint drift',()=>{
 assert.throws(()=>transform('services/stocks-global/server.mjs','export const changed=true;'),/TRACE_ANCHOR_COUNT/);
 const dir=temp();try{
  const originals=JSON.parse(readFileSync(resolve(here,'sources.json'),'utf8'));
  for(const file of originals.files){mkdirSync(dirname(resolve(dir,'source',file)),{recursive:true});writeFileSync(resolve(dir,'source',file),readFileSync(resolve(repo,file)));}
  writeFileSync(resolve(dir,'source/services/stocks-global/engine.mjs'),'unverified');
  assert.throws(()=>instrument(resolve(dir,'source'),resolve(dir,'shadow')),/TRACE_UNVERIFIED_SOURCE_REVISION/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('OFF recorder creates no output and requires no fixture or destination',()=>{
 const result=child('const p=await import('+JSON.stringify(pathToFileURL(resolve(here,'recorder.mjs')).href)+');p.event(p.EVENTS.HTTP_ARRIVAL);p.flush();if(p.enabled)throw Error("enabled");',{STOCKS_PHASE_TRACE:'0',STOCKS_PHASE_TRACE_FIXTURE:'',STOCKS_PHASE_TRACE_DIR:''});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');
});
test('ON requires explicit fixture capability',()=>{
 const result=child('await import('+JSON.stringify(pathToFileURL(resolve(here,'recorder.mjs')).href)+')',{STOCKS_PHASE_TRACE:'1',STOCKS_PHASE_TRACE_FIXTURE:''});
 assert.notEqual(result.status,0);assert.match(result.stderr,/TRACE_FIXTURE_CAPABILITY_REQUIRED/);
});
test('binary recorder is byte bounded, numeric only, monotonic and explicit about dropped events',()=>{
 const dir=temp();try{
  const count=Math.floor((BOUNDS.client-HEADER_BYTES)/RECORD_BYTES);
  const result=child('const p=await import('+JSON.stringify(pathToFileURL(resolve(here,'recorder.mjs')).href)+');for(let i=0;i<'+(count+3)+';i++)p.emit(p.EVENTS.CLIENT_START,i+1,0,0,"SECRET_BODY_TOKEN",NaN);p.flush();',{STOCKS_PHASE_TRACE:'1',STOCKS_PHASE_TRACE_DIR:dir});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(readdirSync(dir).sort(),['client.bin','client.meta.json']);
  const bytes=readFileSync(resolve(dir,'client.bin')),meta=JSON.parse(readFileSync(resolve(dir,'client.meta.json'),'utf8'));
  assert.equal(meta.count,count);assert.equal(meta.dropped,3);assert.equal(meta.complete,false);
  assert.equal(bytes.length,count*RECORD_BYTES);assert.ok(bytes.length<=BOUNDS.client);
  assert.ok(readFileSync(resolve(dir,'client.meta.json')).length<65536);
  assert.equal(bytes.includes(Buffer.from('SECRET_BODY_TOKEN')),false);
  assert.deepEqual(meta.columns,COLUMNS);assert.equal(bytes.readDoubleLE(6*8),0);assert.equal(bytes.readDoubleLE(7*8),0);
  let previous=0;for(let i=0;i<count;i++){assert.equal(bytes.readDoubleLE(i*RECORD_BYTES),i+1);const time=bytes.readDoubleLE(i*RECORD_BYTES+8);assert.ok(time>=previous);previous=time;}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('client records numeric IDs, safe HTTP errors and deadline separately',()=>{
 const dir=temp();try{
  const result=child('const p=await import('+JSON.stringify(pathToFileURL(resolve(here,'recorder.mjs')).href)+');const id=p.clientStart(new URL("http://127.0.0.1/__stocks_global/state?id=SECRET"),3000);p.clientHeaders(id,422);p.clientEnd(id,null,{status:422,bytes:100},"ACCOUNT_BUSY");p.clientDeadline(id);p.flush();',{STOCKS_PHASE_TRACE:'1',STOCKS_PHASE_TRACE_DIR:dir});
  assert.equal(result.status,0,result.stderr);
  const bytes=readFileSync(resolve(dir,'client.bin')),rows=Array.from({length:bytes.length/RECORD_BYTES},(_,row)=>Array.from({length:COLUMNS.length},(_,col)=>bytes.readDoubleLE(row*RECORD_BYTES+col*8)));
  assert.deepEqual(rows.map(r=>r[2]),[EVENTS.CLIENT_START,EVENTS.CLIENT_HEADERS,EVENTS.CLIENT_END,EVENTS.CLIENT_DEADLINE]);
  assert.ok(rows.every(r=>r[3]===1));assert.equal(rows[2][6],1);assert.equal(rows[2][7],422);
  assert.equal(bytes.includes(Buffer.from('SECRET')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('worker close completion flag is visible before the existing closed message',()=>{
 const url=pathToFileURL(resolve(here,'recorder.mjs')).href;
 const workerCode='(async()=>{const {workerData}=await import("node:worker_threads");const p=await import('+JSON.stringify(url)+');p.post({postMessage(){if(Atomics.load(new Int32Array(workerData.__phaseTrace.worker),2)!==1)throw Error("CLOSE_FLAG_NOT_VISIBLE");}},{kind:"closed"});})().catch(error=>{console.error(error);process.exitCode=1;});';
 const result=child('const {Worker}=await import("node:worker_threads");const w=new Worker('+JSON.stringify(workerCode)+',{eval:true,workerData:{__phaseTrace:{worker:new SharedArrayBuffer('+BOUNDS.worker+')}}});w.on("error",()=>{process.exitCode=1;});w.on("exit",code=>{if(code)process.exitCode=code;});',{STOCKS_PHASE_TRACE:'1'});
 assert.equal(result.status,0,result.stderr);
});
