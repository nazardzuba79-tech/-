// V2 is a separate ledger. V1 code and saved history remain readable and untouched.
import { units, decimal, check, SCALE, SimError } from '../stocks-simulator/engine.mjs';
import { instrument } from './catalog.mjs';
export { units, decimal, check, SimError };
export const currencies = ['USDT','USDC'];
const min = (...n) => n.reduce((a,b) => a < b ? a : b);
const ceil = (a,b) => (a+b-1n)/b;
const gross = (p,q,buy) => buy ? ceil(p*q,SCALE) : p*q/SCALE;
const signed = s => BigInt(s.replace('.',''));
export const active = o => ['OPEN','PARTIAL'].includes(o.status);
const key = (id,c) => id+'|'+c;
const position = (s,id,c) => s.positions[key(id,c)] ??= { instrumentId:id,currency:c,quantity:decimal(0n),reserved:decimal(0n),cost:decimal(0n),nativeCost:decimal(0n),realized:decimal(0n) };
export function createState(now=Date.now()) {
  return { schema:2,revision:0,createdAt:now,settings:{feeBps:0,model:'observation-cap-1-v1',conversion:'verified-source-rates'},wallets:Object.fromEntries(currencies.map(c=>[c,{cash:decimal(10000n*SCALE),reserved:decimal(0n)}])),orders:[],fills:[],positions:{},quotes:{},realized:{USDT:decimal(0n),USDC:decimal(0n)},adjustments:[] };
}
export function quoteStatus(q,now,currency='USDT') {
  const i=instrument(q?.instrumentId); if(!q||!i) return 'QUOTE_UNAVAILABLE';
  if(q.provider!==i.provider||q.nativeCurrency!==i.currency||!q.eventId||q.verified!==true) return 'INVALID_QUOTE';
  if(!Number.isSafeInteger(q.timestamp)||!Number.isSafeInteger(q.receivedAt)||q.timestamp>now+2000||q.receivedAt>now+2000) return 'INVALID_QUOTE';
  if(now-q.timestamp>(i.delaySeconds+60)*1000||now-q.receivedAt>30000||q.failed) return 'QUOTE_STALE';
  if(q.marketOpen!==true) return 'MARKET_CLOSED';
  if(!q.prices?.[currency]) return 'FX_UNAVAILABLE';
  const fx=q.fx?.[currency];
  if(currency!==q.nativeCurrency&&!fx) return 'FX_UNAVAILABLE';
  const maxFxAge=q.nativeCurrency==='RUB'&&currency==='USDT'?36*3600000:180000;
  if(fx && (!Number.isSafeInteger(fx.timestamp)||fx.timestamp>now+2000||!Number.isSafeInteger(fx.maxAgeMs)||fx.maxAgeMs<=0||fx.maxAgeMs>maxFxAge||now-fx.timestamp>fx.maxAgeMs)) return 'FX_STALE';
  if(q.nativeCurrency==='RUB'&&(!Number.isSafeInteger(fx?.stableTimestamp)||(currency==='USDC'&&!Number.isSafeInteger(fx?.referenceTimestamp))))return 'FX_STALE';
  if(fx?.stableTimestamp && (fx.stableTimestamp>now+2000||now-fx.stableTimestamp>180000))return 'FX_STALE';
  if(fx?.referenceTimestamp && (fx.referenceTimestamp>now||now-fx.referenceTimestamp>36*3600000))return 'FX_STALE';
  if(fx){try{units(fx.rate,true);}catch{return 'FX_UNAVAILABLE';}}
  try { units(q.prices[currency].buy,true);units(q.prices[currency].sell,true);units(q.capacity,true); } catch { return 'INVALID_QUOTE'; }
  return 'READY';
}
function release(s,o) {
  const target=o.side==='BUY'?s.wallets[o.currency]:position(s,o.instrumentId,o.currency);
  target.reserved=decimal(units(target.reserved)-units(o.reserved));o.reserved=decimal(0n);
}
export function submit(s,input,now) {
  check(input&&typeof input.id==='string'&&/^[\w-]{16,80}$/.test(input.id),'INVALID_REQUEST_ID');
  check(instrument(input.instrumentId)&&currencies.includes(input.currency),'INVALID_PAIR');
  check(['BUY','SELL'].includes(input.side)&&['MARKET','LIMIT'].includes(input.type),'INVALID_ORDER');
  const r={id:input.id,instrumentId:input.instrumentId,currency:input.currency,side:input.side,type:input.type,quantity:decimal(units(input.quantity,true)),limitPrice:input.type==='LIMIT'?decimal(units(input.limitPrice,true)):null};
  const signature=JSON.stringify(r),existing=s.orders.find(o=>o.id===r.id);
  if(existing){check(existing.signature===signature,'IDEMPOTENCY_CONFLICT');return existing;}
  check(s.orders.length<10000,'LEDGER_LIMIT');
  const q=s.quotes[r.instrumentId],buy=r.side==='BUY';
  if(r.type==='MARKET')check(quoteStatus(q,now,r.currency)==='READY',quoteStatus(q,now,r.currency));
  const price=units(r.type==='LIMIT'?r.limitPrice:q.prices[r.currency][buy?'buy':'sell'],true),qty=units(r.quantity);
  const amount=gross(price,qty,buy);check(amount>0n,'ORDER_TOO_SMALL');
  const target=buy?s.wallets[r.currency]:position(s,r.instrumentId,r.currency),reserve=buy?amount:qty;
  check(units(buy?target.cash:target.quantity)-units(target.reserved)>=reserve,buy?'INSUFFICIENT_FUNDS':'INSUFFICIENT_SHARES');
  target.reserved=decimal(units(target.reserved)+reserve);
  const o={...r,signature,remaining:r.quantity,filled:decimal(0n),reserved:decimal(reserve),status:'OPEN',createdAt:now,updatedAt:now};s.orders.push(o);
  if(o.type==='MARKET'){match(s,o.instrumentId,now,o.id);if(active(o)){release(s,o);o.status=units(o.filled)?'PARTIAL_CANCELLED':'CANCELLED';o.updatedAt=now;}}
  return o;
}
export function cancel(s,id,now){const o=s.orders.find(o=>o.id===id);check(o,'ORDER_NOT_FOUND');if(active(o)){release(s,o);o.status=units(o.filled)?'PARTIAL_CANCELLED':'CANCELLED';o.updatedAt=now;}return o;}
export function applyQuote(s,q,now){
  const old=s.quotes[q.instrumentId];if(old&&old.timestamp>q.timestamp)return;
  if(old?.eventId===q.eventId){s.quotes[q.instrumentId]={...q,used:old.used??decimal(0n)};return;}
  s.quotes[q.instrumentId]={...q,used:decimal(0n)};match(s,q.instrumentId,now);
}
export function match(s,id,now,marketId=null){
  const quote=s.quotes[id];if(!quote)return;
  for(const o of s.orders){
    if(o.instrumentId!==id||!active(o)||quoteStatus(quote,now,o.currency)!=='READY')continue;
    if(o.type==='MARKET'&&o.id!==marketId)continue;
    // Limits may only use a new observation actually occurring AFTER submission.
    if(o.type==='LIMIT'&&quote.timestamp<o.createdAt)continue;
    const buy=o.side==='BUY',p=units(quote.prices[o.currency][buy?'buy':'sell']);
    if(o.type==='LIMIT'&&(buy?p>units(o.limitPrice):p<units(o.limitPrice)))continue;
    const capacity=min(SCALE,units(quote.capacity))-units(quote.used??decimal(0n));if(capacity<=0n)break;
    const qty=min(units(o.remaining),capacity),value=gross(p,qty,buy);if(!value)continue;
    check(s.fills.length<50000,'LEDGER_LIMIT');
    const w=s.wallets[o.currency],pos=position(s,id,o.currency),remaining=units(o.remaining)-qty;
    release(s,o);
    const nextReserve=buy&&o.type==='LIMIT'?gross(units(o.limitPrice),remaining,true):buy?0n:remaining;
    const target=buy?w:pos;target.reserved=decimal(units(target.reserved)+nextReserve);o.reserved=decimal(nextReserve);
    let realized=0n;
    if(buy){check(units(w.cash)-units(w.reserved)>=value,'INSUFFICIENT_FUNDS');w.cash=decimal(units(w.cash)-value);pos.quantity=decimal(units(pos.quantity)+qty);pos.cost=decimal(units(pos.cost)+value);pos.nativeCost=decimal(units(pos.nativeCost)+gross(units(quote.ask),qty,true));}
    else {check(units(pos.quantity)-units(pos.reserved)>=qty,'INSUFFICIENT_SHARES');const basis=qty===units(pos.quantity)?units(pos.cost):units(pos.cost)*qty/units(pos.quantity);pos.nativeCost=decimal(units(pos.nativeCost)-units(pos.nativeCost)*qty/units(pos.quantity));realized=value-basis;w.cash=decimal(units(w.cash)+value);pos.quantity=decimal(units(pos.quantity)-qty);pos.cost=decimal(units(pos.cost)-basis);pos.realized=decimal(signed(pos.realized)+realized);s.realized[o.currency]=decimal(signed(s.realized[o.currency])+realized);}
    o.remaining=decimal(remaining);o.filled=decimal(units(o.filled)+qty);o.status=remaining?'PARTIAL':'FILLED';o.updatedAt=now;
    quote.used=decimal(units(quote.used??decimal(0n))+qty);
    s.fills.push({id:`${o.id}-${s.fills.length+1}`,orderId:o.id,instrumentId:id,currency:o.currency,side:o.side,quantity:decimal(qty),price:decimal(p),nativePrice:buy?quote.ask:quote.bid,nativeCurrency:quote.nativeCurrency,multiplier:quote.multiplier??null,fx:quote.fx?.[o.currency]??null,notional:decimal(value),fee:decimal(0n),realized:decimal(realized),timestamp:now,quoteTimestamp:quote.timestamp,eventId:quote.eventId,provider:quote.provider});
  }
}
export function setBalances(s,input,now){
  check(typeof input?.id==='string'&&/^[\w-]{16,80}$/.test(input.id),'INVALID_REQUEST_ID');
  const balances=Object.fromEntries(currencies.map(c=>[c,decimal(units(input.balances?.[c]))])),signature=JSON.stringify(balances),old=s.adjustments.find(a=>a.id===input.id);
  if(old){check(old.signature===signature,'IDEMPOTENCY_CONFLICT');return;}
  check(s.adjustments.length<1000,'LEDGER_LIMIT');for(const c of currencies)check(units(balances[c])>=units(s.wallets[c].reserved),'RESERVED_FUNDS');
  const previous=Object.fromEntries(currencies.map(c=>[c,s.wallets[c].cash]));for(const c of currencies)s.wallets[c].cash=balances[c];s.adjustments.push({id:input.id,signature,previous,balances,timestamp:now});
}
export function validate(s){
  check(s?.schema===2&&Number.isSafeInteger(s.revision),'CORRUPT_LEDGER');
  check(new Set(s.orders.map(o=>o.id)).size===s.orders.length&&new Set(s.fills.map(f=>f.id)).size===s.fills.length,'CORRUPT_LEDGER');
  const filled=new Map();
  const orderIds=new Set(s.orders.map(o=>o.id));
  for(const f of s.fills){check(orderIds.has(f.orderId),'ORPHAN_FILL');filled.set(f.orderId,(filled.get(f.orderId)??0n)+units(f.quantity));}
  for(const o of s.orders){check(units(o.quantity)===units(o.remaining)+units(o.filled),'FILL_MISMATCH');check((filled.get(o.id)??0n)===units(o.filled),'FILL_MISMATCH');}
  for(const c of currencies){const w=s.wallets[c];check(units(w.cash)>=units(w.reserved),'NEGATIVE_BALANCE');check(s.orders.filter(o=>active(o)&&o.side==='BUY'&&o.currency===c).reduce((a,o)=>a+units(o.reserved),0n)===units(w.reserved),'RESERVATION_MISMATCH');}
  for(const p of Object.values(s.positions)){check(units(p.quantity)>=units(p.reserved),'NEGATIVE_SHARES');units(p.cost);check(s.orders.filter(o=>active(o)&&o.side==='SELL'&&o.currency===p.currency&&o.instrumentId===p.instrumentId).reduce((a,o)=>a+units(o.reserved),0n)===units(p.reserved),'RESERVATION_MISMATCH');}
}
export function snapshot(s,now){const r=structuredClone(s);for(const c of currencies)r.wallets[c].available=decimal(units(s.wallets[c].cash)-units(s.wallets[c].reserved));for(const p of Object.values(r.positions)){const qty=units(p.quantity),q=s.quotes[p.instrumentId];p.available=decimal(qty-units(p.reserved));p.average=qty?decimal(units(p.cost)*SCALE/qty):null;p.averageNative=qty?decimal(units(p.nativeCost)*SCALE/qty):null;p.mark=null;p.unrealized=null;if(qty&&quoteStatus(q,now,p.currency)==='READY'){p.mark=q.prices[p.currency].sell;p.unrealized=decimal(gross(units(p.mark),qty,false)-units(p.cost));}}
  for(const q of Object.values(r.quotes)){q.status=Object.fromEntries(currencies.map(c=>[c,quoteStatus(q,now,c)]));q.ageSeconds=Math.max(0,Math.floor((now-q.timestamp)/1000));}r.serverTime=now;for(const o of r.orders)delete o.signature;return r;
}
