import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { Store } from './core.mjs';
import { createStockServer } from './server.mjs';

const instrument={...JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)))[0],enabled:true,dataRightsStatus:'confirmed'};
const now=Date.UTC(2026,9,7,15);

async function fixture(run){
  const directory=mkdtempSync(join(tmpdir(),'stocks-http-query-'));
  const store=new Store(join(directory,'history.sqlite'));
  const rows=Array.from({length:3},(_,n)=>({instrumentId:instrument.instrumentId,interval:'15m',openTimeUtc:now-(3-n)*900000,closeTimeUtc:now-(2-n)*900000,open:'100.001000',high:'102',low:'99',close:'101.1200',volume:n===1?'0.001200':null,currency:instrument.currency,provider:instrument.provider,providerTimestamp:now,fetchedAt:now,adjustmentMode:'unadjusted'}));
  store.write(rows,instrument,now);
  const observation={onHit:null};
  const server=createStockServer({store,instruments:[instrument],profile:{measure:(_name,fn)=>fn(),count:name=>{if(name==='cacheHits')observation.onHit?.();}}});
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/stocks/history/${instrument.instrumentId}`;
    await run({store,server,base,rows,observation});
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();
    rmSync(directory,{recursive:true,force:true});
  }
}

test('cached history preserves decoded query, duplicate rejection and range boundaries',async()=>{
  await fixture(async({base,rows})=>{
    const expected=rows.map(({openTimeUtc,closeTimeUtc,open,high,low,close,volume,fetchedAt})=>({openTimeUtc,closeTimeUtc,open,high,low,close,volume,fetchedAt}));
    for(const query of ['', '?', '?limit=300', '?%6cimit=3e2', '?limit=0x12c', '?limit=300&before=9007199254740991', '?before=9007199254740991&limit=300', '?&&limit=300&&']){
      const response=await fetch(base+query);assert.equal(response.status,200,query);
      assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');
      assert.deepEqual((await response.json()).candles,expected,query);
    }
    const historical=await (await fetch(base+`?before=${rows[2].openTimeUtc}&limit=1`)).json();
    assert.deepEqual(historical.candles,[expected[1]]);assert.equal(historical.next,expected[1].openTimeUtc);
    assert.deepEqual((await (await fetch(base+'?before=0')).json()).candles,[]);
    for(const query of ['?limit=1&limit=2','?limit=1&%6cimit=2','?before=1&before=2','?unknown=1','?=1','?limit','?limit=','?limit=0','?limit=501','?limit=1.1','?limit=NaN','?before=-1','?before=9007199254740992','?before=Infinity']){
      const response=await fetch(base+query);assert.equal(response.status,400,query);
      assert.deepEqual(await response.json(),{error:'unavailable'},query);
    }
    const emptyBefore=await fetch(base+'?before=');assert.equal(emptyBefore.status,200);
    assert.deepEqual((await emptyBefore.json()).candles,[]);
  });
});

test('cached followers await one encoded page and preserve its exact financial strings',async()=>{
  await fixture(async({store,server,base,observation})=>{
    const expected=await (await fetch(base)).text();
    server.stockCache.clear();
    const key=`${instrument.instrumentId}:300:${Number.MAX_SAFE_INTEGER}`;
    let release,loads=0,sqlReads=0;
    const original=store.encodedHistory.bind(store);
    store.encodedHistory=(...args)=>{sqlReads++;return original(...args);};
    const pending=server.stockCache.get(key,()=>{loads++;return new Promise(resolve=>{release=resolve;});});
    await Promise.resolve();
    let observed=0,timer;
    const entered=new Promise((resolve,reject)=>{
      observation.onHit=()=>{if(++observed===20)resolve();};
      timer=setTimeout(()=>reject(Error('Pending followers did not enter the HTTP handler')),3000);
    });
    const requests=Array.from({length:20},async()=>{const response=await fetch(base);assert.equal(response.status,200);return response.text();});
    try{
      await entered;
      release({body:Buffer.from(expected),latestTime:now-900000});await pending;
      assert.deepEqual(await Promise.all(requests),Array(20).fill(expected));
    }finally{
      clearTimeout(timer);release({body:Buffer.from(expected),latestTime:now-900000});await pending;await Promise.allSettled(requests);
    }
    assert.equal(loads,1);assert.equal(sqlReads,0);assert.equal(server.stockCache.pending.size,0);
    assert.equal(server.stockCache.bytes,Buffer.byteLength(expected)+128);
  });
});

test('100 cached fetch readers reuse bounded transport without extra SQL reads',async()=>{
  await fixture(async({store,server,base})=>{
    let connections=0,active=0,peak=0,reads=0;
    const original=store.encodedHistory.bind(store);
    store.encodedHistory=(...args)=>{reads++;return original(...args);};
    server.on('connection',socket=>{connections++;peak=Math.max(peak,++active);socket.on('close',()=>active--);});
    const wave=()=>Promise.all(Array.from({length:100},async()=>{
      const response=await fetch(base);assert.equal(response.status,200);return response.text();
    }));
    const first=await wave();await new Promise(resolve=>setImmediate(resolve));
    const second=await wave();assert.deepEqual(second,first);
    assert.equal(connections,100);assert.equal(peak,100);assert.equal(reads,1);
    assert.equal(server.maxConnections,128);assert.equal(server.requestTimeout,10000);assert.equal(server.headersTimeout,10000);
  });
});

test('idle transport still closes without an active request or a client timeout',async()=>{
  await fixture(async({server,base})=>{
    const url=new URL(base);let timer;
    const socket=connect({host:url.hostname,port:Number(url.port)});
    try{
      await new Promise((resolve,reject)=>{
        let response='';
        timer=setTimeout(()=>reject(Error('Idle transport did not close within its existing 10s timeout')),10000);
        socket.on('error',reject);
        socket.on('connect',()=>socket.write(`GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: keep-alive\r\n\r\n`));
        socket.on('data',chunk=>{response+=chunk.toString();});
        socket.on('close',()=>{try{assert.match(response,/^HTTP\/1\.1 200 /);assert.match(response,/Connection: keep-alive/i);resolve();}catch(error){reject(error);}});
      });
      assert.equal(socket.destroyed,true);assert.equal(server.timeout,10000);
    }finally{clearTimeout(timer);socket.destroy();}
  });
});
