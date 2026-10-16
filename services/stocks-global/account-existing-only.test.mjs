import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAccounts, accountId } from './accounts.mjs';
import { openAccountWorker } from './account-worker.mjs';
import { createState, applyQuote, submit, snapshot } from './engine.mjs';

// Explicitly synthetic persisted test accounts, never production identities,
// source quotes, or default registration balances.
const NOW=1791569400000,ID='BYBIT:AAPLXUSDT';
const ALICE={issuer:'existing-only-fixture',subject:'alice'};
const BOB={issuer:'existing-only-fixture',subject:'bob'};
const quote={instrumentId:ID,provider:'bybit',nativeCurrency:'USDT',bid:'100',ask:'100',timestamp:NOW,receivedAt:NOW,verified:true,marketOpen:true,eventId:'existing-only-fixture-quote',capacity:'1.00000000',prices:{USDT:{buy:'100',sell:'100'}},fx:{}};
const order=(suffix,extra={})=>({id:`existing-only-request-${suffix}`,instrumentId:ID,currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1',...extra});

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'stocks-existing-only-')),path=join(dir,'accounts.sqlite'),repos=[];
  const initialized=openAccounts(path);initialized.close();
  t.after(async()=>{for(const repo of repos)await repo.close();await rm(dir,{recursive:true,force:true});});
  const dbCall=run=>{const db=new DatabaseSync(path);try{return run(db);}finally{db.close();}};
  const stored=()=>dbCall(db=>db.prepare('SELECT id,ledger FROM paper_accounts ORDER BY id').all());
  const seed=(principal,cash,withHistory=false)=>{
    const state=createState(NOW);state.wallets.USDT.cash=cash;state.wallets.USDC.cash='0.00000000';
    if(withHistory){applyQuote(state,quote,NOW);submit(state,order('retained-buy'),NOW);submit(state,order('retained-limit',{type:'LIMIT',limitPrice:'50'}),NOW);state.revision=7;}
    dbCall(db=>db.prepare('INSERT INTO paper_accounts(id,ledger) VALUES (?,?)').run(accountId(principal),JSON.stringify(state)));
    return state;
  };
  return {path,stored,seed,remove:principal=>dbCall(db=>db.prepare('DELETE FROM paper_accounts WHERE id=?').run(accountId(principal))),
    direct:()=>{const repo=openAccounts(path,{now:()=>NOW,diagnostics:true});repos.push(repo);return repo;},
    worker:async()=>{const repo=await openAccountWorker(path,{now:()=>NOW,diagnostics:true});repos.push(repo);return repo;}};
}

test('existing-only direct binding fails without creating or writing an absent ledger',async t=>{
  const f=await fixture(t),repo=f.direct(),before=repo.metrics();
  assert.throws(()=>repo.forPrincipal(ALICE,{existingOnly:true}),/ACCOUNT_NOT_BOUND/);
  assert.deepEqual(f.stored(),[]);
  assert.equal(repo.metrics().sqlWriteCalls,before.sqlWriteCalls);
  assert.equal(repo.metrics().transactionExecCalls,before.transactionExecCalls);
});

test('existing-only direct bindings preserve different nonstandard balances and complete prior ledgers',async t=>{
  const f=await fixture(t),alice=f.seed(ALICE,'321.12500000',true),bob=f.seed(BOB,'765.87500000'),before=f.stored(),repo=f.direct();
  const a=repo.forPrincipal(ALICE,{existingOnly:true}),b=repo.forPrincipal(BOB,{existingOnly:true});
  assert.equal(a.created,false);assert.equal(b.created,false);
  assert.deepEqual(a.readState(),alice);assert.deepEqual(b.readState(),bob);
  assert.deepEqual(a.read(),snapshot(alice,NOW));assert.deepEqual(b.read(),snapshot(bob,NOW));
  assert.equal(a.read().wallets.USDT.reserved,'5.00000000');
  assert.equal(a.read().fills.length,1);assert.equal(a.read().orders.length,2);
  assert.deepEqual(f.stored(),before,'binding and reading do not rewrite persisted bytes');
  assert.equal(repo.metrics().sqlWriteCalls,0);
});

test('existing-only identity includes issuer and does not bind the same subject from another authority',async t=>{
  const f=await fixture(t);f.seed(ALICE,'321.12500000');const before=f.stored(),repo=f.direct();
  assert.throws(()=>repo.forPrincipal({...ALICE,issuer:'other-fixture-authority'},{existingOnly:true}),/ACCOUNT_NOT_BOUND/);
  assert.deepEqual(f.stored(),before);
});

