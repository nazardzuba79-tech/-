'use strict';
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const{chromium}=require(process.env.HOME_QA_PLAYWRIGHT||'playwright');

const OUT=path.resolve('docs/qa/home-laptop-first-load');
fs.mkdirSync(OUT,{recursive:true});
const TICKER_DELAY_MS=5000;
const MARKET=/\/api\/v1\/(market\/external\/|market\/global|cfd\/(?:display\/)?tickers|futures\/config)/;
const EXPECTED_MARKET_PATHS=['/market/external/tickers','/market/external/orderbook/BTC-USDT','/market/external/candles/BTC-USDT','/market/external/trades/BTC-USDT','/market/external/rankings','/market/global','/cfd/tickers','/futures/config'].map(value=>'/api/v1'+value).sort();
const report={startedAt:new Date().toISOString(),tickerDelayMs:TICKER_DELAY_MS,heroReadyMs:null,tickerFinishedBeforeHero:false,marketRequests:[],writes:[],webSockets:[],pageErrors:[],findings:[]};
let tickerFinished=false,server,browser,page;
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
 if(p==='/market/external/tickers')return void(async()=>{await wait(TICKER_DELAY_MS);tickerFinished=true;res.json({source:'kraken',tickers});})();
 if(p==='/market/external/orderbook/BTC-USDT')return res.json({source:'kraken',pair:'BTC/USDT',timestamp:Date.now(),bids:Array.from({length:8},(_,i)=>({price:String(76745.9-i*.1),quantity:String(.1+i*.03)})),asks:Array.from({length:8},(_,i)=>({price:String(76746.1+i*.1),quantity:String(.12+i*.025)}))});
 if(p==='/market/external/candles/BTC-USDT')return res.json({source:'kraken',pair:'BTC/USDT',interval:'15m',candles});
 if(p==='/market/external/trades/BTC-USDT')return res.json({source:'kraken',pair:'BTC/USDT',trades:Array.from({length:6},(_,i)=>({id:`t${i}`,price:String(76746-i*.2),quantity:String(.02+i*.01),side:i%2?'SELL':'BUY',time:Date.now()-i*1000}))});
 if(p==='/market/external/rankings')return res.json({source:'qa',rankings:[]});
 if(p==='/market/global')return res.json({source:'qa',global:null,fearGreed:null});
 if(p==='/cfd/tickers')return res.json({source:'qa',configured:true,tickers:[{symbol:'XAUUSD',name:'Gold Spot',price:'4349.19',changePercent24h:'-1.02',status:'market_closed',stale:false,marketClosed:true,displayOnly:true,executionAllowed:false,entitlementVerified:false,provider:'qa',providerSymbol:'XAUUSD',providerTimestamp:Date.now(),fetchedAt:Date.now(),asOf:Date.now(),maxQuoteAgeMs:120000},{symbol:'WTIUSD',name:'Crude Oil WTI Spot',price:'96.607',changePercent24h:'2.36',status:'market_closed',stale:false,marketClosed:true,displayOnly:true,executionAllowed:false,entitlementVerified:false,provider:'qa',providerSymbol:'USOIL',providerTimestamp:Date.now(),fetchedAt:Date.now(),asOf:Date.now(),maxQuoteAgeMs:120000}]});
 if(p==='/futures/config')return res.json({symbols:['BTC/USDT']});
 if(p==='/support/conversations/mine')return res.json({conversation:null,messages:[]});
 return next();
}

