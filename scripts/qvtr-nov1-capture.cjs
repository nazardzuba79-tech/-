/* Read-only public snapshot -> local/offline private review. No market price mutation. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
const {buildQvtrNov1Isolated,previewQvtrNov1Price,NOV1_PEAK_AT,NOV1_CORRECTION_END,NOV1_REJOIN_AT}=require('../src/services/listings/qvtrNov1Isolated.ts');
(async()=>{
  const source=JSON.parse(fs.readFileSync('config/isolated/qvtr-source-20261031-refresh.json','utf8'));
  const response=await fetch('https://market.voltextech.net/market/test-assets/QVTR-USDT',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('READ_ONLY_SOURCE_HTTP_'+response.status);
  const live=await response.json(),receivedAt=Date.now();
  const observation={listingId:live.listingId,version:live.version,countdown:live.countdown,source:'simulation',isTradable:live.isTradable,serverTime:live.state?.serverTime,lastPrice:live.state?.lastPrice};
  const review=buildQvtrNov1Isolated(source.config,observation,receivedAt);
  const dirname=path.join('artifacts','qvtr-isolated','nov1-'+review.effectiveAt);
  fs.mkdirSync(dirname,{recursive:true});
  const observations=[];
  for(let t=review.effectiveAt;t<=NOV1_REJOIN_AT;t+=300000)
    observations.push({time:new Date(t).toISOString(),modeledPrice:previewQvtrNov1Price(review,t)});
  for(const target of [NOV1_PEAK_AT,NOV1_CORRECTION_END,NOV1_REJOIN_AT])
    observations.push({time:new Date(target).toISOString(),modeledPrice:previewQvtrNov1Price(review,target)});
  observations.sort((a,b)=>a.time.localeCompare(b.time));
  const fd=fs.openSync(path.join(dirname,'review.json'),'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify({review,observations,source:'OFFLINE_MODEL_NOT_MARKET_QUOTE',executable:false,promotionAllowed:false},null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  console.log(JSON.stringify({mode:'ISOLATED_QVTR_REVIEW_ONLY',start:new Date(review.effectiveAt).toISOString(),anchor:review.observed.lastPrice,peak:new Date(NOV1_PEAK_AT).toISOString(),peakPrice:review.peakPrice,correctionPrice:review.correctionPrice,dir:dirname,promotionAllowed:false}));
})().catch(e=>{console.error('QVTR NOV1 isolated capture:',e.message);process.exitCode=1});
