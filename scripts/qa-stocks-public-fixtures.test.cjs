'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events');
const {staticFixture,sha}=require('./qa-stocks-public-fixtures.cjs');
const {certificates,createIngress,request,PREFIX}=require('./qa-stocks-tls-ingress.cjs');
const {raw}=require('./qa-stocks-tls-rehearsal.cjs');
test('one exact build-memory hostname hunk; actual source is never overwritten',async()=>{
  const {shadow,BEFORE,AFTER}=await import('./qa-stocks-public-build.mjs');
  const source='if ('+BEFORE+') return true;';
  assert.equal(shadow(source),'if ('+AFTER+') return true;');
  assert.throws(()=>shadow('no hostname'));assert.throws(()=>shadow(source+source));
});
test('static fixture has manifest-only paths and strict finite read authority context',async t=>{
  assert.ok(process.env.STOCKS_FIXTURE_PYTHON,'Explicit fixture Python executable required');
  const credentials=certificates(process.env.STOCKS_FIXTURE_PYTHON);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stocks-static-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bytes=Buffer.from('{"fixtureAsset":true}');fs.writeFileSync(path.join(dir,'index.html'),bytes);
  let calls=0;const authority=http.createServer((_req,res)=>{calls++;res.setHeader('content-type','application/json');res.end('{"id":"fixture-owner"}');});
  authority.listen(0,'127.0.0.1');await once(authority,'listening');t.after(()=>new Promise(r=>authority.close(r)));
  const origin='http://127.0.0.1:'+authority.address().port,audit={denied:[],authorityReads:0,fixtureReads:[],assets:0};
  const handler=staticFixture({build:{dist:dir,files:[{path:'index.html',sha256:sha(bytes),bytes:bytes.length}]},authorityOrigin:origin,reads:new Map(),audit});
  const ingress=await createIngress({credentials,upstreamOrigin:origin,allowSameOriginRead:true,staticHandler:handler});t.after(()=>ingress.close());
  assert.equal((await request(ingress,credentials,{path:'/stocks',headers:{origin:undefined,'sec-fetch-site':'none'}})).status,200);
  assert.equal((await request(ingress,credentials,{path:'/stocks',headers:{host:'wrong.invalid'}})).status,400);
  assert.equal((await request(ingress,credentials,{path:'/outside',headers:{origin:undefined}})).status,404);
  assert.equal((await request(ingress,credentials,{path:'/stocks',headers:{origin:'https://wrong.invalid'}})).status,403);
  assert.equal((await request(ingress,credentials,{method:'POST',path:'/api/v1/me',body:{}})).status,405);
  assert.equal((await request(ingress,credentials,{path:'/api/v1/me',headers:{origin:undefined,authorization:'Bearer disposable'}})).status,200);
  assert.equal((await request(ingress,credentials,{path:'/api/v1/me',headers:{origin:undefined,'sec-fetch-site':'none',authorization:'Bearer disposable'}})).status,403);
  assert.equal((await request(ingress,credentials,{path:'/api/v1/me',headers:{origin:undefined}})).status,401);
  assert.equal((await request(ingress,credentials,{path:'/api/v1/orders',headers:{authorization:'Bearer disposable'}})).status,404);
  assert.equal((await raw(ingress,credentials,'GET /stocks HTTP/1.1\r\nHost: '+ingress.authority+'\r\nOrigin: '+ingress.origin+'\r\nOrigin: '+ingress.origin+'\r\nConnection: close\r\n\r\n')).status,400);
  assert.equal(calls,1);
  fs.writeFileSync(path.join(dir,'index.html'),'changed');
  assert.equal((await request(ingress,credentials,{path:'/stocks'})).status,500);
});

