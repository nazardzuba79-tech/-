import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAuthorityAdapter } from './authority-adapter.mjs';
import { accountId } from './accounts.mjs';
import { createServer } from './server.mjs';

const ISSUER='authority-transport-fixture',KEY='synthetic-internal-gateway-key-0000000000';
const credential = letter => 'Bearer '+letter.repeat(32);
test('authority transport keeps per-request sessions when a principal handle is reused across concurrent tabs',async t=>{
  const calls=[];
  const server=http.createServer(async(req,res)=>{
    const authorization=req.headers.authorization,subject=authorization===credential('B')?'synthetic-b':'synthetic-a';
    res.setHeader('content-type','application/json');
    if(req.url.endsWith('/identity'))return res.end(JSON.stringify({issuer:ISSUER,subject}));
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
    calls.push({authorization,key:req.headers['x-stocks-authority-key'],body});
    res.end(JSON.stringify({value:body.type==='ensure'?{id:accountId({issuer:ISSUER,subject})}:{syntheticCredential:authorization},metrics:{synthetic:true}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const adapter=createAuthorityAdapter({endpoint:`http://127.0.0.1:${server.address().port}/api/v1/stocks-test-cash`,issuer:ISSUER,gatewayKey:KEY});
  t.after(async()=>{await adapter.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  let handle;
  await adapter.runWithRequest({headers:{authorization:credential('A')}},async()=>{const principal=await adapter.authenticate();handle=await adapter.forPrincipal(principal,{existingOnly:true});});
  const [a,b]=await Promise.all([
    adapter.runWithRequest({headers:{authorization:credential('C')}},async()=>{await adapter.authenticate();await new Promise(resolve=>setImmediate(resolve));return handle.execute('readView');}),
    adapter.runWithRequest({headers:{authorization:credential('B')}},async()=>{const principal=await adapter.authenticate();const other=await adapter.forPrincipal(principal,{existingOnly:true});return other.execute('readView');})
  ]);
  assert.equal(a.syntheticCredential,credential('C'));assert.equal(b.syntheticCredential,credential('B'));
  assert.ok(calls.every(call=>call.key===KEY));assert.equal(JSON.stringify(adapter.metrics()).includes(KEY),false);
});

test('authority transport fails closed on a lost mutation response and never retries',async()=>{
  let requests=0;
  const adapter=createAuthorityAdapter({endpoint:'http://127.0.0.1:1/api/v1/stocks-test-cash',issuer:ISSUER,gatewayKey:KEY,fetchImpl:async(_url,options)=>{
    requests++;if(options.method==='GET')return new Response(JSON.stringify({issuer:ISSUER,subject:'synthetic-a'}));
    if(JSON.parse(options.body).type==='ensure')return new Response(JSON.stringify({value:{id:accountId({issuer:ISSUER,subject:'synthetic-a'})}}));
    throw Error('synthetic lost response');
  }});
  await adapter.runWithRequest({headers:{authorization:credential('A')}},async()=>{
    const principal=await adapter.authenticate();const handle=await adapter.forPrincipal(principal,{existingOnly:true});await assert.rejects(handle.execute('submitObserved',{order:{id:'synthetic-lost-order-01'}}),/ACCOUNT_OUTCOME_UNKNOWN/);
  });
  assert.equal(requests,3);await adapter.close();
});

test('authority transport maps real requireAuth revocation wording to AUTH_REQUIRED',async()=>{
  const adapter=createAuthorityAdapter({endpoint:'http://127.0.0.1:1/api/v1/stocks-test-cash',issuer:ISSUER,gatewayKey:KEY,fetchImpl:async()=>new Response(JSON.stringify({error:'Session has been signed out'}),{status:401})});
  await adapter.runWithRequest({headers:{authorization:credential('A')}},async()=>{await assert.rejects(adapter.authenticate(),/AUTH_REQUIRED/);});await adapter.close();
});

test('authority opt-in rejects mixed SQLite/authority configuration before opening a ledger',async()=>{
  const authority={authenticate:async()=>({issuer:ISSUER,subject:'synthetic-a'})};
  await assert.rejects(createServer({accountAuthority:authority,accountsPath:'never-created.sqlite',tradePrincipals:[{issuer:ISSUER,subject:'synthetic-a'},{issuer:ISSUER,subject:'synthetic-b'}]}),/AUTH_CONFIG_INVALID/);
  assert.throws(()=>createAuthorityAdapter({endpoint:'http://example.invalid/api/v1/stocks-test-cash',issuer:ISSUER,gatewayKey:KEY}),/AUTH_CONFIG_INVALID/);
});

test('authority handle forwards observation cancellation and never cancels financial intent from caller signal',async()=>{
  let observationStarted;const started=new Promise(resolve=>observationStarted=resolve),calls=[];
  const adapter=createAuthorityAdapter({endpoint:'http://127.0.0.1:1/api/v1/stocks-test-cash',issuer:ISSUER,gatewayKey:KEY,fetchImpl:async(_url,options)=>{
    if(options.method==='GET')return new Response(JSON.stringify({issuer:ISSUER,subject:'synthetic-a'}));
    const body=JSON.parse(options.body);calls.push({body,aborted:options.signal.aborted});
    if(body.type==='ensure')return new Response(JSON.stringify({value:{id:accountId({issuer:ISSUER,subject:'synthetic-a'})}}));
    if(body.type==='observe'){observationStarted();return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('synthetic transport aborted')),{once:true}));}
    return new Response(JSON.stringify({value:{acknowledged:true}}));
  }});
  await adapter.runWithRequest({headers:{authorization:credential('A')}},async()=>{
    const principal=await adapter.authenticate(),handle=await adapter.forPrincipal(principal,{existingOnly:true}),controller=new AbortController();
    const rejected=assert.rejects(handle.execute('observe',{instrumentId:'BYBIT:AAPLXUSDT'},{signal:controller.signal,occurrenceId:'fixture-transport-observation-id'}),/ACCOUNT_OUTCOME_UNKNOWN/);
    await started;controller.abort();await rejected;
    const financial=await handle.execute('submitObserved',{order:{id:'synthetic-finance-kept-01'}},{signal:controller.signal});assert.equal(financial.acknowledged,true);
  });
  assert.equal(calls.find(x=>x.body.type==='observe').body.occurrenceId,'fixture-transport-observation-id');assert.equal(calls.find(x=>x.body.type==='submitObserved').aborted,false);await adapter.close();
});
