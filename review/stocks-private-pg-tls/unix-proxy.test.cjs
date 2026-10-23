'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{EventEmitter}=require('node:events');
const {validate,createHandler,verifyDirectory,ORIGIN}=require('./unix-proxy.cjs');
const base=()=>({url:'/__stocks_global/orders',method:'POST',headers:{host:'stocks.fixture.invalid:4443',origin:ORIGIN},rawHeaders:['Host','stocks.fixture.invalid:4443','Origin',ORIGIN]});
test('exact route/method Host Origin checks reject hostile paths and requests',()=>{
  assert.equal(validate(base()),'/__stocks_global/orders');
  for(const patch of [{url:'/api/v1/stocks-test-cash/command'},{url:'/__stocks_global/orders/../command'},{url:'/__stocks_global/%6frders'}, {method:'CONNECT'}, {url:'/__stocks_global/orders/'}, {headers:{...base().headers,host:'127.0.0.1:3001'}},{headers:{...base().headers,origin:'https://evil.invalid'}},{headers:{host:base().headers.host}}])assert.throws(()=>validate({...base(),...patch}));
});
test('forwarded, authority and duplicate security headers cannot cross proxy',()=>{
  for(const name of ['x-forwarded-for','forwarded','x-real-ip','cf-connecting-ip','x-stocks-authority-key'])assert.throws(()=>validate({...base(),headers:{...base().headers,[name]:'spoof'}}));
  assert.throws(()=>validate({...base(),rawHeaders:[...base().rawHeaders,'Host','stocks.fixture.invalid:4443']}));
});
test('Unix permissions fail closed on unsupported platforms',()=>assert.throws(()=>verifyDirectory('/unused','win32'),/UNIX_PERMISSIONS_REQUIRE_LINUX/));
async function harness(t,upstream) {
  const handler=createHandler(upstream),server=http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{handler.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
  return (headers={},body='{}')=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/__stocks_global/orders',method:'POST',headers:{Host:'stocks.fixture.invalid:4443',Origin:ORIGIN,...headers}},res=>{
      const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));
    });req.on('error',reject);req.end(body);
  });
}
test('real HTTP proxy fixes upstream4438, strips arbitrary headers and never retries failed mutation',async t=>{
  let calls=0,seen;
  const send=await harness(t,options=>{
    calls++;seen=options;const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};
    req.end=()=>queueMicrotask(()=>req.emit('error',Error('ECONNRESET')));return req;
  });
  const result=await send({authorization:'Bearer fixture-token','x-extra':'must-not-forward','x-stocks-token':'csrf'});
  assert.equal(result.status,503);assert.equal(calls,1);assert.equal(seen.host,'127.0.0.1');assert.equal(seen.port,4438);
  assert.equal(seen.headers['x-extra'],undefined);assert.equal(seen.headers.authorization,'Bearer fixture-token');assert.equal(seen.headers['x-stocks-authority-key'],undefined);
});
test('malicious capability, invalid Origin and oversized body fail before upstream',async t=>{
  let calls=0;const send=await harness(t,()=>{calls++;throw Error('must not connect');});
  assert.equal((await send({'x-stocks-authority-key':'forged'})).status,403);
  assert.equal((await send({Origin:'https://evil.invalid'})).status,403);
  assert.equal((await send({},'a'.repeat(16385))).status,403);assert.equal(calls,0);
});
test('successful request preserves path and body; upstream429 is passed without retry',async t=>{
  const {Readable}=require('node:stream');let calls=0,body;
  const send=await harness(t,(options,callback)=>{
    calls++;assert.equal(options.path,'/__stocks_global/orders');assert.equal(options.headers.origin,ORIGIN);
    const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};
    req.end=value=>{body=value.toString();queueMicrotask(()=>{const res=Readable.from(['{"error":"AUTH_RATE_LIMIT"}']);res.statusCode=429;res.headers={'retry-after':'28'};callback(res);});};return req;
  });
  const response=await send({},'{"id":"one-intent"}');assert.equal(response.status,429);assert.equal(JSON.parse(response.body).error,'AUTH_RATE_LIMIT');assert.equal(body,'{"id":"one-intent"}');assert.equal(calls,1);
});
