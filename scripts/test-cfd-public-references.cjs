'use strict';
// Explicit fixtures, not market observations. All HTTP is injected and local.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.CFD_REFERENCE_BUILD_DIR || '../dist/services/marketData/cfd';
const lib = require(path.resolve(__dirname, root, 'PublicReferenceFeed.js'));
const { publicReferenceDisplay, waitForReferenceWork } = require(path.resolve(__dirname, root, 'PublicReferenceDisplay.js'));
const { parseGoldReference, parseEcbReferences, parseEiaReference, PublicReferenceFeed, referenceDecimal } = lib;
const NOW = Date.parse('2026-09-13T12:00:00Z');
const DAY = 86400000;
const gold = (symbol = 'XAU', at = NOW, price = '2000.123456789012345678') => `{"symbol":"${symbol}","price":${price},"updatedAt":"${new Date(at).toISOString()}"}`;
const ecb = (omit = '') => `<gesmes:Envelope><gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender><Cube><Cube time='2026-09-11'>${Object.entries({USD:'1.2',GBP:'0.8',JPY:'180',AUD:'1.6',CAD:'1.5',CHF:'0.9',NZD:'2'}).filter(([k])=>k!==omit).map(([k,v])=>`<Cube currency='${k}' rate='${v}'/>`).join('')}</Cube></Cube></gesmes:Envelope>`;
const eia = (brent = false, date = '2026 Sep- 7 to Sep-11', values = ['','70.10','71.20','0','-1.25']) => `<h1>${brent ? 'Europe Brent' : 'Cushing, OK WTI'} Spot Price FOB (Dollars per Barrel)</h1><table><tr><th>Week Of</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th></tr><tr><td>${date}</td>${values.map(v=>`<td>${v}</td>`).join('')}</tr></table>`;
function harness(overrides = {}) {
  let now = NOW; const calls = [], sleeps = [];
  const fetchFn = async (url, init) => {
    calls.push({url,init});
    if (overrides.fetch) { const result = await overrides.fetch(url, init, now); if (result) return result; }
    const text = url.includes('gold-api') ? gold(url.split('/').pop(), overrides.replay ? NOW : now)
      : url.includes('ecb') ? ecb(overrides.omit ?? '') : eia(url.includes('RBRTED'));
    return new Response(text, {status:200});
  };
  const feed = new PublicReferenceFeed({enabled:overrides.enabled ?? true, fetchFn, now:()=>now, sleep:async ms=>{sleeps.push(ms);}});
  return {feed,calls,sleeps,setNow:value=>{now=value;}};
}
const primary = (over = {}) => ({symbol:'XAUUSD',provider:'twelvedata',last:null,status:'unavailable',stale:false,
  providerTimestamp:null,fetchedAt:null,executionAllowed:true,entitlementVerified:true,bid:null,ask:null,mid:null,...over});
