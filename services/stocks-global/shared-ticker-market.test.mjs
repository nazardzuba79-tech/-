import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { SharedTickerMarketHub } from './shared-ticker-market.mjs';
import { MarketHub } from './market.mjs';
import { CATALOG } from './catalog.mjs';
import { quoteStatus } from './engine.mjs';
import { nativeHistoryFixture } from '../stocks/realistic-provider-fixture.mjs';

const BASE=Date.parse('2026-10-16T12:00:00Z'),IDS=CATALOG.filter(i=>i.provider!=='moex').slice(0,20),REPORT=[];
function fixture(Hub=SharedTickerMarketHub){
  const s={now:BASE,calls:[],nativeOffset:0,fxOffset:0,missing:null,duplicate:null,tickerError:false};
  const price=i=>String(100+CATALOG.indexOf(i)+Math.floor((s.now-BASE)/10000));
  const ticker=i=>({symbol:i.sourceSymbol,lastPrice:price(i),price24hPcnt:'0.0125',priceChangePercent:'1.25',volume24h:'20',volume:'20',closeTime:s.now});
  const hub=new Hub({now:()=>s.now,fetchImpl:async(address,options)=>{
    const u=new URL(address),provider=u.hostname==='api.bybit.com'?'bybit':'binance',symbol=u.searchParams.get('symbol'),i=CATALOG.find(i=>i.sourceSymbol===symbol&&i.provider===provider);
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    let kind,body;
    if(u.pathname==='/v5/market/instruments-info'){kind='metadata';body={retCode:0,result:{list:CATALOG.filter(i=>i.provider==='bybit').map(i=>({symbol:i.sourceSymbol,status:'Trading',xstockMultiplier:'1.01'}))}};}
    else if(u.pathname==='/api/v3/exchangeInfo'){kind='metadata';body={symbols:CATALOG.filter(i=>i.provider==='binance').map(i=>({symbol:i.sourceSymbol,status:'TRADING'}))};}
    else if(u.hostname==='iss.moex.com'){kind='metadata';body={securities:{columns:['SECID','STATUS'],data:[]}};}
    else if(u.pathname==='/v5/market/tickers'||u.pathname==='/api/v3/ticker/24hr'){
      kind=symbol?'single-ticker':'batch-ticker';
      if(!symbol&&provider==='binance')assert.deepEqual(JSON.parse(u.searchParams.get('symbols')),CATALOG.filter(i=>i.provider==='binance').map(i=>i.sourceSymbol));
      const rows=CATALOG.filter(i=>i.provider===provider&&(!symbol||symbol===i.sourceSymbol)&&i.id!==s.missing).map(ticker);
      const duplicate=CATALOG.find(i=>i.id===s.duplicate&&i.provider===provider);if(duplicate)rows.push(ticker(duplicate));
      body=provider==='bybit'?{retCode:0,time:s.now,result:{category:'spot',list:rows}}:symbol?(i?ticker(i):{symbol,lastPrice:'100'}):rows;
    }else if(u.pathname==='/v5/market/orderbook'&&i){kind='native';const at=s.now+s.nativeOffset;body={retCode:0,result:{s:symbol,ts:at,cts:at,u:at,b:[[price(i),'2']],a:[[String(Number(price(i))+.1),'2']]}};}
    else if(u.pathname==='/api/v3/trades'&&(i||symbol==='USDCUSDT')){kind=i?'native':'fx';body=[{id:s.now,time:s.now+(i?s.nativeOffset:s.fxOffset),price:i?price(i):'0.9982'}];}
    else if(u.pathname==='/v5/market/time'){kind='time';body={time:s.now};}
    else if(i&&['/v5/market/kline','/api/v3/klines'].includes(u.pathname)){kind='history';body=nativeHistoryFixture(u,s.now);}
    else throw Error('SYNTHETIC_TRANSPORT_DENIED:'+u.pathname);
    s.calls.push({at:s.now,host:u.hostname,kind,symbol});
    if(s.tickerError&&kind==='batch-ticker')return new Response('{}',{status:503});
    return new Response(JSON.stringify(body));
  }});
  return{hub,s};
}
const count=(s,kind,host)=>s.calls.filter(x=>x.kind===kind&&(!host||x.host===host)).length;
function peak(calls,host){const rows=calls.filter(x=>x.host===host);return Math.max(0,...rows.map(row=>rows.filter(x=>x.at>row.at-60000&&x.at<=row.at).length));}

