'use strict';
/** Disposable end-to-end browser QA. Real public provider quotes/OHLC;
 * browser loopback-only, no database or real order writes. */
const fs=require('node:fs');const path=require('node:path');const express=require('express');
const{randomBytes}=require('node:crypto');const{chromium}=require(process.env.CFD_QA_PLAYWRIGHT||'playwright');
process.env.JWT_SECRET||=randomBytes(48).toString('hex');process.env.API_KEY_ENCRYPTION_SECRET||=randomBytes(32).toString('hex');process.env.NODE_ENV='production';
const{CfdMarketDataService}=require('../dist/services/CfdMarketDataService');const{cfdRouter}=require('../dist/api/routes/cfd');
const OUT=path.resolve('docs/qa/cfd-display-browser');fs.mkdirSync(OUT,{recursive:true});
const report={revision:process.env.GITHUB_SHA||null,environment:'disposable loopback CI; real public display providers; no DB writes',startedAt:new Date().toISOString(),scenarios:[],pageErrors:[],findings:[],blockedWrites:0,blockedExternalHosts:[]};
const denied=new Set();let server,browser,activePage;
const noDb=new Proxy({},{get(){throw new Error('Database access forbidden in CFD QA');}});
function fixture(pathname){
 if(pathname==='/market/external/tickers')return{source:'qa',tickers:[{pair:'BTC/USDT',lastPrice:'65000',changePercent24h:'1.25',quoteVolume24h:'1000000',high24h:'66000',low24h:'64000'}]};
 if(pathname==='/market/external/rankings')return{source:'qa',rankings:[]};if(pathname==='/market/global')return{source:'qa',global:null,fearGreed:null};
 if(pathname.startsWith('/market/external/orderbook/'))return{pair:'BTC/USDT',bids:[],asks:[],timestamp:Date.now()};if(pathname.startsWith('/market/external/candles/'))return{pair:'BTC/USDT',interval:'15m',candles:[]};if(pathname.startsWith('/market/external/trades/'))return{pair:'BTC/USDT',trades:[]};
 if(pathname==='/support/conversations/mine')return{conversation:null,messages:[]};return null;
}
(async()=>{
 const cfd=cfdRouter(noDb,new CfdMarketDataService(undefined),noDb);const app=express();
 app.use((req,res,next)=>{if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return res.sendStatus(403);res.setHeader('Cache-Control','no-store');if(!['GET','HEAD'].includes(req.method)){report.blockedWrites++;return res.status(405).json({error:'QA write blocked'});}next();});
 app.use('/api/v1',(req,res,next)=>{if(req.path==='/me')return res.json({id:'local-cfd-qa',email:'qa@example.invalid',displayName:'LOCAL QA',phone:null,country:null,avatarUrl:null,isAdmin:false,kycStatus:'NOT_STARTED',twoFactorEnabled:false,createdAt:'2026-01-01T00:00:00.000Z'});if(req.path.startsWith('/cfd/'))return cfd(req,res,next);const x=fixture(req.path);return x?res.json(x):res.status(503).json({error:'Unavailable in isolated QA'});});
 app.use(express.static(path.resolve('frontend/dist')));app.get('*',(_req,res)=>res.sendFile(path.resolve('frontend/dist/index.html')));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const origin=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const width of [1920,1280,768,390]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});await context.addInitScript(()=>{localStorage.setItem('exchange_lang','ru');localStorage.setItem('exchange_token','local-cfd-qa');localStorage.removeItem('voltex_cfd_practice_v1');});
  await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(!['GET','HEAD'].includes(req.method())){report.blockedWrites++;return route.abort();}if(u.origin===origin)return route.continue();denied.add(u.hostname);return route.abort();});
  const displayRequests=[];context.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/v1/cfd/display/'))displayRequests.push(req.url());});
  const page=await context.newPage();page.setDefaultTimeout(45_000);activePage=page;page.on('pageerror',e=>report.pageErrors.push({width,error:e.message}));await page.goto(origin+'/trade?market=cfd&symbol=XAUUSD',{waitUntil:'domcontentloaded'});
  // One bounded cold-provider warmup retry is allowed; steady state remains six hours.
  // Public no-key feeds can legitimately omit one instrument for a moment, so
  // acceptance uses the first REAL priced row instead of fabricating XAUUSD.
  await page.waitForFunction(()=>document.querySelectorAll('.cfd-option').length===13,null,{timeout:45_000});
  await page.waitForFunction(()=>[...document.querySelectorAll('.cfd-option')].some(row=>{const p=row.querySelector('.cfd-price')?.textContent||'';return p.trim()!==''&&!p.includes('—');}),null,{timeout:45_000});
  const selectedSymbol=await page.evaluate(()=>{
    const active=document.querySelector('.cfd-option.active');
    const price=(active?.querySelector('.cfd-price')?.textContent||'').trim();
    const usable=price!==''&&!price.includes('—')?active:[...document.querySelectorAll('.cfd-option')].find(row=>{const p=(row.querySelector('.cfd-price')?.textContent||'').trim();return p!==''&&!p.includes('—');});
    if(!usable)throw new Error('No real CFD price available');
    if(usable!==active)usable.click();
    return (usable.querySelector('.cfd-optionSymbol')?.textContent||'').trim();
  });
  if(!selectedSymbol)throw new Error(`Selected CFD symbol missing at ${width}px`);
  await page.waitForFunction(symbol=>{const row=document.querySelector('.cfd-option.active');const p=(row?.querySelector('.cfd-price')?.textContent||'').trim();return row?.querySelector('.cfd-optionSymbol')?.textContent?.trim()===symbol&&p!==''&&!p.includes('—');},selectedSymbol,{timeout:10000});
  await page.locator('.cfd-owned-chart-canvas canvas').first().waitFor({state:'visible',timeout:25000});await page.waitForFunction(()=>document.querySelector('.cfd-owned-chart')?.getAttribute('data-chart-status')==='ready',null,{timeout:25000});await page.locator('.cfd-order-panel form').waitFor({state:'visible',timeout:10000});
  const price=await page.locator('.cfd-option.active .cfd-price').innerText();const input=page.locator('.cfd-order-panel input[type=number]');await input.fill('0.01');const submit=page.locator('.cfd-order-panel button[type=submit]');await submit.waitFor({state:'visible'});if(await submit.isDisabled())throw new Error(`Order remained disabled at ${width}px`);await submit.click();
  await page.locator('.cfd-position-content tbody tr').first().waitFor({state:'visible',timeout:5000});const openText=await page.locator('.cfd-position-content').innerText();if(!openText.includes(selectedSymbol))throw new Error(`Position missing at ${width}px`);
  const close=page.locator('.cfd-closeBtn').first();await page.waitForFunction(()=>{const b=document.querySelector('.cfd-closeBtn');return b&&!b.disabled;},null,{timeout:10000});await close.click();await page.locator('.cfd-tab').nth(1).click();await page.locator('.cfd-position-content tbody tr').first().waitFor({state:'visible',timeout:5000});const historyText=await page.locator('.cfd-position-content').innerText();if(!historyText.includes(selectedSymbol))throw new Error(`History missing at ${width}px`);
  const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,rows:document.querySelectorAll('.cfd-option').length,forms:document.querySelectorAll('.cfd-terminal form').length,submits:document.querySelectorAll('.cfd-terminal button[type=submit]').length,canvases:document.querySelectorAll('.cfd-owned-chart-canvas canvas').length,chartStatus:document.querySelector('.cfd-owned-chart')?.getAttribute('data-chart-status')||null,technicalLabels:document.querySelectorAll('.cfd-practice-badge,.cfd-practice-mode,.cfd-disclaimer').length}));
  report.scenarios.push({width,price,sampledDisplay:true,...result});if(result.overflow)report.findings.push(`Horizontal overflow ${width}px`);if(result.forms!==1||result.submits!==1)report.findings.push(`Order ticket incomplete ${width}px`);if(result.canvases<1||result.chartStatus!=='ready')report.findings.push(`Chart not ready ${width}px`);if(result.technicalLabels!==0)report.findings.push(`Technical labels visible ${width}px`);
  await page.screenshot({path:path.join(OUT,`cfd-working-${width}.png`),fullPage:true});
  // Let the initial request/cache write settle before measuring a hard reload.
  // Otherwise the first context can count its still-finishing cold request as
  // a reload request even though the reload itself was served from storage.
  await page.waitForTimeout(750);const before=displayRequests.length;
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('.cfd-owned-chart')?.getAttribute('data-chart-status')==='ready',null,{timeout:15000});await page.waitForTimeout(1000);
  if(displayRequests.length!==before)report.findings.push(`CFD snapshot was re-downloaded on reload at ${width}px`);
  // Customer UI intentionally renders no snapshot/cache/feed-age marker.
  await context.close();activePage=null;
 }
 // Homepage has its own dedicated first-load/cached-reload workflow.
 if(report.blockedWrites!==0)report.findings.push(`Unexpected browser/API writes attempted: ${report.blockedWrites}`);if(report.pageErrors.length)report.findings.push(`Browser errors: ${report.pageErrors.length}`);
})().catch(async error=>{
 report.findings.push(error instanceof Error?error.message:'QA failed');if(activePage&&!activePage.isClosed())try{report.failedPage=await activePage.evaluate(()=>({title:document.title,chart:document.querySelector('.cfd-owned-chart')?.getAttribute('data-chart-status'),rows:[...document.querySelectorAll('.cfd-option')].map(e=>e.textContent)}));await activePage.screenshot({path:path.join(OUT,'failure.png'),fullPage:true,timeout:3000});}catch{}process.exitCode=1;
}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));report.blockedExternalHosts=[...denied].sort();report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));console.log('CFD_WORKING_TERMINAL_REPORT '+JSON.stringify(report));if(report.findings.length)process.exitCode=1;});
