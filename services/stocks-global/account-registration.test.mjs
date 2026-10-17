import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccounts } from './accounts.mjs';
import { setBalances } from './engine.mjs';

const alice={issuer:'fixture-only',subject:'alice'};
const bob={issuer:'fixture-only',subject:'bob'};

test('reopening a funded account is read-only even while an independent writer holds its reservation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-registration-')),path=join(dir,'paper.sqlite');
  const repo=openAccounts(path,{diagnostics:true}),locker=new DatabaseSync(path);
  try{
    const original=repo.forPrincipal(alice),before=original.readState(),writes=repo.metrics().sqlWriteCalls;
    assert.equal(original.created,true);
    locker.exec('BEGIN IMMEDIATE');
    const reopened=repo.forPrincipal(alice);
    assert.equal(reopened.created,false);
    assert.deepEqual(reopened.readState(),before);
    assert.equal(repo.metrics().sqlWriteCalls,writes);
    assert.equal(repo.metrics().sqlStages.exists.calls,2);
    // An existing handle is not permission to bypass the writer lock for money.
    await assert.rejects(reopened.transact(state=>setBalances(state,{id:'fixture-adjustment-lock',balances:{USDT:'9',USDC:'8'}},Date.now())),/database is locked/);
    assert.deepEqual(reopened.readState(),before);
    locker.exec('ROLLBACK');
  }finally{try{locker.exec('ROLLBACK');}catch{}locker.close();repo.close();await rm(dir,{recursive:true,force:true});}
});

test('a missing account cannot receive a successful initialization ACK while its FULL insert is blocked',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-registration-')),path=join(dir,'paper.sqlite');
  const repo=openAccounts(path,{diagnostics:true}),locker=new DatabaseSync(path);
  try{
    repo.forPrincipal(alice);
    locker.exec('BEGIN IMMEDIATE');
    assert.throws(()=>repo.forPrincipal(bob),/database is locked/);
    assert.equal(locker.prepare('SELECT COUNT(*) AS count FROM paper_accounts').get().count,1);
    locker.exec('ROLLBACK');
    const created=repo.forPrincipal(bob);
    assert.equal(created.created,true);
    assert.equal(created.read().wallets.USDT.cash,'10000.00000000');
    assert.equal(repo.forPrincipal(bob).created,false);
    assert.equal(locker.prepare('SELECT COUNT(*) AS count FROM paper_accounts').get().count,2);
    assert.equal(locker.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  }finally{try{locker.exec('ROLLBACK');}catch{}locker.close();repo.close();await rm(dir,{recursive:true,force:true});}
});

test('registration never substitutes cached defaults for another writer or for a restarted account',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-registration-')),path=join(dir,'paper.sqlite');
  let repo=openAccounts(path,{now:()=>1791569400000,diagnostics:true});
  const other=openAccounts(path,{now:()=>1791569410000});
  try{
    const a=repo.forPrincipal(alice),createdAt=a.read().createdAt;
    const independent=other.forPrincipal(alice);
    assert.equal(independent.created,false);
    await independent.transact(state=>setBalances(state,{id:'fixture-adjustment-state',balances:{USDT:'250',USDC:'700'}},1791569410000));
    const committed=independent.readState();
    assert.equal(repo.forPrincipal(alice).created,false);
    assert.deepEqual(a.readState(),committed);
    repo.close();repo=openAccounts(path,{now:()=>1791569420000,diagnostics:true});
    const restarted=repo.forPrincipal(alice);
    assert.equal(restarted.created,false);
    assert.equal(restarted.read().createdAt,createdAt);
    assert.deepEqual(restarted.readState(),committed);
    assert.equal(repo.metrics().sqlWriteCalls,0);
    assert.equal(repo.forPrincipal(bob).read().wallets.USDT.cash,'10000.00000000');
    assert.equal(restarted.read().wallets.USDT.cash,'250.00000000');
  }finally{other.close();repo.close();await rm(dir,{recursive:true,force:true});}
});
