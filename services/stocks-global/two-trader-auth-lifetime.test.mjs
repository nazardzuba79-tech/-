import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from './server.mjs';
import { openAccounts, accountId } from './accounts.mjs';
import { createState, SimError } from './engine.mjs';
import { CATALOG } from './catalog.mjs';

// Disposable auth and quote authorities only. These tests never use real users,
// session secrets, provider requests, or a production balance.
const NOW=1791569400000,ID='BYBIT:AAPLXUSDT';
const ALICE={issuer:'auth-lifetime-fixture',subject:'alice'};
const BOB={issuer:'auth-lifetime-fixture',subject:'bob'};
const statePath='state?id='+encodeURIComponent(ID);
const order=(id,extra={})=>({id,instrumentId:ID,currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'90',...extra});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const bounded=async promise=>{
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture barrier timed out')),2000);})]);}
  finally{clearTimeout(timer);}
};
const until=async predicate=>{const end=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<end,'fixture condition must settle');await new Promise(resolve=>setTimeout(resolve,5));}};

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'stocks-auth-lifetime-')),path=join(dir,'paper.sqlite');
  const initialize=openAccounts(path);initialize.close();
  const db=new DatabaseSync(path);
  for(const [index,principal]of [ALICE,BOB].entries()){
    const state=createState(NOW);state.wallets.USDT.cash=['731.25000000','129.87500000'][index];state.wallets.USDC.cash='0.00000000';
    db.prepare('INSERT INTO paper_accounts(id,ledger) VALUES (?,?)').run(accountId(principal),JSON.stringify(state));
  }
  db.close();
  const auth=new Map([['alice',{principal:ALICE,valid:true,calls:0}],['bob',{principal:BOB,valid:true,calls:0}]]);
  const control=new Int32Array(new SharedArrayBuffer(5*Int32Array.BYTES_PER_ELEMENT));
  let time=NOW,price='100',quoteGate=null,authGate=null;
  const gates=[];
  const newGate=()=>{const entered=deferred(),released=deferred();const gate={entered:entered.promise,enter:entered.resolve,release:released.resolve,wait:released.promise};gates.push(gate);return gate;};
  const hub={metrics:{},catalogue:async()=>CATALOG.map(asset=>({...asset,online:true,exists:true})),
    quote:async()=>{
      if(quoteGate){const gate=quoteGate;quoteGate=null;gate.enter();await gate.wait;}
      return{instrumentId:ID,provider:'bybit',nativeCurrency:'USDT',bid:price,ask:price,timestamp:time,receivedAt:time,verified:true,marketOpen:true,eventId:'auth-lifetime-fixture-'+time,capacity:'1.00000000',prices:{USDT:{buy:price,sell:price}},fx:{}};
    },history:async()=>({candles:[]})};
  const app=await createServer({port:0,accountsPath:path,tradePrincipals:[ALICE,BOB],accountDiagnostics:true,now:()=>time,hub,
    accountWorkerOptions:{testHooks:{commitControl:control.buffer}},
    authenticate:async(req,{signal}={})=>{
      const name=req.headers['x-fixture-session'],state=auth.get(name);if(!state)throw new SimError('AUTH_REQUIRED');state.calls++;
      if(authGate&&authGate.name===name&&authGate.at===state.calls){const gate=authGate;authGate=null;gate.enter();await gate.wait;}
      if(signal?.aborted)throw new SimError('AUTH_UNAVAILABLE');if(!state.valid)throw new SimError('AUTH_REQUIRED');
      return{...state.principal};
    }});
  const requests=new Set();
  t.after(async()=>{for(const gate of gates)gate.release();Atomics.store(control,2,1);Atomics.notify(control,2);for(const req of requests)req.destroy();await app.close();await rm(dir,{recursive:true,force:true});});
  const begin=(route,{session='alice',token,body,slow=false}={})=>{
    const encoded=body===undefined?undefined:JSON.stringify(body);let request;
    const response=new Promise((resolve,reject)=>{
      request=http.request(`http://127.0.0.1:${app.port}/__stocks_global/${route}`,{method:encoded===undefined?'GET':'POST',headers:{'x-fixture-session':session,...(encoded===undefined?{}:{'content-type':'application/json','x-stocks-token':token||''})},signal:AbortSignal.timeout(3000)},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks))});}catch(error){reject(error);}});
      });
      requests.add(request);request.on('close',()=>requests.delete(request));request.on('error',reject);
      if(slow)request.write(encoded.slice(0,1));else request.end(encoded);
    });
    return{response,finish:()=>request.end(encoded.slice(1))};
  };
  const send=(route,options)=>begin(route,options).response;
  const rows=()=>{const read=new DatabaseSync(path,{readOnly:true});try{return read.prepare('SELECT id,ledger FROM paper_accounts ORDER BY id').all();}finally{read.close();}};
  return{app,auth,control,rows,begin,send,advance:(value=price)=>{time+=3000;price=value;},
    holdQuote:()=>{quoteGate=newGate();return quoteGate;},
    holdAuth:(name,afterCalls=2)=>{authGate={...newGate(),name,at:auth.get(name).calls+afterCalls};return authGate;},
    ready:async(session='alice')=>{
      const first=await send(statePath,{session});assert.equal(first.status,200,JSON.stringify(first.data));time+=3000;
      const current=await send(statePath,{session});assert.equal(current.status,200,JSON.stringify(current.data));return current.data.token;
    }};
}

