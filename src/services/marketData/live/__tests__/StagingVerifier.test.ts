import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
const {settings,Tracker,SSEParser,parseFrame,secretIn,safeDiagnostics,requestCollector,collectorStage,collectorDiagnostic,observeSSE,verify}=require('../../../../../scripts/verify-market-data-staging.cjs');
const token=randomBytes(24).toString('hex');
const row=(overrides:any={})=>({id:'spot:BTCUSDT',pair:'BTC/USDT',symbol:'BTC/USDT',provider:'bybit',providerSymbol:'BTCUSDT',marketType:'spot',baseAsset:'BTC',quoteAsset:'USDT',settleAsset:null,lastPrice:1,bidPrice:null,askPrice:null,high24h:null,low24h:null,volume24h:0,quoteVolume24h:0,changePercent24h:0,indexPrice:null,markPrice:null,fundingRate:null,fundingIntervalMinutes:null,openInterest:null,openInterestValue:null,providerEventAt:10,sequence:1,receivedAt:10,fetchedAt:10,stale:false,...overrides});
const frame=(type='snapshot',revision=1,rows=[row()],epoch='a')=>JSON.stringify({version:1,type,rows,epoch,revision,status:'live',sentAt:Date.now()});
describe('read-only staging verifier',()=>{
  test.each(['http://remote.invalid','https://u:p@host.invalid','https://host.invalid?token=x','https://host.invalid/#secret','https://host.invalid/private'])('refuses unsafe collector URL %s',url=>{
    expect(()=>settings({MARKET_DATA_COLLECTOR_URL:url,MARKET_DATA_COLLECTOR_TOKEN:token,VOLTEX_API_URL:'https://api.invalid'})).toThrow();
  });
  test('accepts loopback QA and HTTPS origins; API /api/v1 suffix is normalized',()=>{
    expect(settings({MARKET_DATA_COLLECTOR_URL:'http://127.0.0.1:1',MARKET_DATA_COLLECTOR_TOKEN:token,VOLTEX_API_URL:'https://api.invalid/api/v1',STAGING_SOAK_MINUTES:'15'})).toMatchObject({api:'https://api.invalid',soakMs:900000});
  });
  test('missing config fails without IO or printing any environment value',async()=>{
    const log=jest.fn(),result=await verify({MARKET_DATA_COLLECTOR_TOKEN:token},log);
    expect(result.ok).toBe(false);expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });
  test('snapshot/delta identity, real zero, null and stale remain distinct',()=>{
    const t=new Tracker(token);t.receive(frame());t.receive(frame('delta',2,[row({lastPrice:0,stale:true})]));
    expect(t.rows.get('spot:BTCUSDT')).toMatchObject({lastPrice:0,markPrice:null,stale:true});
    expect(t.report()).toMatchObject({tickers:1,assets:1,stale:1,deltas:1});
  });
  test('reconnect rejects same-epoch rollback and delta before authoritative snapshot',()=>{
    const t=new Tracker(token);t.receive(frame('snapshot',5));t.reconnect();expect(()=>t.receive(frame('snapshot',4))).toThrow();
    expect(()=>t.receive(frame('delta',6))).toThrow();t.receive(frame('snapshot',7));expect(t.report().revisionGaps).toBe(2);
  });
  test('rejects old ticker timestamp and malformed values, including absent instead of null',()=>{
    const t=new Tracker(token);t.receive(frame());expect(()=>t.receive(frame('delta',2,[row({providerEventAt:9})]))).toThrow();
    for(const lastPrice of ['0',undefined])expect(()=>parseFrame(frame('snapshot',1,[row({lastPrice})]))).toThrow();
    expect(()=>parseFrame(frame('snapshot',1,[row(),row()]))).toThrow();
  });
  test('SSE parser handles split CRLF, comments, event/data chunks and multiple events',()=>{
    const t=new Tracker(token),p=new SSEParser((data:string,event:string)=>t.receive(data,event));
    const wire=`: ping\r\n\r\nevent: snapshot\r\ndata: ${frame()}\r\n\r\nevent: delta\r\ndata: ${frame('delta',2)}\r\n\r\n`;
    for(let i=0;i<wire.length;i+=13)p.push(wire.slice(i,i+13));expect(t.report().frames).toBe(2);
    expect(()=>p.push('x'.repeat(16_065_537))).toThrow();
  });
  test('tokens in raw, encoded, JSON-escaped or base64 SSE cause a hard failure',()=>{
    for(const text of [token,encodeURIComponent(token),Buffer.from(token).toString('base64')])expect(secretIn(text,token)).toBe(true);
    expect(secretIn(JSON.stringify('a"b'),'a"b')).toBe(true);
    const t=new Tracker(token);expect(()=>t.receive(frame().replace('"status":"live"',`"leak":"${token}","status":"live"`))).toThrow();
  });
  test('diagnostics output allows numeric counters and known states, never arbitrary server config',()=>{
    const d=safeDiagnostics({token,url:token,status:token,memory:{rss:100,secret:token},connections:[{category:token,state:token,topics:3}]});
    expect(JSON.stringify(d)).not.toContain(token);expect(d.memory.rss).toBe(100);
  });
  test.each([
    'collector_health','snapshot_missing_token','snapshot_invalid_token','diagnostics_missing_token',
    'diagnostics_invalid_token','ws_missing_token','ws_invalid_token','authenticated_snapshot_fetch',
    'authenticated_snapshot_parse','authenticated_diagnostics_fetch','authenticated_diagnostics_parse',
  ])('collector exception is attributed to safe stage %s without exposing the original error',async(stage:string)=>{
    let failure:any;
    try{await collectorStage(stage,async()=>{throw new Error(`Authorization: Bearer ${token}; body=${token}`);});}catch(error){failure=error;}
    const diagnostic=collectorDiagnostic(failure);
    expect(diagnostic).toEqual({stage});expect(JSON.stringify(diagnostic)).not.toContain(token);
  });
  test('request timeout and secret leak retain the safe request operation only',async()=>{
    const config={collector:'https://collector.invalid',token};
    const hangingFetch=jest.fn((_url:string,options:any)=>new Promise((_resolve,reject)=>{
      const fail=()=>reject(new Error(`Authorization: Bearer ${token}`));
      if(options.signal.aborted)fail();else options.signal.addEventListener('abort',fail,{once:true});
    }));
    let timeout:any;
    try{await collectorStage('authenticated_snapshot_fetch',()=>requestCollector(config,'/internal/v1/snapshot',token,hangingFetch,5));}catch(error){timeout=error;}
    expect(collectorDiagnostic(timeout)).toEqual({stage:'request_timeout',operation:'authenticated_snapshot_fetch'});
    let leak:any;
    try{await collectorStage('collector_health',()=>requestCollector(config,'/health',undefined,async()=>new Response(token)));}catch(error){leak=error;}
    expect(collectorDiagnostic(leak)).toEqual({stage:'secret_leak_check',operation:'collector_health'});
    expect(JSON.stringify([collectorDiagnostic(timeout),collectorDiagnostic(leak)])).not.toContain(token);
  });
  test.each([
    ['http_non_200',()=>({ok:false,status:503,headers:new Headers(),body:null})],
    ['wrong_content_type',()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:null})],
    ['missing_body',()=>({ok:true,status:200,headers:new Headers({'content-type':'text/event-stream'}),body:null})],
    ['body_read_error',()=>sseResponse({read:async()=>{throw new Error(`cookie=${token}; body=${token}`);},cancel:async()=>{}})],
    ['parser_error',()=>sseResponse({read:async()=>({done:false,value:new TextEncoder().encode('data: x\n\n')}),cancel:async()=>{}}),{parserFactory:()=>({push:()=>{throw new Error(`body=${token}`);}})}],
    ['tracker_validation',()=>sseResponse({read:async()=>({done:false,value:new TextEncoder().encode('event: snapshot\ndata: {}\n\n')}),cancel:async()=>{}})],
  ])('public SSE classifies %s without leaking transport details',async(reason:string,response:()=>any,dependencies:any={})=>{
    const diagnostics:any[]=[];
    await expect(observeSSE({api:'https://api.invalid'},new Tracker(token),10000,undefined,(event:any)=>diagnostics.push(event),
      {fetchFn:async()=>response(),...dependencies})).rejects.toMatchObject({reason});
    expect(diagnostics).toHaveLength(1);expect(diagnostics[0].reason).toBe(reason);expect(JSON.stringify(diagnostics)).not.toContain(token);
  });
  test('early EOF reconnects to the same endpoint, requires a snapshot, and continues with the same tracker',async()=>{
    jest.useFakeTimers({now:0});
    try{
      const diagnostics:any[]=[],tracker=new Tracker(token);let calls=0;
      const fetchFn=async(_url:string,options:any)=>{
        calls++;
        return calls===1
          ?sseResponse(sequenceReader([chunk('snapshot',1),{done:true}],options.signal))
          :sseResponse(sequenceReader([chunk('snapshot',2),chunk('delta',3)],options.signal));
      };
      const observation=observeSSE({api:'https://api.invalid'},tracker,20_000,undefined,(event:any)=>diagnostics.push(event),{fetchFn});
      await flushPromises();
      expect(calls).toBe(2);expect(tracker.report()).toMatchObject({snapshots:2,deltas:1,reconnects:1,revisionGaps:0,rejectedFrames:0});
      await jest.advanceTimersByTimeAsync(20_000);
      await expect(observation).resolves.toMatchObject({reason:'intended_duration_complete',reconnectCount:1});
      expect(diagnostics.map(event=>event.reason)).toEqual(['unexpected_eof','reconnect_succeeded','intended_duration_complete']);
      expect(JSON.stringify(diagnostics)).not.toContain(token);
    }finally{jest.useRealTimers();}
  });
  test('early EOF fails when reconnect cannot be established within the bounded grace',async()=>{
    jest.useFakeTimers({now:0});
    try{
      const diagnostics:any[]=[],tracker=new Tracker(token);let calls=0;
      const fetchFn=async(_url:string,options:any)=>{
        calls++;
        return calls===1?sseResponse(sequenceReader([chunk('snapshot',1),{done:true}],options.signal))
          :sseResponse(sequenceReader([],options.signal));
      };
      const observation=observeSSE({api:'https://api.invalid'},tracker,60_000,undefined,(event:any)=>diagnostics.push(event),{fetchFn,reconnectGraceMs:2_000});
      const outcome=expect(observation).rejects.toMatchObject({reason:'reconnect_failed'});
      await flushPromises();await jest.advanceTimersByTimeAsync(2_000);
      await outcome;
      expect(calls).toBe(2);expect(diagnostics.map(event=>event.reason)).toEqual(['unexpected_eof','reconnect_failed']);
      expect(JSON.stringify(diagnostics)).not.toContain(token);
    }finally{jest.useRealTimers();}
  });
  test('a delta before the authoritative reconnect snapshot remains a hard continuity failure',async()=>{
    const tracker=new Tracker(token);let calls=0;
    const fetchFn=async(_url:string,options:any)=>{
      calls++;
      return calls===1?sseResponse(sequenceReader([chunk('snapshot',5),{done:true}],options.signal))
        :sseResponse(sequenceReader([chunk('delta',6)],options.signal));
    };
    await expect(observeSSE({api:'https://api.invalid'},tracker,10_000,undefined,()=>{},{fetchFn}))
      .rejects.toMatchObject({reason:'tracker_validation'});
    expect(tracker.report()).toMatchObject({reconnects:1,revisionGaps:1,rejectedFrames:1});
  });
  test('a skipped revision after a valid reconnect snapshot remains a hard continuity failure',async()=>{
    const tracker=new Tracker(token);let calls=0;
    const fetchFn=async(_url:string,options:any)=>{
      calls++;
      return calls===1?sseResponse(sequenceReader([chunk('snapshot',5),{done:true}],options.signal))
        :sseResponse(sequenceReader([chunk('snapshot',6),chunk('delta',8)],options.signal));
    };
    await expect(observeSSE({api:'https://api.invalid'},tracker,10_000,undefined,()=>{},{fetchFn}))
      .rejects.toMatchObject({reason:'tracker_validation'});
    expect(tracker.report()).toMatchObject({snapshots:2,reconnects:1,revisionGaps:1,rejectedFrames:1});
  });
  test('EOF just before the 15-minute deadline reconnects until the intended deadline and passes',async()=>{
    jest.useFakeTimers({now:0});
    try{
      let calls=0;const diagnostics:any[]=[];
      const fetchFn=async(_url:string,options:any)=>{
        calls++;
        return calls===1?sseResponse(sequenceReader([chunk('snapshot',1),delayedDone(899_765)],options.signal))
          :sseResponse(sequenceReader([],options.signal));
      };
      const observation=observeSSE({api:'https://api.invalid'},new Tracker(token),900_000,undefined,(event:any)=>diagnostics.push(event),{fetchFn});
      await flushPromises();await jest.advanceTimersByTimeAsync(899_765);await flushPromises();
      expect(calls).toBe(2);expect(diagnostics[0]).toMatchObject({reason:'unexpected_eof',reconnectCount:1});
      await jest.advanceTimersByTimeAsync(235);
      await expect(observation).resolves.toMatchObject({reason:'intended_duration_complete',reconnectCount:1});
    }finally{jest.useRealTimers();}
  });
  test('intended duration is PASS while external abort and terminal silence remain distinct FAIL reasons',async()=>{
    const abortingFetch=async(_url:string,options:any)=>sseResponse({
      read:()=>new Promise((_resolve,reject)=>{const fail=()=>reject(new Error(`body=${token}`));
        if(options.signal.aborted)fail();else options.signal.addEventListener('abort',fail,{once:true});}),cancel:async()=>{},
    });
    const completed:any[]=[];
    await expect(observeSSE({api:'https://api.invalid'},new Tracker(token),5,undefined,(event:any)=>completed.push(event),{fetchFn:abortingFetch}))
      .resolves.toMatchObject({reason:'intended_duration_complete'});
    const external=new AbortController();external.abort();const interrupted:any[]=[];
    await expect(observeSSE({api:'https://api.invalid'},new Tracker(token),10000,external.signal,(event:any)=>interrupted.push(event),{fetchFn:abortingFetch}))
      .rejects.toMatchObject({reason:'external_abort'});
    expect(interrupted[0].reason).toBe('external_abort');

    jest.useFakeTimers();
    try{
      const tracker=new Tracker(token);tracker.lastAt=Date.now();const watched:any[]=[];
      const observation=observeSSE({api:'https://api.invalid'},tracker,60000,undefined,(event:any)=>watched.push(event),{fetchFn:abortingFetch});
      await Promise.resolve();jest.advanceTimersByTime(41000);await Promise.resolve();
      await expect(observation).rejects.toMatchObject({reason:'silence_watchdog'});
      expect(watched[0].reason).toBe('silence_watchdog');
    }finally{jest.useRealTimers();}
    expect(JSON.stringify([completed,interrupted])).not.toContain(token);
  });
  test('a normal 20-second observation retains the intended-duration PASS with no reconnect',async()=>{
    jest.useFakeTimers({now:0});
    try{
      const diagnostics:any[]=[];
      const observation=observeSSE({api:'https://api.invalid'},new Tracker(token),20_000,undefined,(event:any)=>diagnostics.push(event),{
        fetchFn:async(_url:string,options:any)=>sseResponse(sequenceReader([chunk('snapshot',1),chunk('delta',2)],options.signal)),
      });
      await flushPromises();await jest.advanceTimersByTimeAsync(20_000);
      await expect(observation).resolves.toMatchObject({reason:'intended_duration_complete',reconnectCount:0});
      expect(diagnostics).toHaveLength(1);expect(diagnostics[0]).toMatchObject({reason:'intended_duration_complete',reconnectCount:0});
    }finally{jest.useRealTimers();}
  });
  test('CLI uses env only, no local storage, financial imports, mutation requests or secret-bearing URLs',()=>{
    const source=readFileSync(resolve(__dirname,'../../../../../scripts/verify-market-data-staging.cjs'),'utf8');
    expect(source).toContain('Authorization:`Bearer ${');expect(source).toContain("redirect:'error'");
    expect(source).not.toMatch(/localStorage|sessionStorage|NEXT_PUBLIC|DATABASE_URL|method:\s*['"](?:POST|PUT|PATCH|DELETE)|console\.(?:error|log)\(.*(?:config|token|\.stack)/);
    expect(source).not.toMatch(/DIAGNOSTIC[^\n]*(?:error\.(?:message|stack|cause)|response\.(?:body|headers)|Authorization|token)/);
  });
});

function sseResponse(reader:any) {
  return {ok:true,status:200,headers:new Headers({'content-type':'text/event-stream'}),body:{getReader:()=>reader}};
}
const encoded=(text:string)=>new TextEncoder().encode(text);
const chunk=(type:string,revision:number)=>({done:false,value:encoded(`event: ${type}\ndata: ${frame(type,revision)}\n\n`)});
const delayedDone=(ms:number)=>({delay:ms,done:true});
function sequenceReader(items:any[],signal:AbortSignal) {
  let index=0;
  return {read:()=>{
    if(index<items.length){const item=items[index++];if(item.delay!==undefined)return new Promise(resolve=>setTimeout(()=>resolve({done:item.done}),item.delay));return Promise.resolve(item);}
    return new Promise((_resolve,reject)=>{const fail=()=>reject(new Error(`transport=${token}`));
      if(signal.aborted)fail();else signal.addEventListener('abort',fail,{once:true});});
  },cancel:async()=>{}};
}
async function flushPromises(){for(let i=0;i<8;i++)await Promise.resolve();}
