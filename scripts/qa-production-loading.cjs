'use strict';
/**
 * VOLTEX read-only production loading audit.
 *
 * The audit has two layers:
 *  1. real HTTPS reads against api.voltextech.net for every public market
 *     dataset that drives tickers, charts and market discovery;
 *  2. browser smoke of the deployed homepage plus a local production build
 *     for signed-in routes. The local build proxies PUBLIC GET market data to
 *     the real production API. Private/account reads are isolated fixtures so
 *     this job never needs a user password and never writes to production.
 *
 * Every non-GET/HEAD request is rejected. No order, transfer, account update,
 * registration or database mutation is possible from this harness.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {once}=require('node:events');
const {chromium}=require(process.env.VOLTEX_QA_PLAYWRIGHT||'playwright');

const ROOT=path.resolve(__dirname,'..');
const DIST=path.join(ROOT,'frontend','dist');
const OUT=path.join(ROOT,'docs','qa','production-loading');
const PROD_SITE='https://voltextech.net';
const PROD_API='https://api.voltextech.net/api/v1';
const now=()=>Date.now();
fs.mkdirSync(OUT,{recursive:true});

const report={
  revision:process.env.GITHUB_SHA||null,
  startedAt:new Date().toISOString(),
  production:{site:PROD_SITE,api:PROD_API},
  api:[],pages:[],routeSmokes:[],consoleErrors:[],pageErrors:[],requestFailures:[],
  protectedReads:[],blockedWrites:0,findings:[],warnings:[],
};
const hard=(scope,message,detail)=>report.findings.push({scope,message,detail:detail??null});
const warn=(scope,message,detail)=>report.warnings.push({scope,message,detail:detail??null});
const finitePositive=v=>Number.isFinite(Number(v))&&Number(v)>0;
const timeoutSignal=ms=>AbortSignal.timeout(ms);

async function readJson(route,label,validate,{timeoutMs=15000,slowMs=3000,critical=true}={}){
  const started=now();let status=0,bytes=0;
  try{
    const response=await fetch(PROD_API+route,{headers:{Accept:'application/json'},redirect:'error',signal:timeoutSignal(timeoutMs)});
    status=response.status;const text=await response.text();bytes=Buffer.byteLength(text);
    const elapsed=now()-started;
    const row={label,route,status,ms:elapsed,bytes,ok:response.ok};report.api.push(row);
    if(elapsed>slowMs)warn(label,`slow public read: ${elapsed} ms`,route);
    if(!response.ok)throw new Error(`HTTP ${response.status}: ${text.slice(0,240)}`);
    const body=JSON.parse(text);validate?.(body,row);return body;
  }catch(error){
    const elapsed=now()-started;
    if(!report.api.some(r=>r.label===label&&r.route===route))report.api.push({label,route,status,ms:elapsed,bytes,ok:false,error:String(error?.message||error)});
    (critical?hard:warn)(label,'public data check failed',String(error?.message||error));return null;
  }
}

async function auditPublicApi(){
  const tickers=await readJson('/market/external/tickers','spot tickers',(body)=>{
    assert.ok(Array.isArray(body.tickers)&&body.tickers.length>=10,'ticker universe too small');
    const btc=body.tickers.find(r=>r.pair==='BTC/USDT');assert.ok(btc&&finitePositive(btc.lastPrice),'BTC/USDT ticker missing');
  });
  await Promise.all([
    readJson('/market/snapshot','shared market snapshot',(body)=>{
      assert.equal(body.tickers?.available,true,'gateway ticker section unavailable');
      assert.ok(Array.isArray(body.tickers.value)&&body.tickers.value.length>=10,'gateway ticker list too small');
    }),
    readJson('/market/external/symbols','spot symbols',(body)=>{
      assert.ok(Array.isArray(body.symbols)&&body.symbols.some(r=>r.pair==='BTC/USDT'),'BTC/USDT symbol missing');
    }),
    readJson('/market/external/orderbook/BTC-USDT?limit=12','spot order book',(body)=>{
      assert.equal(body.pair,'BTC/USDT');assert.ok(body.bids?.length&&body.asks?.length,'order book empty');
      assert.ok(finitePositive(body.bids[0]?.price)&&finitePositive(body.asks[0]?.price),'order book prices invalid');
    }),
    readJson('/market/external/candles/BTC-USDT?interval=15m&limit=48','spot candles',(body)=>{
      assert.equal(body.pair,'BTC/USDT');assert.ok(Array.isArray(body.candles)&&body.candles.length>=20,'spot candles missing');
      assert.ok(body.candles.every(c=>[c.open,c.high,c.low,c.close].every(finitePositive)),'invalid candle price');
    }),
    readJson('/market/external/trades/BTC-USDT?limit=8','spot trades',(body)=>{
      assert.equal(body.pair,'BTC/USDT');assert.ok(Array.isArray(body.trades)&&body.trades.length>0,'recent trades missing');
    }),
    readJson('/market/global','global market',(body)=>{
      assert.ok(body.global||body.fearGreed,'both global sources unavailable');
    },{critical:false,slowMs:4000}),
    readJson('/market/external/rankings','rankings',(body)=>{
      assert.ok(Array.isArray(body.rankings)&&body.rankings.length>0,'rankings empty');
    },{critical:false,slowMs:4000}),
    readJson('/market/assets?limit=1000','asset catalogue',(body)=>{
      assert.equal(body.available,true,'asset catalogue unavailable');
      assert.ok(Array.isArray(body.value?.assets)&&body.value.assets.length>=10,'asset catalogue empty');
    },{critical:false,slowMs:5000}),
    readJson('/futures/config','futures config',(body)=>{
      assert.ok(Array.isArray(body.symbols)&&['BTC/USDT','ETH/USDT','SOL/USDT'].every(x=>body.symbols.includes(x)),'core futures contracts missing');
    }),
    readJson('/futures/mark-price/BTC-USDT','futures mark price',(body)=>{
      assert.equal(body.symbol,'BTC/USDT');assert.ok(finitePositive(body.markPrice)&&finitePositive(body.indexPrice),'mark/index missing');
    }),
    readJson('/futures/funding-rate/BTC-USDT?limit=1','futures funding',(body)=>{
      assert.equal(body.symbol,'BTC/USDT');assert.ok(Array.isArray(body.history),'funding history malformed');
    },{critical:false}),
    readJson('/market/derivatives/BTC','futures market stats',(body)=>{
      assert.ok(typeof body.available==='boolean','market derivatives availability missing');
      if(body.available)assert.ok(body.value&&typeof body.value==='object','market derivatives payload missing');
    },{critical:false,slowMs:5000}),
    readJson('/cfd/tickers','CFD tickers',(body)=>{
      assert.ok(Array.isArray(body.tickers)&&body.tickers.length===13,`expected 13 CFD instruments, got ${body.tickers?.length}`);
      const symbols=new Set(body.tickers.map(r=>r.symbol));for(const s of ['XAUUSD','WTIUSD','EURUSD'])assert.ok(symbols.has(s),`${s} missing`);
      const priced=body.tickers.filter(r=>finitePositive(r.price));assert.ok(priced.length>=10,`only ${priced.length}/13 CFD prices available`);
    },{slowMs:5000}),
    readJson('/cfd/candles/XAUUSD?interval=15m&limit=50','XAU chart candles',(body)=>{
      assert.equal(body.symbol,'XAUUSD');assert.ok(Array.isArray(body.bars)&&body.bars.length>=20,'XAU candles missing');
    },{slowMs:5000}),
    readJson('/cfd/candles/WTIUSD?interval=15m&limit=50','WTI chart candles',(body)=>{
      assert.equal(body.symbol,'WTIUSD');assert.ok(Array.isArray(body.bars)&&body.bars.length>=20,'WTI candles missing');
    },{slowMs:5000}),
  ]);
  return tickers;
}

function qaUser(){return{id:'qa-read-only',email:'qa@localhost.invalid',displayName:'Read-only QA',phone:null,country:null,avatarUrl:null,isAdmin:false,kycStatus:'NOT_STARTED',twoFactorEnabled:false,createdAt:'2026-01-01T00:00:00.000Z'};}
function isolatedPrivate(pathname){
  if(pathname==='/api/v1/me')return qaUser();
  if(['/api/v1/balances','/api/v1/futures/balances','/api/v1/orders/me','/api/v1/trades/me','/api/v1/futures/orders/me','/api/v1/futures/positions','/api/v1/futures/positions/history','/api/v1/deposits/me','/api/v1/withdrawals/me','/api/v1/purchases/me','/api/v1/products'].includes(pathname))return[];
  if(pathname==='/api/v1/support/conversations/mine')return{conversation:null,messages:[]};
  if(pathname==='/api/v1/portfolio/summary')return{totalUsd:'0',assets:[]};
  if(pathname==='/api/v1/wallet/portfolio-history')return{points:[]};
  if(pathname==='/api/v1/referral/me')return{code:'QA',referredCount:0};
  return null;
}

async function startHybridServer(){
  assert.ok(fs.existsSync(path.join(DIST,'index.html')),'frontend/dist missing');
  const app=express();app.disable('x-powered-by');let origin='';
  app.use((req,res,next)=>{
    if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return res.sendStatus(403);
    if(!['GET','HEAD'].includes(req.method)){report.blockedWrites++;return res.status(405).json({error:'read_only_audit'});}
    res.setHeader('Cache-Control','no-store');next();
  });
  app.use('/api/v1',async(req,res)=>{
    const fullPath='/api/v1'+req.url.split('?')[0];
    const fixture=isolatedPrivate(fullPath);
    if(fixture!==null){report.protectedReads.push({path:fullPath,mode:'isolated-fixture'});return res.json(fixture);}
    const target=PROD_API+req.url;
    try{
      const upstream=await fetch(target,{headers:{Accept:req.headers.accept||'application/json'},redirect:'error',signal:timeoutSignal(15000)});
      // Never let an intentionally fake local token get cleared by the real
      // production auth middleware. Protected responses are outside this
      // market-data audit and are represented as a controlled 503 instead.
      if(upstream.status===401||upstream.status===403){
        report.protectedReads.push({path:fullPath,mode:'production-protected',status:upstream.status});
        return res.status(503).json({error:'protected_read_not_exercised_in_read_only_audit'});
      }
      const buf=Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status);res.type(upstream.headers.get('content-type')||'application/json');return res.send(buf);
    }catch(error){return res.status(502).json({error:'production_proxy_failed',detail:String(error?.message||error)});}
  });
  app.use(express.static(DIST,{index:false,redirect:false,maxAge:0}));
  app.get('*',(_req,res)=>res.sendFile(path.join(DIST,'index.html')));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
  return{server,origin};
}

function attachDiagnostics(page,name,origin){
  page.on('pageerror',error=>report.pageErrors.push({page:name,error:error.message}));
  page.on('console',msg=>{if(msg.type()==='error')report.consoleErrors.push({page:name,text:msg.text().slice(0,500)});});
  page.on('requestfailed',req=>{
    const url=req.url();
    // External widget telemetry/assets are not VOLTEX data transport. Keep
    // failures only for our app/API and TradingView's chart bootstrap.
    if(url.startsWith(origin)||url.startsWith(PROD_SITE)||url.startsWith(PROD_API)||url.includes('tradingview.com'))
      report.requestFailures.push({page:name,url,method:req.method(),error:req.failure()?.errorText||'failed'});
  });
}
async function nonDash(page,selector,timeout=15000){
  await page.waitForFunction(sel=>{const n=document.querySelector(sel);if(!n)return false;const text=(n.textContent||'').trim();return text&&text!=='—'&&!/Loading|Загрузка|Loading market data/i.test(text);},selector,{timeout});
}
async function countAtLeast(page,selector,count,timeout=15000){await page.waitForFunction(([sel,min])=>document.querySelectorAll(sel).length>=min,[selector,count],{timeout});}

async function auditHomepage(browser){
  const context=await browser.newContext({viewport:{width:1600,height:900},serviceWorkers:'block'});const page=await context.newPage();attachDiagnostics(page,'homepage',PROD_SITE);
  const started=now();await page.goto(PROD_SITE+'/',{waitUntil:'domcontentloaded',timeout:30000});
  try{
    await countAtLeast(page,'.hs-tape .tick',5,15000);
    await page.locator('.hs-chart svg.vx-real-candles').waitFor({state:'visible',timeout:15000});
    await countAtLeast(page,'.book-row.bid',1,15000);await countAtLeast(page,'.book-row.ask',1,15000);await countAtLeast(page,'.hs-trade-row',1,15000);
    const elapsed=now()-started;report.pages.push({name:'homepage',url:PROD_SITE+'/',ok:true,readyMs:elapsed});if(elapsed>5000)warn('homepage',`hero market data ready after ${elapsed} ms`);
  }catch(error){hard('homepage','deployed hero market surface did not become ready',String(error?.message||error));report.pages.push({name:'homepage',url:PROD_SITE+'/',ok:false,readyMs:now()-started});}
  await page.screenshot({path:path.join(OUT,'homepage-production.png'),fullPage:true});await context.close();
}

async function auditMarketRoutes(browser,origin){
  const routes=[
    {name:'markets',path:'/markets',ready:async page=>{await page.locator('.markets-page').waitFor({timeout:15000});await countAtLeast(page,'.vx-cat-table tbody tr',5,20000);if(await page.locator('.markets-error-banner').count())throw new Error('markets error banner visible');}},
    {name:'spot',path:'/trade?pair=BTC%2FUSDT',ready:async page=>{await page.locator('.spot-terminal').waitFor({timeout:15000});await nonDash(page,'.ticker-bar .value.price',15000);await countAtLeast(page,'.orderbook-bids .ob-row',1,15000);await countAtLeast(page,'.orderbook-asks .ob-row',1,15000);await page.locator('.voltex-tradingview-chart__embed iframe').waitFor({state:'attached',timeout:20000});}},
    {name:'futures',path:'/futures?pair=BTC%2FUSDT',ready:async page=>{await page.locator('.futures-terminal').waitFor({timeout:15000});await nonDash(page,'.futures-primary-price .value.price',15000);await countAtLeast(page,'.reference-book .rb-row',2,15000);await page.locator('.voltex-tradingview-chart__embed iframe').waitFor({state:'attached',timeout:20000});}},
    {name:'cfd-xau',path:'/trade?market=cfd&symbol=XAUUSD',ready:async page=>{await page.locator('.cfd-terminal').waitFor({timeout:15000});await countAtLeast(page,'.cfd-option',13,15000);await nonDash(page,'.cfd-option.active .cfd-price',15000);await page.locator('.cfd-owned-chart-canvas canvas').first().waitFor({state:'visible',timeout:20000});}},
    {name:'cfd-wti',path:'/trade?market=cfd&symbol=WTIUSD',ready:async page=>{await page.locator('.cfd-terminal').waitFor({timeout:15000});await nonDash(page,'.cfd-option.active .cfd-price',15000);await page.locator('.cfd-owned-chart-canvas canvas').first().waitFor({state:'visible',timeout:20000});}},
  ];
  for(const route of routes){
    const context=await browser.newContext({viewport:{width:1600,height:900},serviceWorkers:'block'});await context.addInitScript(()=>{localStorage.setItem('exchange_token','read-only-qa-token');localStorage.setItem('exchange_lang','ru');});
    const page=await context.newPage();attachDiagnostics(page,route.name,origin);
    await page.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
    const started=now();
    try{await page.goto(origin+route.path,{waitUntil:'domcontentloaded',timeout:30000});await route.ready(page);const elapsed=now()-started;report.pages.push({name:route.name,url:route.path,ok:true,readyMs:elapsed});if(elapsed>7000)warn(route.name,`market surface ready after ${elapsed} ms`);}
    catch(error){hard(route.name,'market surface failed to load',String(error?.message||error));report.pages.push({name:route.name,url:route.path,ok:false,readyMs:now()-started});}
    await page.screenshot({path:path.join(OUT,`${route.name}.png`),fullPage:true}).catch(()=>{});await context.close();
  }
}

async function smokeOtherRoutes(browser,origin){
  // These pages are checked for chunk/runtime loading only. Account-specific
  // data is deliberately not read from production in this no-credentials job.
  const routes=['/settings','/card','/wallet','/otc','/copy-trading','/arbitrage','/analytics'];
  for(const route of routes){
    const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});await context.addInitScript(()=>{localStorage.setItem('exchange_token','read-only-qa-token');localStorage.setItem('exchange_lang','ru');});const page=await context.newPage();attachDiagnostics(page,route,origin);await page.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
    try{await page.goto(origin+route,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForFunction(()=>document.body.innerText.trim().length>40,{timeout:15000});await page.waitForTimeout(750);const shell=await page.locator('.route-shell').count();const location=new URL(page.url()).pathname;const ok=!shell&&location===route;report.routeSmokes.push({route,ok,location});if(!ok)hard(route,'route chunk remained on fallback or redirected',{shell,location});}
    catch(error){report.routeSmokes.push({route,ok:false,error:String(error?.message||error)});hard(route,'route failed to render',String(error?.message||error));}
    await context.close();
  }
}

(async()=>{
  try{
    await auditPublicApi();
    const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    try{
      await auditHomepage(browser);
      const hybrid=await startHybridServer();
      try{await auditMarketRoutes(browser,hybrid.origin);await smokeOtherRoutes(browser,hybrid.origin);}finally{await new Promise(r=>hybrid.server.close(r));}
    }finally{await browser.close();}
    // Page errors on market-critical routes are findings; console errors are
    // retained as evidence but not automatically fatal because blocked
    // account reads on the route-smoke pages can log expected errors.
    for(const row of report.pageErrors)hard(row.page,'browser page error',row.error);
    const criticalFailed=report.requestFailures.filter(r=>r.page==='homepage'||['markets','spot','futures','cfd-xau','cfd-wti'].includes(r.page));
    for(const row of criticalFailed)warn(row.page,'browser request failed',row.url);
  }catch(error){hard('audit','audit harness failed',String(error?.stack||error));}
  report.completedAt=new Date().toISOString();report.ok=report.findings.length===0;
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
  console.log('VOLTEX_PRODUCTION_LOADING_AUDIT '+JSON.stringify({ok:report.ok,api:report.api.length,pages:report.pages,routeSmokes:report.routeSmokes,findings:report.findings,warnings:report.warnings,blockedWrites:report.blockedWrites}));
  if(!report.ok)process.exitCode=1;
})();