for(const replacement of ['revoked','other-allowed-principal'])test(`slow POST body cannot use an authorization that became ${replacement}`,async t=>{
  const f=await fixture(t),token=await f.ready(),before=f.rows(),calls=f.auth.get('alice').calls;
  const request=f.begin('orders',{token,body:order('auth-lifetime-slow-body'),slow:true});
  await until(()=>f.auth.get('alice').calls>calls);
  if(replacement==='revoked')f.auth.get('alice').valid=false;else f.auth.get('alice').principal=BOB;
  request.finish();const result=await request.response;
  assert.equal(result.status,401);assert.equal(result.data.error,'AUTH_REQUIRED');assert.deepEqual(f.rows(),before);
});

test('revocation while existing-account binding waits prevents financial work and personal response',async t=>{
  const f=await fixture(t),token=await f.ready('bob');
  const pending=await f.send('orders',{session:'bob',token,body:order('auth-lifetime-held-order')});assert.equal(pending.status,200,JSON.stringify(pending.data));
  const aliceBefore=f.rows().find(row=>row.id===accountId(ALICE));
  const commits=Atomics.load(f.control,1);Atomics.store(f.control,0,1);
  const cancel=f.send('cancel',{session:'bob',token,body:{id:'auth-lifetime-held-order'}});
  await until(()=>Atomics.load(f.control,1)>commits);
  const request=f.send('state');
  await until(()=>f.app.accountMetrics().queue.pending===1);
  f.auth.get('alice').valid=false;Atomics.store(f.control,2,1);Atomics.notify(f.control,2);
  assert.equal((await cancel).status,200);
  const result=await request;assert.equal(result.status,401);assert.equal(result.data.error,'AUTH_REQUIRED');
  assert.deepEqual(f.rows().find(row=>row.id===accountId(ALICE)),aliceBefore);assert.equal(result.data.wallets,undefined);
});

for(const route of ['state','refresh'])test(`revocation during ${route} quote wait cannot fill an existing limit`,async t=>{
  const f=await fixture(t),token=await f.ready();
  const pending=await f.send('orders',{token,body:order('auth-lifetime-quote-limit')});assert.equal(pending.status,200,JSON.stringify(pending.data));
  assert.equal(pending.data.wallets.USDT.reserved,'9.00000000');const before=f.rows(),metrics=f.app.accountMetrics();
  f.advance('80');const gate=f.holdQuote();
  const request=f.send(route==='state'?statePath:'refresh',route==='state'?{}:{token,body:{id:ID}});
  await bounded(gate.entered);f.auth.get('alice').valid=false;gate.release();
  const result=await request;assert.equal(result.status,401);assert.equal(result.data.error,'AUTH_REQUIRED');
  assert.deepEqual(f.rows(),before);assert.equal(f.app.accountMetrics().sqlWriteCalls,metrics.sqlWriteCalls);
});

test('blocked identity revalidation holds no financial queue slot or another trader transaction',async t=>{
  const f=await fixture(t),aliceToken=await f.ready(),bobToken=await f.ready('bob');
  const gate=f.holdAuth('alice'),before=f.rows().find(row=>row.id===accountId(ALICE));
  const waiting=f.send('orders',{token:aliceToken,body:order('auth-lifetime-blocked-authority')});
  await bounded(gate.entered);
  assert.equal(f.app.accountMetrics().queue.active,0);assert.equal(f.app.accountMetrics().queue.pending,0);
  const bob=await f.send('orders',{session:'bob',token:bobToken,body:order('auth-lifetime-independent-bob')});assert.equal(bob.status,200,JSON.stringify(bob.data));
  f.auth.get('alice').valid=false;gate.release();const rejected=await waiting;
  assert.equal(rejected.status,401);assert.equal(rejected.data.error,'AUTH_REQUIRED');
  assert.deepEqual(f.rows().find(row=>row.id===accountId(ALICE)),before);
});
