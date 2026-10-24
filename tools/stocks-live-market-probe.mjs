// Explicit bounded PUBLIC READ-ONLY developer probe, never a release activation.
// No broker credentials, user JWT, financial route, rights attestation or orders.
import { LiveMarketHub } from '../services/stocks-global/live-market.mjs';
import { LIVE_PROVIDERS } from '../services/stocks-global/live-catalog.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeMexcPublic } from '../services/stocks-global/mexc-public-protobuf.mjs';
if(!process.argv.includes('--public-read-only'))throw Error('EXPLICIT_PUBLIC_READ_ONLY_REQUIRED');
const out=resolve(process.argv[process.argv.indexOf('--out')+1]??'.');await mkdir(out,{recursive:true});
const events=[],frames=[],counts=new Map(),hub=new LiveMarketHub({liveVenues:LIVE_PROVIDERS,feedOptions:{onPublicFrame:(venue,raw,binary)=>{try{const b=Buffer.from(raw);let d=venue==='mexc'&&binary?decodeMexcPublic(b):JSON.parse((venue==='bingx'&&b[0]===31?gunzipSync(b,{maxOutputLength:262144}):b).toString());const topic=d.channel??d.topic??d.dataType??d.arg?.channel??d.e??'ack',key=venue+':'+topic;if((counts.get(key)??0)<3&&frames.length<200){counts.set(key,(counts.get(key)??0)+1);frames.push({venue,binary,at:Date.now(),base64:b.toString('base64'),topic});}}catch{}},onEvent:e=>{if(events.length<4000)events.push({...e,at:Date.now()});}}});
const report={startedAt:new Date().toISOString(),node:process.version,mode:'public-read-only-no-trading',catalogue:[],instruments:[],events:[]};let renew;
try{const rows=await hub.catalogue();report.catalogue=rows.map(i=>({id:i.id,issuer:i.issuer,currency:i.currency,exists:i.exists,online:i.online,error:i.sourceError}));const selected=rows.filter(i=>['AAPL','TSLA'].includes(i.ticker)&&i.issuer!=='ondo'&&i.online);for(const i of selected)hub.setStockDemand('probe:'+i.id,i.id);
  renew=setInterval(()=>{for(const i of selected)hub.setStockDemand('probe:'+i.id,i.id);},3000);
  await new Promise(r=>setTimeout(r,7000));
  for(const i of selected){const result={id:i.id,issuer:i.issuer,currency:i.currency};try{result.quote=await hub.quote(i.id,{includeUsdc:false});}catch(e){result.quoteError=e.code??e.message;}try{const h=await hub.history(i.id,'15m');result.history={rows:h.candles.length,first:h.candles[0],last:h.candles.at(-1)};}catch(e){result.historyError=e.code??e.message;}report.instruments.push(result);}
  await new Promise(r=>setTimeout(r,3000));for(const i of selected){const c=hub.feed.candle(i.id,'15m');report.instruments.find(r=>r.id===i.id).nativeWsCandle=c??null;}
  report.metrics=hub.feed.metrics;report.events=events;report.finishedAt=new Date().toISOString();await writeFile(resolve(out,'public-wire-fixtures.json'),JSON.stringify(frames,null,2));await writeFile(resolve(out,'live-market-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({metadata:rows.filter(i=>i.online).length,results:report.instruments.map(i=>({id:i.id,quote:i.quote?'PASS':i.quoteError,history:i.history?.rows??i.historyError,nativeCandle:!!i.nativeWsCandle})),metrics:report.metrics,errors:events.filter(e=>['error','rejected'].includes(e.type)).slice(0,25)},null,2));
}finally{clearInterval(renew);hub.close();}