test('candidate shares the same fresh catalogue ticker across20 native quote reads',async()=>{
  const{hub,s}=fixture();await hub.catalogue();const initial=count(s,'batch-ticker');
  const values=await Promise.all(IDS.map(i=>hub.quote(i.id)));
  assert.equal(count(s,'single-ticker'),0);assert.equal(count(s,'batch-ticker'),initial);assert.equal(count(s,'native'),20);assert.equal(count(s,'fx'),1);
  assert.ok(values.every(q=>q.timestamp===BASE&&q.eventId===String(BASE)&&quoteStatus(q,s.now,'USDC')==='READY'));
});

test('ticker cache keeps the existing15000ms boundary while native events are never TTL-cached',async()=>{
  const{hub,s}=fixture();const first=await hub.quote(IDS[0].id);assert.equal(count(s,'batch-ticker','api.bybit.com'),1);
  s.now=BASE+14999;const second=await hub.quote(IDS[0].id);assert.equal(second.last,first.last);assert.equal(second.timestamp,s.now);assert.notEqual(second.eventId,first.eventId);assert.equal(count(s,'batch-ticker','api.bybit.com'),1);
  s.now=BASE+15000;const third=await hub.quote(IDS[0].id);assert.notEqual(third.last,first.last);assert.equal(third.timestamp,s.now);assert.equal(count(s,'batch-ticker','api.bybit.com'),2);assert.equal(count(s,'native'),3);
});

test('fresh batch response time cannot freshen stale book/trade timestamps or stale FX',async()=>{
  const{hub,s}=fixture();s.nativeOffset=-61000;
  for(const i of IDS.slice(0,2)){const q=await hub.quote(i.id);assert.equal(q.timestamp,BASE-61000);assert.equal(quoteStatus(q,s.now),'QUOTE_STALE');}
  s.nativeOffset=-1;const beforeDemand=await hub.quote(IDS[0].id);assert.equal(beforeDemand.timestamp,BASE-1);assert.ok(beforeDemand.timestamp<s.now);
  s.nativeOffset=0;s.fxOffset=-181000;s.now+=15000;const q=await hub.quote(IDS[1].id);assert.equal(q.fxError,'FX_STALE');assert.equal(quoteStatus(q,s.now,'USDC'),'FX_UNAVAILABLE');
});

test('missing/duplicate selected ticker fails closed without poisoning other symbols or the other venue',async()=>{
  for(const venue of [0,1])for(const mode of ['missing','duplicate']){const{hub,s}=fixture();s[mode]=IDS[venue].id;await assert.rejects(hub.quote(IDS[venue].id),/INVALID_DATA/);assert.equal(quoteStatus(await hub.quote(IDS[venue+2].id),s.now),'READY');assert.equal(quoteStatus(await hub.quote(IDS[1-venue].id),s.now),'READY');}
});

test('expired batch HTTP failure has no stale fallback or hidden retry and can recover normally',async()=>{
  const{hub,s}=fixture();await hub.quote(IDS[0].id);s.now+=15000;s.tickerError=true;const before=count(s,'batch-ticker','api.bybit.com');
  await assert.rejects(hub.quote(IDS[0].id),/SOURCE_HTTP_503/);assert.equal(count(s,'batch-ticker','api.bybit.com'),before+1);
  s.tickerError=false;s.now++;assert.equal(quoteStatus(await hub.quote(IDS[0].id),s.now),'READY');
});

test('default hub and non-Stock/type-specific request shapes are unchanged',async()=>{
  const legacy=fixture(MarketHub),candidate=fixture();
  for(const i of IDS.slice(0,2))assert.deepEqual(await candidate.hub.quote(i.id),await legacy.hub.quote(i.id));
  assert.equal(count(legacy.s,'single-ticker'),2);assert.equal(count(candidate.s,'single-ticker'),0);
  const unknown=await candidate.hub.request('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',15000);assert.equal(unknown.symbol,'BTCUSDT');assert.equal(candidate.s.calls.at(-1).kind,'single-ticker');
  await candidate.hub.request('https://api.binance.com/api/v3/ticker/24hr?symbol=AAPLBUSDT&type=MINI',15000);assert.equal(candidate.s.calls.at(-1).kind,'single-ticker');
  await candidate.hub.request('https://api.binance.com/api/v3/ticker/24hr?symbol=AAPLBUSDT',1000);assert.equal(candidate.s.calls.at(-1).kind,'single-ticker');
});

