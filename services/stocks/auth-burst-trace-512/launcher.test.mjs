// No HTTP, servers, Docker, disk creation, or preparation: injected pure hooks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, validateLauncherConfig } from './launcher.mjs';
import { TRACE_PLAN_ID, tracePlanHash } from './trace-plan.mjs';

const h='a'.repeat(64),s='b'.repeat(40),dir=path.resolve('fixture-repository'),outside=path.resolve('fixture-evidence');
function config(){return{schema:'stocks-one-burst-launcher-512-v1',mode:'run',repository:dir,gate:{input:{},policy:{}},
  freeze:{schema:1,planId:TRACE_PLAN_ID,planSha256:tracePlanHash(),sourceSha:s,contextSha256:h,imageId:'sha256:'+h,
    nodeSha256:h,bcryptSha256:h,seedSha256:h,reviewedPacketSha256:h,device:'8:0'},
  adapter:{sourceRoot:path.join(outside,'source'),preparationPath:path.join(outside,'preparation.json'),preparationSha256:h,
    seedPath:path.join(outside,'seed.sqlite'),overlay:{},disk:path.join(outside,'disk'),device:path.join(outside,'device'),
    outputDirectory:path.join(outside,'adapter'),driverFiles:[]},attemptMarker:path.join(outside,'attempt.json'),
  resultPath:path.join(outside,'report.json'),imageOwnership:'external-preloaded'};}
function mocks(){const writes=new Map(),calls=[];const hooks={git:()=>{throw Error('UNEXPECTED_GIT');},
  validateRun:()=>({eligible:true,sourceSha:s,policySha256:h,runId:'12345'}),
  save:(file,value)=>{assert.ok(!writes.has(file),'EXISTING_ATTEMPT');writes.set(file,value);},
  createAdapter:()=>({close:async()=>({removed:true,errors:[]})}),
  runTrace:async()=>{calls.push('run');return{status:'FAIL',ordinary:[],errors:[],cleanup:{removed:true,errors:[]}};},
  readEvidence:()=>({events:[{requestId:'trace_01',type:'authority-start'},{requestId:'warmup_01'}]}),
  analyzeTrace:input=>{calls.push(input);return{captureStatus:'COMPLETE',ordinaryStatus:'FAIL'};}};return{hooks,writes,calls};}
test('explicit configuration excludes unknown modes, paths, ownership and extra fields',()=>{
  assert.equal(validateLauncherConfig(config()).mode,'run');
  for(const patch of [{mode:'deploy'},{imageOwnership:'delete-any-image'},{attemptMarker:path.join(dir,'attempt')},{extra:true}])
    assert.throws(()=>validateLauncherConfig({...config(),...patch}));
});
test('disabled gate causes no attempt marker, adapter or workload',async()=>{
  const {hooks,writes,calls}=mocks();hooks.validateRun=()=>({eligible:false});
  await assert.rejects(launch(config(),hooks),/TRACE_LAUNCH_NOT_ELIGIBLE/);assert.equal(writes.size,0);assert.equal(calls.length,0);
});
test('one atomic attempt persists across failure and rejects a second workload',async()=>{
  const {hooks,writes,calls}=mocks(),c=config();const report=await launch(c,hooks);
  assert.equal(report.status,'FAIL');assert.equal(report.analysis.ordinaryStatus,'FAIL');assert.equal(writes.size,2);
  assert.equal(calls[1].authorityEvents.length,1);assert.equal(calls[1].authorityEvents[0].requestId,'trace_01');
  await assert.rejects(launch(c,hooks),/EXISTING_ATTEMPT/);assert.equal(calls.filter(x=>x==='run').length,1);
});
test('missing raw evidence or incomplete analysis cannot be reported as a complete trace',async()=>{
  const {hooks}=mocks();hooks.runTrace=async()=>({status:'PASS',ordinary:[],errors:[]});hooks.readEvidence=()=>{throw Error('MISSING');};
  const report=await launch(config(),hooks);assert.equal(report.status,'INCOMPLETE');assert.ok(report.errors.includes('TRACE_ADAPTER_EVIDENCE_UNAVAILABLE'));
});
test('lease time shrinks the same 600s budget and owned image releases only after container cleanup',async()=>{
  const c=config(),{hooks,calls}=mocks();let clock=0,budget;
  c.imageOwnership='verified-archive-lease';c.imageLease={archivePath:path.join(outside,'image.tar'),archiveSha256:h,archiveBytes:10,dockerConfigDirectory:path.join(outside,'docker')};
  hooks.now=()=>clock;hooks.imageExecute=()=>{throw Error('UNEXPECTED_IMAGE_COMMAND');};
  hooks.validateRun=()=>({eligible:true,sourceSha:s,policySha256:h,runId:'12345',localFileBindings:{inputs:[{path:'runtime-image.tar',bytes:10,sha256:h}]}});
  hooks.acquireImageLease=async()=>{clock=120000;return{owned:true,evidence:{owned:true},release:async({containersClosed})=>{
    assert.equal(containersClosed,true);calls.push('release');return{status:'REMOVED',errors:[]};}};};
  hooks.runTrace=async({budgetMs})=>{budget=budgetMs;clock+=100000;return{status:'PASS',ordinary:[],errors:[],cleanup:{removed:true,errors:[]}};};
  const report=await launch(c,hooks);assert.equal(budget,450000);assert.equal(report.launcherElapsedMs,220000);assert.equal(calls.includes('release'),true);
});
test('image is retained when container ownership cleanup is unconfirmed',async()=>{
  const c=config(),{hooks}=mocks();let released=false;
  c.imageOwnership='verified-archive-lease';c.imageLease={archivePath:path.join(outside,'image.tar'),archiveSha256:h,archiveBytes:10,dockerConfigDirectory:path.join(outside,'docker')};
  hooks.imageExecute=()=>{};hooks.validateRun=()=>({eligible:true,sourceSha:s,policySha256:h,runId:'12345',localFileBindings:{inputs:[{path:'runtime-image.tar',bytes:10,sha256:h}]}});
  hooks.acquireImageLease=async()=>({owned:true,evidence:{},release:async()=>{released=true;}});
  hooks.runTrace=async()=>({status:'INCOMPLETE',ordinary:[],errors:[],cleanup:{removed:false,errors:['UNKNOWN']}});
  const report=await launch(c,hooks);assert.equal(released,false);assert.equal(report.status,'INCOMPLETE');assert.ok(report.errors.includes('TRACE_IMAGE_RETAINED_FOR_UNCLOSED_CONTAINERS'));
});