function tlsProbeHarness({untrusted='reject',closeFailure=0}={}){
  const HOST='stocks-review.invalid',PREFIX='/api/stocks/',listeners=[],pages=[],events=[];let contextClosed=0,routeCount=0,webSocketRouteCount=0;
  const credentials={proof:{caFingerprint:'trusted-ca',wrongSanFingerprint:'wrong-san-leaf'},wrongSan:{fixture:'wrong-san'}};
  const context={
    route:async(pattern,handler)=>{assert.equal(pattern,'**/*');assert.equal(typeof handler,'function');routeCount++;},
    routeWebSocket:async(pattern,handler)=>{assert.equal(pattern,'**/*');assert.equal(typeof handler,'function');webSocketRouteCount++;},
    newPage:async()=>{
      assert.ok(pages.every(page=>page.closed),'a prior owned control page must close before the next is created');
      const page={index:pages.length+1,closed:false,gotos:0,errorDocumentPending:false,response:null,pending:null,
        async goto(url,options){
          assert.equal(options.waitUntil,'load');assert.equal(options.timeout,10000);assert.equal(this.closed,false);this.gotos++;
          if(this.pending)await this.pending;
          if(this.errorDocumentPending)throw Error('Navigation is interrupted by another navigation to chrome-error://chromewebdata/');
          const target=new URL(url),index=listeners.findIndex(row=>new URL(row.origin).port===target.port);assert.ok(index>=0);
          if(target.hostname==='bad-sni.'+HOST){listeners[0].audit.sniDenied++;this.pending=Promise.resolve().then(()=>{if(!this.closed)this.errorDocumentPending=true;});throw Error('net::ERR_CONNECTION_CLOSED');}
          if(index===1){if(untrusted==='accept')return {status:()=>200};throw Error(untrusted==='mismatch'?'net::ERR_TIMED_OUT':'net::ERR_CERT_AUTHORITY_INVALID');}
          if(index===2)throw Error('net::ERR_CERT_COMMON_NAME_INVALID');
          assert.equal(index,0);return {status:()=>200};
        },
        on(name,handler){assert.equal(name,'response');this.response=handler;},
        async evaluate(_fn,url){assert.equal(url,listeners[3].origin+PREFIX+'orders');assert.equal(this.errorDocumentPending,false);const audit=listeners[3].audit;audit.requests++;audit.denied++;audit.lastDenial={status:403,error:'ORIGIN_DENIED'};this.response({url:()=>url,status:()=>403});return {error:'Failed to fetch'};},
        async close(){events.push('close:'+this.index);if(this.index===closeFailure)throw Error('fixture page close failed');this.closed=true;},
      };pages.push(page);events.push('open:'+page.index);return page;
    },
    close:async()=>{contextClosed++;for(const page of pages)page.closed=true;},
  };
  const browser={newContext:async options=>{assert.equal(options.serviceWorkers,'block');assert.equal(options.ignoreHTTPSErrors,false);assert.deepEqual(Object.keys(options).sort(),['ignoreHTTPSErrors','serviceWorkers']);return context;}};
  const dependencies={HOST,PREFIX,certificates:()=>({proof:{caFingerprint:'foreign-ca'}}),createIngress:async()=>{const listener={origin:'https://'+HOST+':'+(44000+listeners.length),audit:{requests:0,forwarded:0,denied:0,sniDenied:0,lastDenial:null},closed:false,close:async()=>{listener.closed=true;}};listeners.push(listener);return listener;}};
  const module={exports:{}};require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname,'qa-stocks-public-tls-probes.cjs'),'utf8'),{module,setTimeout,clearTimeout,URL,require:name=>{if(name==='node:assert/strict')return assert;if(name==='./qa-stocks-tls-ingress.cjs')return dependencies;throw Error('unexpected TLS probe fixture dependency');}});
  const run=()=>module.exports.browserTlsProbes({browser,credentials,python:'unused-fixture',upstreamOrigin:'http://127.0.0.1:44099',fixture:{command:async command=>{assert.equal(command,'audit');return {identityRequests:0,forwarded:0,quotes:0};}},check:(ok,message)=>assert.ok(ok,message)});
  return {run,pages,listeners,events,closed:()=>contextClosed,guards:()=>({routeCount,webSocketRouteCount})};
}

test('actual TLS probes isolate delayed error-document navigations using a fresh closed page per control',async()=>{
  const harness=tlsProbeHarness(),proof=await harness.run();assert.equal(proof.status,'PASS');assert.equal(harness.pages.length,5);
  assert.deepEqual(harness.pages.map(page=>page.gotos),[1,1,1,1,1]);assert.ok(harness.pages.every(page=>page.closed));assert.equal(harness.closed(),1);assert.ok(harness.listeners.every(row=>row.closed));
  assert.deepEqual(harness.events,['open:1','close:1','open:2','close:2','open:3','close:3','open:4','close:4','open:5','close:5']);
  assert.deepEqual(harness.guards(),{routeCount:1,webSocketRouteCount:1});assert.equal(proof.cases.length,5);assert.ok(Object.values(proof.backendDelta).every(value=>value===0));assert.equal(proof.normalTls,true);
});

test('actual TLS probes fail closed on accepted or mismatched certificate errors and still close every owned resource',async()=>{
  for(const untrusted of ['accept','mismatch']){const harness=tlsProbeHarness({untrusted});await assert.rejects(harness.run,error=>error.tlsProbeProof?.status==='FAIL'&&/normal Chromium rejects untrusted without TLS bypass/.test(error.message));assert.equal(harness.pages.length,2);assert.ok(harness.pages.every(page=>page.closed));assert.equal(harness.closed(),1);assert.ok(harness.listeners.every(row=>row.closed));}
});

test('actual TLS probe page-close failure stops further controls and preserves any preceding assertion failure',async()=>{
  for(const options of [{closeFailure:4},{untrusted:'accept',closeFailure:2}]){const harness=tlsProbeHarness(options);await assert.rejects(harness.run,error=>error.message==='fixture page close failed'&&error.tlsProbeProof?.status==='FAIL'&&(!options.untrusted||/normal Chromium rejects untrusted/.test(error.tlsProbeProof.failure.probeFailure?.message)));assert.equal(harness.pages.length,options.closeFailure);assert.equal(harness.closed(),1);assert.ok(harness.listeners.every(row=>row.closed));}
});
