'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {build,sha}=require('./qa-stocks-package-builder.cjs');
const {fixtureProcess}=require('./qa-stocks-local-stage-recovery.cjs');
const {ISSUER,ID}=require('./qa-stocks-local-stage-fixture.cjs');
const root=path.resolve(__dirname,'..'),PREFIX='/__stocks_global/';
function verifyAndCopy(source,destination,manifestName,files){
  assert.ok(!fs.existsSync(destination));fs.mkdirSync(destination,{mode:0o700});
  for(const file of files){const input=path.resolve(source,file.path),output=path.resolve(destination,file.path);assert.ok(input.startsWith(source+path.sep)&&output.startsWith(destination+path.sep));assert.ok(fs.lstatSync(input).isFile());assert.equal(sha(fs.readFileSync(input)),file.sha256);fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(input,output,fs.constants.COPYFILE_EXCL);}
  fs.copyFileSync(path.join(source,manifestName),path.join(destination,manifestName),fs.constants.COPYFILE_EXCL);
}
function childProcess(runtime,report){
  const env={STOCKS_PACKAGE_FIXTURE:'true',HOME:runtime,TEMP:runtime,TMP:runtime,USERPROFILE:runtime};if(process.platform==='win32')env.SystemRoot=process.env.SystemRoot||'C:\\Windows';
  const child=spawn(process.execPath,['--no-global-search-paths',path.join(runtime,'fixture-driver.mjs')],{cwd:runtime,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  let serial=0,size=0;const pending=new Map(),logs=[];
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{size+=chunk.length;if(size>262144){child.kill();return;}logs.push(chunk.toString());});
  child.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Object.assign(Error(m.error.message),{stack:m.error.stack})):p.resolve(m.result);});
  const exited=new Promise(resolve=>child.once('close',(code,signal)=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('PACKAGE_CHILD_EXIT'));}pending.clear();report.child={code,signal,outputBytes:size};resolve({code,signal});}));
  child.on('error',e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();});
  const command=(command,input={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);child.kill();reject(Error('PACKAGE_COMMAND_TIMEOUT'));},10000);if(!child.connected){clearTimeout(timer);return reject(Error('PACKAGE_IPC_CLOSED'));}pending.set(id,{resolve,reject,timer});child.send({id,command,input});});
  const wait=async(ms=5000)=>{let timer;try{return await Promise.race([exited,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('PACKAGE_EXIT_TIMEOUT')),ms))]);}finally{clearTimeout(timer);}};
  const terminate=async()=>{if(child.exitCode!==null||child.signalCode!==null)return wait(2000);child.kill('SIGTERM');try{return await wait(2000);}catch{child.kill('SIGKILL');return wait(2000);}};
  return {child,logs,command,wait,terminate};
}
function request(origin,route,token,body,csrf){return new Promise((resolve,reject)=>{
  const base=new URL(origin);assert.equal(base.hostname,'127.0.0.1');let req;const timer=setTimeout(()=>req.destroy(Error('PACKAGE_HTTP_DEADLINE')),3000);
  req=http.request({host:'127.0.0.1',port:+base.port,path:PREFIX+route,method:body===undefined?'GET':'POST',agent:false,headers:{host:base.host,origin:base.origin,authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'}),...(csrf?{'x-stocks-token':csrf}:{})}},res=>{
    let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>2*1024*1024)req.destroy(Error('PACKAGE_RESPONSE_BUDGET'));else chunks.push(b);});res.on('error',reject);res.on('end',()=>{clearTimeout(timer);try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(e){reject(e);}});
  });req.once('error',e=>{clearTimeout(timer);reject(e);});req.end(body===undefined?undefined:JSON.stringify(body));
});}
function closedDatabase(file){const db=new DatabaseSync(file,{readOnly:true});try{assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(x=>Object.values(x)[0]),['ok']);const accounts=db.prepare('SELECT id,ledger FROM paper_accounts ORDER BY id').all().map(row=>{const {revision,...ledger}=JSON.parse(row.ledger);return {id:row.id,revision,semanticSha256:sha(JSON.stringify(ledger)),fills:ledger.fills.length};});return {sha256:sha(fs.readFileSync(file)),tables:db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name),bytes:fs.statSync(file).size,accounts};}finally{db.close();}}
async function main(output,authorityPackage){
  assert.ok(path.isAbsolute(output)&&path.isAbsolute(authorityPackage));assert.ok(!fs.existsSync(output));fs.mkdirSync(path.dirname(output),{recursive:true});fs.mkdirSync(output,{mode:0o700});
  const report={fixtureOnly:true,productionAccess:false,capacityClaim:false,status:'INCOMPLETE',assertions:0,startedAt:new Date().toISOString(),calls:[],checks:[]},check=(ok,label)=>{report.checks.push({label,passed:!!ok});assert.ok(ok,label);report.assertions++;};
  const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});let authority,packaged,temp;
  try{
    const manifest=build(root,path.join(output,'runtime-package'));write('dependency-proof.json',manifest);check(manifest.npmDependencies.length===0,'AST closure has no npm dependencies');
    check(manifest.edges.some(e=>e.kind==='worker-url'&&e.to==='services/stocks-global/account-worker-runtime.mjs'),'SQLite worker URL belongs to package');
    const authorityManifest=JSON.parse(fs.readFileSync(path.join(authorityPackage,'manifest.json'),'utf8'));
    check(authorityManifest.fixtureOnly===true,'reused actual compiled /me fixture package');
    // Verify source/dist/module bytes still match the current reviewed checkout; never rebuild or mutate the retained r3 artifact.
    for(const f of authorityManifest.files)check(sha(fs.readFileSync(path.join(root,f.path)))===f.sha256,'reused authority source unchanged: '+f.path);
    report.authority={sourcePackage:authorityPackage,manifestSha256:sha(fs.readFileSync(path.join(authorityPackage,'manifest.json'))),scope:'Separate real compiled /me QA authority; its dependencies use the existing workspace NODE_PATH, never inherited by Stocks runtime'};
    temp=fs.mkdtempSync(path.join(os.tmpdir(),'voltex-stocks-package-'));report.externalDirectory=temp;
    check(!path.resolve(temp).startsWith(root+path.sep),'execution directory outside checkout');
    const runtime=path.join(temp,'runtime'),authorityRoot=path.join(temp,'authority-package');
    verifyAndCopy(path.join(output,'runtime-package'),runtime,'runtime-manifest.json',manifest.files);
    verifyAndCopy(authorityPackage,authorityRoot,'manifest.json',authorityManifest.files);
    fs.copyFileSync(path.join(__dirname,'qa-stocks-package-child.mjs'),path.join(runtime,'fixture-driver.mjs'),fs.constants.COPYFILE_EXCL);
    report.driver={source:'scripts/qa-stocks-package-child.mjs',sha256:sha(fs.readFileSync(path.join(runtime,'fixture-driver.mjs'))),scope:'QA driver separate from the runtime artifact'};
    report.authorityProcess={};authority=fixtureProcess(authorityRoot,path.join(temp,'authority-data'),report.authorityProcess);const identity=await authority.ready();
    report.runtimeProcess={};packaged=childProcess(runtime,report.runtimeProcess);const ready=await packaged.command('init',{authority:identity.authorityOrigin,issuer:ISSUER});report.runtimeProof=ready;
    check(ready.NODE_PATH==='ABSENT'&&ready.externalDependencies==='UNRESOLVABLE','no workspace dependency resolution');check(ready.cwd===runtime,'runtime actually executes external copy');
    const call=async(user,route,body,csrf)=>{const r=await request(ready.gatewayOrigin,route,identity.tokens[user],body,csrf);report.calls.push({user,route:route.split('?')[0],status:r.status,error:r.body.error||null});return r;};
    let alice=await call('alice','state'),bob=await call('bob','state');
    check(alice.status===200&&alice.body.account.canTrade,'owner authenticated by external real /me fixture');check(bob.status===200&&!bob.body.account.canTrade,'viewer identity and role preserved');
    const catalogue=await call('alice','catalogue'),instrument=catalogue.body.catalogue?.[0];report.catalogue=instrument;
    check(catalogue.status===200&&catalogue.body.catalogue?.length===1&&instrument?.id===ID&&instrument.sourceSymbol==='AAPLXUSDT'&&instrument.asset==='AAPLX'&&instrument.provider==='bybit'&&instrument.currency==='USDT'&&instrument.name==='Apple Inc.'&&instrument.kind==='token'&&instrument.online===true&&instrument.exists===true,'actual fixture catalogue identity/currency/provider/name matches quoted instrument');
    const order={id:'standalone-fixture-buy',instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'};
    check((await call('alice','refresh',{id:ID},alice.body.token)).status===200,'fixture observation selected');
    check((await call('bob','orders',order,bob.body.token)).status===401,'viewer cannot mutate');
    const bought=await call('alice','orders',order,alice.body.token);check(bought.status===200&&bought.body.wallets.USDT.cash==='9990.00000000'&&bought.body.positions[ID+'|USDT'].quantity==='0.10000000','owner fixture order exact');
    const wallet=await call('alice','portfolio');check(wallet.status===200&&wallet.body.positions[ID+'|USDT'].quantity==='0.10000000','Wallet projection from packaged runtime');
    check((await call('bob','state')).body.fills.length===0,'isolated viewer ledger');
    const lostOrder={...order,id:'standalone-fixture-lost-ack'};await packaged.command('dropAck');let lost=false;
    try{await call('alice','orders',lostOrder,alice.body.token);}catch(e){check(e.code==='ECONNRESET','lost ACK is a real transport reset');lost=true;report.calls.push({user:'alice',route:'orders',status:null,error:e.code});}
    check(lost&&(await packaged.command('audit')).droppedAcknowledgements===1,'lost ACK occurred only after committed upstream 200');
    await packaged.command('restart');alice=await call('alice','state');check(alice.body.fills.length===2&&alice.body.wallets.USDT.cash==='9980.00000000','worker shutdown and restart persist exact owner ledger');
    const retry=await call('alice','orders',lostOrder,alice.body.token);check(retry.status===200&&retry.body.fills.length===2,'same lost-ACK ID after restart not executed twice');
    const before=await packaged.command('audit'),authorityBefore=await authority.command('audit');await packaged.command('enabled',{value:false});
    for(const [route,body]of[['state'],['portfolio'],['orders',order]])check((await call('alice',route,body,alice.body.token)).status===503,'cached client disabled: '+route);
    const after=await packaged.command('audit'),authorityAfter=await authority.command('audit');check(after.forwarded===before.forwarded&&after.quotes===before.quotes&&authorityAfter.identityRequests===authorityBefore.identityRequests,'feature-off does not reach identity, quote or ledger');
    const quiesced=await packaged.command('quiesce');check(quiesced.closed&&quiesced.metrics.queue.pending===0&&quiesced.metrics.queue.active===0,'FULL worker drained before backup');
    const original=closedDatabase(quiesced.path),restored=path.join(runtime,'data','restored.sqlite');fs.copyFileSync(quiesced.path,restored,fs.constants.COPYFILE_EXCL);check(closedDatabase(restored).sha256===original.sha256,'consistent byte-exact copy to different path');
    await packaged.command('restore',{path:restored});alice=await call('alice','state');bob=await call('bob','state');check(alice.body.fills.length===2&&alice.body.wallets.USDT.cash==='9980.00000000'&&bob.body.fills.length===0,'restored separate ledgers exact');
    const replay=await call('alice','orders',lostOrder,alice.body.token);check(replay.status===200&&replay.body.fills.length===2,'restore retains request idempotency');
    await packaged.command('networkProbe');check((await packaged.command('audit')).networkDenied===1,'unadmitted external request denied before transport');
    await packaged.command('quiesce');check(closedDatabase(quiesced.path).sha256===original.sha256,'original retained database unchanged');
    fs.mkdirSync(path.join(output,'closed-fixture-ledgers'),{mode:0o700});for(const file of ['primary.sqlite','restored.sqlite'])fs.copyFileSync(path.join(runtime,'data',file),path.join(output,'closed-fixture-ledgers',file),fs.constants.COPYFILE_EXCL);
    const restoredProof=closedDatabase(restored);
    check(JSON.stringify(original.accounts.map(({revision,...rest})=>rest))===JSON.stringify(restoredProof.accounts.map(({revision,...rest})=>rest)),'restore/replay preserves every ledger field other than revision');
    const revisions=original.accounts.map((row,i)=>({id:row.id,before:row.revision,after:restoredProof.accounts[i].revision,delta:restoredProof.accounts[i].revision-row.revision,expectedDelta:row.fills===2?1:0}));
    check(revisions.every(row=>row.delta===row.expectedDelta)&&revisions.filter(row=>row.delta===1).length===1,'same-ID replay increments owner revision once without financial change; viewer revision unchanged');
    report.storage={original,restored:restoredProof,reconciliation:{status:'PASS',fields:'entire ledger except revision',revisions,postReplayBytesIdentical:original.sha256===restoredProof.sha256},mode:'same-binary FULL quiesced restore; post-replay revision changes bytes; not historical-binary rollback'};report.status='PASS';
  }catch(e){report.status='FAIL';report.failure={message:e.message,stack:e.stack};}
  finally{
    for(const [name,child]of [['runtime',packaged],['authority',authority]])if(child){try{await child.command('stop');const exit=await(child.wait?child.wait():child.waitForExit());if(exit.code!==0)throw Error('CHILD_EXIT_NONZERO');}catch(e){report.status='FAIL';report[name+'CleanupError']=e.message;await child.terminate().catch(x=>report[name+'TerminationError']=x.message);}fs.writeFileSync(path.join(output,name+'.log'),child.logs.join(''),{flag:'wx',mode:0o600});}
    report.completedAt=new Date().toISOString();report.retainedExternalDirectory=temp||null;report.limitations=['External compiled /me QA authority is not part of standalone Stocks runtime','Local Node/platform binary pinned by hash; no verified container digest or deployment image','QA fixture driver injects private fixture quotes; no live provider capability/rights claim','No production DB, public ingress, real trades or capacity test; external temp data retained for inspection'];write('report.json',report);
    write('sources.json',['qa-stocks-package-builder.cjs','qa-stocks-package-proof.cjs','qa-stocks-package-child.mjs'].map(f=>({path:'scripts/'+f,sha256:sha(fs.readFileSync(path.join(__dirname,f)))})));
  }
  console.log(JSON.stringify({status:report.status,assertions:report.assertions,output,failure:report.failure||null}));if(report.status!=='PASS')process.exitCode=1;
}
if(require.main===module){assert.equal(process.argv.length,6);assert.equal(process.argv[2],'--output');assert.equal(process.argv[4],'--authority-package');main(path.resolve(process.argv[3]),path.resolve(process.argv[5])).catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={main};