(async()=>{
 const app=express();
 app.use('/api/v1',fixture);
 app.use('/api/v1',(_req,res)=>res.status(503).json({error:'not used in homepage first-load QA'}));
 app.use(express.static(path.resolve('frontend/dist')));
 app.get('*',(_req,res)=>res.sendFile(path.resolve('frontend/dist/index.html')));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.HOME_QA_CHROMIUM||undefined,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1600,height:1000},serviceWorkers:'block'});
 await context.route('**/*',route=>{
  const request=route.request(),u=new URL(request.url());
  if(!['GET','HEAD','OPTIONS'].includes(request.method())){report.writes.push(request.method()+' '+u.pathname);return route.abort();}
  if(u.origin!==origin)return route.abort();
  if(MARKET.test(u.href))report.marketRequests.push(u.pathname);
  return route.continue();
 });
 await context.routeWebSocket('**/*',socket=>{report.webSockets.push(socket.url());socket.close();});
 page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 const start=Date.now();await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 // The owner restored the Sapphire composition. Its compact new column and
 // original visible terminal must work before the shared universe replies.
 await page.locator('[data-market-platform-hero] [data-market-visual]').waitFor({state:'visible',timeout:4000});
 await page.locator('#home-live-terminal').waitFor({state:'visible',timeout:4000});
 await page.waitForFunction(()=>{
  const hero=document.querySelector('#home-global-hero');
  const visible=node=>!!node&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0;
  return !!hero?.querySelector('h1')?.textContent?.trim()
   &&visible(hero.querySelector('a[href="/trade"]'))&&visible(hero.querySelector('a[href="/markets"]'))
   &&visible(hero.querySelector('button[data-motion-toggle]'))
   &&document.querySelectorAll('#home-live-terminal').length===1
   &&document.querySelectorAll('#home-live-terminal .vx-real-candles').length===1
   &&document.querySelectorAll('#home-live-terminal .book-row').length>=2
   &&document.querySelectorAll('#home-live-terminal .hs-trade-row').length>=1;
 },null,{timeout:4000});
 report.heroReadyMs=Date.now()-start;report.tickerFinishedBeforeHero=tickerFinished;
 if(tickerFinished)report.findings.push('Market scene waited for delayed all-pairs ticker response');
 if(report.heroReadyMs>=TICKER_DELAY_MS)report.findings.push(`Market scene first content took ${report.heroReadyMs}ms`);
 if(await page.locator('.terminal-screen').count()!==1)report.findings.push('Expected exactly one visible Sapphire terminal beside the revised column');
 if(await page.locator('[data-market-platform-hero] #home-live-terminal').count())report.findings.push('Column reused the terminal observer identity');
 await page.screenshot({path:path.join(OUT,'first-load-1600.png'),fullPage:true});
 // Preserve the data regression: the same shared hook still obtains and
 // persists its genuine BTC snapshot, and lower sections paint the delayed
 // ticker result. The decorative scene adds no provider reads or sockets.
 await page.waitForFunction(()=>{
  const record=JSON.parse(localStorage.getItem('voltex.home.market.v1')||'null');
  return record?.tickers?.length===3&&record?.hero?.candles?.length===48
   &&record?.hero?.book?.bids?.length===6&&record?.hero?.trades?.length===6
   &&document.querySelectorAll('[data-market-tile]').length===8
   &&[...document.querySelectorAll('[data-market-tile]')].every(coin=>/^(?:CFD|STOCKS SOON)?$/.test(coin.textContent||''))
   &&document.querySelectorAll('[data-market-tile] .vm-card-price, [data-market-tile] .vm-card-note, [data-market-tile] .vm-card-change').length===0
   &&document.querySelectorAll('.vx-heatmap-meta').length===1
   &&[...document.querySelectorAll('table tbody tr')].some(row=>/BTC/.test(row.textContent||'')&&/76[,.]?746/.test(row.textContent||''));
 },null,{timeout:10000});
 report.sharedSnapshot=await page.evaluate(()=>{const record=JSON.parse(localStorage.getItem('voltex.home.market.v1'));return{version:record.version,tickers:record.tickers.length,candles:record.hero.candles.length,bookBids:record.hero.book.bids.length,trades:record.hero.trades.length};});
 if(JSON.stringify([...report.marketRequests].sort())!==JSON.stringify(EXPECTED_MARKET_PATHS))report.findings.push('Shared market request budget changed: '+JSON.stringify(report.marketRequests));
 if(report.writes.length)report.findings.push('Unexpected writes: '+report.writes.join(', '));
 if(report.webSockets.length)report.findings.push('Unexpected WebSocket: '+report.webSockets.join(', '));
 if(report.pageErrors.length)report.findings.push(`Page errors: ${report.pageErrors.length}`);
 fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
 console.log('HOME_LAPTOP_FIRST_LOAD '+JSON.stringify(report));
 if(report.findings.length)process.exitCode=1;
 await context.close();
})().catch(async error=>{report.findings.push(error instanceof Error?error.message:String(error));try{if(page&&!page.isClosed())await page.screenshot({path:path.join(OUT,'failure.png'),fullPage:true,timeout:3000});}catch{}fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));});
