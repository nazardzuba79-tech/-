import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptEvent, message, validEvent, Delivery } from './src/core.js';
const now=Date.now(),tx='ab'.repeat(32);
const proof=(extra={})=>({eventId:'native-proof',eventType:'DEPOSIT_DISCOVERED',timestamp:now,asset:'TRX',network:'TRON_NATIVE',amount:'12.345678',txHash:tx,
  confirmations:19,requiredConfirmations:19,finalized:true,proofStatus:'VERIFIED',...extra});
const copy=(extra={})=>({eventId:'copy-trx',eventType:'DEPOSIT_ADDRESS_COPIED',timestamp:now,asset:'TRX',network:'tron',networkLabel:'TRON (Native)',...extra});
test('TRX proof is native and USDT remains TRC-20; no credit or threshold is invented',()=>{
 assert.equal(validEvent(proof(),'DEPOSIT_DISCOVERED',now),true);
 assert.match(message(proof()),/^Нове надходження: 12\.345678 TRX/);
 assert.match(message(proof()),/TRON \(Native\)/);assert.match(message(proof()),new RegExp('TXID: '+tx));
 assert.match(message(proof()),/Підтвердження: 19/);assert.doesNotMatch(message(proof()),/USDT|зараховано|мінімум.*USDT/);
 assert.match(message(proof({asset:'USDT',network:'TRC20'})),/12\.345678 USDT/);
 assert.doesNotMatch(message(proof({asset:'USDT',network:'TRC20'})),/TRX|Native/);
});
test('copy is explicitly not a deposit and never trusts a wrong TRON display label',()=>{
 assert.match(message(copy({networkLabel:'TRON (TRC-20)'})),/НЕ поповнення[\s\S]*TRX[\s\S]*TRON \(Native\)/);
 assert.doesNotMatch(message(copy()),/Нове надходження|TXID|Підтвердження/);
 assert.match(message(copy({asset:'USDT'})),/USDT[\s\S]*TRON \(TRC-20\)/);
});
for(const patch of [{finalized:false},{proofStatus:'PENDING'},{confirmations:18},{txHash:undefined},{network:'TRC20'},{asset:'USDT'},{amount:'0'},{requiredConfirmations:0}])test('unproven or mismatched proof cannot send '+JSON.stringify(patch),async()=>{
 let calls=0;const env={TELEGRAM_BOT_TOKEN:'fixture',TELEGRAM_CHAT_ID:'fixture',EVENTS:{idFromName(){calls++;throw Error('must reject before durable object');}}};
 assert.equal((await acceptEvent(proof(patch),'DEPOSIT_DISCOVERED',env)).status,400);assert.equal(calls,0);
});
test('copy payload cannot smuggle chain proof or a balance instruction',async()=>{
 const env={TELEGRAM_BOT_TOKEN:'fixture',TELEGRAM_CHAT_ID:'fixture'};
 assert.equal((await acceptEvent(copy({txHash:tx,amount:'12'}),'DEPOSIT_ADDRESS_COPIED',env)).status,400);
 assert.equal((await acceptEvent(proof({credit:true}),'DEPOSIT_DISCOVERED',env)).status,400);
});
test('native proof repeat and process restart send exactly once and retain no financial payload',async()=>{
 let record,alarm,calls=0,lock=Promise.resolve();const storage={get:async()=>record,put:async(_,v)=>{record=structuredClone(v);},setAlarm:async v=>{alarm=v;},transaction:fn=>{const p=lock.then(()=>fn(storage));lock=p.catch(()=>{});return p;}};
 const send=async(_url,init)=>{calls++;assert.match(JSON.parse(init.body).text,/TRX/);return Response.json({ok:true,result:{message_id:41}});};
 const request=()=>new Request('https://internal/event',{method:'POST',body:JSON.stringify(proof())});
 const d=new Delivery({storage},{TELEGRAM_BOT_TOKEN:'fixture',TELEGRAM_CHAT_ID:'fixture'},send,()=>now);
 await Promise.all(Array.from({length:10},()=>d.fetch(request())));
 const restarted=new Delivery({storage},d.env,send,()=>now);assert.equal((await(await restarted.fetch(request())).json()).deliveryStatus,'SENT');
 assert.equal(calls,1);assert.deepEqual(Object.keys(record).sort(),['eventId','eventType','status','timestamp']);assert.ok(alarm>now);
});