test('candidate retains the same100-per-host rolling60000ms guard including the exact boundary',async()=>{
  const{hub,s}=fixture();for(let i=0;i<100;i++)await hub.request('https://api.bybit.com/v5/market/time');
  await assert.rejects(hub.request('https://api.bybit.com/v5/market/time'),/RATE_LIMIT/);s.now=BASE+59999;await assert.rejects(hub.request('https://api.bybit.com/v5/market/time'),/RATE_LIMIT/);
  s.now=BASE+60000;await hub.request('https://api.bybit.com/v5/market/time');assert.equal(s.calls.length,101);assert.equal(peak(s.calls,'api.bybit.com'),100);
});

test('history and execution still compete for the same unchanged provider budget',async()=>{
  const{hub,s}=fixture();await hub.catalogue();assert.equal(s.calls.filter(x=>x.host==='api.bybit.com').length,2);
  for(let i=0;i<97;i++)await hub.request('https://api.bybit.com/v5/market/time');
  await hub.history(IDS[0].id,'15m');assert.equal(s.calls.filter(x=>x.host==='api.bybit.com').length,100);assert.equal(count(s,'history'),1);
  await assert.rejects(hub.quote(IDS[0].id),/RATE_LIMIT/);assert.equal(s.calls.filter(x=>x.host==='api.bybit.com').length,100);
});

test('virtual Bybit7-at5s accounting stays below100HTTP/min with unchanged native observations',async()=>{
  const{hub,s}=fixture(),ids=IDS.filter(i=>i.provider==='bybit');assert.equal(ids.length,7);let success=0;
  for(let elapsed=0;elapsed<120000;elapsed+=5000){s.now=BASE+elapsed;for(const q of await Promise.all(ids.map(i=>hub.quote(i.id)))){assert.equal(quoteStatus(q,s.now,'USDC'),'READY');success++;}}
  assert.equal(success,168);assert.equal(count(s,'native','api.bybit.com'),168);assert.equal(count(s,'batch-ticker','api.bybit.com'),8);assert.equal(peak(s.calls,'api.bybit.com'),89);
  REPORT.push({provider:'bybit',symbols:7,cadenceMs:5000,virtualMs:120000,success,peakRolling60s:89,starts:s.calls,interpretation:'synthetic actual request guard, no CPU/HTTP/CX23 capacity claim'});
});

test('Binance13-at5s still exposes the unsolved156native/min lower bound and never bypasses100',async()=>{
  const{hub,s}=fixture(),ids=IDS.filter(i=>i.provider==='binance');assert.equal(ids.length,13);let success=0,rateLimit=0;
  for(let elapsed=0;elapsed<60000;elapsed+=5000){s.now=BASE+elapsed;for(const row of await Promise.allSettled(ids.map(i=>hub.quote(i.id))))if(row.status==='fulfilled'){assert.equal(quoteStatus(row.value,s.now),'READY');success++;}else{assert.equal(row.reason.code,'RATE_LIMIT');rateLimit++;}}
  assert.equal(success+rateLimit,156);assert.ok(rateLimit>0);assert.equal(peak(s.calls,'api.binance.com'),100);assert.equal(count(s,'single-ticker'),0);
  REPORT.push({provider:'binance',symbols:13,cadenceMs:5000,virtualMs:60000,attempts:156,success,rateLimit,peakRolling60s:100,budgetSatisfied:false,starts:s.calls,interpretation:'native trades remain per symbol; explicit NOT_CLEARED, no cap/TTL weakening'});
});

process.on('exit',()=>{if(process.env.STOCKS_SHARED_TICKER_REPORT)writeFileSync(process.env.STOCKS_SHARED_TICKER_REPORT,JSON.stringify(REPORT,null,2));});
