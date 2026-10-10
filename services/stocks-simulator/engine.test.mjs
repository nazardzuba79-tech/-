import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createState, configure, setTestBalances, submit, cancel, applyQuote, snapshot, validate, quoteStatus, units, decimal, MAX_QUOTE_AGE_MS } from './engine.mjs';
import { openStore } from './store.mjs';

// Explicit deterministic fixtures for unit/integration tests only. Never served by the preview launcher.
const NOW = Date.parse('2026-10-09T15:00:00Z');
const q = (symbol = 'AAPL', price = '100', extra = {}) => ({ symbol, priceUsd: price, currency: 'USD', interval: '1min', provider: 'Twelve Data', timestamp: NOW - 20_000, receivedAt: NOW, marketOpen: true, ...extra });
let sequence = 0;
const order = (extra = {}) => ({ id: `test-request-${String(++sequence).padStart(8,'0')}`, symbol: 'AAPL', currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '1', ...extra });
const ready = () => { const s = createState(NOW); applyQuote(s, q(), NOW); return s; };
const expectCode = (fn, code) => assert.throws(fn, e => e.code === code);
const wallet = (s, c = 'USDT') => snapshot(s,NOW).wallets[c];

test('Apple: fractional buy, weighted entry, changing mark, partial and full sell reconcile cash and PnL', () => {
  const s = ready(); submit(s, order({ quantity: '2' }), NOW);
  applyQuote(s,q('AAPL','120',{ timestamp: NOW - 10_000 }),NOW); submit(s,order(),NOW);
  assert.equal(s.positions['AAPL/USDT'].cost,'320.00000000');
  assert.equal(snapshot(s,NOW).positions['AAPL/USDT'].average,'106.66666666');
  applyQuote(s,q('AAPL','130',{ timestamp: NOW }),NOW);
  assert.equal(snapshot(s,NOW).positions['AAPL/USDT'].unrealized,'70.00000000');
  submit(s,order({ side:'SELL',quantity:'0.5' }),NOW);
  assert.equal(s.positions['AAPL/USDT'].quantity,'2.50000000');
  assert.equal(s.realized.USDT,'11.66666667');
  assert.equal(snapshot(s,NOW).positions['AAPL/USDT'].unrealized,'58.33333333');
  submit(s,order({ side:'SELL',quantity:'2.5' }),NOW);
  assert.equal(s.positions['AAPL/USDT'].quantity,'0.00000000'); assert.equal(s.positions['AAPL/USDT'].cost,'0.00000000');
  assert.equal(s.realized.USDT,'70.00000000'); assert.equal(wallet(s).cash,'10070.00000000');
  assert.equal(s.fills.length,4); validate(s);
});
test('NVIDIA in USDC uses its explicit conversion rate and independent cash account', () => {
  const s = createState(NOW); configure(s,{ feeBps:0, balances:{ USDT:'10000',USDC:'10000' },usdPerUnit:{ USDT:'1.25',USDC:'0.8' } });
  applyQuote(s,q('NVDA','40'),NOW); submit(s,order({ symbol:'NVDA',currency:'USDC',quantity:'0.1' }),NOW);
  assert.equal(wallet(s,'USDC').cash,'9995.00000000'); assert.equal(wallet(s).cash,'10000.00000000');
  applyQuote(s,q('NVDA','45',{timestamp:NOW}),NOW); submit(s,order({symbol:'NVDA',currency:'USDC',quantity:'0.1',side:'SELL'}),NOW);
  assert.equal(wallet(s,'USDC').cash,'10000.62500000'); assert.equal(s.realized.USDC,'0.62500000'); validate(s);
});
test('buy limit reserves cost and commission, waits, then fills at improved confirmed price', () => {
  const s=ready(); const o=submit(s,order({type:'LIMIT',limitPrice:'90',quantity:'2'}),NOW);
  assert.equal(o.status,'OPEN'); assert.equal(wallet(s).reserved,'180.00000000'); assert.equal(wallet(s).available,'9820.00000000');
  applyQuote(s,q('AAPL','89',{timestamp:NOW}),NOW);
  assert.equal(o.status,'FILLED'); assert.equal(wallet(s).cash,'9822.00000000'); assert.equal(wallet(s).reserved,'0.00000000');
  assert.equal(s.fills[0].price,'89.00000000'); validate(s);
});
test('limit cancellation releases reservation exactly once', () => {
  const s=ready(), o=submit(s,order({type:'LIMIT',limitPrice:'80',quantity:'1.5'}),NOW);
  cancel(s,o.id,NOW); cancel(s,o.id,NOW); assert.equal(wallet(s).available,'10000.00000000');
  applyQuote(s,q('AAPL','75',{timestamp:NOW}),NOW); assert.equal(s.fills.length,0); assert.equal(o.status,'CANCELLED'); validate(s);
});
test('sell limit reserves shares, prevents oversell, releases on cancel', () => {
  const s=ready(); submit(s,order({quantity:'2'}),NOW); const o=submit(s,order({side:'SELL',type:'LIMIT',limitPrice:'120',quantity:'1.5'}),NOW);
  assert.equal(snapshot(s,NOW).positions['AAPL/USDT'].available,'0.50000000');
  expectCode(()=>submit(s,order({side:'SELL',quantity:'1'}),NOW),'INSUFFICIENT_SHARES');
  cancel(s,o.id,NOW); assert.equal(snapshot(s,NOW).positions['AAPL/USDT'].available,'2.00000000'); validate(s);
});
test('sell limit executes only at or above limit and FIFO reservations remain consistent', () => {
  const s=ready(); submit(s,order({quantity:'3'}),NOW);
  const a=submit(s,order({side:'SELL',type:'LIMIT',limitPrice:'120'}),NOW);
  const b=submit(s,order({side:'SELL',type:'LIMIT',limitPrice:'125'}),NOW);
  applyQuote(s,q('AAPL','122',{timestamp:NOW-1000}),NOW); assert.equal(a.status,'FILLED');assert.equal(b.status,'OPEN');
  applyQuote(s,q('AAPL','130',{timestamp:NOW}),NOW); assert.equal(b.status,'FILLED');assert.equal(s.realized.USDT,'52.00000000');validate(s);
});
test('cash reservations across symbols cannot overspend the shared USDT wallet', () => {
  const s=ready();submit(s,order({type:'LIMIT',limitPrice:'90',quantity:'100'}),NOW);
  expectCode(()=>submit(s,order({symbol:'TSLA',type:'LIMIT',limitPrice:'80',quantity:'20'}),NOW),'INSUFFICIENT_FUNDS');validate(s);
});
test('no short selling or implicit cross-currency position borrowing', () => {
  const s=ready();expectCode(()=>submit(s,order({side:'SELL'}),NOW),'INSUFFICIENT_SHARES');
  submit(s,order(),NOW);expectCode(()=>submit(s,order({side:'SELL',currency:'USDC'}),NOW),'INSUFFICIENT_SHARES');validate(s);
});
test('fees and non-parity conversion reconcile entry cost and realized PnL', () => {
  const s=createState(NOW);configure(s,{feeBps:100,balances:{USDT:'10000',USDC:'10000'},usdPerUnit:{USDT:'1.25',USDC:'1'}});
  applyQuote(s,q(),NOW);submit(s,order(),NOW);assert.equal(wallet(s).cash,'9919.20000000');assert.equal(s.positions['AAPL/USDT'].cost,'80.80000000');
  applyQuote(s,q('AAPL','110',{timestamp:NOW}),NOW);submit(s,order({side:'SELL'}),NOW);
  assert.equal(wallet(s).cash,'10006.32000000');assert.equal(s.realized.USDT,'6.32000000');validate(s);
});
test('request idempotency survives price changes and stale market data', () => {
  const s=ready(), r=order();submit(s,r,NOW);const before=JSON.stringify(s);
  submit(s,r,NOW+MAX_QUOTE_AGE_MS*2);assert.equal(JSON.stringify(s),before);
  expectCode(()=>submit(s,{...r,quantity:'2'},NOW),'IDEMPOTENCY_CONFLICT');
});
for(const [name,quote,code] of [
  ['stale',q('AAPL','100',{timestamp:NOW-MAX_QUOTE_AGE_MS-1}),'QUOTE_STALE'],
  ['closed',q('AAPL','100',{marketOpen:false}),'MARKET_CLOSED'],
  ['failed refresh',q('AAPL','100',{receivedAt:0}),'QUOTE_STALE'],
]) test(`Market and pending Limit fail closed for ${name} quotes`,()=>{
  const s=createState(NOW);applyQuote(s,quote,NOW);expectCode(()=>submit(s,order(),NOW),code);
  const o=submit(s,order({type:'LIMIT',limitPrice:'110'}),NOW);assert.equal(o.status,'OPEN');assert.equal(s.fills.length,0);
});
test('no market order without quote; limit may wait with fully reserved funds',()=>{
  const s=createState(NOW);expectCode(()=>submit(s,order(),NOW),'QUOTE_UNAVAILABLE');
  const o=submit(s,order({type:'LIMIT',limitPrice:'110'}),NOW);assert.equal(o.status,'OPEN');assert.equal(wallet(s).reserved,'110.00000000');
});
test('weekends and after-hours are blocked even if provider says open',()=>{
  for(const when of ['2026-10-10T15:00:00Z','2026-10-09T20:00:00Z','2026-10-09T13:29:59Z']){
    const t=Date.parse(when);assert.equal(quoteStatus(q('AAPL','100',{timestamp:t,receivedAt:t}),t),'MARKET_CLOSED');
  }
});
test('malformed, future and wrong-currency quotes are rejected',()=>{
  for(const change of [{priceUsd:'NaN'},{priceUsd:'0'},{currency:'USDT'},{provider:'TradingView'},{timestamp:NOW+6000},{interval:'1day'}]){
    expectCode(()=>applyQuote(createState(NOW),q('AAPL','100',change),NOW),'INVALID_QUOTE');
  }
});
test('out-of-order snapshots cannot cross a waiting limit or revalue history',()=>{
  const s=ready();applyQuote(s,q('AAPL','120',{timestamp:NOW}),NOW);const o=submit(s,order({type:'LIMIT',limitPrice:'110'}),NOW);
  applyQuote(s,q('AAPL','100',{timestamp:NOW-1000}),NOW);assert.equal(o.status,'OPEN');assert.equal(s.quotes.AAPL.priceUsd,'120');
});
test('stale mark becomes unknown, not zero PnL',()=>{
  const s=ready();submit(s,order(),NOW);assert.equal(snapshot(s,NOW+MAX_QUOTE_AGE_MS+1).positions['AAPL/USDT'].unrealized,null);
});
test('precision: repeated tiny round trips conserve cash with no hidden float drift',()=>{
  const s=ready();for(let i=0;i<100;i++){submit(s,order({quantity:'0.00000123'}),NOW);submit(s,order({quantity:'0.00000123',side:'SELL'}),NOW);}
  assert.equal(wallet(s).cash,'10000.00000000');assert.equal(s.realized.USDT,'0.00000000');validate(s);
});
test('invalid numbers, leverage and invalid symbols cannot enter the ledger',()=>{
  const s=ready();for(const quantity of ['-1','0','1e3','NaN','0.000000001','100000001']) expectCode(()=>submit(s,order({quantity}),NOW), quantity==='0'||quantity==='100000001'?'INVALID_AMOUNT':'INVALID_DECIMAL');
  expectCode(()=>submit(s,order({symbol:'BTC'}),NOW),'INVALID_PAIR');expectCode(()=>submit(s,order({currency:'USD'}),NOW),'INVALID_PAIR');
});
test('conversion and starting-balance edits lock after first submitted order',()=>{
  const s=ready();submit(s,order({type:'LIMIT',limitPrice:'80'}),NOW);
  expectCode(()=>configure(s,{feeBps:0,balances:{USDT:'1',USDC:'1'},usdPerUnit:{USDT:'1',USDC:'1'}}),'SETTINGS_LOCKED');
});
test('persisted ledger restores balances, open reservations, idempotency, fills and positions',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-sim-test-'));const path=join(dir,'ledger.json');let store;
  try{
    store=await openStore(path,{now:()=>NOW});const r=order();await store.transact(s=>{applyQuote(s,q(),NOW);submit(s,r,NOW);submit(s,order({type:'LIMIT',limitPrice:'80'}),NOW);});
    const before=store.read();await store.close();store=await openStore(path,{now:()=>NOW});assert.deepEqual(store.read(),before);
    await store.transact(s=>submit(s,r,NOW));assert.equal(store.read().fills.length,1);
    await assert.rejects(openStore(path,{now:()=>NOW}),e=>e.code==='EEXIST');
  }finally{await store?.close();await rm(dir,{recursive:true,force:true});}
});
test('concurrent submissions serialize and never overspend',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-sim-concurrent-'));const store=await openStore(join(dir,'ledger.json'),{now:()=>NOW});
  try{await store.transact(s=>applyQuote(s,q(),NOW));const results=await Promise.allSettled(Array.from({length:20},()=>store.transact(s=>submit(s,order({quantity:'10'}),NOW))));
    assert.equal(results.filter(x=>x.status==='fulfilled').length,10);assert.equal(store.read().wallets.USDT.cash,'0.00000000');assert.equal(store.read().fills.length,10);
  }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
test('failed durable write does not publish a fill or debit',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-sim-atomic-'));const path=join(dir,'ledger.json');await writeFile(path,JSON.stringify(ready()));
  const store=await openStore(path,{now:()=>NOW,persist:async()=>{throw Error('test disk full');}});
  try{await assert.rejects(store.transact(s=>submit(s,order(),NOW)),/test disk full/);assert.equal(store.read().fills.length,0);assert.equal(store.read().wallets.USDT.cash,'10000.00000000');assert.equal(JSON.parse(await readFile(path,'utf8')).fills.length,0);
  }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
test('eight-decimal parser and formatter preserve boundaries exactly',()=>{
  assert.equal(decimal(units('0.00000001')),'0.00000001');assert.equal(decimal(units('99999999.99999999')),'99999999.99999999');
});
test('test balance changes are audited, idempotent and cannot consume reserved cash or rewrite trades',()=>{
  const s=ready();submit(s,order(),NOW);const fills=JSON.stringify(s.fills);const o=submit(s,order({type:'LIMIT',limitPrice:'80'}),NOW);
  expectCode(()=>setTestBalances(s,{id:'balance-invalid-0001',balances:{USDT:'79',USDC:'10000'}},NOW),'RESERVED_FUNDS');
  assert.equal(s.wallets.USDT.cash,'9900.00000000');
  const request={id:'balance-valid-000001',balances:{USDT:'15000',USDC:'20000'}};setTestBalances(s,request,NOW);setTestBalances(s,request,NOW);
  assert.equal(wallet(s).available,'14920.00000000');assert.equal(s.adjustments.length,1);assert.equal(JSON.stringify(s.fills),fills);
  assert.equal(s.adjustments[0].previous.USDT,'9900.00000000');assert.equal(s.realized.USDT,'0.00000000');assert.equal(o.status,'OPEN');validate(s);
});
