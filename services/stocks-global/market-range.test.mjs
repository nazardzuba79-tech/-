import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketHub, parseCandles } from './market.mjs';
import { CATALOG } from './catalog.mjs';

// Native-shaped, timestamp-anchored fixtures only. No external network, SQL,
// account, execution quote or trading endpoint is used by this suite.
const BASE=Date.parse('2026-10-10T12:00:00Z');
const PAIRS=['BYBIT:AAPLXUSDT','BINANCE:AAPLBUSDT'];
const periods={'1':60000,'5':300000,'15':900000,'30':1800000,'60':3600000,'240':14400000,D:86400000,'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};
function fixture({gaps=false,available=10000}={}){
  const state={now:BASE,calls:[],corrections:new Map(),removed:new Set(),available,fail:false,gate:null,transform:null};
  const rowsFor=(url,overrideLimit)=>{
    const u=new URL(url),step=periods[u.searchParams.get('interval')],limit=overrideLimit??Number(u.searchParams.get('limit'));
    assert.ok(step);assert.ok(limit===300||limit===600);
    const end=Number(u.searchParams.get('end')??u.searchParams.get('endTime')??state.now);
    const rows=[];let index=Math.floor(Math.min(end,state.now)/step);
    for(let visited=0;rows.length<limit&&visited<state.available;visited++,index--){
      if(gaps&&index%7===0)continue;
      const time=index*step;if(state.removed.has(time))continue;
      const open=100+(index%1000)/1000,close=state.corrections.get(time)??open+0.01;
      rows.push([String(time),String(open),String(Math.max(open,close)+1),String(Math.min(open,close)-1),String(close),String(1+(index%19))]);
    }
    return u.hostname==='api.bybit.com'?rows:rows.reverse();
  };
  const fetchImpl=async url=>{
    const u=new URL(url);assert.ok(['api.bybit.com','api.binance.com'].includes(u.hostname));assert.ok(['/v5/market/kline','/api/v3/klines'].includes(u.pathname));
    state.calls.push(url);if(state.gate)await state.gate;if(state.fail)return new Response('unavailable',{status:503});
    let rows=rowsFor(url);if(state.transform)rows=state.transform(rows);return new Response(JSON.stringify(u.hostname==='api.bybit.com'?{retCode:0,result:{symbol:u.searchParams.get('symbol'),list:rows}}:rows));
  };
  const expected=(id,interval,end)=>{
    const i=CATALOG.find(i=>i.id===id),period=i.provider==='bybit'?{'1m':'1','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240','1D':'D'}[interval]:interval==='1D'?'1d':interval;
    const url=`https://api.${i.provider}.com/${i.provider==='bybit'?'v5/market/kline':'api/v3/klines'}?symbol=${i.sourceSymbol}&interval=${period}&limit=300${end?`&${i.provider==='bybit'?'end':'endTime'}=${end}`:''}`;
    return parseCandles(rowsFor(url,300),i.provider,state.now).filter(c=>!end||c.time*1000<end);
  };
  return {state,expected,hub:new MarketHub({now:()=>state.now,fetchImpl})};
}

test('two-page on-demand native windows exactly match limit300 OHLCV and inclusive-end public projection for both providers',async()=>{
  for(const id of PAIRS)for(const interval of ['15m','1h','1D']){
    const f=fixture(),step=periods[interval==='1D'?'1d':interval],latest=await f.hub.history(id,interval);
    assert.deepEqual(latest.candles,f.expected(id,interval,null));assert.equal(latest.candles.length,300);
    const aligned=Math.floor(BASE/step)*step;
    for(const end of [aligned,aligned-23*step,aligned-23*step+1234,latest.candles[0].time*1000-1]){
      const page=await f.hub.history(id,interval,end);assert.deepEqual(page.candles,f.expected(id,interval,end));assert.equal(page.receivedAt,BASE);
    }
    assert.equal(f.state.calls.length,1,'one requested600 response covers selected recent and next native page');
    assert.equal(f.hub.metrics.historyRangeHits,4);assert.equal(f.hub.metrics.historyParses,1);
    assert.ok(f.state.calls.every(url=>new URL(url).searchParams.get('limit')==='600'));
    const distant=aligned-601*step,page=await f.hub.history(id,interval,distant);
    assert.deepEqual(page.candles,f.expected(id,interval,distant));assert.equal(f.state.calls.length,2);
    assert.equal(new URL(f.state.calls[1]).searchParams.get('limit'),'300','arbitrary uncovered cursor uses exact fallback');
  }
});

test('source gaps remain exact and a partial native suffix never masquerades as a complete300 page',async()=>{
  for(const id of PAIRS){
    const f=fixture({gaps:true}),latest=await f.hub.history(id,'15m');
    const end=latest.candles[0].time*1000-1;
    assert.deepEqual((await f.hub.history(id,'15m',end)).candles,f.expected(id,'15m',end));assert.equal(f.state.calls.length,1);
    const outside=end-100*900000;
    assert.deepEqual((await f.hub.history(id,'15m',outside)).candles,f.expected(id,'15m',outside));assert.equal(f.state.calls.length,2);
    assert.ok(latest.candles.some((c,n)=>n&&c.time-latest.candles[n-1].time>900),'real gaps are preserved');
    const short=fixture({available:450});
    assert.deepEqual((await short.hub.history(id)).candles,short.expected(id,'15m',null));
    await short.hub.history(id,'15m',BASE-20*900000);assert.equal(short.state.calls.length,2,'incomplete source window disables range reuse');
  }
});

test('unordered or duplicate wider payloads never enlarge public pages or prove ranges; invalid older OHLC fails closed',async()=>{
  for(const id of PAIRS){
    const unordered=fixture();unordered.state.transform=rows=>[...rows].reverse();
    const page=await unordered.hub.history(id);assert.deepEqual(page.candles,unordered.expected(id,'15m',null));assert.equal(page.candles.length,300);assert.equal(unordered.hub.historyRanges.size,0);
    const duplicate=fixture();duplicate.state.transform=rows=>rows.map((r,n)=>n===20?rows[19]:r);
    assert.ok((await duplicate.hub.history(id)).candles.length<=300);assert.equal(duplicate.hub.historyRanges.size,0);
    const malformed=fixture();malformed.state.transform=rows=>rows.map((r,n)=>n===(id.startsWith('BYBIT')?599:0)?[r[0],r[1],'0',r[3],r[4],r[5]]:r);
    await assert.rejects(malformed.hub.history(id),/INVALID_CANDLES/);assert.equal(malformed.hub.historyRanges.size,0);assert.equal(malformed.hub.historyCache.size,0);
    assert.equal(malformed.state.calls.length,1,'invalid wider data is not silently dropped or automatically fetched again');
  }
});

test('latest and covered cursor readers singleflight once with no catalogue or speculative interval calls',async()=>{
  const f=fixture();let release;f.state.gate=new Promise(resolve=>{release=resolve;});
  const reads=[f.hub.history(PAIRS[0]),...Array.from({length:50},(_,n)=>f.hub.history(PAIRS[0],'15m',BASE-(n%2+1)*900000))];
  assert.equal(f.state.calls.length,1);release();const pages=await Promise.all(reads);
  assert.equal(f.state.calls.length,1);assert.equal(f.hub.metrics.historyParses,1);assert.equal(f.hub.metrics.historyRangeHits,2);
  assert.equal(pages[1],pages[3]);assert.equal(f.hub.historyFlights.size,0);assert.equal(f.hub.historyQueue.length,0);
  await assert.rejects(f.hub.history('BINANCE:UNKNOWN','15m'),/UNSUPPORTED_TIMEFRAME/);
  await assert.rejects(f.hub.history(PAIRS[0],'2m'),/UNSUPPORTED_TIMEFRAME/);assert.equal(f.state.calls.length,1);
});

test('distinct range followers cannot bypass two-active/eight-queued admission while latest provider read is held',async()=>{
  const f=fixture();let release;f.state.gate=new Promise(resolve=>{release=resolve;});
  const latest=f.hub.history(PAIRS[0]),followers=Array.from({length:9},(_,n)=>f.hub.history(PAIRS[0],'15m',BASE-(n+1)*900000));
  const duplicate=f.hub.history(PAIRS[0],'15m',BASE-900000);
  assert.equal(f.hub.historyActive,2);assert.equal(f.hub.historyQueue.length,8);assert.equal(f.state.calls.length,1);
  await assert.rejects(f.hub.history(PAIRS[0],'15m',BASE-100*900000),/SOURCE_BUSY/);
  assert.equal(f.hub.historyFlights.size,10,'rejected cursor does not accumulate outside bounded admission');
  release();await Promise.all([latest,...followers,duplicate]);assert.equal(f.state.calls.length,1);
  assert.equal(f.hub.historyFlights.size,0);assert.equal(f.hub.historyQueue.length,0);assert.equal(f.hub.historyActive,0);
});

test('queued historical reads cannot depend on a later latest request behind them in the same bounded queue',async()=>{
  const f=fixture();let release;f.state.gate=new Promise(resolve=>{release=resolve;});
  const occupied=[f.hub.history(PAIRS[0],'1h'),f.hub.history(PAIRS[1],'1h')];
  const historical=[f.hub.history(PAIRS[0],'15m',BASE-900000),f.hub.history(PAIRS[0],'15m',BASE-1800000)];
  const laterLatest=f.hub.history(PAIRS[0],'15m');assert.equal(f.hub.historyQueue.length,3);
  release();await Promise.all([...occupied,...historical,laterLatest]);
  assert.equal(f.state.calls.length,5,'older cursor requests use exact fallback instead of awaiting a later queued dependency');
  assert.equal(f.hub.historyQueue.length,0);assert.equal(f.hub.historyFlights.size,0);assert.equal(f.hub.historyActive,0);
});

test('latest10s and original-observation historical300s TTL never slide or borrow freshness',async()=>{
  const f=fixture();await f.hub.history(PAIRS[0]);f.state.now+=9999;
  const end=BASE-10*900000,older=await f.hub.history(PAIRS[0],'15m',end);
  assert.equal(older.receivedAt,BASE);assert.equal(f.state.calls.length,1);
  f.state.now=BASE+10000;await f.hub.history(PAIRS[0],'15m',end-1);
  assert.equal(f.state.calls.length,2);assert.equal(new URL(f.state.calls[1]).searchParams.get('limit'),'300','expired range cannot serve new cursor');
  f.state.now=BASE+299999;assert.equal(await f.hub.history(PAIRS[0],'15m',end),older);
  f.state.now++;assert.notEqual(await f.hub.history(PAIRS[0],'15m',end),older);assert.equal(f.state.calls.length,3);
});

test('authoritative reconnect refresh invalidates derived historical aliases and exposes corrected OHLC without mutating prior pages',async()=>{
  for(const id of PAIRS){
    const f=fixture();const latest=await f.hub.history(id),end=BASE-10*900000,older=await f.hub.history(id,'15m',end);
    const changed=older.candles.at(-1);f.state.corrections.set(changed.time*1000,changed.close+0.25);
    f.state.now+=10000;
    const refreshed=await Promise.all(Array.from({length:20},()=>f.hub.history(id)));
    assert.equal(new Set(refreshed).size,1);assert.notEqual(refreshed[0],latest);
    const corrected=await f.hub.history(id,'15m',end);assert.deepEqual(corrected.candles,f.expected(id,'15m',end));
    assert.notEqual(corrected,older);assert.equal(corrected.candles.at(-1).close,changed.close+0.25);assert.equal(older.candles.at(-1),changed);
    assert.equal(f.state.calls.length,2);assert.equal(f.hub.metrics.historyRangeInvalidations,1);assert.throws(()=>{changed.close=0;},TypeError);
  }
});

test('failed refresh cannot install a range or erase a previously valid historical page',async()=>{
  const f=fixture();await f.hub.history(PAIRS[0]);const end=BASE-10*900000,older=await f.hub.history(PAIRS[0],'15m',end);
  f.state.now+=10000;f.state.fail=true;await assert.rejects(f.hub.history(PAIRS[0]),/SOURCE_HTTP_503/);
  assert.equal(await f.hub.history(PAIRS[0],'15m',end),older);assert.equal(f.hub.metrics.historyRangeInvalidations,0);
  await assert.rejects(f.hub.history(PAIRS[0],'15m',end-1),/SOURCE_HTTP_503/);assert.equal(f.hub.historyFlights.size,0);
  f.state.fail=false;await f.hub.history(PAIRS[0]);assert.equal(f.hub.metrics.historyRangeInvalidations,1);
});

test('removed candles and short authoritative refreshes invalidate old derived pages without filling gaps',async()=>{
  const f=fixture();await f.hub.history(PAIRS[0]);const end=BASE-10*900000,older=await f.hub.history(PAIRS[0],'15m',end);
  const removed=older.candles.at(-20).time*1000;f.state.removed.add(removed);f.state.now+=10000;
  await f.hub.history(PAIRS[0]);const corrected=await f.hub.history(PAIRS[0],'15m',end);
  assert.deepEqual(corrected.candles,f.expected(PAIRS[0],'15m',end));assert.ok(!corrected.candles.some(c=>c.time*1000===removed));
  assert.ok(older.candles.some(c=>c.time*1000===removed));assert.equal(f.state.calls.length,2);
  f.state.available=200;f.state.now+=10000;await f.hub.history(PAIRS[0]);
  const shortened=await f.hub.history(PAIRS[0],'15m',end);
  assert.deepEqual(shortened.candles,f.expected(PAIRS[0],'15m',end));assert.ok(shortened.candles.length<300);
  assert.equal(f.state.calls.length,4,'short latest cannot prove complete range and uses exact historical fallback');
  assert.equal(f.hub.metrics.historyRangeInvalidations,2);
});

test('successfully validated unordered refresh cannot leave an older derived alias with contradictory corrected OHLC',async()=>{
  const f=fixture();await f.hub.history(PAIRS[0]);const end=BASE-10*900000,older=await f.hub.history(PAIRS[0],'15m',end);
  const changed=older.candles.at(-1);f.state.corrections.set(changed.time*1000,changed.close+0.25);f.state.transform=rows=>[...rows].reverse();f.state.now+=10000;
  const latest=await f.hub.history(PAIRS[0]);assert.equal(latest.candles.length,300);assert.equal(f.hub.historyRanges.size,0);
  assert.equal(f.hub.metrics.historyRangeInvalidations,1);assert.equal(f.state.calls.length,2,'invalidated alias is not prefetched');
  const corrected=await f.hub.history(PAIRS[0],'15m',end);assert.deepEqual(corrected.candles,f.expected(PAIRS[0],'15m',end));
  assert.notEqual(corrected,older);assert.equal(corrected.candles.at(-1).close,changed.close+0.25);assert.equal(f.state.calls.length,3);
});

test('combined windows and shared public pages stay below8MiB and128 entries under catalogue-sized selected demand',async()=>{
  const f=fixture();let peak=0;
  for(const i of CATALOG.filter(i=>i.provider!=='moex'))for(const interval of ['1m','5m','15m','30m','1h','4h','1D']){
    const latest=await f.hub.history(i.id,interval),end=latest.candles[0].time*1000-1;
    await f.hub.history(i.id,interval,end);peak=Math.max(peak,f.hub.metrics.historyCacheBytes);
    assert.ok(f.hub.metrics.historyCacheBytes<=8*1048576);assert.ok(f.hub.historyRetained.size<=128);
    const entries=[...f.hub.historyCache.values(),...f.hub.historyRanges.values()],refs=new Map();
    for(const entry of entries)for(const candle of entry.candles)refs.set(candle,(refs.get(candle)||0)+1);
    assert.equal(f.hub.historyCandleRefs.size,refs.size);
    assert.equal(f.hub.metrics.historyCacheBytes,refs.size*248+entries.reduce((sum,e)=>sum+1024+(e.candles.length+(e.extraRefs||0))*8,0));
  }
  assert.ok(peak>7*1048576);assert.ok(f.hub.metrics.historyCacheEvictions>0);assert.equal(f.hub.cache.size,0);
});

test('unchanged20-reader schedule with native limit/end contract reduces ideal104 Binance starts without raising provider budget',async()=>{
  const f=fixture(),ids=CATALOG.filter(i=>i.provider!=='moex').slice(0,20);let peak=0;const errors={};
  for(let turn=0;turn<15;turn++){
    f.state.now=BASE+turn*2000;if(turn%3===2)continue;
    const interval=['15m','1h','1D'][Math.floor(turn/3)%3],before=turn%3===1?Math.floor(f.state.now/86400000)*86400000-86400000:null;
    for(let user=0;user<20;user++){
      const id=ids[(user+Math.floor(turn/3))%20].id;
      try{const page=await f.hub.history(id,interval,before);assert.deepEqual(page.candles,f.expected(id,interval,before));}
      catch(error){if(error.name==='AssertionError')throw error;errors[error.code||error.message]=(errors[error.code||error.message]||0)+1;}
      peak=Math.max(peak,f.hub.metrics.historyCacheBytes);
    }
  }
  const starts={binance:0,bybit:0};for(const url of f.state.calls)starts[new URL(url).hostname==='api.bybit.com'?'bybit':'binance']++;
  assert.deepEqual(errors,{});assert.deepEqual(starts,{binance:65,bybit:35});assert.equal(f.hub.metrics.historyRangeHits,100);
  assert.equal(f.hub.metrics.historyParses,100);assert.ok(peak<=8*1048576);assert.equal(f.hub.metrics.historyCacheEvictions,0);
  // Provider guard itself remains100/rolling60s, irrespective of avoided starts.
  f.hub.starts.set('api.binance.com',Array(100).fill(f.state.now));
  await assert.rejects(f.hub.history(PAIRS[1],'1m',BASE-100000000),/RATE_LIMIT/);
});
