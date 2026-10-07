'use strict';
// Homepage last-good snapshot: after one visit that confirmed real market
// data, a reload paints that data before any API request is answered and
// asks no market provider for anything while the snapshot is under six
// hours old. Fixture API on loopback only; nothing external is contacted.
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const{chromium}=require(process.env.HOME_QA_PLAYWRIGHT||'playwright');

const OUT=path.resolve('docs/qa/home-snapshot-reload');
fs.mkdirSync(OUT,{recursive:true});
const SNAPSHOT_KEY='voltex.home.market.v1';
// Market DATA reads: quotes, hero book/candles/trades, rankings, global
// figures, CFD quotes and the contract list. Asset-icon metadata under
// /market/assets is a lookup for logos, not a provider read; it is reported
// on its own and never counted here.
const MARKET=/\/api\/v1\/(market\/external\/|market\/global|cfd\/(?:display\/)?tickers|futures\/config)/;
const METADATA=/\/api\/v1\/market\/assets\//;
const EXPECTED_MARKET_PATHS=['/market/external/tickers','/market/external/orderbook/BTC-USDT','/market/external/candles/BTC-USDT','/market/external/trades/BTC-USDT','/market/external/rankings','/market/global','/cfd/tickers','/futures/config'].map(value=>'/api/v1'+value).sort();
const report={startedAt:new Date().toISOString(),firstVisit:{},reload:{},coldVisit:{},writes:[],webSockets:[],pageErrors:[],findings:[]};
let server,browser,page;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const candles=Array.from({length:48},(_,i)=>{const open=76000+i*9,close=open+(i%2?14:-8);return{time:1_799_990_000+i*900,open,high:Math.max(open,close)+12,low:Math.min(open,close)-10,close,volume:40+i};});
const tickers=[
 {pair:'BTC/USDT',lastPrice:'76746',bidPrice:'76745.9',askPrice:'76746.1',high24h:'77949',low24h:'76459.7',volume24h:'892',quoteVolume24h:'68590000',changePercent24h:'-0.67'},
 {pair:'ETH/USDT',lastPrice:'2479.53',bidPrice:'2479.5',askPrice:'2479.6',high24h:'2520',low24h:'2440',volume24h:'9000',quoteVolume24h:'22300000',changePercent24h:'-1.82'},
 {pair:'SOL/USDT',lastPrice:'99.78',bidPrice:'99.77',askPrice:'99.79',high24h:'103',low24h:'98',volume24h:'120000',quoteVolume24h:'11900000',changePercent24h:'-1.94'},
];

function fixture(req,res,next){
 const sampled=req.path==='/cfd/display/tickers';
 if(sampled){const original=res.json.bind(res);res.json=body=>original({...body,_display:{mode:'snapshot',capturedAt:Date.now(),refreshMs:21600000}});res.set('Cache-Control','public,max-age=21600');}
 const p=sampled?'/cfd/tickers':req.path;
 if(p==='/market/external/tickers')return res.json({source:'kraken',tickers});
 if(p==='/market/external/orderbook/BTC-USDT')return res.json({source:'kraken',pair:'BTC/USDT',timestamp:Date.now(),bids:Array.from({length:8},(_,i)=>({price:String(76745.9-i*.1),quantity:String(.1+i*.03)})),asks:Array.from({length:8},(_,i)=>({price:String(76746.1+i*.1),quantity:String(.12+i*.025)}))});
 if(p==='/market/external/candles/BTC-USDT')return res.json({source:'kraken',pair:'BTC/USDT',interval:'15m',candles});
 if(p==='/market/external/trades/BTC-USDT')return res.json({source:'kraken',pair:'BTC/USDT',trades:Array.from({length:6},(_,i)=>({id:`t${i}`,price:String(76746-i*.2),quantity:String(.02+i*.01),side:i%2?'SELL':'BUY',time:Date.now()-i*1000}))});
 if(p==='/market/external/rankings')return res.json({source:'qa',rankings:[{symbol:'BTC',name:'Bitcoin',image:'',categories:['LAYER1'],changePercent24h:-0.67,changePercent7d:null}]});
 if(p==='/market/global')return res.json({source:'qa',global:{totalVolume24hUsd:8.9e10,totalMarketCapUsd:2.4e12,btcDominancePercent:55.1,ethDominancePercent:null,marketCapChangePercent24h:-0.4},fearGreed:{value:61,classification:'Greed',updatedAt:Date.now()}});
 if(p==='/cfd/tickers')return res.json({source:'qa',configured:true,tickers:[{symbol:'XAUUSD',name:'Gold Spot',price:'4349.19',changePercent24h:'-1.02',status:'live',stale:false,marketClosed:false,displayOnly:true,executionAllowed:false,provider:'qa',providerSymbol:'XAUUSD',providerTimestamp:Date.now(),fetchedAt:Date.now(),asOf:Date.now(),maxQuoteAgeMs:120000}]});
 if(p==='/futures/config')return res.json({symbols:['BTC/USDT']});
 if(p==='/support/conversations/mine')return res.json({conversation:null,messages:[]});
 return next();
}

