// Finite public-host-shaped frontend rehearsal. No public DNS, real funds or deployment.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixtureProcess}=require('./qa-stocks-local-stage-recovery.cjs');
const {ID}=require('./qa-stocks-local-stage-fixture.cjs');
const {certificates,createIngress,request,HOST,PREFIX}=require('./qa-stocks-tls-ingress.cjs');
const {createNssHome,assertLinux}=require('./qa-stocks-public-nss.cjs');
const {browserTlsProbes,BAD_SNI}=require('./qa-stocks-public-tls-probes.cjs');
const {walletFixtures,staticFixture,sha}=require('./qa-stocks-public-fixtures.cjs');
const {verifyBuild}=require('./qa-stocks-principal-projection.cjs');
const root=path.resolve(__dirname,'..');
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}}
async function until(fn,label,ms=10000){const end=performance.now()+ms;while(!await fn()){if(performance.now()>end)throw Error(label);await new Promise(r=>setTimeout(r,50));}}
function copyAuthority(source,dest,sourceRoot=root){
  assert.ok(path.isAbsolute(source)&&path.isAbsolute(dest)&&path.isAbsolute(sourceRoot));
  const bounded=file=>{const st=fs.lstatSync(file);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<=4*1024*1024,'bounded artifact file');return fs.readFileSync(file);};
  const bytes=bounded(path.join(source,'manifest.json')),manifest=JSON.parse(bytes);
  const proofFile=path.join(path.dirname(source),'build-provenance.json');
  const build=verifyBuild(proofFile,sourceRoot,source);
  assert.equal(manifest.fixtureOnly,true);assert.equal(manifest.buildProvenanceSha256,build.proofSha256,'package bound to exact verified producer proof');
  const contents=new Map();
  for(const file of manifest.files){
    assert.ok(/^(scripts\/qa-stocks-local-stage-fixture\.cjs|services\/(stocks-global|stocks-simulator)\/[a-z-]+\.mjs|dist\/[A-Za-z0-9_/-]+\.js|src\/[A-Za-z0-9_/-]+\.ts)$/.test(file.path)&&!file.path.includes('..'),'reviewed authority package path');
    assert.ok(!contents.has(file.path),'duplicate artifact path');
    const content=bounded(path.join(source,file.path));assert.equal(sha(content),file.sha256);
    if(file.path.startsWith('dist/'))assert.equal(file.sha256,build.compiled[file.path],'compiled artifact is verified used closure');
    else assert.equal(sha(bounded(path.join(sourceRoot,file.path))),file.sha256,'Reused actual /me/Stocks QA source matches current reviewed source');
    contents.set(file.path,content);
  }
  assert.deepEqual([...contents.keys()].filter(p=>p.startsWith('dist/')).sort(),Object.keys(build.compiled).sort(),'complete and exact verified emitted closure');
  fs.mkdirSync(dest,{mode:0o700});
  for(const [file,content]of contents){const target=path.join(dest,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content,{flag:'wx',mode:0o600});}
  fs.writeFileSync(path.join(dest,'manifest.json'),bytes,{flag:'wx',mode:0o600});
  return {source,manifestSha256:sha(bytes),files:manifest.files.length,build,scope:'Immutable fresh-build-proven local /me artifact; current source/compiler/config/log verified, compiled closure read from artifact only; strict fixture Prisma and separate private SQLite; no production session'};
}
async function main({output,buildRoot,authorityPackage,python,playwright,certutil}){
  for(const p of [output,buildRoot,authorityPackage,python,playwright,certutil])assert.ok(path.isAbsolute(p));
  assert.ok(!fs.existsSync(output));fs.mkdirSync(path.dirname(output),{recursive:true});fs.mkdirSync(output,{mode:0o700});
  const report={schema:1,fixtureOnly:true,publicExposure:false,productionAccess:false,capacityClaim:false,status:'RUNNING',assertions:0,checks:[],cases:['off','on','candidate'].map(name=>({name,status:'NOT_RUN'})),startedAt:new Date().toISOString()};
  const check=(condition,label)=>{assert.ok(condition,label);report.assertions++;report.checks.push(label);};
  const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  let fixture,browser,browserServer,activeIngress,activeContext,nss,enabled=true;
  try{
    assertLinux(process.platform);
    const manifestBytes=fs.readFileSync(path.join(buildRoot,'manifest.json')),manifest=JSON.parse(manifestBytes);
    check(manifest.complete===true&&JSON.stringify(manifest.builds.map(b=>b.name))==='["off","on","candidate"]','three complete separate builds');
    report.build={manifestSha256:sha(manifestBytes),sourceHash:manifest.sourceHash,buildRoot,cases:manifest.builds.map(b=>({name:b.name,env:b.env,outputHash:b.outputHash,candidateDelta:b.candidateDelta}))};
    for(const item of manifest.sourceFiles)assert.equal(sha(fs.readFileSync(path.join(root,'frontend',item.path))),item.sha256,'unchanged frontend input: '+item.path);
    report.build.verifiedSourceFiles=manifest.sourceFiles.length;check(true,'every recorded frontend input unchanged');
    report.authority=copyAuthority(authorityPackage,path.join(output,'package'));
    fixture=fixtureProcess(path.join(output,'package'),path.join(output,'data'),report);const ready=await fixture.ready();
    const credentials=certificates(python);nss=createNssHome({credentials,certutil,forbiddenRoots:[output,buildRoot,authorityPackage]});report.nss=nss.proof;
    const {chromium}=require(playwright),wallet=walletFixtures(root);report.walletFixture=wallet.provenance;report.tls=credentials.proof;
    report.networkBoundary={type:'normal Chromium TLS + fresh private NSS fixture-CA trust + reserved-host resolver mapping + Playwright pre-dispatch HTTP/WS denial',osNetworkNamespace:false,realDNS:false,systemTrustChanged:false,serviceWorkers:'blocked',note:'Browser/Node QA controls; not an OS-level egress barrier or production TLS deployment'};
    // Playwright creates its own profile using the parent os.tmpdir; pin only this launch to private scratch.
    const previousTmp=process.env.TMPDIR;process.env.TMPDIR=nss.env.TMPDIR;
    try{browserServer=await chromium.launchServer({headless:true,chromiumSandbox:true,timeout:30000,env:nss.env,args:[
      '--host-resolver-rules=MAP '+HOST+' 127.0.0.1, MAP '+BAD_SNI+' 127.0.0.1, MAP * ~NOTFOUND',
      '--no-proxy-server','--disable-background-networking','--disable-component-update',
      '--disable-sync','--no-first-run','--disable-default-apps',
    ]});}finally{if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;}
    nss.verifyProfile(browserServer.process().spawnargs);
    report.browser={version:null,ownedPid:browserServer.process().pid,normalCertificateValidation:true,chromiumSandbox:true,ignoreHTTPSErrors:false,launchArguments:browserServer.process().spawnargs.slice(1)};
    browser=await chromium.connect(browserServer.wsEndpoint());report.browser.version=browser.version();
    report.browserTls=await browserTlsProbes({browser,credentials,python,upstreamOrigin:ready.gatewayOrigin,fixture,check});
    for(const build of manifest.builds){
      check(build.env.VITE_STOCKS_OWNER_USDT_ONLY===String(build.name!=='off'),'explicit owner USDT-only build flag '+build.name);
      const row=report.cases.find(x=>x.name===build.name);row.status='RUNNING';row.requests=[];row.responses=[];row.externalBlocked=[];row.webSocketsBlocked=[];row.pageErrors=[];row.consoleErrors=[];row.staticAudit={denied:[],authorityReads:0,fixtureReads:[],assets:0};save();
      activeIngress=await createIngress({credentials,upstreamOrigin:ready.gatewayOrigin,enabled:()=>enabled,allowSameOriginRead:true,staticHandler:staticFixture({build,authorityOrigin:ready.authorityOrigin,reads:wallet.routes,audit:row.staticAudit})});
      const ingress=activeIngress;
      const preflight=await request(ingress,credentials,{path:PREFIX+'state',headers:{authorization:'Bearer '+ready.tokens.alice}});
      check(preflight.status===200,'Node per-request fixture CA validates '+build.name);
      check(!!(await request(ingress,credentials,{untrusted:true})).error,'Node rejects untrusted fixture CA '+build.name);
      check((await request(ingress,credentials,{method:'POST',path:PREFIX+'refresh',body:{id:ID},headers:{authorization:'Bearer '+ready.tokens.alice,'x-stocks-token':preflight.body.token}})).status===200,'private selected quote seed '+build.name);
      activeContext=await browser.newContext({viewport:{width:1440,height:900},locale:'en',serviceWorkers:'block'});
      const context=activeContext;check(typeof context.routeWebSocket==='function','pre-dispatch WebSocket deny API exists');
      await context.routeWebSocket('**/*',socket=>{row.webSocketsBlocked.push({url:socket.url().split('?')[0]});socket.close();});
      await context.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());
        if(url.origin!==ingress.origin){row.externalBlocked.push({origin:url.origin,path:url.pathname,type:req.resourceType()});return route.abort('blockedbyclient');}
        return route.continue();
      });
      await context.addInitScript(token=>{localStorage.setItem('exchange_token',token);localStorage.setItem('exchange_lang','en');},ready.tokens.alice);
      const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>row.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')row.consoleErrors.push(m.text().slice(0,400));});
      page.on('request',req=>{const url=new URL(req.url());if(url.origin===ingress.origin)row.requests.push({method:req.method(),path:url.pathname,origin:req.headers().origin||null,secFetchSite:req.headers()['sec-fetch-site']||null});});
      page.on('response',res=>{const url=new URL(res.url());if(url.origin===ingress.origin&&(url.pathname.startsWith(PREFIX)||url.pathname==='/api/v1/me'))row.responses.push({path:url.pathname,status:res.status()});});
      try{
        await page.goto(ingress.origin+'/stocks/'+encodeURIComponent(ID),{waitUntil:'domcontentloaded',timeout:20000});
        if(build.name==='candidate'){
          await page.locator('.vxg-ticket').waitFor({state:'visible'});
          await until(()=>row.responses.some(r=>r.path===PREFIX+'state'&&r.status===200),'candidate state not confirmed');
          await until(()=>row.responses.some(r=>r.path===PREFIX+'history'&&r.status===200),'candidate history not confirmed');
          check(await page.locator('.vx-stocks-terminal').count()===0,'candidate selects only existing GlobalStocks');
          check((await page.locator('.vxg-active-asset').innerText()).includes('AAPLX'),'candidate exact source instrument');
          check(await page.locator('.vxg-currency').getByRole('button',{name:'USDT',exact:true}).count()===1&&await page.locator('.vxg-currency').getByRole('button',{name:'USDC',exact:true}).count()===0,'candidate preserves owner USDT-only interface');
          check(await page.locator('.vxg-chart-section canvas').count()>0,'candidate existing chart mounted with private one-candle fixture');
          row.selection='QA_ONLY_GLOBAL_STOCKS';row.marketData='private fixture one-candle/quote, not real data';
          await page.screenshot({path:path.join(output,'candidate-desktop-1440.png'),fullPage:true});
          await page.setViewportSize({width:390,height:844});
          await until(()=>page.locator('.vxg-mobile-tabs').isVisible(),'candidate mobile tabs');
          check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'candidate mobile no horizontal page overflow');
          await page.screenshot({path:path.join(output,'candidate-mobile-390.png'),fullPage:true});
          await page.setViewportSize({width:1440,height:900});
        }else if(build.name==='on'){
          await page.locator('.vx-stocks-terminal').waitFor({state:'visible'});
          check(await page.locator('.vxg-ticket').count()===0,'untouched public-host enabled build retains GlobalStocks fence');
          check(!row.requests.some(r=>r.path.startsWith(PREFIX)),'untouched Stocks page makes no GlobalStocks requests');
          row.selection='LEGACY_WIDGET_TERMINAL';row.publicGlobalStocks='BLOCKED_BY_EXISTING_HOSTNAME_FENCE';
          await page.screenshot({path:path.join(output,'unmodified-on-public-1440.png'),fullPage:true});
        }else{
          await page.locator('#root').waitFor({state:'visible'});await page.waitForLoadState('load');
          check(await page.locator('.vxg-ticket,.vx-stocks-terminal,.vx-stocks-overview').count()===0,'disabled build mounts no Stocks terminal');
          check(!row.requests.some(r=>r.path.startsWith(PREFIX)),'disabled Stocks route makes no GlobalStocks reads');
          row.selection='STOCKS_ROUTE_COMPILED_OFF';
        }
        const beforeWallet=row.requests.length;
        await page.goto(ingress.origin+'/wallet',{waitUntil:'domcontentloaded',timeout:20000});
        await page.locator('.wallet-overview').waitFor({state:'visible'});
        if(build.name==='candidate')await until(()=>row.responses.some(r=>r.path===PREFIX+'portfolio'&&r.status===200),'candidate Wallet portfolio read not confirmed');
        // Wait for finite Wallet reads to settle; this is a UI contract, not throughput.
        await page.waitForTimeout(350);
        const walletRequests=row.requests.slice(beforeWallet).filter(r=>r.path===PREFIX+'portfolio');
        check(build.name==='candidate'?walletRequests.length>0:walletRequests.length===0,build.name+' Wallet shared host/flag behavior');
        if(build.name!=='candidate')check(!row.requests.some(r=>r.path.startsWith(PREFIX)),build.name+' entire untouched public Stocks/Wallet journey makes zero GlobalStocks requests');
        row.walletGlobalRequests=walletRequests.length;row.walletGate=build.name==='on'?'SHARED_EXACT_LOCAL_HOST_FENCE':build.name==='off'?'COMPILED_OFF':'QA_CANDIDATE_ONLY';
        if(build.name==='on')await page.screenshot({path:path.join(output,'unmodified-on-wallet-1440.png'),fullPage:true});
        if(build.name==='candidate'){
          await page.goto(ingress.origin+'/stocks/'+encodeURIComponent(ID),{waitUntil:'domcontentloaded'});
          await page.locator('.vxg-ticket').waitFor({state:'visible'});
          // Hide first to release the UI lease; then wait for admitted reads to drain.
          await page.goto(ingress.origin+'/wallet',{waitUntil:'domcontentloaded'});await page.locator('.wallet-overview').waitFor({state:'visible'});
          await until(()=>ingress.audit.active===0,'ingress drains before feature-off');await page.waitForTimeout(100);
          const before=await fixture.command('audit');enabled=false;
          const results=await page.evaluate(async({token,csrf,prefix,id})=>{
            const headers={Authorization:'Bearer '+token,'X-Stocks-Token':csrf};
            const calls=[['state',undefined],['portfolio',undefined],['orders',{id:'public-fixture-disabled-order',instrumentId:id,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'}]];
            const result=[];for(const [route,body]of calls){const r=await fetch(prefix+route,{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});result.push({route,status:r.status,error:(await r.json()).error});}return result;
          },{token:ready.tokens.alice,csrf:preflight.body.token,prefix:PREFIX,id:ID});
          check(results.every(r=>r.status===503&&r.error==='FIXTURE_STOCKS_DISABLED'),'cached browser GET/POST denied after backend feature off');
          const after=await fixture.command('audit');
          check(after.identityRequests===before.identityRequests&&after.forwarded===before.forwarded&&after.quotes===before.quotes,'feature-off cached calls perform no authority/ledger/provider admission');
          row.featureOff={results,authorityDelta:after.identityRequests-before.identityRequests,forwardedDelta:after.forwarded-before.forwarded,quoteDelta:after.quotes-before.quotes};
          enabled=true;
        }
        check(row.pageErrors.length===0,build.name+' has no uncaught JavaScript errors');
        check((await context.serviceWorkers()).length===0,'no active service workers '+build.name);
        row.ingress={...ingress.audit};row.status='PASS';
      }catch(e){row.status='FAIL';row.failure={message:e.message,stack:e.stack};await page.screenshot({path:path.join(output,build.name+'-failure.png'),fullPage:true}).catch(()=>{});throw e;}
      finally{await bounded(context.close(),5000,'CONTEXT_CLOSE_TIMEOUT');activeContext=null;await bounded(ingress.close(),5000,'INGRESS_CLOSE_TIMEOUT');activeIngress=null;save();}
    }
    report.status='PASS';report.publication='BLOCKED: untouched public host cannot select GlobalStocks; shared Wallet/route fence is retained; QA candidate is not a runtime change';
  }catch(e){report.status='FAIL';report.failure={message:e.message,stack:e.stack};if(e.tlsProbeProof)report.browserTls=e.tlsProbeProof;}
  finally{
    if(activeContext)await bounded(activeContext.close(),5000,'CONTEXT_CLOSE_TIMEOUT').catch(e=>{report.status='FAIL';report.contextCleanupError=e.message;});
    if(activeIngress)await bounded(activeIngress.close(),5000,'INGRESS_CLOSE_TIMEOUT').catch(e=>{report.status='FAIL';report.ingressCleanupError=e.message;});
    if(browser)await bounded(browser.close(),5000,'BROWSER_CLOSE_TIMEOUT').catch(e=>{report.status='FAIL';report.browserCleanupError=e.message;});
    if(browserServer)await bounded(browserServer.close(),5000,'BROWSER_SERVER_CLOSE_TIMEOUT').catch(async e=>{report.status='FAIL';report.browserServerCleanupError=e.message;await bounded(browserServer.kill(),3000,'BROWSER_KILL_TIMEOUT').catch(x=>report.browserKillError=x.message);});
    if(nss){try{const child=browserServer?.process();if(child)await until(()=>child.exitCode!==null||child.signalCode!==null,'OWNED_BROWSER_STILL_RUNNING',3000);nss.cleanup();}catch(e){report.status='FAIL';report.nssCleanupError=e.message;}}
    if(fixture){try{report.fixtureAudit=await fixture.command('audit');await fixture.command('stop');check((await fixture.waitForExit()).code===0,'fixture exits normally');}catch(e){report.status='FAIL';report.fixtureCleanupError=e.message;await fixture.terminate().catch(x=>report.fixtureTerminationError=x.message);}fs.writeFileSync(path.join(output,'fixture.log'),fixture.logs.join(''),{flag:'wx',mode:0o600});}
    report.completedAt=new Date().toISOString();report.limitations=['No production domain, provider traffic, real funds, deploy image or capacity claim','Linux-only fresh private NSS fixture CA; normal browser TLS validation; no global trust change','External request denial is a QA browser routing boundary, not OS network isolation','Untouched enabled public route still selects legacy; shared exact-localhost Wallet fence intentionally blocks its reads','Candidate modifies one shared hostname hunk in build memory only and is not publishable'];save();
    fs.writeFileSync(path.join(output,'sources.json'),JSON.stringify(['qa-stocks-public-host.cjs','qa-stocks-public-nss.cjs','qa-stocks-public-tls-probes.cjs','qa-stocks-public-build.mjs','qa-stocks-public-fixtures.cjs','qa-stocks-tls-ingress.cjs'].map(f=>({path:'scripts/'+f,sha256:sha(fs.readFileSync(path.join(__dirname,f)))})),null,2),{flag:'wx',mode:0o600});
  }
  console.log(JSON.stringify({status:report.status,assertions:report.assertions,cases:report.cases.map(r=>({name:r.name,status:r.status,selection:r.selection,walletGlobalRequests:r.walletGlobalRequests,failure:r.failure?.message})),failure:report.failure?.message,output}));if(report.status!=='PASS')process.exitCode=1;
}
if(require.main===module){
  assert.equal(process.argv.length,14);const args={};for(let i=2;i<14;i+=2){assert.ok(['--output','--build-root','--authority-package','--python','--playwright','--certutil'].includes(process.argv[i]));assert.ok(!(process.argv[i] in args));args[process.argv[i]]=path.resolve(process.argv[i+1]);}
  main({output:args['--output'],buildRoot:args['--build-root'],authorityPackage:args['--authority-package'],python:args['--python'],playwright:args['--playwright'],certutil:args['--certutil']}).catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports={main,copyAuthority};
