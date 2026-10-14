// Pure byte/inspection guards only. No server, HTTP, Docker, SQLite or child process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTraceContainer, verifyOverlay, verifyPreparedInputs, traceCommand, trackContainerCreation, reconcileOwnedContainer, readGateGit } from './adapter.mjs';
import { buildOverlay } from './build-overlay.mjs';
import { OVERLAYS, HELPERS, digest } from './closure.mjs';
import { TRACE_PLAN_ID, tracePlanHash } from './trace-plan.mjs';
import observer from '../auth-http-fixture-512/durability-observer.cjs';
import { MEMBER_PATHS, COMPILED_PATHS } from './prepare-receipts.mjs';

const hash = 'a'.repeat(64), sourceSha = 'b'.repeat(40);
const freeze = () => ({ schema:1, planId:TRACE_PLAN_ID, planSha256:tracePlanHash(), sourceSha,
  contextSha256:hash, imageId:'sha256:'+hash,nodeSha256:hash,bcryptSha256:hash,seedSha256:hash,reviewedPacketSha256:hash,device:'8:0' });

test('gate Git reader preserves exact approved blob bytes including trailing LF', () => {
  for (const bytes of [Buffer.from('{"approved":true}\n'), Buffer.from('\n{"approved":true}\r\n'), Buffer.from([0xff, 0, 10])]) {
    const args = ['cat-file', 'blob', sourceSha + ':services/stocks/auth-burst-trace-512/launch-policy.json'];
    const result = readGateGit(args, { repository: '/reviewed', env: { LANG: 'C' }, timeoutMs: 1000, now: () => 0,
      execute(binary, actual, options) {
        assert.equal(binary, '/usr/bin/git'); assert.deepEqual(actual, args); assert.equal(options.cwd, '/reviewed');
        assert.equal(options.timeout, 1000); assert.equal(options.maxBuffer, 8 * 1024 ** 2);
        return options.encoding === 'utf8' ? bytes.toString('utf8') : Buffer.from(bytes);
      } });
    assert.ok(Buffer.isBuffer(result), 'Gate receives bytes, not normalized text');
    assert.deepEqual(result, bytes); assert.equal(digest(result), digest(bytes));
  }
});