const ref = (over = {}) => ({...parseGoldReference(gold(),'XAU',NOW)[0],status:'available',validUntil:NOW+180000,executionAllowed:false,...over});
test('decimal parser preserves genuine zero and negative values and rejects coercions',()=>{
  for (const value of ['0','-1.25','2e3','2000.123456789012345678']) assert.equal(referenceDecimal(value),value);
  for (const value of [null,undefined,true,{},'',' ','0x10','NaN','Infinity']) assert.equal(referenceDecimal(value),null);
});
test('Gold API numeric token retains provider decimal without binary rounding',()=>{
  const q=parseGoldReference(gold(),'XAU',NOW)[0]; assert.equal(q.priceDecimal,'2000.123456789012345678');
  assert.equal(q.kind,'indicative');assert.equal(q.contract,'Gold-API:XAU:indicative');assert.equal(q.unit,'provider_native_quote');
});
test('Gold API accepts real quoted zero and negative, never invents a bid or ask',()=>{
  for(const price of ['"0"','"-2.5"']) {const q=parseGoldReference(gold('XAU',NOW,price),'XAU',NOW)[0];assert.equal(q.priceDecimal,JSON.parse(price));assert.equal(q.bid,undefined);}
});
for(const [name,body] of [['wrong symbol',gold('XAG')],['wrong currency',gold().replace('"symbol"','"currency":"EUR","symbol"')],
  ['future time',gold('XAU',NOW+2000)],['missing time','{"symbol":"XAU","price":1}'],['malformed price',gold('XAU',NOW,'null')],
  ['invalid date',gold().replace('2026-09-13','2026-02-30')]]) {
  test(`Gold API rejects ${name}`,()=>assert.throws(()=>parseGoldReference(body,'XAU',NOW)));
}
test('ECB emits seven correctly directed pairs with explicit cross-rate derivation',()=>{
  const rows=parseEcbReferences(ecb(),NOW);const map=Object.fromEntries(rows.map(q=>[q.symbol,q]));
  assert.equal(rows.length,7);for(const [s,p] of Object.entries({EURUSD:'1.2',GBPUSD:'1.5',USDJPY:'150',AUDUSD:'0.75',USDCAD:'1.25',USDCHF:'0.75',NZDUSD:'0.6'}))assert.equal(map[s].priceDecimal,p);
  assert.equal(map.GBPUSD.derivation,'USD/EUR divided by GBP/EUR; 12 decimals, half-up');assert.equal(map.EURUSD.derivation,null);
  assert.ok(rows.every(q=>q.sourceTimestamp===null&&q.observationDate==='2026-09-11'&&q.kind==='daily_reference'));
});
test('ECB missing currency excludes only the affected pair',()=>assert.equal(parseEcbReferences(ecb('CHF'),NOW).length,6));
test('ECB rejects unsafe XML, duplicate rates and future dates',()=>{
  for(const body of ['<!DOCTYPE foo>'+ecb(),ecb().replace("</Cube>","<Cube currency='USD' rate='2'/></Cube>"),ecb().replace('2026-09-11','2026-09-14')])assert.throws(()=>parseEcbReferences(body,NOW));
});
test('EIA maps weekday cells to real daily dates and preserves negative/zero observations',()=>{
  const q=parseEiaReference(eia(),'WTIUSD',NOW)[0];assert.equal(q.priceDecimal,'-1.25');assert.equal(q.observationDate,'2026-09-11');assert.equal(q.sourceTimestamp,null);assert.equal(q.unit,'barrel');
  assert.equal(parseEiaReference(eia(false,undefined,['','70','71','0','']),'WTIUSD',NOW)[0].priceDecimal,'0');
});
test('EIA empty Friday retains Thursday date, never invents Friday/end-of-day time',()=>{
  const q=parseEiaReference(eia(false,undefined,['70','71','72','73','&nbsp;']),'WTIUSD',NOW)[0];assert.equal(q.observationDate,'2026-09-10');assert.equal(q.sourceTimestamp,null);
});
test('EIA handles year-crossing Monday/Friday week without shifting dates',()=>{
  const q=parseEiaReference(eia(false,'2025 Dec-29 to Jan- 2',['1','2','3','4','5']),'WTIUSD',NOW)[0];assert.equal(q.observationDate,'2026-01-02');
});
test('EIA rejects wrong oil identity, invalid week, future observations and malformed cells',()=>{
  assert.throws(()=>parseEiaReference(eia(true),'WTIUSD',NOW));assert.throws(()=>parseEiaReference(eia(),'XBRUSD',NOW));
  assert.throws(()=>parseEiaReference(eia(false,'2026 Sep- 8 to Sep-12'),'WTIUSD',NOW));
  assert.throws(()=>parseEiaReference(eia(false,'2026 Sep-14 to Sep-18'),'WTIUSD',NOW));
  assert.throws(()=>parseEiaReference(eia(false,undefined,['1','bad','3','4','5']),'WTIUSD',NOW));
});
test('disabled feed performs zero HTTP and exposes no data',async()=>{const h=harness({enabled:false});await h.feed.refreshDue();assert.equal(h.calls.length,0);assert.deepEqual(h.feed.snapshot(),[]);});
test('50 simultaneous browser reads coalesce into exactly seven public requests',async()=>{
  const h=harness();await Promise.all(Array.from({length:50},()=>h.feed.refreshDue()));assert.equal(h.calls.length,7);assert.equal(h.feed.snapshot().length,13);
  assert.equal(h.sleeps.length,4);assert.ok(h.calls.every(c=>c.init.redirect==='error'&&c.init.signal));
  await h.feed.refreshDue();assert.equal(h.calls.length,7);
});
test('reference read never spends quota and returned objects cannot mutate the cache',async()=>{
  const h=harness();await h.feed.refreshDue();const q=h.feed.snapshot()[0];q.priceDecimal='999';assert.notEqual(h.feed.snapshot()[0].priceDecimal,'999');assert.equal(h.calls.length,7);
});
test('failure of a metals provider does not block ECB or EIA lanes',async()=>{
  const h=harness({fetch:async url=>{if(url.includes('gold-api'))throw Error('network');}});await h.feed.refreshDue();assert.equal(h.feed.snapshot().length,9);assert.equal(h.calls.length,7);
});
test('oversized responses fail closed without disabling other instruments',async()=>{
  const h=harness({fetch:async url=>url.endsWith('/XAU')?new Response('x'.repeat(17000)):null});await h.feed.refreshDue();assert.equal(h.feed.snapshot().length,12);assert.ok(!h.feed.snapshot().some(q=>q.symbol==='XAUUSD'));
});
test('429 Retry-After is honored across repeated reads',async()=>{
  const h=harness({fetch:async url=>url.endsWith('/XAU')?new Response('',{status:429,headers:{'Retry-After':'600'}}):null});await h.feed.refreshDue();h.setNow(NOW+180000);await h.feed.refreshDue();assert.equal(h.calls.filter(c=>c.url.endsWith('/XAU')).length,1);
});
test('source replay never refreshes source age',async()=>{
  const h=harness({replay:true});await h.feed.refreshDue();h.setNow(NOW+181000);await h.feed.refreshDue();const q=h.feed.snapshot().find(q=>q.symbol==='XAUUSD');assert.equal(q.status,'stale');assert.equal(q.sourceTimestamp,NOW);
});
test('partial ECB response marks only missing currency stale',async()=>{
  let missing=false;const h=harness({fetch:async url=>url.includes('ecb')?new Response(ecb(missing?'CHF':'')):null});await h.feed.refreshDue();missing=true;h.setNow(NOW+3600001);await h.feed.refreshDue();
  const rows=h.feed.snapshot();assert.equal(rows.find(q=>q.symbol==='USDCHF').status,'stale');assert.equal(rows.find(q=>q.symbol==='EURUSD').status,'available');
});
test('failed refresh retains labelled history instead of fabricating current prices',async()=>{
  let failed=false;const h=harness({fetch:async url=>{if(failed&&url.endsWith('/XAU'))throw Error('down');}});await h.feed.refreshDue();failed=true;h.setNow(NOW+60001);await h.feed.refreshDue();assert.equal(h.feed.snapshot().find(q=>q.symbol==='XAUUSD').status,'stale');
});
test('cache history expires and clock regression fails closed',async()=>{
  const h=harness();await h.feed.refreshDue();h.setNow(NOW-10000);assert.equal(h.feed.snapshot().length,0);h.setNow(NOW+31*DAY);assert.equal(h.feed.snapshot().length,0);
});
test('fallback cannot inherit execution permission or primary percent change',()=>{
  const q=primary({changePercent24h:'5'});const row=publicReferenceDisplay(q,'Gold',ref(),5000,NOW);
  assert.equal(row.executionAllowed,false);assert.equal(row.entitlementVerified,false);assert.equal(row.last,null);assert.equal(row.bid,null);assert.equal(row.ask,null);assert.equal(row.changePercent24h,undefined);assert.equal(row.displayOnly,true);assert.equal(q.executionAllowed,true);
});
test('fresh primary wins without averaging or altering financial observation',()=>{
  const q=primary({last:2001,lastDecimal:'2001',status:'live',referenceStatus:'available',fetchedAt:NOW,providerTimestamp:NOW});const row=publicReferenceDisplay(q,'Gold',ref(),5000,NOW);
  assert.equal(row.price,'2001');assert.equal(row.executionAllowed,true);assert.equal(q.last,2001);
});
test('wrong-symbol fallback cannot substitute WTI for Brent',()=>{
  const row=publicReferenceDisplay(primary({symbol:'XBRUSD'}),'Brent',ref({symbol:'WTIUSD'}),5000,NOW);assert.equal(row.price,null);
});
test('daily reference is labelled with exact date, no intraday timestamp or change',()=>{
  const r={...parseEiaReference(eia(),'WTIUSD',NOW)[0],status:'available',validUntil:NOW+DAY,executionAllowed:false};const row=publicReferenceDisplay(primary({symbol:'WTIUSD'}),'WTI',r,5000,NOW);
  assert.equal(row.providerTimestamp,null);assert.equal(row.observationDate,'2026-09-11');assert.match(row.referenceLabel,/Daily reference.*U.S. EIA.*2026-09-11/);assert.equal(row.executionAllowed,false);
});
test('stale fallback remains explicitly last-known even when primary unavailable',()=>{const row=publicReferenceDisplay(primary(),'Gold',ref({status:'stale'}),5000,NOW);assert.match(row.referenceLabel,/Last known/);assert.equal(row.status,'stale');});
test('read-time expiration overrides cached available state',()=>{const row=publicReferenceDisplay(primary(),'Gold',ref({validUntil:NOW-1}),5000,NOW);assert.equal(row.stale,true);assert.equal(row.executionAllowed,false);});
test('nonfinite fallback timestamps or expiry are not displayed',()=>{
  for(const patch of [{sourceTimestamp:NaN},{receivedAt:NaN},{validUntil:NaN}])assert.equal(publicReferenceDisplay(primary(),'Gold',ref(patch),5000,NOW).price,null);
});
test('public additional wait is bounded and consumes failures',async()=>{
  const started=Date.now();await waitForReferenceWork(new Promise(()=>{}),5);assert.ok(Date.now()-started<1000);await waitForReferenceWork(Promise.reject(Error('fail')),5);
});
