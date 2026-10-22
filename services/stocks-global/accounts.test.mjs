import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openAccounts, accountId } from './accounts.mjs';
import { identityResolver } from './identity.mjs';
import { createServer } from './server.mjs';
import { applyQuote, submit, cancel, setBalances } from './engine.mjs';
import { CATALOG } from './catalog.mjs';

const now=1791569400000,id='BYBIT:AAPLXUSDT';
const alice={issuer:'fixture-only',subject:'alice'},bob={issuer:'fixture-only',subject:'bob'};
const quote={instrumentId:id,provider:'bybit',nativeCurrency:'USDT',bid:'100',ask:'100',timestamp:now,receivedAt:now,verified:true,marketOpen:true,eventId:'fixture-only-1',capacity:'1.00000000',prices:{USDT:{buy:'100',sell:'100'}},fx:{}};
const order=(n,extra={})=>({id:`request-${String(n).padStart(20,'0')}`,instrumentId:id,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1',...extra});
const dir=()=>mkdtemp(join(tmpdir(),'stocks-accounts-test-'));

test('two users have independent wallets, positions, reservations, histories and idempotency namespaces',async()=>{
  const d=await dir(),repo=openAccounts(join(d,'paper.sqlite'),{now:()=>now});
  try{
    const a=repo.forPrincipal(alice),b=repo.forPrincipal(bob);
    await a.transact(s=>{applyQuote(s,quote,now);submit(s,order(1),now);submit(s,order(2,{type:'LIMIT',limitPrice:'50'}),now);});
    assert.equal(a.read().wallets.USDT.cash,'9990.00000000');assert.equal(a.read().wallets.USDT.reserved,'5.00000000');
    assert.equal(b.read().wallets.USDT.cash,'10000.00000000');assert.deepEqual(b.read().positions,{});assert.equal(b.read().orders.length,0);
    await assert.rejects(b.transact(s=>cancel(s,order(2).id,now)));
    await b.transact(s=>{applyQuote(s,quote,now);submit(s,order(1,{quantity:'0.2'}),now);});
    assert.equal(b.read().fills.length,1);assert.equal(b.read().wallets.USDT.cash,'9980.00000000');assert.equal(a.read().fills.length,1);
    await a.transact(s=>setBalances(s,{id:order(9).id,balances:{USDT:'12000',USDC:'15000'}},now));
    assert.equal(b.read().wallets.USDC.cash,'10000.00000000');assert.equal(b.read().adjustments.length,0);
    assert.notEqual(accountId(alice),accountId({...alice,issuer:'different-authority'}));
  }finally{repo.close();await rm(d,{recursive:true,force:true});}
});

test('atomic transactions across two repositories prevent double fills, overselling and lost updates',async()=>{
  const d=await dir(),path=join(d,'paper.sqlite'),r1=openAccounts(path,{now:()=>now}),r2=openAccounts(path,{now:()=>now});
  try{
    const a=r1.forPrincipal(alice),other=r2.forPrincipal(alice);await a.transact(s=>applyQuote(s,quote,now));
    await Promise.all(Array.from({length:30},(_,i)=>(i%2?a:other).transact(s=>submit(s,order(1),now))));
    assert.equal(a.read().fills.length,1);assert.equal(a.read().wallets.USDT.cash,'9990.00000000');
    await other.transact(s=>applyQuote(s,{...quote,eventId:'sell-2',timestamp:now+1,receivedAt:now+1},now+1));
    await a.transact(s=>submit(s,order(2,{side:'SELL'}),now+1));
    await assert.rejects(other.transact(s=>submit(s,order(3,{side:'SELL'}),now+1)));
    assert.equal(a.read().wallets.USDT.cash,'10000.00000000');assert.equal(a.read().positions[id+'|USDT'].quantity,'0.00000000');
  }finally{r1.close();r2.close();await rm(d,{recursive:true,force:true});}
});

test('a failed commit cannot publish balances, reservations, history or fills',async()=>{
  const d=await dir(),repo=openAccounts(join(d,'paper.sqlite'),{now:()=>now,beforeCommit:()=>{throw Error('fixture disk failure');}});
  try{const a=repo.forPrincipal(alice);await assert.rejects(a.transact(s=>{applyQuote(s,quote,now);submit(s,order(1),now);}),/fixture disk failure/);assert.equal(a.read().fills.length,0);assert.equal(a.read().revision,0);assert.equal(a.read().wallets.USDT.cash,'10000.00000000');}
  finally{repo.close();await rm(d,{recursive:true,force:true});}
});

test('a new process restores both accounts and reservations; ownerless legacy history is untouched',async()=>{
  const d=await dir(),path=join(d,'paper.sqlite'),legacy=join(d,'ledger.json');await writeFile(legacy,'{"legacy":"must remain byte exact"}');
  const repo=openAccounts(path,{now:()=>now});const a=repo.forPrincipal(alice),b=repo.forPrincipal(bob);
  await a.transact(s=>{applyQuote(s,quote,now);submit(s,order(1),now);submit(s,order(2,{type:'LIMIT',limitPrice:'50'}),now);});
  await b.transact(s=>setBalances(s,{id:order(3).id,balances:{USDT:'12345',USDC:'23456'}},now));
  const expected=[a.read(),b.read()];repo.close();
  try{const code=`import {openAccounts} from ${JSON.stringify(new URL('./accounts.mjs',import.meta.url).href)};const r=openAccounts(${JSON.stringify(path)},{now:()=>${now}});console.log(JSON.stringify([r.forPrincipal(${JSON.stringify(alice)}).read(),r.forPrincipal(${JSON.stringify(bob)}).read()]));r.close();`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),expected);assert.equal(await readFile(legacy,'utf8'),'{"legacy":"must remain byte exact"}');
  }finally{await rm(d,{recursive:true,force:true});}
});