test('existing-only direct handle cannot recreate a removed account on read or transaction',async t=>{
  const f=await fixture(t);f.seed(ALICE,'321.12500000');const repo=f.direct(),a=repo.forPrincipal(ALICE,{existingOnly:true});
  f.remove(ALICE);const writes=repo.metrics().sqlWriteCalls;let called=false;
  assert.throws(()=>a.read(),/ACCOUNT_NOT_BOUND/);
  assert.throws(()=>a.readState(),/ACCOUNT_NOT_BOUND/);
  await assert.rejects(a.transact(()=>{called=true;}),/ACCOUNT_NOT_BOUND/);
  assert.equal(called,false);assert.equal(repo.metrics().sqlWriteCalls,writes);assert.deepEqual(f.stored(),[]);
});

test('worker restricted registrations never join default-funded registration batches',async t=>{
  const f=await fixture(t),repo=await f.worker(),legacy={issuer:'legacy-fixture',subject:'legacy'};
  const results=await Promise.allSettled([
    repo.forPrincipal(ALICE,{existingOnly:true}),repo.forPrincipal(legacy),repo.forPrincipal(BOB,{existingOnly:true}),
  ]);
  assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.code,'ACCOUNT_NOT_BOUND');
  assert.equal(results[1].status,'fulfilled');assert.equal(results[2].status,'rejected');assert.equal(results[2].reason.code,'ACCOUNT_NOT_BOUND');
  assert.deepEqual(f.stored().map(row=>row.id),[accountId(legacy)]);
  assert.equal((await results[1].value.read()).wallets.USDT.cash,'10000.00000000','legacy API remains unchanged');
  assert.equal(repo.metrics().queue.registrationGroups,0);
});

test('existing-only worker preserves both accounts, history, reserves and state across restart',async t=>{
  const f=await fixture(t),alice=f.seed(ALICE,'321.12500000',true),bob=f.seed(BOB,'765.87500000'),before=f.stored();
  const repo=await f.worker(),a=await repo.forPrincipal(ALICE,{existingOnly:true}),b=await repo.forPrincipal(BOB,{existingOnly:true});
  assert.deepEqual(await a.read(),snapshot(alice,NOW));assert.deepEqual(await b.read(),snapshot(bob,NOW));
  await assert.rejects(repo.forPrincipal({...ALICE,issuer:'other-fixture-authority'},{existingOnly:true}),/ACCOUNT_NOT_BOUND/);
  assert.deepEqual(f.stored(),before);assert.equal(repo.metrics().sqlWriteCalls,0);
  await repo.close();const restarted=await f.worker();
  assert.deepEqual(await (await restarted.forPrincipal(ALICE,{existingOnly:true})).read(),snapshot(alice,NOW));
  assert.deepEqual(await (await restarted.forPrincipal(BOB,{existingOnly:true})).read(),snapshot(bob,NOW));
  assert.deepEqual(f.stored(),before);assert.equal(restarted.metrics().sqlWriteCalls,0);
});

test('worker existing-only commands retain atomic idempotent trading in the bound account',async t=>{
  const f=await fixture(t);f.seed(ALICE,'321.12500000');f.seed(BOB,'765.87500000');
  const repo=await f.worker(),a=await repo.forPrincipal(ALICE,{existingOnly:true}),b=await repo.forPrincipal(BOB,{existingOnly:true});
  await a.execute('quote',quote);const intent=order('one-intent');
  await a.execute('submit',intent);await a.execute('submit',intent);
  const first=await a.read();assert.equal(first.wallets.USDT.cash,'311.12500000');assert.equal(first.orders.length,1);assert.equal(first.fills.length,1);
  assert.equal((await b.read()).wallets.USDT.cash,'765.87500000');assert.equal((await b.read()).orders.length,0);
  await repo.close();const restarted=await f.worker(),restored=await restarted.forPrincipal(ALICE,{existingOnly:true});
  assert.deepEqual(await restored.read(),first);
});

test('worker cached legacy handle and command options cannot bypass a removed existing-only binding',async t=>{
  const f=await fixture(t);f.seed(ALICE,'321.12500000');const repo=await f.worker();
  await repo.forPrincipal(ALICE);const a=await repo.forPrincipal(ALICE,{existingOnly:true});f.remove(ALICE);
  const before=repo.metrics();
  await assert.rejects(a.read(),/ACCOUNT_NOT_BOUND/);
  await assert.rejects(a.execute('readView',undefined,{existingOnly:false}),/ACCOUNT_NOT_BOUND/);
  await assert.rejects(a.execute('quote',quote,{existingOnly:false}),/ACCOUNT_NOT_BOUND/);
  await assert.rejects(a.execute('balances',{id:'existing-only-reset-attempt',balances:{USDT:'9000',USDC:'9000'}},{existingOnly:false}),/ACCOUNT_NOT_BOUND/);
  await assert.rejects(repo.forPrincipal(ALICE,{existingOnly:true}),/ACCOUNT_NOT_BOUND/);
  assert.deepEqual(f.stored(),[]);assert.equal(repo.metrics().sqlWriteCalls,before.sqlWriteCalls);
  assert.equal(repo.metrics().transactionExecCalls,before.transactionExecCalls);
});
