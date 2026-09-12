// Deterministic public-provider fixture through REAL REST/WS/internal WS/SSE.
// Load values below are test data only; this module is never a runtime import.
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const ts=require('typescript');const express=require('express');const {createServer}=require('node:http');
const {once}=require('node:events');const {randomBytes}=require('node:crypto');const {performance}=require('node:perf_hooks');
const WebSocket=require('ws');
const {BybitMarketDataService}=require('../dist/services/marketData/bybit/BybitMarketDataService');
const {BybitLiveTickerCollector}=require('../dist/services/marketData/bybit/BybitLiveTickerCollector');
const {collectorServer}=require('../dist/services/marketData/live/collectorServer');
const {MarketDataCollectorClient}=require('../dist/services/marketData/live/MarketDataCollectorClient');
const {marketLiveRouter}=require('../dist/api/routes/marketLive');
const source=fs.readFileSync(path.join(__dirname,'../frontend/src/lib/liveMarketStore.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
const moduleBox={exports:{}};vm.runInNewContext(compiled,{module:moduleBox,exports:moduleBox.exports,require,Date,Map,Set,Math,JSON,Number,Error,setTimeout,clearTimeout,setInterval,clearInterval});
const {LiveMarketStore}=moduleBox.exports;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async predicate=>{const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)throw new Error('Fixture timeout');await sleep(10);}};
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
function percentile(values,p){return values.length?[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]:null;}

