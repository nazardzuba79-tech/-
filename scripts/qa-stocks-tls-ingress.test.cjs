'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),https=require('node:https');
const {once}=require('node:events');
const {certificates,createIngress,request,HOST,PREFIX,MAX_BODY}=require('./qa-stocks-tls-ingress.cjs');
const {raw}=require('./qa-stocks-tls-rehearsal.cjs');
let credentials;
before(()=>{assert.ok(process.env.STOCKS_FIXTURE_PYTHON,'Explicit fixture Python executable required');credentials=certificates(process.env.STOCKS_FIXTURE_PYTHON);});
const wait=async(predicate)=>{const end=performance.now()+1500;while(!predicate()){if(performance.now()>end)throw Error('TEST_BARRIER_TIMEOUT');await new Promise(r=>setTimeout(r,5));}};
async function setup(t,handler,options={}){
  const upstream=http.createServer(handler);upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const ingress=await createIngress({credentials,upstreamOrigin:'http://127.0.0.1:'+upstream.address().port,...options});
  t.after(async()=>{await ingress.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));});return ingress;
}
test('explicit CA and exact SNI/Host/Origin admit fixture; other trust and authorities fail',async t=>{
  let starts=0;const ingress=await setup(t,(_req,res)=>{starts++;res.end('{"fixture":true}');});
  assert.equal((await request(ingress,credentials)).body.fixture,true);assert.equal(starts,1);
  assert.match((await request(ingress,credentials,{untrusted:true})).error||'',/^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT)$/);
  const sniBefore=ingress.audit.sniDenied;
  assert.match((await request(ingress,credentials,{servername:'wrong.invalid'})).error||'',/^(ECONNRESET|EPROTO|ERR_SSL_)/);
  assert.equal(ingress.audit.sniDenied,sniBefore+1);
  assert.equal((await request(ingress,credentials,{headers:{host:'wrong.invalid'}})).status,400);
  assert.equal((await request(ingress,credentials,{headers:{origin:undefined}})).status,403);
  assert.deepEqual(ingress.audit.lastDenial,{status:403,error:'ORIGIN_DENIED'});
  assert.equal(starts,1);
});

