import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { createSimulatorServer } from './server.mjs';
import { TwelveDataQuotes } from './provider.mjs';
const NOW=Date.parse('2026-10-09T15:00:00Z');
const raw={symbol:'AAPL',currency:'USD',exchange:'NASDAQ',timestamp:Math.floor((NOW-20000)/1000),datetime:'2026-10-09 14:59:40',is_market_open:true,close:'100'};
test('provider sends only an allowlisted GET and validates intraday metadata',async()=>{
  const calls=[];const p=new TwelveDataQuotes({apiKey:'unit-test-key',now:()=>NOW,fetchImpl:async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(raw));}});
  const quote=await p.quote('AAPL');assert.equal(quote.priceUsd,'100.00000000');assert.equal(quote.marketOpen,true);
  assert.equal(calls[0].url.origin,'https://api.twelvedata.com');assert.equal(calls[0].url.pathname,'/quote');assert.equal(calls[0].url.searchParams.get('interval'),'1min');assert.equal(calls[0].opts.method,'GET');assert.equal(calls[0].opts.redirect,'error');
  await assert.rejects(p.quote('https://broker/orders'),e=>e.code==='INVALID_PAIR');assert.equal(calls.length,1);
});
test('public trial never invents NVIDIA/Tesla data or attempts order endpoints',async()=>{
  let calls=0;const p=new TwelveDataQuotes({fetchImpl:async()=>{calls++;throw Error('unexpected');}});
  for(const symbol of ['NVDA','TSLA'])await assert.rejects(p.quote(symbol),e=>e.code==='SOURCE_KEY_REQUIRED');assert.equal(calls,0);
});
test('provider rejects day-only timestamps, symbol mismatch, non-USD and oversized data',async()=>{
  for(const value of [{...raw,datetime:'2026-10-09'},{...raw,symbol:'TSLA'},{...raw,currency:'EUR'},{...raw,is_market_open:'true'}]){
    const p=new TwelveDataQuotes({now:()=>NOW,fetchImpl:async()=>new Response(JSON.stringify(value))});await assert.rejects(p.quote('AAPL'),e=>e.code==='INVALID_QUOTE');
  }
  const p=new TwelveDataQuotes({fetchImpl:async()=>new Response('x'.repeat(65537))});await assert.rejects(p.quote('AAPL'),e=>e.code==='INVALID_QUOTE');
});
test('provider failures redact private credentials and enforce shared request budget',async()=>{
  const p=new TwelveDataQuotes({apiKey:'secret-unit-fixture',now:()=>NOW,fetchImpl:async()=>{throw Error('URL contains secret-unit-fixture');}});
  for(let i=0;i<8;i++)await assert.rejects(p.quote('AAPL'),e=>e.code==='PROVIDER_UNAVAILABLE'&&!e.message.includes('secret-unit-fixture'));
  await assert.rejects(p.quote('AAPL'),e=>e.code==='PROVIDER_RATE_LIMIT');
});
test('HTTP simulator supports trading/cancellation and rejects real routes, cross-origin, forged quotes and duplicate execution',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stocks-http-test-'));const provider={apiKey:'unit-test-only',quote:async(symbol)=>({symbol,currency:'USD',priceUsd:'100',provider:'Twelve Data',interval:'1min',timestamp:NOW-10000,receivedAt:NOW,marketOpen:true})};
  const app=await createSimulatorServer({port:0,dataPath:join(dir,'ledger.json'),provider,now:()=>NOW,autoPoll:false});const base=`http://127.0.0.1:${app.port}`;
  try{
    await app.refresh('AAPL');const state=await (await fetch(base+'/__stocks_simulator/state')).json();
    const post=async(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Stocks-Token':state.token,...headers},body:JSON.stringify(body)});
    const buy={id:'http-buy-0000000001',symbol:'AAPL',currency:'USDT',side:'BUY',type:'MARKET',quantity:'1.25'};
    let res=await post('/__stocks_simulator/orders',buy);assert.equal(res.status,200);assert.equal((await res.json()).wallets.USDT.cash,'9875.00000000');
    res=await post('/__stocks_simulator/orders',buy);assert.equal((await res.json()).fills.length,1);
    const limit={...buy,id:'http-limit-00000001',type:'LIMIT',limitPrice:'80'};await post('/__stocks_simulator/orders',limit);
    res=await post('/__stocks_simulator/cancel',{id:limit.id});assert.equal((await res.json()).wallets.USDT.reserved,'0.00000000');
    res=await post('/__stocks_simulator/orders',{...buy,id:'http-sell-000000001',side:'SELL'});const done=await res.json();assert.equal(done.wallets.USDT.cash,'10000.00000000');assert.equal(done.positions['AAPL/USDT'].quantity,'0.00000000');
    for(const path of ['/api/orders','/api/wallet/transfer','/v1/orders','/__stocks_simulator/quotes','/__stocks_simulator/reset']){res=await post(path,{symbol:'AAPL',priceUsd:'999'});assert.notEqual(res.status,200);}
    res=await post('/__stocks_simulator/orders',{...buy,id:'http-bad-origin-001'},{Origin:'https://evil.example'});assert.equal(res.status,422);
    res=await post('/__stocks_simulator/orders',{...buy,id:'http-bad-token-0001'},{'X-Stocks-Token':'forged'});assert.equal(res.status,422);
    const hostStatus=await new Promise((ok,fail)=>{const request=http.get(base+'/__stocks_simulator/state',{headers:{Host:'evil.example'}},response=>{response.resume();ok(response.statusCode);});request.on('error',fail);});assert.equal(hostStatus,422);
    assert.equal(app.store.read().fills.length,2);assert.equal(app.server.address().address,'127.0.0.1');
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
