'use strict';
/** Disposable end-to-end browser QA for the working CFD terminal.
 * Real public quotes/OHLC are fetched server-side. The browser is loopback
 * only and every non-GET request is rejected, proving local orders do not
 * reach VOLTEX financial endpoints or any external market. */
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const{randomBytes}=require('node:crypto');
const{chromium}=require(process.env.CFD_QA_PLAYWRIGHT||'playwright');
process.env.JWT_SECRET||=randomBytes(48).toString('hex');
process.env.API_KEY_ENCRYPTION_SECRET||=randomBytes(32).toString('hex');
process.env.NODE_ENV='production';
const{CfdMarketDataService}=require('../dist/services/CfdMarketDataService');
const{cfdRouter}=require('../dist/api/routes/cfd');
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
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin){denied.add(u.hostname);return route.abort();}if(!['GET','HEAD'].includes(route.request().method())){report.blockedWrites++;return route.abort();}return route.continue();});
  const page=await context.newPage();activePage=page;page.on('pageerror',e=>report.pageErrors.push({width,error:e.message}));await page.goto(origin+'/trade?market=cfd&symbol=XAUUSD',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('.cfd-option').length===13,{timeout:25000});await page.waitForFunction(()=>{const p=document.querySelector('.cfd-option.active .cfd-price')?.textContent||'';return p.trim()!==''&&!p.includes('—');},{timeout:25000});
  await page.locator('.cfd-owned-chart-canvas canvas').first().waitFor({state:'visible',timeout:25000});await page.waitForFunction(()=>document.querySelector('.cfd-owned-chart')?.getAttribute('data-chart-status')==='ready',{timeout:25000});await page.locator('.cfd-order-panel form').waitFor({state:'visible',timeout:10000});
  const price=await page.locator('.cfd-option.active .cfd-price').innerText();const input=page.locator('.cfd-order-panel input[type=number]');await input.fill('0.01');const submit=page.locator('.cfd-order-panel button[type=submit]');await submit.waitFor({state:'visible'});if(await submit.isDisabled())throw new Error(`Order remained disabled at ${width}px`);await submit.click();
  await page.locator('.cfd-position-content tbody tr').first().waitFor({state:'visible',timeout:5000});const openText=await page.locator('.cfd-position-content').innerText();if(!openText.includes('XAUUSD'))throw new Error(`Position missing at ${width}px`);
  const close=page.locator('.cfd-closeBtn').first();await page.waitForFunction(()=>{const b=document.querySelector('.cfd-closeBtn');return b&&!b.disabled;},{timeout:10000});await close.click();await page.locator('.cfd-tab').nth(1).click();await page.locator('.cfd-position-content tbody tr').first().waitFor({state:'visible',timeout:5000});const historyText=await page.locator('.cfd-position-content').innerText();if(!historyText.includes('XAUUSD'))throw new Error(`History missing at ${width}px`);
  const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,rows:document.querySelectorAll('.cfd-option').length,forms:document.querySelectorAll('.cfd-terminal form').length,submits:document.querySelectorAll('.cfd-terminal button[type=submit]').length,canvases:document.querySelectorAll('.cfd-owned-chart-canvas canvas').length,chartStatus:document.querySelector('.cfd-owned-chart')?.getAttribute('data-chart-status')||null,technicalLabels:document.querySelectorAll('.cfd-practice-badge,.cfd-practice-mode,.cfd-disclaimer').length}));report.scenarios.push({width,price,...result});if(result.overflow)report.findings.push(`Horizontal overflow ${width}px`);if(result.forms!==1||result.submits!==1)report.findings.push(`Order ticket incomplete ${width}px`);if(result.canvases<1||result.chartStatus!=='ready')report.findings.push(`Chart not ready ${width}px`);if(result.technicalLabels!==0)report.findings.push(`Technical labels visible ${width}px`);await page.screenshot({path:path.join(OUT,`cfd-working-${width}.png`),fullPage:true});await context.close();activePage=null;
 }
 {const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();return['GET','HEAD'].includes(route.request().method())?route.continue():route.abort();});const page=await context.newPage();await page.goto(origin+'/',{waitUntil:'domcontentloaded'});await page.locator('.vx-asset-gold').waitFor({state:'visible',timeout:15000});await page.waitForFunction(()=>['.vx-asset-gold','.vx-asset-oil'].every(s=>{const x=document.querySelector(s)?.textContent||'';return x&&!x.includes('—');}),{timeout:25000});await page.screenshot({path:path.join(OUT,'home-prices-1280.png'),fullPage:true});await context.close();}
 if(report.blockedWrites!==0)report.findings.push(`Unexpected browser/API writes attempted: ${report.blockedWrites}`);if(report.pageErrors.length)report.findings.push(`Browser errors: ${report.pageErrors.length}`);
})().catch(async error=>{report.findings.push(error instanceof Error?error.message:'QA failed');if(activePage&&!activePage.isClosed())try{await activePage.screenshot({path:path.join(OUT,'failure.png'),fullPage:true,timeout:3000});}catch{}process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));report.blockedExternalHosts=[...denied].sort();report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));console.log('CFD_WORKING_TERMINAL_REPORT '+JSON.stringify(report));if(report.findings.length)process.exitCode=1;});
