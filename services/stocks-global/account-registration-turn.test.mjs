import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { getEventListeners } from 'node:events';
import { Worker } from 'node:worker_threads';
import { openAccountWorker } from './account-worker.mjs';
import { accountId } from './accounts.mjs';

const NOW=1791569400000,principal=subject=>({issuer:'registration-turn-fixture-only',subject});
const ALICE=principal('alice'),BOB=principal('bob');
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const release=control=>{Atomics.store(control,2,1);Atomics.notify(control,2);};
const arm=control=>{Atomics.store(control,0,1);Atomics.store(control,2,0);return Atomics.load(control,1);};
async function entered(control,previous){const until=Date.now()+5000;while(Atomics.load(control,1)<=previous){assert(Date.now()<until,'worker must reach the commit barrier');await delay(5);}}
function rows(path){const db=new DatabaseSync(path,{readOnly:true});try{return new Map(db.prepare('SELECT id,ledger FROM paper_accounts').all().map(row=>[row.id,JSON.parse(row.ledger)]));}finally{db.close();}}
async function fixture(t,options={}){
 const directory=await mkdtemp(join(tmpdir(),'stocks-registration-turn-')),path=join(directory,'paper.sqlite');
 const financial=new Int32Array(new SharedArrayBuffer(20)),registration=new Int32Array(new SharedArrayBuffer(20));
 const repos=[],open=async()=>{const repo=await openAccountWorker(path,{now:()=>NOW,diagnostics:true,...options,testHooks:{commitControl:financial.buffer,registrationControl:registration.buffer}});repos.push(repo);return repo;};
 const repo=await open();
 t.after(async()=>{release(financial);release(registration);for(const value of repos)await value.close();const target=resolve(directory),base=resolve(tmpdir())+sep;assert(target.startsWith(base)&&target.split(sep).at(-1).startsWith('stocks-registration-turn-'));await rm(target,{recursive:true,force:true});});
 return{repo,path,financial,registration,open};
}

test('idle same-turn50 owners use two existing bounded FULL groups without an early singleton ACK',async t=>{
 const f=await fixture(t),previous=arm(f.registration),owners=Array.from({length:50},(_,n)=>principal('owner-'+n));let acknowledged=0;
 const pending=Promise.all(owners.map(owner=>f.repo.forPrincipal(owner).then(account=>{acknowledged++;return account;})));pending.catch(()=>{});
 assert.equal(f.repo.metrics().queue.pending,50);assert.equal(f.repo.metrics().queue.active,0);
 await entered(f.registration,previous);
 assert.equal(acknowledged,0);assert.equal(rows(f.path).size,0);assert.equal(f.repo.metrics().queue.active,32);assert.equal(f.repo.metrics().queue.pending,18);
 release(f.registration);const handles=await pending;assert.equal(new Set(handles.map(h=>h.id)).size,50);
 const metrics=f.repo.metrics();assert.equal(metrics.sqlStages.commit.calls,2);assert.equal(metrics.sqlWriteCalls,50);assert.equal(metrics.queue.registrationGroups,2);assert.equal(metrics.queue.groupedRegistrations,50);assert.equal(metrics.queue.maxRegistrationGroup,32);assert.equal(metrics.queue.bytes,0);
 await f.repo.close();const restarted=await f.open();for(const owner of [owners[0],owners[49]])assert.equal((await(await restarted.forPrincipal(owner)).read()).wallets.USDT.cash,'10000.00000000');
});