test('gate Git reader retains the absolute command deadline and rejects non-byte stdout', () => {
  let clock = 0;
  assert.throws(() => readGateGit(['rev-parse', 'HEAD'], { repository: '/reviewed', env: {}, timeoutMs: 10,
    now: () => clock, execute: () => { clock = 10; return Buffer.from(sourceSha + '\n'); } }), /TRACE_ADAPTER_DEADLINE/);
  assert.throws(() => readGateGit(['cat-file', 'blob', 'fixture'], { repository: '/reviewed', env: {}, timeoutMs: 10,
    now: () => 0, execute: () => 'normalized output' }), /TRACE_GIT_STDOUT_BYTES_REQUIRED/);
});
function inspectFixture(role = 'service') {
  const id='c'.repeat(64), serviceId='d'.repeat(64), runId='auth-http512-pure',uid=1001,command=traceCommand(role);
  const binds=role==='service'?[{source:'/owned/data',target:'/data',ro:false},{source:'/owned/observation',target:observer.DIRECTORY,ro:false},
    ...[...OVERLAYS,...HELPERS].map(p=>({source:'/owned/'+p,target:'/source/'+p,ro:true})),{source:'/owned/manifest.json',target:'/trace/derived-manifest.json',ro:true}]:[];
  const context={runId,image:'sha256:'+hash,role,serviceId,uid,binds};
  const info={Id:id,Image:context.image,Config:{User:'1001:1001',Hostname:id.slice(0,12),Labels:{'voltex.auth-http.run':runId,'voltex.auth-http.role':role},
    Entrypoint:[command.entrypoint],Cmd:command.args,Env:['AUTH_HTTP_FIXTURE_512=true','NODE_VERSION=24.21.0','PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']},
    HostConfig:{ReadonlyRootfs:true,CapDrop:['ALL'],CapAdd:[],SecurityOpt:['no-new-privileges'],Privileged:false,PidMode:'',IpcMode:'private',
      NetworkMode:role==='service'?'none':'container:'+serviceId,PortBindings:{},PublishAllPorts:false,Memory:268435456,MemorySwap:268435456,
      NanoCpus:role==='service'?50000000:500000000,CpusetCpus:role==='service'?'0':'1',Devices:[],PidsLimit:64},
    Mounts:binds.map(row=>({Type:'bind',Source:row.source,Destination:row.target,RW:!row.ro}))};
  return {info,context};
}
test('exact derived mounts preserve original service resources and private namespace',()=>{
  for(const role of ['service','authority','driver']){const f=inspectFixture(role);assert.equal(validateTraceContainer(f.info,f.context),true);}
});
test('inspection rejects writable overlay, egress, port publishing, CPU drift, secret env and extra mount',()=>{
  const changes=[f=>{f.info.Mounts.find(x=>x.Destination.startsWith('/source/')).RW=true;},
    f=>{f.info.HostConfig.NetworkMode='bridge';},f=>{f.info.HostConfig.PortBindings={'3000/tcp':[{HostPort:'3000'}]};},
    f=>{f.info.HostConfig.NanoCpus=100000000;},f=>{f.info.Config.Env.push('DATABASE_URL=forbidden-test-value');},
    f=>{f.info.Mounts.push({Type:'bind',Source:'/unowned',Destination:'/extra',RW:false});}];
  for(const change of changes){const f=inspectFixture();change(f);assert.throws(()=>validateTraceContainer(f.info,f.context));}
});
function prepared(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stocks-trace-adapter-pure-'));
  const real=fs.realpathSync(root);t.after(()=>{assert.equal(fs.realpathSync(root),real);assert.ok(path.basename(real).startsWith('stocks-trace-adapter-pure-'));fs.rmSync(real,{recursive:true});});
  const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),sourceRoot=path.join(root,'source');
  const files=OVERLAYS.map(name=>{const bytes=Buffer.from(fs.readFileSync(path.join(checkout,name),'utf8').replace(/\r\n/g,'\n'));
    const target=path.join(sourceRoot,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);return{path:name,bytes:bytes.length,sha256:digest(bytes)};});
  const contextSha256=digest(JSON.stringify(files));
  const manifest={schema:'stocks-auth-http-prepare-512-v1',sourceSha,contextSha256,files};
  fs.writeFileSync(path.join(sourceRoot,'runtime-source-manifest.json'),JSON.stringify(manifest));
  const overlay=buildOverlay({sourceRoot,outputDirectory:path.join(root,'overlay'),sourceSha,contextSha256});
  return {options:{sourceRoot,overlay},freeze:{...freeze(),contextSha256},manifest};
}
test('adapter independently recomputes all six overlays and helper hashes',t=>{
  const f=prepared(t),result=verifyOverlay(f.options,f.freeze,f.manifest);
  assert.equal(result.mounts.length,9);assert.ok(result.mounts.every(row=>row.ro));
  const row=f.options.overlay.mounts[0];fs.appendFileSync(row.source,'\n');
  assert.throws(()=>verifyOverlay(f.options,f.freeze,f.manifest));
});
test('caller cannot replace guarded overlay hash or add writable bind even with recomputed manifest digest',t=>{
  const f=prepared(t);f.options.overlay.manifest.overlays[0].hunksSha256='f'.repeat(64);
  const bytes=Buffer.from(JSON.stringify(f.options.overlay.manifest));fs.writeFileSync(f.options.overlay.manifestPath,bytes);
  f.options.overlay.manifestSha256=digest(bytes);
  assert.throws(()=>verifyOverlay(f.options,f.freeze,f.manifest));
});
test('preparation alone cannot pass workload authorization before any filesystem access',()=>{
  assert.throws(()=>verifyPreparedInputs({},freeze(),{eligible:false}),/TRACE_LAUNCH_NOT_ELIGIBLE/);
  assert.throws(()=>verifyPreparedInputs({},freeze(),{eligible:true,sourceSha:'f'.repeat(40)}));
});
test('unknown create outcomes remain owned and reconcile only exact name and labels',()=>{
  for(const outcome of ['timeout','malformed']){
    const items=new Map(),runId='auth-http512-pure',name=runId+'-service';let daemonCreated=false;
    assert.throws(()=>trackContainerCreation(items,{role:'service',name},()=>{daemonCreated=true;if(outcome==='timeout')throw Error('ETIMEDOUT');return 'malformed';}));
    assert.equal(daemonCreated,true);assert.equal(items.size,1);const item=items.get('service');assert.equal(item.name,name);assert.equal(item.id,null);
    const info={Id:'f'.repeat(64),Name:'/'+name,Config:{Labels:{'voltex.auth-http.run':runId,'voltex.auth-http.role':'service'}}};
    const resolved=reconcileOwnedContainer(item,runId,target=>{assert.equal(target,name);return info;});assert.equal(resolved.absent,false);assert.equal(item.id,info.Id);
    assert.throws(()=>reconcileOwnedContainer(item,'another-run',()=>info));
  }
});
test('cleanup never interprets permission/transport/ambiguous lookup failures as missing container',()=>{
  const runId='auth-http512-pure',item={id:null,name:runId+'-driver',role:'driver'};
  for(const error of [Error('socket timeout'),{status:1,stderr:'permission denied'},{status:1,stderr:'Error: No such object: another-name'}])
    assert.throws(()=>reconcileOwnedContainer(item,runId,()=>{throw error;}),/TRACE_CONTAINER_OUTCOME_UNRESOLVED/);
  assert.deepEqual(reconcileOwnedContainer(item,runId,()=>{throw {status:1,stderr:'Error: No such object: '+item.name};}),{absent:true});
});
test('prepared byte checks accept internal npm links and reject changed source or compiler bindings',t=>{
  // Deliberately synthetic proof bytes; this validates the adapter contract, not a compiler or native runtime.
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stocks-prepared-adapter-pure-')),real=fs.realpathSync(temp);
  t.after(()=>{assert.equal(fs.realpathSync(temp),real);assert.ok(path.basename(real).startsWith('stocks-prepared-adapter-pure-'));fs.rmSync(real,{recursive:true});});
  const sourceRoot=path.join(temp,'source'),files=[];
  const put=(name,bytes)=>{const data=Buffer.from(bytes),file=path.join(sourceRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);
    files.push({path:name,bytes:data.length,sha256:digest(data)});return digest(data);};
  const sourceHash=put('src/fixture.ts','fixture'),lockHash=put('package-lock.json','{}'),configHash=put('tsconfig.json','{}'),logHash=put('build.log','fixture-only');
  for(const name of ['server','accounts','identity','local-proxy','account-worker-runtime'])put('services/stocks-global/'+name+'.mjs','// inert fixture');
  const here=path.dirname(fileURLToPath(import.meta.url));
  for(const name of ['run.mjs','durability-observer.cjs','plan.mjs','probe.mjs'])put('services/stocks/auth-http-fixture-512/'+name,fs.readFileSync(path.join(here,'../auth-http-fixture-512',name)));
  const compiled=Object.fromEntries(COMPILED_PATHS.map(name=>[name,put(name,'// inert emitted fixture')]));
  const sourcesBefore=[{path:'src/fixture.ts',sha256:sourceHash}],compilerFiles=[{file:'package.json',sha256:hash}];
  const proof={exitCode:0,signal:null,sourcesUnchanged:true,sourcesBefore,sourcesAfterHash:digest(JSON.stringify(sourcesBefore)),
    outputs:Object.entries(compiled).map(([path,sha256])=>({path,sha256})),packageLockSha256:lockHash,tsconfig:{sha256:configHash},logSha256:logHash,compilerFiles};
  const proofBytes=Buffer.from(JSON.stringify(proof)),proofSha256=put('compiled-proof.json',proofBytes),contextSha256=digest(JSON.stringify(files));
  const manifest={schema:'stocks-auth-http-prepare-512-v1',sourceSha,contextSha256,files},manifestBytes=Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(sourceRoot,'runtime-source-manifest.json'),manifestBytes);
  const dependencies=[{path:'bcrypt/prebuilds/linux-x64/bcrypt.glibc.node',bytes:1,sha256:hash},{path:'typescript/package.json',bytes:1,sha256:hash},
    {path:'.bin/tsc',symlink:'../typescript/bin/tsc'},{path:'typescript/bin/tsc',bytes:1,sha256:hash}];
  const seedBytes=Buffer.from('inert closed seed fixture'),seedSha256=digest(seedBytes),seedPath=path.join(temp,'seed.sqlite');fs.writeFileSync(seedPath,seedBytes);
  const derivedBytes=Buffer.from('{}'),manifestPath=path.join(temp,'derived-manifest.json');fs.writeFileSync(manifestPath,derivedBytes);
  const inside={status:'PREPARED_NOT_AUTHORIZED',contextSha256,runtime:{node:'v24.21.0',platform:'linux',arch:'x64',nodeSha256:hash},
    dependencies:{files:dependencies,inventorySha256:digest(JSON.stringify(dependencies)),nativeFiles:dependencies.filter(x=>/\.node$/.test(x.path)),bcryptSha256:hash},
    seed:{closed:true,integrity:'ok',journal:'delete',synchronous:2,sha256:seedSha256,bytes:seedBytes.length},
    compiler:{proofSha256,compiled},runtimeClosure:{files:[]}};
  const insideBytes=Buffer.from(JSON.stringify(inside)),insidePath=path.join(temp,'private/runtime-output/inside-proof.json');fs.mkdirSync(path.dirname(insidePath),{recursive:true});fs.writeFileSync(insidePath,insideBytes);
  const report={schema:manifest.schema,status:'PREPARED_NOT_AUTHORIZED',sourceSha,contextSha256,image:{id:'sha256:'+hash,baseImage:'fixture-base'},inside};
  const reportBytes=Buffer.from(JSON.stringify(report)),preparationPath=path.join(temp,'preparation.json');fs.writeFileSync(preparationPath,reportBytes);
  const closureHash=digest(JSON.stringify(Object.entries(compiled).map(([path,sha256])=>({path,sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)));
  const f={...freeze(),contextSha256,seedSha256};
  const options={sourceRoot,preparationPath,preparationSha256:digest(reportBytes),seedPath,overlay:{manifestPath,manifestSha256:digest(derivedBytes)},
    launch:{policy:{native:{nodeSha256:hash,bcryptSha256:hash,nodeVersion:'v24.21.0',baseImage:'fixture-base',
      dependencyInventorySha256:inside.dependencies.inventorySha256,nativeFilesSha256:digest(JSON.stringify(inside.dependencies.nativeFiles)),compiledClosureSha256:closureHash}},
      input:{artifacts:{compiled:{proofText:JSON.stringify({buildProvenanceSha256:proofSha256,closureSha256:closureHash})}}}}};
  const row=(path,bytes)=>({path,bytes:bytes.length,sha256:digest(bytes)});
  const eligibility={eligible:true,sourceSha,planSha256:f.planSha256,policySha256:f.reviewedPacketSha256,imageId:f.imageId,sourceContextSha256:contextSha256,
    seedSha256,derivedManifestSha256:options.overlay.manifestSha256,receiptKind:'LOCAL_SAME_JOB',localFileBindings:{
      preparation:[row(MEMBER_PATHS.preparationReport,reportBytes),row(MEMBER_PATHS.insideProof,insideBytes),row(MEMBER_PATHS.derivedManifest,derivedBytes),row(MEMBER_PATHS.runtimeManifest,manifestBytes)],
      inputs:[row(MEMBER_PATHS.seed,seedBytes)]}};
  assert.equal(verifyPreparedInputs(options,f,eligibility).compiledProofSha256,proofSha256);
  fs.appendFileSync(path.join(sourceRoot,'src/fixture.ts'),'changed');assert.throws(()=>verifyPreparedInputs(options,f,eligibility));
});
