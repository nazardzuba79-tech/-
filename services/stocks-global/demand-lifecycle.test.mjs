import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from './server.mjs';
import {CATALOG} from './catalog.mjs';
const ID='BYBIT:AAPLXUSDT',NOW=1791849600000;
async function fixture(t,accountWorkerOptions={}){
 const dir=await mkdtemp(join(tmpdir(),'stocks-demand-'));let time=NOW,price=100,calls=0,releaseQuote,quoteTime,authWait,authCalls=0;
 const app=await createServer({ financialEnabled: true,port:0,accountsPath:join(dir,'paper.sqlite'),accountWorkerOptions,ownerOnlyMode:true,tradeOwnerSubject:'alice',now:()=>time,autoPoll:true,
 authenticate:async req=>{authCalls++;if(authWait)await authWait;return{issuer:'demand-fixture',subject:req.headers.authorization==='Bearer synthetic-test-bob'?'bob':'alice'};},
 hub:{metrics:{},catalogue:async()=>CATALOG,history:async()=>({candles:[]}),quote:async id=>{calls++;if(releaseQuote)await releaseQuote;return{instrumentId:id,provider:'bybit',nativeCurrency:'USDT',timestamp:quoteTime??time,receivedAt:time,verified:true,marketOpen:true,eventId:'event-'+time,capacity:'1.00000000',bid:String(price),ask:String(price),prices:{USDT:{buy:String(price),sell:String(price)}},fx:{}};} }});
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.port+'/__stocks_global/';let token;
 const send=async(route,body,method,options={})=>{const res=await fetch(base+route,{method:method||(body?'POST':'GET'),headers:{'Authorization':'Bearer synthetic-test-user','X-Stocks-Token':token||'','Content-Type':'application/json',...options.headers},...(body?{body:JSON.stringify(body)}:{}),signal:options.signal??AbortSignal.timeout(5000)});const data=await res.json();if(data.token)token=data.token;return{status:res.status,data};};
 await send('state');return{send,app,calls:()=>calls,authCalls:()=>authCalls,holdAuth:()=>{let resume;authWait=new Promise(r=>{resume=r;});return()=>{resume();authWait=null;};},oldQuote:()=>{quoteTime=time;},hold:()=>{let resume;releaseQuote=new Promise(r=>{resume=r;});return()=>{resume();releaseQuote=null;};},advance:(ms,next=price)=>{time+=ms;price=next;}};
}
test('owner review has no autonomous provider work after HTTP demand stops',async t=>{
 const f=await fixture(t);await f.send('state?id='+encodeURIComponent(ID));
 await new Promise(r=>setTimeout(r,100));const before=f.calls();
 await new Promise(r=>setTimeout(r,3200));
 assert.equal(f.calls(),before,'closing the chart must not leave a hidden quote poller');
});
test('Wallet values only held stocks on demand without executing pending limit orders',async t=>{
 const f=await fixture(t);await f.send('refresh',{id:ID});
 const buy={id:'demand-buy-order-0001',instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.5'};
 assert.equal((await f.send('orders',buy)).status,200);
 const pending={...buy,id:'demand-limit-order-01',type:'LIMIT',quantity:'0.1',limitPrice:'120'};
 assert.equal((await f.send('orders',pending)).status,200);
 f.advance(5000,110);const before=await f.send('state'),calls=f.calls(),view=await f.send('portfolio');
 assert.equal(view.status,200,'dedicated read-only portfolio route exists');
 assert.equal(view.data.positions[ID+'|USDT'].mark,'110');
 assert.equal(f.calls()-calls,1,'only the held instrument needs a quote');
 const after=await f.send('state');
 assert.deepEqual(after.data.orders,before.data.orders,'Wallet read cannot fill a limit');
 assert.deepEqual(after.data.wallets,before.data.wallets);
 assert.equal('orders' in view.data,false,'portfolio does not transport the complete ledger');
});
test('authenticated chart release ends admission for cached quotes until fresh demand',async t=>{
 const f=await fixture(t);await f.send('refresh',{id:ID});
 assert.equal((await f.send('lease?id='+encodeURIComponent(ID),undefined,'DELETE')).status,200);
 const buy={id:'demand-after-exit-01',instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'};
 assert.equal((await f.send('orders',buy)).status,422);
 assert.equal((await f.send('state')).data.fills.length,0);
});

test('lease expiry blocks orders even while the old quote is younger than 30 seconds',async t=>{
 const f=await fixture(t);await f.send('refresh',{id:ID});f.advance(12001);
 const r=await f.send('orders',{id:'expired-lease-0001',instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'});
 assert.equal(r.status,422);assert.equal((await f.send('state')).data.fills.length,0);
});
test('resuming chart cannot execute a limit using a cached pre-resume event',async t=>{
 const f=await fixture(t);await f.send('refresh',{id:ID});
 await f.send('orders',{id:'resume-limit-0001',instrumentId:ID,currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'120'});
 await f.send('lease?id='+encodeURIComponent(ID),undefined,'DELETE');
 f.oldQuote();f.advance(5000,110);await f.send('state?id='+encodeURIComponent(ID));
 const state=await f.send('state');assert.equal(state.data.fills.length,0);assert.equal(state.data.errors[ID],'QUOTE_STALE');
});
test('disconnect while a quote is in flight cannot execute a pending limit',async t=>{
 const f=await fixture(t);await f.send('refresh',{id:ID});
 await f.send('orders',{id:'abort-limit-00001',instrumentId:ID,currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'120'});
 f.advance(5000,110);const resume=f.hold(),abort=new AbortController(),calls=f.calls();
 const read=f.send('state?id='+encodeURIComponent(ID),undefined,'GET',{signal:abort.signal}).catch(()=>null);
 while(f.calls()===calls)await new Promise(r=>setTimeout(r,5));
 abort.abort();await read;await new Promise(r=>setTimeout(r,30));resume();await new Promise(r=>setTimeout(r,30));
 assert.equal((await f.send('state')).data.fills.length,0);
});
test('release from a previous visit cannot close the current same-instrument visit',async t=>{
 const f=await fixture(t);await f.send('state?id='+encodeURIComponent(ID),undefined,'GET',{headers:{'X-Stocks-View':'visit-old'}});
 f.advance(3000);await f.send('state?id='+encodeURIComponent(ID),undefined,'GET',{headers:{'X-Stocks-View':'visit-new'}});
 await f.send('lease?id='+encodeURIComponent(ID),undefined,'DELETE',{headers:{'X-Stocks-View':'visit-old'}});
 const buy=await f.send('orders',{id:'current-visit-001',instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'});
 assert.equal(buy.status,200);assert.equal(buy.data.fills.length,1);
});

test('Wallet closed during identity verification starts no later quote request',async t=>{
 const f=await fixture(t);await f.send('refresh',{id:ID});
 await f.send('orders',{id:'close-wallet-buy-01',instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'});
 f.advance(5000);const resume=f.holdAuth(),before=f.calls(),auth=f.authCalls(),abort=new AbortController();
 const pending=f.send('portfolio',undefined,'GET',{signal:abort.signal}).catch(()=>null);
 while(f.authCalls()===auth)await new Promise(r=>setTimeout(r,5));
 abort.abort();await pending;await new Promise(r=>setTimeout(r,30));resume();await new Promise(r=>setTimeout(r,30));
 assert.equal(f.calls(),before);
});
test('Wallet quote deadline retains holdings with unavailable marks and no retries',async t=>{
 const f=await fixture(t);await f.send('refresh',{id:ID});
 await f.send('orders',{id:'slow-wallet-buy-01',instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'});
 f.advance(5000);const resume=f.hold(),before=f.calls(),started=performance.now();
 const view=await f.send('portfolio');resume();
 assert.equal(view.status,200);assert.ok(performance.now()-started<3000);
 assert.equal(view.data.positions[ID+'|USDT'].quantity,'0.10000000');
 assert.equal(view.data.positions[ID+'|USDT'].mark,null);assert.equal(view.data.errors[ID],'SOURCE_BUSY');
 assert.equal(f.calls(),before+1);
});

test('nonowner quote-on-open uses one shared flight and never runs any account matcher',async t=>{
 const f=await fixture(t);await f.send('refresh',{id:ID});
 await f.send('orders',{id:'owner-limit-view-01',instrumentId:ID,currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'120'});
 f.advance(5000,110);const before=(await f.send('state')).data,calls=f.calls();
 const headers={Authorization:'Bearer synthetic-test-bob'};
 const views=await Promise.all(Array.from({length:5},()=>f.send('state?id='+encodeURIComponent(ID),undefined,'GET',{headers})));
 for(const view of views){
  assert.equal(view.status,200);assert.equal(view.data.account.canTrade,false);
  assert.equal(view.data.quotes[ID]?.prices.USDT.sell,'110','nonowner receives the current quote without a financial observation');
  assert.equal(view.data.fills.length,0);assert.equal(view.data.orders.length,0);
 }
 assert.equal(f.calls(),calls+1,'identical viewers share provider work');
 const after=(await f.send('state')).data;assert.deepEqual(after.orders,before.orders);assert.deepEqual(after.wallets,before.wallets);assert.equal(after.fills.length,0);
});

test('disconnecting explicit refresh cannot admit a late quote to the limit matcher',async t=>{
 const f=await fixture(t);await f.send('refresh',{id:ID});
 await f.send('orders',{id:'abort-refresh-0001',instrumentId:ID,currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'120'});
 f.advance(5000,110);const resume=f.hold(),abort=new AbortController(),calls=f.calls();
 const read=f.send('refresh',{id:ID},'POST',{signal:abort.signal}).catch(()=>null);
 while(f.calls()===calls)await new Promise(r=>setTimeout(r,5));
 abort.abort();await read;await new Promise(r=>setTimeout(r,30));resume();await new Promise(r=>setTimeout(r,30));
 const state=(await f.send('state')).data;assert.equal(state.fills.length,0);assert.equal(state.orders[0].status,'OPEN');
});

test('an old durable observation acknowledgement cannot admit orders into a new visit',async t=>{
 const control=new Int32Array(new SharedArrayBuffer(5*Int32Array.BYTES_PER_ELEMENT));
 const f=await fixture(t,{testHooks:{commitControl:control.buffer}});
 await f.send('refresh',{id:ID});
 await f.send('orders',{id:'old-ack-limit-001',instrumentId:ID,currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'120'});
 f.advance(5000,110);const commits=Atomics.load(control,1);Atomics.store(control,0,1);Atomics.store(control,2,0);
 const old=f.send('refresh',{id:ID});
 const deadline=Date.now()+2000;while(Atomics.load(control,1)===commits&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
 assert.ok(Atomics.load(control,1)>commits,'old observation reached the durable transaction');
 await f.send('lease?id='+encodeURIComponent(ID),undefined,'DELETE');
 f.advance(5000);const resume=f.hold(),calls=f.calls();
 const current=f.send('state?id='+encodeURIComponent(ID),undefined,'GET',{headers:{'X-Stocks-View':'new-visit'}});
 while(f.calls()===calls)await new Promise(r=>setTimeout(r,5));
 Atomics.store(control,2,1);Atomics.notify(control,2);await old;
 const order=await f.send('orders',{id:'new-visit-market-1',instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'});
 resume();await current;assert.equal(order.status,422,'new visit needs its own fresh acknowledgement');
 const state=(await f.send('state')).data;assert.equal(state.orders.length,1);assert.equal(state.fills.length,1,'accepted old atomic fill is preserved');
});

test('lease release drops an undispatched observation but preserves the blocking financial commit',async t=>{
 const control=new Int32Array(new SharedArrayBuffer(5*Int32Array.BYTES_PER_ELEMENT));
 const f=await fixture(t,{testHooks:{commitControl:control.buffer}});
 await f.send('refresh',{id:ID});
 const order={instrumentId:ID,currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'120'};
 await f.send('orders',{...order,id:'queued-first-0001'});
 const commits=Atomics.load(control,1);Atomics.store(control,0,1);Atomics.store(control,2,0);
 const blocker=f.send('orders',{...order,id:'queued-blocker-01',limitPrice:'50'});
 const deadline=Date.now()+2000;while(Atomics.load(control,1)===commits&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
 assert.ok(Atomics.load(control,1)>commits);
 f.advance(5000,110);const calls=f.calls(),observation=f.send('refresh',{id:ID});
 while(f.calls()===calls)await new Promise(r=>setTimeout(r,5));
 const queuedUntil=Date.now()+1000;while(f.app.accountMetrics().queue.pending===0&&Date.now()<queuedUntil)await new Promise(r=>setTimeout(r,5));
 assert.equal(f.app.accountMetrics().queue.pending,1,'observation is queued and undispatched');
 await f.send('lease?id='+encodeURIComponent(ID),undefined,'DELETE');
 Atomics.store(control,2,1);Atomics.notify(control,2);await blocker;await observation;
 const state=(await f.send('state')).data;
 assert.equal(state.orders.length,2,'accepted blocking financial command commits');
 assert.equal(state.fills.length,0,'undispatched quote must not fill after release');
});