test('identity adapter fails closed for forged, expired, revoked and unavailable identity; no client identity trust',async()=>{
  let mode='valid',calls=0;const resolver=identityResolver({endpoint:'http://127.0.0.1:1/api/v1/me',issuer:'fixture-only',fetchImpl:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:1/api/v1/me');assert.equal(options.redirect,'error');assert.equal(options.method,'GET');if(mode==='offline')throw Error('offline');if(mode==='revoked')return new Response('{}',{status:401});if(mode==='oversize')return new Response('x'.repeat(16385));if(mode==='blocked')return Response.json({id:'alice',blocked:true});if(mode==='invalid')return Response.json({id:'../bob'});return Response.json({id:'alice'});}});
  const req={headers:{authorization:'Bearer fixture-token-alice-123', 'x-user-id':'bob'}};
  assert.deepEqual(await resolver(req),alice);assert.deepEqual(await resolver(req),alice);assert.equal(calls,2);
  for(mode of ['offline','revoked','oversize','blocked','invalid'])await assert.rejects(resolver(req));
  await assert.rejects(resolver({headers:{'x-user-id':'alice'}}));
  assert.throws(()=>identityResolver({endpoint:'http://remote.invalid/api/v1/me',issuer:'fixture'}));
});

test('authenticated HTTP separates all account routes, rejects account selectors/CSRF, shares quotes and blocks MOEX',async()=>{
  const d=await dir();let revoked=false,authReads=0,quoteReads=0;
  const authority=http.createServer((req,res)=>{authReads++;res.setHeader('Content-Type','application/json');const credential=req.headers.authorization;const subject=credential==='Bearer fixture-token-alice-123'?'alice':credential==='Bearer fixture-token-bob-12345'?'bob':null;if(revoked||!subject){res.statusCode=401;res.end('{}');}else res.end(JSON.stringify({id:subject}));});
  await new Promise(r=>authority.listen(0,'127.0.0.1',r));
  const authenticate=identityResolver({endpoint:`http://127.0.0.1:${authority.address().port}/api/v1/me`,issuer:'fixture-only'});
  const hub={metrics:{},catalogue:async()=>CATALOG,history:async()=>({candles:[]}),quote:async()=>{quoteReads++;return quote;}};
  const app=await createServer({port:0,accountsPath:join(d,'paper.sqlite'),authenticate,hub,now:()=>now,autoPoll:false});
  const base=`http://127.0.0.1:${app.port}/__stocks_global/`,auth={alice:'fixture-token-alice-123',bob:'fixture-token-bob-12345'};
  const get=(user,path='state')=>fetch(base+path,{headers:{Authorization:'Bearer '+auth[user]}});
  let a,b;const post=(user,token,path,body,extra={})=>fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+auth[user],'X-Stocks-Token':token,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  try{
    assert.equal((await fetch(base+'state')).status,401);assert.equal((await fetch(base+'state',{headers:{'X-User-Id':'alice'}})).status,401);
    a=await(await get('alice')).json();b=await(await get('bob')).json();assert.notEqual(a.account.id,b.account.id);assert.notEqual(a.token,b.token);
    assert.equal((await post('bob',a.token,'balances',{id:order(99).id,balances:{USDT:'1',USDC:'1'}})).status,422);
    assert.equal((await get('bob','state?accountId='+a.account.id)).status,422);
    assert.equal((await post('bob',b.token,'balances',{accountId:a.account.id})).status,422);
    assert.equal((await post('alice',a.token,'orders',order(1),{Origin:'https://evil.invalid'})).status,422);
    await Promise.all([post('alice',a.token,'refresh',{id}),post('bob',b.token,'refresh',{id})]);assert.equal(quoteReads,1);
    assert.equal((await post('alice',a.token,'orders',order(1))).status,200);
    assert.equal((await post('alice',a.token,'orders',order(2,{type:'LIMIT',limitPrice:'50'}))).status,200);
    assert.equal((await post('bob',b.token,'cancel',{id:order(2).id})).status,422);
    b=await(await get('bob')).json();assert.equal(b.orders.length,0);assert.equal(b.fills.length,0);assert.equal(b.wallets.USDT.cash,'10000.00000000');
    assert.equal((await post('alice',a.token,'orders',order(3,{instrumentId:'MOEX:TQBR:SBER'}))).status,422);
    assert.equal((await get('alice','history?id=MOEX%3ATQBR%3ASBER')).status,422);assert.equal(quoteReads,1);
    for(const path of ['/api/orders','/api/wallet/balance','/v1/orders','/admin/users'])assert.equal((await fetch(base.replace('/__stocks_global/','')+path,{method:'POST'})).status,404);
    assert.ok(authReads>=12);revoked=true;assert.equal((await get('alice')).status,401);assert.equal((await post('alice',a.token,'cancel',{id:order(2).id})).status,401);
  }finally{await app.close();await new Promise(r=>authority.close(r));await rm(d,{recursive:true,force:true});}
});