// The compact orbit, restored visible Sapphire terminal and existing
// overview, heatmap and table all read the same confirmed snapshot.
const painted=()=>{
 const overview=document.querySelector('.vx-home main > .vx-reveal');
 const terminal=document.querySelector('#home-live-terminal');
 return {
 scene:document.querySelectorAll('[data-market-platform-hero] [data-market-visual]').length,
 columnData:[...document.querySelectorAll('[data-market-tile]')].map(card=>({
  symbol:card.getAttribute('data-market-tile'),
  price:card.querySelector('.vm-card-price')?.textContent||'',
  unavailableNote:card.querySelector('.vm-card-note')?.textContent||'',
 })),
 terminals:document.querySelectorAll('#home-live-terminal').length,
 terminalVisible:!!terminal&&getComputedStyle(terminal).visibility==='visible'&&terminal.getBoundingClientRect().width>0,
 duplicateTerminalInColumn:document.querySelectorAll('[data-market-platform-hero] #home-live-terminal').length,
 candles:document.querySelectorAll('#home-live-terminal .vx-real-candles').length,
 bookRows:document.querySelectorAll('#home-live-terminal .book-row').length,
 tradeRows:document.querySelectorAll('#home-live-terminal .hs-trade-row').length,
 tapeBtc:/BTC[\s\S]{0,80}76[,.]?746/.test(document.querySelector('.hs-tape .tape-set')?.textContent||''),
 badge:(document.querySelector('#home-live-terminal .feed-state')?.textContent||'').trim(),
 overview:overview?.textContent||'',
 // CryptoIcon can replace its image with a letter avatar after an image
 // failure. Compare confirmed values and row labels, not decorative text.
 // Each overview list row begins with its icon; data starts at child 1.
 overviewData:[...(overview?.querySelectorAll('section')||[])].map(panel=>({
  title:panel.querySelector('h3')?.textContent?.trim()||'',
  values:[...panel.querySelectorAll('.tabular-nums')].map(node=>node.textContent?.trim()||''),
  rows:[...panel.querySelectorAll('li')].map(row=>[...row.children].slice(1).map(node=>node.textContent?.trim()||'')),
 })),
 overviewPlaceholders:overview?.querySelectorAll('.animate-pulse').length??-1,
 heatmap:document.querySelectorAll('.vx-heatmap-meta').length,
 heatmapBtc:[...document.querySelectorAll('.vx-heat-tile')].some(row=>/BTC/.test(row.textContent||'')&&/76[,.]?746/.test(row.textContent||'')),
 marketsBtc:[...document.querySelectorAll('table tbody tr')].some(row=>/BTC/.test(row.textContent||'')&&/76[,.]?746/.test(row.textContent||'')),
 placeholders:document.querySelectorAll('#home-live-terminal .hs-empty, .hs-tape-empty, .vx-heatmap-empty').length,
 };
};
const ready=state=>state.scene===1&&state.columnData.length===7&&state.columnData.find(row=>row.symbol==='BTC')?.price==='76,746.00'&&state.columnData.find(row=>row.symbol==='GOLD')?.price==='4,349.19'&&state.columnData.find(row=>row.symbol==='OIL')?.price===''&&state.columnData.every(row=>row.unavailableNote==='')&&state.terminals===1&&state.terminalVisible&&state.duplicateTerminalInColumn===0&&state.candles===1&&state.bookRows>=2&&state.tradeRows>=1&&state.tapeBtc&&state.heatmap===1&&state.heatmapBtc&&state.marketsBtc&&state.placeholders===0&&state.overviewPlaceholders===0&&/61/.test(state.overview)&&/55\.1%/.test(state.overview)&&/4349\.19/.test(state.overview)&&/Layer 1/.test(state.overview);
// Both probes run inside the page, so they travel as source text.
const PAINTED=`(${painted})()`,READY=`(${ready})(${PAINTED})`;

