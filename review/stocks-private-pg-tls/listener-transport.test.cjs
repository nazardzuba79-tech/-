'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const root=path.resolve(__dirname,'../..');
const ts=require(path.join(root,'node_modules/typescript'));
const file=path.join(root,'src/api/middleware/stocksAuthorityIngress.ts');
const source=fs.readFileSync(file,'utf8');
const crypto=require('node:crypto');
// Compare with the committed blob, allowing checkout-only CRLF normalization.
const cp=require('node:child_process');
const blob=cp.execFileSync('git',['show',require('./source-guard.cjs').APP+':src/api/middleware/stocksAuthorityIngress.ts'],{cwd:root}).toString();
assert.equal(source.replace(/\r\n/g,'\n'),blob.replace(/\r\n/g,'\n'));
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const mod={exports:{}};
vm.runInThisContext('(function(exports,require,module){'+compiled+'\n})')(mod.exports,require('node:module').createRequire(file),mod);
const {createStocksAuthorityIngress,stocksAuthorityIngressConfig}=mod.exports;
test('actual133 listener accepts only private socket plus capability; both trader contexts and public wallet preserved',async t=>{
  const express=require(path.join(root,'node_modules/express')),app=express(),key=crypto.randomBytes(32).toString('hex');
  const ingress=createStocksAuthorityIngress({port:0,gatewayKey:key,requestsPerMinute:240});app.use(ingress.middleware);
  // Transport test double only: real JWT/PG tests remain in the future smoke.
  const seen=[];app.get('/api/v1/stocks-test-cash/identity',(req,res)=>{seen.push(req.headers.authorization);res.json({ok:true});});
  app.get('/api/v1/stocks-test-cash/wallet',(_req,res)=>res.json({ok:true}));
  const privateServer=await ingress.listen(app),publicServer=http.createServer(app);
  await new Promise(r=>publicServer.listen(0,'127.0.0.1',r));
  t.after(async()=>{for(const s of [privateServer,publicServer]){s.closeAllConnections();await new Promise(r=>s.close(r));}});
  // Node fetch normalizes Host; use raw HTTP to actually send the hostile Host.
  const req=(server,headers={},route='identity')=>new Promise((resolve,reject)=>{
    const r=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/v1/stocks-test-cash/'+route,headers},res=>{
      res.resume();res.once('end',()=>resolve({status:res.statusCode,headers:{get:name=>res.headers[name]},arrayBuffer:async()=>{}}));
    });r.on('error',reject);r.end();
  });
  for(const token of ['trader-a','trader-b']){
    const r=await req(privateServer,{'x-stocks-authority-key':key,authorization:token});assert.equal(r.status,200);assert.equal(r.headers.get('ratelimit-limit'),'240');await r.arrayBuffer();
  }
  for(const headers of [{'x-stocks-authority-key':'fake'},{'x-stocks-authority-key':key,'x-forwarded-for':'127.0.0.1'},{'x-stocks-authority-key':key,host:'127.0.0.1:3000'}]){const r=await req(privateServer,headers);assert.equal(r.status,403);await r.arrayBuffer();}
  const publicReply=await req(publicServer,{'x-stocks-authority-key':key,host:'127.0.0.1:'+privateServer.address().port});assert.equal(publicReply.status,403);assert.equal(publicReply.headers.get('ratelimit-limit'),'120');await publicReply.arrayBuffer();
  const wallet=await req(publicServer,{},'wallet');assert.equal(wallet.status,200);await wallet.arrayBuffer();assert.deepEqual(seen,['trader-a','trader-b']);
});
test('production parser accepts planned3001 bounded240 only when explicitly enabled',()=>{
  assert.deepEqual(stocksAuthorityIngressConfig({}),{});
  const config=stocksAuthorityIngressConfig({PORT:'3000',STOCKS_CATALOGUE_ENABLED:'true',STOCKS_AUTHORITY_INTERNAL_PORT:'3001',STOCKS_AUTHORITY_REQUESTS_PER_MINUTE:'240',STOCKS_TEST_CASH_GATEWAY_KEY:'a'.repeat(64)});
  assert.equal(config.port,3001);assert.equal(config.requestsPerMinute,240);
  assert.throws(()=>stocksAuthorityIngressConfig({STOCKS_AUTHORITY_INTERNAL_PORT:'3001'}));
});