test('single owner and funded reopen finish inside original admission deadline; replay cannot double-fill',async t=>{
 const f=await fixture(t),start=performance.now(),alice=await f.repo.forPrincipal(ALICE);assert(performance.now()-start<2500,'single owner must not wait for a full cohort');
 const quote={instrumentId:'BYBIT:AAPLXUSDT',provider:'bybit',nativeCurrency:'USDT',bid:'100',ask:'100',timestamp:NOW,receivedAt:NOW,verified:true,marketOpen:true,eventId:'turn-fixture-quote',capacity:'1.00000000',prices:{USDT:{buy:'100',sell:'100'}},fx:{}};
 const order={id:'turn-order-restart-00000001',instrumentId:quote.instrumentId,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1'};
 await alice.execute('quote',quote);await alice.execute('submit',order);const before=await alice.read();assert.equal(before.wallets.USDT.cash,'9990.00000000');
 await f.repo.close();const reopened=await f.open(),againStart=performance.now(),again=await reopened.forPrincipal(ALICE);assert(performance.now()-againStart<2500);
 assert.equal(reopened.metrics().sqlWriteCalls,0,'existing account admission must stay read-only');
 await again.execute('submit',order);const after=await again.read();assert.equal(after.wallets.USDT.cash,before.wallets.USDT.cash);assert.equal(after.fills.length,before.fills.length);assert.deepEqual(after.positions,before.positions);
 t.diagnostic('Single/reopened-owner deadline regressions use original2500ms; this unit check is not capacity acceptance.');
});

test('elapsed deadlines before the deferred turn reject every owner before any INSERT',async t=>{
 const f=await fixture(t,{queueTimeoutMs:1000}),originalNow=performance.now.bind(performance);let offset=0;t.mock.method(performance,'now',()=>originalNow()+offset);
 const pending=Promise.allSettled([f.repo.forPrincipal(ALICE),f.repo.forPrincipal(BOB)]);offset=1100;
 const outcomes=await pending;assert(outcomes.every(value=>value.status==='rejected'&&value.reason.code==='ACCOUNT_BUSY'));assert.equal(rows(f.path).size,0);assert.equal(f.repo.metrics().queue.timedOut,2);assert.equal(f.repo.metrics().queue.bytes,0);
});

test('a financial command between idle registrations remains a FIFO barrier',async t=>{
 const f=await fixture(t),alice=await f.repo.forPrincipal(ALICE),previous=arm(f.financial);
 const before=f.repo.forPrincipal(BOB),middle=alice.execute('balances',{id:'turn-fifo-balance-00000001',balances:{USDT:'12345',USDC:'10000'}});
 const later=[principal('carol'),principal('dave')],after=Promise.all(later.map(owner=>f.repo.forPrincipal(owner)));before.catch(()=>{});middle.catch(()=>{});after.catch(()=>{});
 await entered(f.financial,previous);const committed=rows(f.path);assert(committed.has(accountId(BOB)));assert(later.every(owner=>!committed.has(accountId(owner))));
 release(f.financial);await Promise.all([before,middle,after]);assert.equal((await alice.read()).wallets.USDT.cash,'12345.00000000');assert.equal(rows(f.path).size,4);
});

test('deferred registrations retain admission budgets; abort and close drain without orphan work',async t=>{
 const f=await fixture(t,{maxPending:3,maxQueueBytes:800}),alice=await f.repo.forPrincipal(ALICE);
 const first=f.repo.forPrincipal(BOB),second=f.repo.forPrincipal(principal('carol')),controller=new AbortController();
 const view=alice.execute('readView',undefined,{signal:controller.signal});view.catch(()=>{});
 await assert.rejects(f.repo.forPrincipal(principal('rejected')),error=>error.code==='ACCOUNT_BUSY');
 controller.abort();await assert.rejects(view,error=>error.code==='ACCOUNT_READ_ABORTED');assert.equal(getEventListeners(controller.signal,'abort').length,0);
 const close=f.repo.close();await Promise.all([first,second,close]);await new Promise(done=>setImmediate(done));
 assert.equal(f.repo.metrics().queue.maxPending,3);assert(f.repo.metrics().queue.maxBytes<=800);assert.equal(f.repo.metrics().queue.bytes,0);assert.equal(f.repo.metrics().workerAlive,0);assert.equal(rows(f.path).size,3);assert(!rows(f.path).has(accountId(principal('rejected'))));
 await assert.rejects(f.repo.forPrincipal(principal('after-close')),error=>error.code==='ACCOUNT_UNAVAILABLE');
});

test('worker loss before the admission turn rejects queued owners without creating them',async t=>{
 let worker;const originalOn=Worker.prototype.on;t.mock.method(Worker.prototype,'on',function(event,listener){worker=this;return originalOn.call(this,event,listener);});
 const f=await fixture(t),originalImmediate=globalThis.setImmediate;let deferred;
 // Hold the scheduler opportunity, not a transaction or its ACK. The real
 // worker exits while both registrations are still undispatched.
 t.mock.method(globalThis,'setImmediate',callback=>{deferred=callback;return originalImmediate(()=>{});});
 const pending=Promise.allSettled([f.repo.forPrincipal(ALICE),f.repo.forPrincipal(BOB)]);
 assert.equal(f.repo.metrics().queue.active,0);assert.equal(f.repo.metrics().queue.pending,2);
 await worker.terminate();const outcomes=await pending;
 assert(outcomes.every(result=>result.status==='rejected'&&result.reason.code==='ACCOUNT_UNAVAILABLE'));
 assert.equal(rows(f.path).size,0);assert.equal(f.repo.metrics().queue.bytes,0);assert.equal(f.repo.metrics().workerAlive,0);
 deferred();assert.equal(f.repo.metrics().queue.dispatched,0);assert.equal(rows(f.path).size,0);
});
