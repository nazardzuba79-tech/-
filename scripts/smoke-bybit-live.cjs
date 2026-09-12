// Read-only public provider smoke. No account/API keys or order endpoints.
const fs = require('node:fs');
const WebSocket = require('ws');
const { BybitMarketDataService } = require('../dist/services/marketData/bybit/BybitMarketDataService');
const { BybitLiveTickerCollector } = require('../dist/services/marketData/bybit/BybitLiveTickerCollector');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const rest=new BybitMarketDataService(), sockets=[];
  const collector=new BybitLiveTickerCollector(rest,{socket:url=>{const ws=new WebSocket(url,{handshakeTimeout:10000,maxPayload:1048576});sockets.push(ws);return ws;}});
  const report={at:new Date().toISOString(),livePossible:false};
  try {
    const [spot,linear]=await Promise.all([rest.listSpotInstruments(),rest.listLinearInstruments()]);
    report.spotInstruments=spot.value.length;report.linearInstruments=linear.value.length;
    collector.start();
    const deadline=Date.now()+25000;
    while(Date.now()<deadline && (collector.feed.status!=='live' || collector.counters.changedRows<1))await sleep(250);
    report.before=collector.diagnostics();
    if(collector.feed.status!=='live')throw new Error('Public WS did not become live within 25 seconds');
    sockets[0]?.terminate();
    const reconnectDeadline=Date.now()+15000;
    while(Date.now()<reconnectDeadline && (collector.feed.status!=='live' || collector.counters.reconnects<1))await sleep(250);
    report.after=collector.diagnostics();report.livePossible=collector.feed.status==='live' && collector.counters.reconnects>=1;
  } catch(error) { report.error=String(error.message); }
  finally { collector.stop();report.restRequests=rest.upstreamRequestCount;
    const json=JSON.stringify(report,null,2);if(process.argv[2])fs.writeFileSync(process.argv[2],json);console.log(json); }
})().catch(()=>{process.exitCode=1;});
