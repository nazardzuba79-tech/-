// Operator-only metadata discovery. Never imported by HTTP/collector/frontend.
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const countries=[['United States','USA','America/New_York',100],['Russia','Russia','Europe/Moscow',50],['Japan','Asia','Asia/Tokyo',20],['Hong Kong','Asia','Asia/Hong_Kong',20],['China','Asia','Asia/Shanghai',20],['South Korea','Asia','Asia/Seoul',20],['India','Asia','Asia/Kolkata',20]];
const preferred=new Set('AAPL MSFT NVDA AMZN GOOGL META BRK.B JPM V MA WMT XOM UNH JNJ PG COST HD ABBV NFLX BAC SBER GAZP LKOH GMKN NVTK TATN ROSN YDEX MGNT MTSS 7203 6758 8306 9984 6501 9983 8035 6861 6098 9432 0700 9988 3690 0005 1299 0941 0939 1398 2318 9618 600519 601398 600036 601318 000858 300750 601288 600900 002594 600030 005930 000660 005380 000270 035420 068270 051910 006400 035720 105560 RELIANCE TCS HDFCBANK ICICIBANK INFY BHARTIARTL ITC LT SBIN HINDUNILVR'.split(' '));
const rows=[],sources=[];
for(const [country,region,zone,max] of countries){
  const url='https://api.twelvedata.com/stocks?country='+encodeURIComponent(country);
  const r=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'error'});if(!r.ok)throw Error(`Metadata HTTP ${r.status}`);
  const text=await r.text(),data=JSON.parse(text).data;if(!Array.isArray(data))throw Error('No metadata '+country);
  const candidates=data.filter(i=>i.type==='Common Stock'&&/^[A-Z0-9]{4}$/.test(i.mic_code)&&/^[A-Za-z0-9._-]{1,24}$/.test(i.symbol)&&/^[A-Z]{3}$/.test(i.currency));
  candidates.sort((a,b)=>Number(preferred.has(b.symbol))-Number(preferred.has(a.symbol))||a.symbol.localeCompare(b.symbol)||a.mic_code.localeCompare(b.mic_code));
  for(const i of candidates){if(rows.filter(x=>x.country===country).length>=max)break;const instrumentId=i.mic_code+':'+i.symbol;if(rows.some(x=>x.instrumentId===instrumentId))continue;
    rows.push({instrumentId,symbol:i.symbol,exchange:i.mic_code,name:i.name,type:'stock',region,country,currency:i.currency,exchangeTimeZone:zone,provider:'twelvedata',providerSymbol:i.symbol,dataRightsStatus:'unconfirmed',logoPath:null,enabled:false,selectionStatus:'candidate-liquidity-review-required',sourceUrl:url});}
  sources.push({country,url,retrievedAt:new Date().toISOString(),sha256:createHash('sha256').update(text).digest('hex'),providerListings:data.length,prepared:rows.filter(x=>x.country===country).length});
  await new Promise(r=>setTimeout(r,2000));
}
const indexUrl='https://api.twelvedata.com/indices';
const indexText=await(await fetch(indexUrl,{signal:AbortSignal.timeout(20000),redirect:'error'})).text();
const indexRows=JSON.parse(indexText).data;
for(const symbol of ['N225','HSI','KOSPI','NSEI','000001']){
  const i=indexRows.find(x=>x.symbol===symbol),slot=rows.findLastIndex(x=>x.country===i?.country);
  if(!i||slot<0)throw Error('Missing index metadata');
  rows[slot]={...rows[slot],instrumentId:i.mic_code+':'+symbol,symbol,exchange:i.mic_code,name:i.name,type:'index',currency:i.currency,providerSymbol:symbol,sourceUrl:indexUrl,selectionStatus:'index-metadata-verified-rights-pending'};
}
sources.push({url:indexUrl,retrievedAt:new Date().toISOString(),sha256:createHash('sha256').update(indexText).digest('hex'),prepared:5});
await writeFile(new URL('./manifest.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
await writeFile(new URL('./catalogue-sources.json',import.meta.url),JSON.stringify(sources,null,2)+'\n');
console.log(JSON.stringify(sources));
