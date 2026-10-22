import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.mjs';
import { CATALOG } from './catalog.mjs';

test('idle service does no provider work; polling projects selected/held interests and commits active orders',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-interest-'));let time=1800000000000,tick,catalogues=0,quotes=0;
  t.mock.method(globalThis,'setInterval',fn=>{tick=fn;return 123456;});
  const A='BYBIT:AAPLXUSDT',N='BYBIT:NVDAXUSDT';
  const hub={metrics:{},history:async()=>({candles:[]}),catalogue:async()=>{catalogues++;return CATALOG;},quote:async id=>{quotes++;return{instrumentId:id,provider:'bybit',nativeCurrency:'USDT',bid:'100',ask:'100',last:'100',timestamp:time,receivedAt:time,verified:true,marketOpen:true,eventId:String(time),capacity:'1.00000000',prices:{USDT:{buy:'100',sell:'100'}},fx:{}};}};
  const app=await createServer({port:0,accountsPath:join(dir,'paper.sqlite'),now:()=>time,hub,authenticate:async req=>({issuer:'fixture-only',subject:req.headers['x-fixture-user']})});
  const base=`http://127.0.0.1:${app.port}/__stocks_global/`,tokens={};
  const state=async(user,id)=>{const s=await(await fetch(base+'state'+(id?'?id='+encodeURIComponent(id):''),{headers:{'x-fixture-user':user}})).json();tokens[user]=s.token;return s;};
  const post=async(user,path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'x-fixture-user':user,'X-Stocks-Token':tokens[user],'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  const settle=async()=>{for(let n=0;n<10;n++)await new Promise(setImmediate);};
  try{
    await tick();await settle();assert.equal(catalogues,0);assert.equal(quotes,0);
    await state('alice',A);await state('bob',N);await state('carol',N);await state('dave',A);await settle();
    await post('carol','orders',{id:'carol-limit-111111111111',instrumentId:A,currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'90'});
    await post('dave','refresh',{id:A});await post('dave','orders',{id:'dave-buy-111111111111111',instrumentId:A,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'});await state('dave',N);await settle();
    const before=Object.fromEntries(await Promise.all(['alice','bob','carol','dave'].map(async user=>[user,(await state(user)).revision]))),commits=hub.metrics.accountQuoteCommits,observations=hub.metrics.accountQuoteObservations;
    time+=3000;await tick();await settle();
    const after=Object.fromEntries(await Promise.all(['alice','bob','carol','dave'].map(async user=>[user,await state(user)])));
    assert.equal(after.alice.revision,before.alice);assert.equal(after.bob.revision,before.bob);
    assert.equal(after.carol.revision,before.carol+1,'active AAPL limit still matches while another chart is selected');
    assert.equal(after.dave.revision,before.dave,'held AAPL mark is a read model, not a ledger mutation');
    assert.equal(after.alice.quotes[A].timestamp,time);assert.equal(after.dave.quotes[A].timestamp,time);
    assert.equal(after.dave.positions[A+'|USDT'].mark,'100');assert.equal(after.dave.positions[A+'|USDT'].unrealized,'0.00000000');
    assert.equal(hub.metrics.accountQuoteCommits-commits,1);assert.equal(hub.metrics.accountQuoteObservations-observations,2);assert.equal(after.bob.quotes[A],undefined);
    const idleCalls=quotes,idleCommits=hub.metrics.accountQuoteCommits;time+=12001;await tick();await settle();
    assert.equal(quotes,idleCalls);assert.equal(hub.metrics.accountQuoteCommits,idleCommits);
    // Existing contexts: a candle read neither updates quotes nor loads/writes a ledger.
    const history=await fetch(base+'history?id='+encodeURIComponent(A),{headers:{'x-fixture-user':'alice'}});assert.equal(history.status,200);
    assert.equal((await state('alice')).revision,after.alice.revision);assert.equal(hub.metrics.accountQuoteCommits,idleCommits);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