test('trusted fixture issuer with a wrong leaf SAN fails normal hostname verification',async t=>{
  let starts=0;const ingress=await setup(t,(_req,res)=>{starts++;res.end('{}');},{credentials:credentials.wrongSan});
  assert.equal((await request(ingress,credentials)).error,'ERR_TLS_CERT_ALTNAME_INVALID');assert.equal(starts,0);
});
test('raw duplicate headers and caller identity headers never reach upstream',async t=>{
  let starts=0;const ingress=await setup(t,(_req,res)=>{starts++;res.end('{}');});
  for(const header of ['Host','Origin','Authorization']){
    const fields={Host:ingress.authority,Origin:ingress.origin,Authorization:'Bearer fixture-only'};
    const text=`GET ${PREFIX}state HTTP/1.1\r\n`+Object.entries(fields).map(([k,v])=>`${k}: ${v}\r\n`).join('')+`${header}: ${fields[header]}\r\nConnection: close\r\n\r\n`;
    assert.equal((await raw(ingress,credentials,text)).status,400,header);
  }
  assert.equal((await request(ingress,credentials,{headers:{'x-forwarded-user':'owner'}})).status,400);assert.equal(starts,0);
});
test('body framing, method, route and bounded response fail closed',async t=>{
  let starts=0;const ingress=await setup(t,(_req,res)=>{starts++;res.end('x'.repeat(2*1024*1024+1));});
  assert.equal((await request(ingress,credentials,{method:'POST'})).status,405);
  assert.equal((await request(ingress,credentials,{path:'/api/v1/orders'})).status,404);
  assert.equal((await request(ingress,credentials,{method:'POST',path:PREFIX+'orders',body:{padding:'x'.repeat(MAX_BODY+1)}})).status,413);
  assert.equal(starts,0);
  const tooBig=await request(ingress,credentials);assert.equal(tooBig.status,502);assert.equal(tooBig.body.error,'RESPONSE_TOO_LARGE');assert.equal(starts,1);
});
test('incomplete order body disconnected before admission never reaches upstream',async t=>{
  let starts=0;const ingress=await setup(t,(_req,res)=>{starts++;res.end('{}');});
  const req=https.request({host:'127.0.0.1',port:ingress.port,servername:HOST,ca:credentials.ca,rejectUnauthorized:true,method:'POST',path:PREFIX+'orders',headers:{host:ingress.authority,origin:ingress.origin,'content-type':'application/json','content-length':1000},agent:false});
  req.on('error',()=>{});req.write('{');await wait(()=>ingress.audit.requests===1);req.destroy();await wait(()=>ingress.audit.active===0);
  assert.equal(starts,0);assert.equal(ingress.audit.disconnected,1);
});
test('HTTP parser bounds and ambiguous or streamed body framing deny before upstream',async t=>{
  let starts=0;const ingress=await setup(t,(_req,res)=>{starts++;res.end('{}');});
  const head=`POST ${PREFIX}orders HTTP/1.1\r\nHost: ${ingress.authority}\r\nOrigin: ${ingress.origin}\r\nContent-Type: application/json\r\nConnection: close\r\n`;
  assert.equal((await raw(ingress,credentials,head+'Content-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n')).status,400);
  assert.equal((await raw(ingress,credentials,head+'Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}')).status,400);
  const overflow='x'.repeat(MAX_BODY+1);
  assert.equal((await raw(ingress,credentials,head+'Transfer-Encoding: chunked\r\n\r\n'+overflow.length.toString(16)+'\r\n'+overflow+'\r\n0\r\n\r\n')).status,413);
  assert.equal((await raw(ingress,credentials,head+'X-Stocks-View: '+'x'.repeat(17000)+'\r\nContent-Length: 2\r\n\r\n{}')).status,431);
  assert.equal(starts,0);
});
test('disconnect cancels only in-flight fixture upstream request',async t=>{
  let started=false,closed=false;const ingress=await setup(t,(_req,res)=>{started=true;res.once('close',()=>closed=true);});
  const req=https.request({host:'127.0.0.1',port:ingress.port,servername:HOST,ca:credentials.ca,rejectUnauthorized:true,path:PREFIX+'state',headers:{host:ingress.authority,origin:ingress.origin},agent:false});req.on('error',()=>{});req.end();
  await wait(()=>started);req.destroy();await wait(()=>closed&&ingress.audit.active===0);assert.equal(ingress.audit.disconnected,1);
});
test('bounded upstream wait returns explicit timeout and drains',async t=>{
  const ingress=await setup(t,()=>{},{timeoutMs:50});const r=await request(ingress,credentials);
  assert.equal(r.status,504);assert.equal(r.body.error,'FIXTURE_INGRESS_DEADLINE');assert.equal(ingress.audit.active,0);
});
test('feature off denies existing authenticated-looking clients without upstream work',async t=>{
  let enabled=true,starts=0;const ingress=await setup(t,(_req,res)=>{starts++;res.end('{}');},{enabled:()=>enabled});
  assert.equal((await request(ingress,credentials)).status,200);enabled=false;
  assert.equal((await request(ingress,credentials,{method:'POST',path:PREFIX+'orders',body:{id:'cached'},headers:{authorization:'Bearer fixture','x-stocks-token':'cached'}})).status,503);assert.equal(starts,1);
});
test('feature off during partial POST denies admission before any upstream request',async t=>{
  let enabled=true,starts=0;const ingress=await setup(t,(_req,res)=>{starts++;res.end('{}');},{enabled:()=>enabled});
  const response=new Promise((resolve,reject)=>{
    const req=https.request({host:'127.0.0.1',port:ingress.port,servername:HOST,ca:credentials.ca,rejectUnauthorized:true,
      method:'POST',path:PREFIX+'orders',headers:{host:ingress.authority,origin:ingress.origin,'content-type':'application/json','content-length':2},agent:false},res=>{
      let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));res.on('error',reject);
    });
    const timer=setTimeout(()=>req.destroy(Error('TEST_RESPONSE_TIMEOUT')),4000);req.once('close',()=>clearTimeout(timer));req.on('error',reject);
    req.write('{');wait(()=>ingress.audit.requests===1&&ingress.audit.active===1).then(()=>{enabled=false;req.end('}');},reject);
  });
  const result=await response;assert.equal(result.status,503);assert.equal(result.body.error,'FIXTURE_STOCKS_DISABLED');
  assert.equal(starts,0);assert.equal(ingress.audit.forwarded,0);assert.equal(ingress.audit.active,0);
});
test('opt-in public fixture GET requires exact TLS authority and same-origin request context',async t=>{
  let starts=0,headers;const ingress=await setup(t,(req,res)=>{starts++;headers=req.headers;res.end('{}');},{allowSameOriginRead:true});
  assert.equal((await request(ingress,credentials,{headers:{origin:undefined,'sec-fetch-mode':'cors','user-agent':'fixture-browser','sec-ch-ua':'fixture'}})).status,200);
  assert.equal(headers['user-agent'],undefined);assert.equal(headers['sec-ch-ua'],undefined);assert.equal(headers['sec-fetch-mode'],undefined);
  assert.equal((await request(ingress,credentials,{headers:{origin:undefined,'sec-fetch-site':undefined}})).status,403);
  assert.equal((await request(ingress,credentials,{headers:{origin:undefined,'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await request(ingress,credentials,{headers:{origin:'https://wrong.invalid'}})).status,403);
  assert.equal((await request(ingress,credentials,{headers:{origin:undefined,host:'wrong.invalid'}})).status,400);
  assert.equal((await request(ingress,credentials,{headers:{origin:undefined,'x-forwarded-host':ingress.authority}})).status,400);
  assert.equal((await request(ingress,credentials,{headers:{origin:undefined,'x-http-method-override':'POST'}})).status,400);
  assert.equal((await request(ingress,credentials,{method:'POST',path:PREFIX+'orders',body:{id:'fixture'},headers:{origin:undefined}})).status,403);
  assert.equal(starts,1);
});
