// Fixture-only synthetic public authority rehearsal; does not wire a public host.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const tls=require('node:tls');
const https=require('node:https');
const {certificates,createIngress,request,HOST,PREFIX,cleanEnv,MAX_BODY}=require('./qa-stocks-tls-ingress.cjs');
const {fixtureProcess}=require('./qa-stocks-local-stage-recovery.cjs');
const {ID}=require('./qa-stocks-local-stage-fixture.cjs');
const root=path.resolve(__dirname,'..'),sha=x=>createHash('sha256').update(x).digest('hex');
const CASES=['pinned TLS and actual compiled authority owner/viewer journey','wrong authority, untrusted TLS and duplicate header denial','route, method, body and caller-identity admission bounds','revocation and cached-client feature-off admission','frontend source fence retained; publication remains blocked'];
function raw(ingress,credentials,text){return new Promise(resolve=>{
  let data='',finished=false;const done=result=>{if(finished)return;finished=true;clearTimeout(timer);socket.destroy();resolve(result);};
  const socket=tls.connect({host:'127.0.0.1',port:ingress.port,servername:HOST,ca:credentials.ca,rejectUnauthorized:true},()=>socket.end(text));
  const timer=setTimeout(()=>done({error:'RAW_DEADLINE'}),4500);
  socket.on('data',b=>{data+=b.toString();if(data.length>8192)return done({error:'RAW_RESPONSE_TOO_LARGE'});});
  socket.on('end',()=>done({status:Number(/^HTTP\/1\.1 (\d+)/.exec(data)?.[1]),raw:data}));socket.on('error',e=>done({error:e.code||e.message}));
});}
function partialPost(ingress,credentials,body,headers,disable){return new Promise((resolve,reject)=>{
  const serialized=JSON.stringify(body),requestsBefore=ingress.audit.requests;let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const req=https.request({host:'127.0.0.1',port:ingress.port,servername:HOST,ca:credentials.ca,rejectUnauthorized:true,agent:false,
    method:'POST',path:PREFIX+'orders',headers:{host:ingress.authority,origin:ingress.origin,'content-type':'application/json','content-length':Buffer.byteLength(serialized),...headers}},res=>{
    let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>2*1024*1024)return req.destroy(Error('PARTIAL_RESPONSE_BUDGET'));chunks.push(b);});
    res.on('error',e=>finish(e));res.on('end',()=>{try{finish(null,{status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(e){finish(e);}});
  });
  const timer=setTimeout(()=>req.destroy(Error('PARTIAL_POST_DEADLINE')),4500);req.once('error',e=>finish(e));req.write(serialized.slice(0,1));
  (async()=>{const end=performance.now()+1500;while(ingress.audit.requests!==requestsBefore+1||ingress.audit.active!==1){if(performance.now()>=end)throw Error('PARTIAL_POST_HEADER_BARRIER');await new Promise(r=>setTimeout(r,5));}disable();req.end(serialized.slice(1));})().catch(e=>{req.destroy();finish(e);});
});}
async function main(output,python){
  assert.ok(path.isAbsolute(output)&&path.isAbsolute(python));assert.ok(!fs.existsSync(output),'Output must not exist');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.mkdirSync(output,{mode:0o700});
  const write=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  const report={fixtureOnly:true,productionAccess:false,capacityClaim:false,browserClaim:false,publicExposure:false,startedAt:new Date().toISOString(),runtime:{node:process.version,platform:process.platform},cases:CASES.map(name=>({name,status:'NOT_RUN'})),assertions:0,calls:[]};
  const check=(value,label)=>{assert.ok(value,label);report.assertions++;};
  const test=async(name,fn)=>{const row=report.cases.find(x=>x.name===name);row.status='RUNNING';try{await fn();row.status='PASS';}catch(e){row.status='FAIL';row.error=e.message;throw e;}};
  let fixture,ingress,ready,enabled=true,alice,bob;
  try{
    const stageOutput=path.join(output,'local-stage');
    const stage=spawnSync(process.execPath,[path.join(__dirname,'qa-stocks-local-stage-recovery.cjs'),'--output',stageOutput],{cwd:root,env:cleanEnv(),windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
    fs.writeFileSync(path.join(output,'stage-invocation.log'),(stage.stdout||'')+(stage.stderr||''),{flag:'wx',mode:0o600});
    check(stage.status===0,'fresh compiled /me staging prerequisite');
    const prior=JSON.parse(fs.readFileSync(path.join(stageOutput,'report.json'),'utf8'));
    check(prior.status==='PASS'&&prior.assertions===61,'full local staging prerequisite retained');
    report.prerequisite={reportSha256:sha(fs.readFileSync(path.join(stageOutput,'report.json'))),buildProvenanceSha256:sha(fs.readFileSync(path.join(stageOutput,'build-provenance.json'))),manifestSha256:sha(fs.readFileSync(path.join(stageOutput,'package/manifest.json'))),assertions:prior.assertions};
    const credentials=certificates(python);report.tls=credentials.proof;
    // A second independent, initially absent SQLite path, beside the verified package.
    fixture=fixtureProcess(path.join(stageOutput,'package'),path.join(stageOutput,'tls-data'),report);ready=await fixture.ready();
    ingress=await createIngress({credentials,upstreamOrigin:ready.gatewayOrigin,enabled:()=>enabled});report.syntheticOrigin=ingress.origin;
    const call=async(user,route,body,csrf,extra={})=>{
      const options={path:PREFIX+route,method:body===undefined?'GET':'POST',body,...extra,headers:{authorization:'Bearer '+ready.tokens[user],...(csrf?{'x-stocks-token':csrf}:{}),...extra.headers}};
      const r=await request(ingress,credentials,options);report.calls.push({route:route.split('?')[0],user,status:r.status??null,error:r.error||r.body?.error||null,ms:r.ms});return r;
    };
    const order=(id,more={})=>({id:'tls-'+id.padEnd(18,'0'),instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1',...more});
    await test(CASES[0],async()=>{
      alice=await call('alice','state');bob=await call('bob','state');
      check(alice.status===200&&alice.body.account.canTrade===true,'owner authenticated by actual compiled /me');
      check(bob.status===200&&bob.body.account.canTrade===false,'Bob remains viewer');
      check(alice.headers['cache-control']==='no-store','no public identity or wallet response caching');
      const observed=await call('alice','state?id='+encodeURIComponent(ID));check(observed.status===200,'owner selects fixture instrument');
      check((await call('alice','refresh',{id:ID},alice.body.token)).status===200,'owner refresh retains backend CSRF');
      check((await call('bob','orders',order('bob'),bob.body.token)).status===401,'viewer cannot trade through TLS ingress');
      check((await call('alice','orders',order('csrf'),'invalid')).status===422,'invalid CSRF cannot trade');
      const bought=await call('alice','orders',order('buy'),alice.body.token);
      check(bought.status===200&&bought.body.wallets.USDT.cash==='9990.00000000','isolated TLS buy exact debit');
      const sold=await call('alice','orders',order('sell',{side:'SELL'}),alice.body.token);
      check(sold.status===200&&sold.body.wallets.USDT.cash==='10000.00000000'&&sold.body.positions[ID+'|USDT'].quantity==='0.00000000','isolated TLS full close');
      const viewer=await call('bob','state');check(viewer.body.fills.length===0&&viewer.body.wallets.USDT.cash==='10000.00000000','separate Bob ledger');
    });
    await test(CASES[1],async()=>{
      const before=await fixture.command('audit');
      const sniBefore=ingress.audit.sniDenied,untrusted=await request(ingress,credentials,{untrusted:true}),wrongSni=await request(ingress,credentials,{servername:'wrong-review.invalid'});
      report.tlsDenials={untrusted,wrongSni,sniRejections:ingress.audit.sniDenied-sniBefore};
      check(/^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT)$/.test(untrusted.error||''),'untrusted fixture CA rejected for trust error');
      check(/^(ECONNRESET|EPROTO|ERR_SSL_)/.test(wrongSni.error||'')&&ingress.audit.sniDenied===sniBefore+1,'wrong SNI rejected by exact server callback');
      check((await request(ingress,credentials,{headers:{host:'wrong-review.invalid'}})).status===400,'wrong Host rejected');
      check((await request(ingress,credentials,{headers:{origin:'https://wrong-review.invalid'}})).status===403,'wrong Origin rejected');
      check((await request(ingress,credentials,{headers:{origin:undefined}})).status===403,'missing Origin rejected');
      const duplicate=await raw(ingress,credentials,`GET ${PREFIX}state HTTP/1.1\r\nHost: ${ingress.authority}\r\nHost: ${ingress.authority}\r\nOrigin: ${ingress.origin}\r\nConnection: close\r\n\r\n`);
      check(duplicate.status===400,'duplicate authority rejected');
      const after=await fixture.command('audit');check(after.forwarded===before.forwarded&&after.identityRequests===before.identityRequests,'invalid TLS or authority never reaches backend');
    });
    await test(CASES[2],async()=>{
      const before=await fixture.command('audit');
      check((await call('alice','../api/v1/orders')).status===404,'outside route rejected');
      check((await call('alice','state',{},alice.body.token)).status===405,'wrong method rejected');
      check((await call('alice','orders',{padding:'x'.repeat(MAX_BODY+1)},alice.body.token)).status===413,'bounded body rejected');
      check((await call('alice','state',undefined,undefined,{headers:{'x-forwarded-user':'alice'}})).status===400,'caller-selected identity header rejected');
      check((await call('alice','state',undefined,undefined,{headers:{'sec-fetch-site':'cross-site'}})).status===403,'cross-site metadata rejected');
      const after=await fixture.command('audit');check(after.forwarded===before.forwarded&&after.identityRequests===before.identityRequests,'denied admission performs no backend work');
      check((await call('alice','state?accountId=bob')).status===400,'real loopback route query allowlist still applied');
      check((await call('alice','history?id=MOEX%3ATQBR%3ASBER&interval=1m')).body.error==='MOEX_UNVERIFIED','MOEX remains blocked');
    });
    await test(CASES[3],async()=>{
      await fixture.command('session',{id:'alice',revoked:true});check((await call('alice','state')).status===401,'revoked session does not survive TLS wrapper');
      await fixture.command('session',{id:'alice',revoked:false});alice=await call('alice','state');check(alice.status===200,'session restoration freshly checked');
      const ledgerHash=body=>sha(JSON.stringify({wallets:body.wallets,positions:body.positions,orders:body.orders,fills:body.fills,realized:body.realized,adjustments:body.adjustments}));
      const ledgerBefore=ledgerHash(alice.body),partialBefore=await fixture.command('audit'),forwardedBefore=ingress.audit.forwarded;
      const partial=await partialPost(ingress,credentials,order('partial-disabled'),{authorization:'Bearer '+ready.tokens.alice,'x-stocks-token':alice.body.token},()=>{enabled=false;});
      check(partial.status===503&&partial.body.error==='FIXTURE_STOCKS_DISABLED','partial valid owner POST denied when disabled before forwarding');
      const partialAfter=await fixture.command('audit');
      check(ingress.audit.forwarded===forwardedBefore&&partialAfter.forwarded===partialBefore.forwarded&&partialAfter.identityRequests===partialBefore.identityRequests&&partialAfter.quotes===partialBefore.quotes,'partial disabled POST causes no upstream, authority or quote work');
      report.partialDisable={status:partial.status,error:partial.body.error,ingressForwardedDelta:ingress.audit.forwarded-forwardedBefore,backendForwardedDelta:partialAfter.forwarded-partialBefore.forwarded,authorityDelta:partialAfter.identityRequests-partialBefore.identityRequests,quoteDelta:partialAfter.quotes-partialBefore.quotes};
      enabled=true;alice=await call('alice','state');check(alice.status===200&&ledgerHash(alice.body)===ledgerBefore,'post-proof validation read confirms exact ledger unchanged');
      report.partialDisable.ledgerUnchanged=true;
      const before=await fixture.command('audit'),forwarded=ingress.audit.forwarded;enabled=false;
      for(const [route,body]of[['state'],['portfolio'],['history?id='+encodeURIComponent(ID)+'&interval=15m'],['orders',order('cached')],['cancel',{id:'tls-buy'}]])check((await call('alice',route,body,alice.body.token)).status===503,'feature-off denies cached '+route.split('?')[0]);
      const after=await fixture.command('audit');check(after.forwarded===before.forwarded&&after.identityRequests===before.identityRequests&&after.quotes===before.quotes&&ingress.audit.forwarded===forwarded,'disabled ingress performs no auth, quote or ledger forwarding');
    });
    await test(CASES[4],async()=>{
      const relative='frontend/src/pages/stocks/StocksPage.tsx',source=fs.readFileSync(path.join(root,relative),'utf8');
      check(source.includes("GlobalStocks && window.location.hostname === '127.0.0.1'"),'public hostname fence remains literal loopback');
      report.frontend={path:relative,sha256:sha(source),publicHostSimulator:'BLOCKED_BY_EXISTING_HOSTNAME_FENCE',browserTest:'NOT_RUN',buildFlagRehearsal:'NOT_RUN',meaning:'TLS fixture wrapper is not public frontend wiring or deployment proof'};
    });
    report.audit=await fixture.command('audit');check(report.audit.prisma.unexpected===0&&report.audit.deniedNetwork===0,'only admitted fixture network and Prisma operations');
    check(report.cases.every(x=>x.status==='PASS'),'all planned finite cases completed');report.status='PASS';
  }catch(error){report.status='FAIL';report.failure={message:error.message,stack:error.stack};}
  finally{
    if(ingress){report.ingress={...ingress.audit};await ingress.close().catch(e=>{report.status='FAIL';report.ingressCleanupError=e.message;});}
    if(fixture){try{await fixture.command('stop');const exited=await fixture.waitForExit();if(exited.code!==0)throw Error('FIXTURE_EXIT_NONZERO');}catch(e){report.status='FAIL';report.childCleanupError=e.message;await fixture.terminate().catch(t=>report.terminationError=t.message);}fs.writeFileSync(path.join(output,'child.log'),fixture.logs.join(''),{flag:'wx',mode:0o600});}
    report.completedAt=new Date().toISOString();report.limitations=['Synthetic host only; no DNS, system trust, real account, production DB or public deployment','Fresh compiled /me with fixture Prisma; does not establish production auth/DB throughput','Fixture gateway is new QA code, not an approved production implementation','No frontend/browser or translation claim; current public-host simulator fence remains','No capacity or external-provider source/licensing claim'];
    write('report.json',report);write('sources.json',['qa-stocks-tls-ingress.cjs','qa-stocks-tls-rehearsal.cjs','qa-stocks-local-stage-recovery.cjs','qa-stocks-local-stage-fixture.cjs'].map(file=>({file:'scripts/'+file,sha256:sha(fs.readFileSync(path.join(__dirname,file)))})));
  }
  console.log(JSON.stringify({status:report.status,cases:report.cases.map(c=>({name:c.name,status:c.status})),assertions:report.assertions,output,failure:report.failure||null}));if(report.status!=='PASS')process.exitCode=1;
}
if(require.main===module){assert.equal(process.argv.length,6);assert.equal(process.argv[2],'--output');assert.equal(process.argv[4],'--python');main(process.argv[3],process.argv[5]).catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={main,raw};