async function measure(batchMs){
  const fixtures=Array.from({length:650},(_,i)=>({symbol:`ASSET${i}USDT`,baseCoin:`ASSET${i}`,quoteCoin:'USDT',status:'Trading',contractType:'LinearPerpetual',settleCoin:'USDT',fundingInterval:'480'}));
  const requests=[], peers=new Map(), latencies=[], downstreamLatencies=[], inputTimes=new Map();let incoming=0, subscriptions=0, closed=false;
  const app=express();
  app.get('/v5/market/instruments-info',(req,res)=>{
    requests.push(req.originalUrl);let list=[...fixtures,{...fixtures[0],symbol:'INACTIVEUSDT',status:'Closed'}],nextPageCursor='';
    if(req.query.category==='linear'){if(req.query.cursor)list=list.slice(350);else{list=list.slice(0,350);nextPageCursor='next';}}
    res.json({retCode:0,time:Date.now(),result:{list,nextPageCursor}});
  });
  app.get('/v5/market/tickers',(req,res)=>{requests.push(req.originalUrl);res.json({retCode:0,time:Date.now(),result:{list:fixtures.map(i=>({symbol:i.symbol,lastPrice:'1',bid1Price:'0.9',ask1Price:'1.1',highPrice24h:'2',lowPrice24h:'0.5',price24hPcnt:'0',volume24h:'0',turnover24h:'0'}))}});});
  const providerServer=createServer(app),wss=new WebSocket.WebSocketServer({server:providerServer});
  wss.on('connection',(ws,req)=>{const topics=new Set();peers.set(ws,{category:req.url.includes('spot')?'spot':'linear',topics});
    ws.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.op==='subscribe'){subscriptions++;m.args.forEach(t=>topics.add(t));ws.send(JSON.stringify({op:'subscribe',success:true,req_id:m.req_id}));}else if(m.op==='ping')ws.send(JSON.stringify({op:'pong'}));});
    ws.on('close',()=>peers.delete(ws));
  });
  const providerUrl=await listen(providerServer),rest=new BybitMarketDataService({baseUrl:providerUrl});
  const collector=new BybitLiveTickerCollector(rest,{spotUrl:providerUrl.replace('http','ws')+'/spot',linearUrl:providerUrl.replace('http','ws')+'/linear',batchMs});
  const token=randomBytes(32).toString('hex'),internal=collectorServer(collector.feed,token,()=>collector.diagnostics());
  const collectorUrl=await listen(internal.server),client=new MarketDataCollectorClient(collectorUrl,token);
  const api=express();api.use('/api/v1',marketLiveRouter(client.feed));const apiServer=createServer(api),apiUrl=await listen(apiServer);
  let browserConnections=0, initialBytes=0,deltaBytes=[], outboundBatches=0, measuring=false;
  // SSE adapter for Node measurement: real HTTP and the real frontend store,
  // no DOM/rendering latency claim. Browser-native QA is separate.
  class Source {
    events=new Map();abort=new AbortController();onerror=null;
    constructor(){browserConnections++;void this.run();}
    addEventListener(name,listener){this.events.set(name,listener);}
    close(){this.abort.abort();}
    async run(){try{const response=await fetch(apiUrl+'/api/v1/market/live',{signal:this.abort.signal});let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString();let index;
      while((index=text.indexOf('\n\n'))>=0){const event=text.slice(0,index);text=text.slice(index+2);const name=event.match(/^event: (.+)$/m)?.[1],data=event.match(/^data: (.+)$/m)?.[1];if(!data)continue;
        const frame=JSON.parse(data);if(name==='snapshot' && frame.rows.length)initialBytes=Buffer.byteLength(data);
        if(measuring && name==='delta'){downstreamLatencies.push(Date.now()-frame.sentAt);deltaBytes.push(Buffer.byteLength(data));}
        this.events.get(name)?.({data});
      }
    }}catch{if(!this.abort.signal.aborted)this.onerror?.();}}
  }
  const store=new LiveMarketStore(()=>new Source());
  const unsubs=Array.from({length:100},()=>store.subscribe(()=>{}));
  const feedOff=collector.feed.subscribe(frame=>{if(measuring && frame.type==='delta'){outboundBatches++;inputTimes.set(frame.rows[0]?.sequence,performance.now());}});
  const clientOff=client.feed.subscribe(frame=>{if(measuring && frame.type==='delta'){const start=inputTimes.get(frame.rows[0]?.sequence);if(start!==undefined)latencies.push(performance.now()-start);}});
  try {
    collector.start();await until(()=>collector.feed.status==='live');client.start();await until(()=>store.getState().rows.size===1300);
    const initialSnapshotBytes=Buffer.byteLength(JSON.stringify(collector.feed.snapshot()));
    const heapBefore=process.memoryUsage();const start=performance.now();let sequence=0;measuring=true;
    // 10,000 messages/s for 3 seconds, 40 distinct symbols (20/category)
    // repeatedly overwritten. All payloads follow public ticker semantics.
    for(let tick=0;tick<60;tick++){
      for(let j=0;j<250;j++)for(const [ws,peer] of peers){
        const symbol=`ASSET${j%20}USDT`;ws.send(JSON.stringify({topic:`tickers.${symbol}`,type:peer.category==='spot'?'snapshot':'delta',ts:Date.now(),cs:++sequence,data:{symbol,lastPrice:String(sequence),volume24h:'0'}}));incoming++;
      }
      await sleep(Math.max(0,start+(tick+1)*50-performance.now()));
    }
    await sleep(batchMs+100);const elapsedMs=performance.now()-start;measuring=false;
    const lookupStart=performance.now();for(let pass=0;pass<100;pass++)for(const key of store.getState().rows.keys())store.getState().rows.get(key);
    const lookupMs=performance.now()-lookupStart;
    const result={batchMs,fixtureAssets:650,activeInstruments:collector.book.instruments.size,tickers:collector.book.rows.size,
      restRequests:requests.length,restPaths:requests,bybitConnections:peers.size,subscriptionRequests:subscriptions,backendConnections:client.counters.connections,
      frontendSubscribers:100,browserConnections,fixtureInputMessages:incoming,elapsedMs,incomingPerSecond:incoming/(elapsedMs/1000),
      coalescedBatches:outboundBatches,batchesPerSecond:outboundBatches/(elapsedMs/1000),
      collectorToBackendMs:{p50:percentile(latencies,.5),p95:percentile(latencies,.95)},
      backendToFrontendStoreMs:{p50:percentile(downstreamLatencies,.5),p95:percentile(downstreamLatencies,.95)},
      initialSnapshotBytes,browserSnapshotBytes:initialBytes,deltaBatchBytes:{p50:percentile(deltaBytes,.5),p95:percentile(deltaBytes,.95)},
      tickerBookSerializedBytes:collector.diagnostics().serializedBookBytes,processMemoryBytes:heapBefore,lookup130000Ms:lookupMs,
      counts:collector.diagnostics()};
    if(result.activeInstruments!==1300 || result.restRequests!==5 || result.bybitConnections!==2 || browserConnections!==1)throw new Error('Scale invariant failed');
    return result;
  }finally{closed=true;unsubs.forEach(f=>f());feedOff();clientOff();client.stop();collector.stop();internal.close();for(const ws of wss.clients)ws.terminate();wss.close();providerServer.close();apiServer.closeAllConnections();apiServer.close();}
}
(async()=>{const results=[];for(const batchMs of [200,250,500])results.push(await measure(batchMs));
  const report={measuredAt:new Date().toISOString(),environment:'Local Windows loopback; deterministic fixture; real transports; frontend store in Node; not production or DOM paint latency',results};
  const json=JSON.stringify(report,null,2);if(process.argv[2])fs.writeFileSync(process.argv[2],json);console.log(json);
})().catch(error=>{console.error(error);process.exitCode=1;});