(async()=>{
 const app=express();
 app.use('/api/v1',fixture);
 app.use('/api/v1',(_req,res)=>res.status(503).json({error:'not used in homepage snapshot QA'}));
 app.use(express.static(path.resolve('frontend/dist')));
 app.get('*',(_req,res)=>res.sendFile(path.resolve('frontend/dist/index.html')));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.HOME_QA_CHROMIUM||undefined,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1600,height:1000},serviceWorkers:'block'});
 let phase='firstVisit',hold=false;
 const marketRequests={firstVisit:[],reload:[],coldVisit:[]},metadataRequests={firstVisit:[],reload:[],coldVisit:[]};
 await context.route('**/*',route=>{
  const request=route.request(),url=request.url();
  if(!['GET','HEAD','OPTIONS'].includes(request.method())){report.writes.push(request.method()+' '+new URL(url).pathname);return route.abort();}
  if(new URL(url).origin!==origin)return route.abort();
  if(MARKET.test(url)){marketRequests[phase].push(url.replace(origin,''));if(hold)return route.abort('timedout');}
  else if(METADATA.test(url))metadataRequests[phase].push(url.replace(origin,''));
  return route.continue();
 });
 await context.routeWebSocket('**/*',socket=>{report.webSockets.push(socket.url());socket.close();});
 page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));

 // 1. The browser receives a real snapshot and confirms every surface.
 let start=Date.now();await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(READY,null,{timeout:10000});
 report.firstVisit={readyMs:Date.now()-start,marketRequests:marketRequests.firstVisit.length,metadataRequests:metadataRequests.firstVisit.length,painted:await page.evaluate(PAINTED)};
 // Exercise the actual probe against both icon states, and prove that it
 // still catches a changed BTC quote. DOM-only fixture mutation is restored
 // synchronously; no application state, storage or server data is modified.
 report.semanticProbe=await page.evaluate(`(() => {
  const read=${painted};
  const row=[...document.querySelectorAll('.vx-home main > .vx-reveal:first-of-type li')].find(node=>node.children[1]?.textContent==='BTC');
  if(!row||!row.children[2])throw new Error('BTC overview row missing from semantic probe');
  const originalIcon=row.firstElementChild,price=row.children[2],originalPrice=price.textContent;
  const image=document.createElement('img');image.alt='BTC';
  const letter=document.createElement('div');letter.textContent='B';
  let currentIcon=originalIcon;
  try {
   currentIcon.replaceWith(image);currentIcon=image;
   const imageData=JSON.stringify(read().overviewData);
   currentIcon.replaceWith(letter);currentIcon=letter;
   const letterData=JSON.stringify(read().overviewData);
   price.textContent='1.00';
   const changedPriceData=JSON.stringify(read().overviewData);
   return {ignoresDecorativeFallback:imageData===letterData,detectsChangedQuote:letterData!==changedPriceData};
  } finally {price.textContent=originalPrice;currentIcon.replaceWith(originalIcon);}
 })()`);
 if(!report.semanticProbe.ignoresDecorativeFallback||!report.semanticProbe.detectsChangedQuote)report.findings.push('Semantic quote probe regression: '+JSON.stringify(report.semanticProbe));
 // 2. It is persisted, versioned, with no request state written as data.
 await page.waitForFunction(key=>{
  const record=JSON.parse(localStorage.getItem(key)||'null');
  return record?.tickers?.length===3&&record?.hero?.candles?.length===48&&record?.hero?.book?.bids?.length===6
   &&record?.hero?.trades?.length===6&&record?.rankings?.length===1&&record?.cfd?.tickers?.length===1&&record?.futuresSymbols?.length===1;
 },SNAPSHOT_KEY,{timeout:3000});
 const raw=await page.evaluate(key=>localStorage.getItem(key),SNAPSHOT_KEY);
 const record=JSON.parse(raw);
 report.firstVisit.snapshot={version:record.version,tickers:record.tickers?.length,candles:record.hero?.candles?.length,bookBids:record.hero?.book?.bids?.length,trades:record.hero?.trades?.length,rankings:record.rankings?.length,cfd:record.cfd?.tickers?.length,futuresSymbols:record.futuresSymbols?.length,bytes:raw.length};
 if(record.version!==1||record.tickers?.length!==3||record.hero?.candles?.length!==48)report.findings.push('Persisted snapshot is incomplete: '+JSON.stringify(report.firstVisit.snapshot));
 if(/"(loading|error|refreshing)"/.test(raw))report.findings.push('Persisted snapshot carries request state as data');
 report.firstVisit.marketPaths=marketRequests.firstVisit.map(value=>new URL(value,origin).pathname).sort();
 if(JSON.stringify(report.firstVisit.marketPaths)!==JSON.stringify(EXPECTED_MARKET_PATHS))report.findings.push('Shared first-visit market request budget changed: '+JSON.stringify(report.firstVisit.marketPaths));

 // 3-4. "Browser reload": a new document, new store, new hook — and the API
 //      does NOT answer (every market request would time out).
 phase='reload';hold=true;
 start=Date.now();await page.reload({waitUntil:'domcontentloaded'});
 // 5-6. The confirmed values are on screen at once, no skeleton in sight.
 await page.waitForFunction(READY,null,{timeout:1500});
 report.reload={readyMs:Date.now()-start,painted:await page.evaluate(PAINTED)};
 // The sections below the fold reveal once on scroll (Reveal.tsx). Walk the
 // whole page so every one of them is shown, check each really became
 // visible, return to the top, and only then capture the full page — a
 // capture of an unscrolled page would show the hero over a black void.
 report.reload.reveal=await page.evaluate(async()=>{
  const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const until=async(check,limit)=>{const started=performance.now();while(!check()&&performance.now()-started<limit)await new Promise(resolve=>setTimeout(resolve,50));return check();};
  const sections=[...document.querySelectorAll('.vx-reveal')];
  const results=[];
  for(const el of sections){
   el.scrollIntoView({block:'center',behavior:'instant'});
   await settle();
   const shown=await until(()=>el.classList.contains('vx-shown'),3000);
   const opaque=await until(()=>getComputedStyle(el).opacity==='1',2000);
   const box=el.getBoundingClientRect();
   results.push({shown,opaque,opacity:getComputedStyle(el).opacity,height:box.height,top:box.top+scrollY,bottom:box.bottom+scrollY});
  }
  window.scrollTo(0,0);
  await settle();
  const footer=document.querySelector('footer');
  const footerTop=footer?footer.getBoundingClientRect().top+scrollY:null;
  const contentBottom=results.length?Math.max(...results.map(item=>item.bottom)):null;
  return {sections:results,footerTop,contentBottom,scrollHeight:document.documentElement.scrollHeight,unshown:document.querySelectorAll('.vx-reveal:not(.vx-shown)').length};
 });
 await page.screenshot({path:path.join(OUT,'reload-1600.png'),fullPage:true});
 const reveal=report.reload.reveal;
 if(!reveal.sections.length)report.findings.push('No .vx-reveal section found on the homepage');
 if(reveal.unshown||reveal.sections.some(item=>!item.shown))report.findings.push('A reveal section never became shown: '+JSON.stringify(reveal.sections));
 if(reveal.sections.some(item=>!item.opaque||item.height<=0))report.findings.push('A reveal section is still transparent or empty after scrolling: '+JSON.stringify(reveal.sections));
 if(reveal.footerTop===null||reveal.footerTop<reveal.contentBottom-1)report.findings.push(`Footer at ${reveal.footerTop} is not after the visible content ending at ${reveal.contentBottom}`);
 // 7. No market provider is asked for anything before the six-hour TTL.
 await wait(2000);
 report.reload.marketRequests=marketRequests.reload.slice();
 report.reload.metadataRequests=metadataRequests.reload.slice();
 if(report.reload.marketRequests.length)report.findings.push('Reload with a fresh snapshot issued market requests: '+report.reload.marketRequests.join(', '));
 if(report.reload.painted.badge!=='Market data')report.findings.push(`Reload badge is "${report.reload.painted.badge}", expected neutral "Market data"`);
 if(JSON.stringify(report.reload.painted.overviewData)!==JSON.stringify(report.firstVisit.painted.overviewData))report.findings.push('Reload changed the confirmed overview values before any provider replied');
 if(JSON.stringify(report.reload.painted.columnData)!==JSON.stringify(report.firstVisit.painted.columnData))report.findings.push('Reload changed verified orbit quotes before any provider replied');
 const after=await page.evaluate(PAINTED);
 if(!ready(after))report.findings.push('Confirmed values did not survive the failed background API: '+JSON.stringify(after));

 // Sanity: the same page with no snapshot does ask, so a zero above is real.
 phase='coldVisit';hold=false;
 await page.evaluate(key=>localStorage.removeItem(key),SNAPSHOT_KEY);
 start=Date.now();await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(READY,null,{timeout:10000});
 report.coldVisit={readyMs:Date.now()-start,marketRequests:marketRequests.coldVisit.length};
 if(report.coldVisit.marketRequests===0)report.findings.push('Cold visit issued no market requests; the request counter is not observing the app');
 if(report.writes.length)report.findings.push('Unexpected writes: '+report.writes.join(', '));
 if(report.webSockets.length)report.findings.push('Unexpected WebSocket: '+report.webSockets.join(', '));
 if(report.pageErrors.length)report.findings.push(`Page errors: ${report.pageErrors.length}`);
 fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
 console.log('HOME_SNAPSHOT_RELOAD '+JSON.stringify(report));
 if(report.findings.length)process.exitCode=1;
 await context.close();
})().catch(async error=>{report.findings.push(error instanceof Error?error.message:String(error));try{if(page&&!page.isClosed()){report.failurePainted=await page.evaluate(PAINTED);await page.screenshot({path:path.join(OUT,'failure.png'),fullPage:true,timeout:3000});}}catch{}fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));});
