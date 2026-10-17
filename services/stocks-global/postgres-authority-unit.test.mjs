// LOGIC UNIT TESTS ONLY. SQLite dialect shim deliberately removes PG row locks.
// These tests cannot qualify PostgreSQL concurrency or real session revocation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openPostgresAuthority, exactAuthorityAmount,authorityProjection } from './postgres-authority.mjs';

const NOW=1791569400000,ISSUER='pg-logic-unit-fixture',A={issuer:ISSUER,subject:'synthetic-a',userId:'synthetic-a',sessionId:'synthetic-session-a',expiresAt:NOW+60000},B={issuer:ISSUER,subject:'synthetic-b',userId:'synthetic-b',sessionId:'synthetic-session-b',expiresAt:NOW+60000};
function database(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE "User"(id TEXT PRIMARY KEY,blockedAt TEXT);CREATE TABLE "Session"(id TEXT PRIMARY KEY,userId TEXT,revokedAt TEXT);
    CREATE TABLE "DemoBalance"(id TEXT PRIMARY KEY,userId TEXT,asset TEXT,available TEXT,locked TEXT,updatedAt TEXT);
    CREATE TABLE "StocksTestAccount"(principalHash TEXT PRIMARY KEY,issuer TEXT,subject TEXT,userId TEXT UNIQUE,revision INTEGER,ledger TEXT,updatedAt TEXT);
    CREATE TABLE "StocksTestReceipt"(principalHash TEXT,intentId TEXT,payloadHash TEXT,revision INTEGER,receipt TEXT,PRIMARY KEY(principalHash,intentId));
    CREATE TABLE "StocksTestAudit"(principalHash TEXT,intentId TEXT,userId TEXT,sessionId TEXT,kind TEXT,revision INTEGER,payloadHash TEXT,PRIMARY KEY(principalHash,intentId));`);
  for(const actor of [A,B]){db.prepare('INSERT INTO User VALUES(?,NULL)').run(actor.userId);db.prepare('INSERT INTO Session VALUES(?,?,NULL)').run(actor.sessionId,actor.userId);db.prepare('INSERT INTO DemoBalance VALUES(?,?,\'USDT\',?,\'0\',NULL)').run('cash-'+actor.userId,actor.userId,actor===A?'731.25':'129.875');}
  const query=(text,params)=>{
    const values=[];const statement=text.replace(/ FOR (?:NO KEY UPDATE|UPDATE)(?: OF a,d)?/g,'').replace(/::(?:text|numeric|jsonb)/g,'').replace(/\$(\d+)/g,(_,index)=>{values.push(params[Number(index)-1]);return '?';});
    return {statement,values};
  };
  const client={
    async $queryRawUnsafe(text,...params){const {statement,values}=query(text,params);return db.prepare(statement).all(...values);},
    async $executeRawUnsafe(text,...params){const {statement,values}=query(text,params);return Number(db.prepare(statement).run(...values).changes);},
    async $transaction(work){db.exec('BEGIN');try{const result=await work(client);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
  };
  const rows=()=>Object.fromEntries(['DemoBalance','StocksTestAccount','StocksTestReceipt','StocksTestAudit'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  return {db,client,rows};
}
const order=id=>({order:{id,instrumentId:'BYBIT:AAPLXUSDT',currency:'USDT',side:'BUY',type:'LIMIT',quantity:'0.1',limitPrice:'90'},sourceBlocked:false});
async function fixture(t,hooks={}){const f=database();t.after(()=>f.db.close());let time=NOW;const authority=openPostgresAuthority(f.client,{issuer:ISSUER,tradePrincipals:[A,B],now:()=>time,...hooks});await authority.bindExisting(A);await authority.bindExisting(B);return{...f,authority,advance:ms=>time+=ms};}

test('PG authority logic: exact decimal projection rejects nonrepresentable dust',()=>{assert.equal(exactAuthorityAmount('731.250000000000000000'),'731.25000000');assert.throws(()=>exactAuthorityAmount('0.000000001'),/CASH_PRECISION_UNSUPPORTED/);});
test('PG authority logic: existing18-place Wallet remainder is preserved rather than spent or rounded',()=>{const view=authorityProjection('731.250000001234567890','9.000000000000000001','9');assert.equal(view.cash,'740.25000000');assert.equal(view.dust,'0.000000001234567890');assert.equal(view.available18,731250000001234567890n);assert.equal(view.locked18,9000000000000000001n);});
test('PG authority logic: explicit binding creates no cash, read and denied viewer never seed',async t=>{
  const f=await fixture(t),before=f.rows();assert.equal(before.DemoBalance.length,2);assert.equal((await f.authority.execute(A,'readView')).wallets.USDT.cash,'731.25000000');
  assert.throws(()=>f.authority.execute({...A,subject:'viewer',userId:'viewer'},'submitObserved',order('logic-viewer-order-01')),/AUTH_REQUIRED/);assert.deepEqual(f.rows(),before);
});
test('PG authority logic: cancel and transient sourceBlocked replay preserve one receipt and one reserve',async t=>{
  const f=await fixture(t),input=order('logic-replay-order-01');const first=await f.authority.execute(A,'submitObserved',input);const before=f.rows();
  const replay=await f.authority.execute(A,'submitObserved',{...input,sourceBlocked:true});assert.deepEqual(replay.receipt,first.receipt);assert.deepEqual(f.rows(),before);
  const cancelled=await f.authority.execute(A,'cancel',{id:input.order.id});assert.equal(cancelled.snapshot.wallets.USDT.reserved,'0.00000000');assert.equal((await f.authority.execute(B,'readView')).wallets.USDT.cash,'129.87500000');
});
test('PG authority logic: expiry before commit rolls back cash, state, receipt and audit',async t=>{
  let expire=()=>{};const f=await fixture(t,{beforeCommit:()=>expire()});const before=f.rows();expire=()=>f.advance(61000);
  await assert.rejects(f.authority.execute(A,'submitObserved',order('logic-expiry-order-01')),/AUTH_REQUIRED/);assert.deepEqual(f.rows(),before);
});
test('PG authority logic: queued input is snapshotted before admission waits',async t=>{
  let release;const hold=new Promise(resolve=>{release=resolve;});let calls=0;const f=await fixture(t,{beforeCommit:()=>++calls===1?hold:undefined});
  const first=f.authority.execute(A,'submitObserved',order('logic-queue-first-01'));await new Promise(resolve=>setImmediate(resolve));
  const input=order('logic-queue-second-01'),second=f.authority.execute(A,'submitObserved',input);input.order.quantity='1';release();await first;const result=await second;
  assert.equal(result.result.quantity,'0.10000000');assert.equal(result.snapshot.wallets.USDT.reserved,'18.00000000');
});

test('PG authority logic: a completed command releases its admission slot before its ACK',async t=>{
  const f=database();t.after(()=>f.db.close());const authority=openPostgresAuthority(f.client,{issuer:ISSUER,tradePrincipals:[A,B],now:()=>NOW,maxPending:1});await authority.bindExisting(A);
  await authority.execute(A,'readView');assert.equal(authority.metrics().pending,0);
  await authority.execute(A,'readView');assert.equal(authority.metrics().pending,0);
});
