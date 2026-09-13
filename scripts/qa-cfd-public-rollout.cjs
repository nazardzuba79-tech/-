'use strict';
/** Disposable loopback-only browser QA. Uses the real compiled frontend and
 * real public CFD route. No production backend, credentials, database or writes.
 * One actual seven-request public sample; failure states replay that sample and
 * are explicitly labelled simulated. This is NOT a Render/session-crossing soak.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.CFD_QA_PLAYWRIGHT || 'playwright');
const { PublicReferenceFeed } = require('../dist/services/marketData/cfd/PublicReferenceFeed');
const { CfdMarketDataService } = require('../dist/services/CfdMarketDataService');
const { cfdRouter } = require('../dist/api/routes/cfd');
const OUT = path.resolve('docs/qa/cfd-multi-provider/browser');
fs.mkdirSync(OUT, { recursive: true });
const report = { environment: 'DISPOSABLE CI LOOPBACK, NOT RENDER', revision: process.env.GITHUB_SHA || null,
  startedAt: new Date().toISOString(), realPublicSamples: null, sourceDiagnostics: [],
  scenarios: [], findings: [], pageErrors: [], blockedExternalHosts: [], blockedWrites: 0,
  limitations: ['TradingView and all browser external traffic intentionally blocked',
    'No production accounts or database; local /me is an explicit synthetic auth fixture',
    'No live-session crossing, distributed collector or Render reachability claim'] };
let server, browser, activePage, mode = 'sample';
const deniedHosts = new Set();
(async () => {
  const refs = new PublicReferenceFeed({ enabled: true });
  await refs.refreshDue();
  const sample = refs.snapshot();
  report.realPublicSamples = sample.length; report.sourceDiagnostics = refs.diagnostics();
  if (sample.length !== 13 || report.sourceDiagnostics.some(s => s.error)) report.findings.push('Real source sample incomplete');
  const simulated = stale => ({isEnabled:()=>true,isRefreshing:()=>false,refreshDue:async()=>{},diagnostics:()=>[],
    snapshot:()=>sample.map(q=>({...q,...(stale?{status:'stale',validUntil:Date.now()-1}:{})}))});
  const noDb = new Proxy({}, {get(){throw new Error('Database access forbidden in public-reference QA');}});
  const data = new CfdMarketDataService(undefined);
  const routes = {
    sample: cfdRouter(noDb, data, noDb, simulated(false)),
    stale: cfdRouter(noDb, data, noDb, simulated(true)),
    off: cfdRouter(noDb, data, noDb, new PublicReferenceFeed()),
  };
  const app = express();
  app.use((req,res,next)=>{
    if (!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.sendStatus(403);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"connect-src 'self'; form-action 'none'; object-src 'none'");
    if (!['GET','HEAD'].includes(req.method)) { report.blockedWrites++; return res.status(403).json({error:'QA writes forbidden'}); }
    next();
  });
  app.use('/api/v1',(req,res,next)=>{
    if(req.path==='/me')return res.json({id:'explicit-local-qa-fixture',displayName:'LOCAL QA ONLY',email:'qa@example.invalid',isAdmin:false,createdAt:'2020-01-01',kycStatus:'NOT_STARTED'});
    if(req.path==='/cfd/tickers'&&mode==='error')return res.status(503).json({error:'SIMULATED source outage'});
    if(req.path==='/cfd/tickers'&&mode==='malformed')return res.json({configured:true,tickers:{error:'SIMULATED malformed payload'}});
    if(req.path.startsWith('/cfd/positions')||req.path==='/futures/balances')return res.status(503).json({error:'No accounts in this QA environment'});
    if(req.path.startsWith('/cfd/'))return (routes[mode]||routes.sample)(req,res,next);
    if(req.path==='/support/conversations/mine')return res.json({conversation:null,messages:[]});
    return res.status(503).json({error:'Unrelated data unavailable in isolated QA'});
  });
  app.use(express.static(path.resolve('frontend/dist')));
  app.get('*',(_req,res)=>res.sendFile(path.resolve('frontend/dist/index.html')));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of [1920,1280,768,390]) for(const pagePath of ['/', '/trade?market=cfd']) {
    mode='sample';
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    // The actual App redirects signed-in '/' to a trading terminal. Exercise
    // the public homepage signed out, and only the protected terminal with
    // this isolated fixture. Never change application routing to fit a test.
    if(pagePath!=='/')await context.addInitScript(()=>localStorage.setItem('exchange_token','explicit-local-qa-fixture-not-a-production-token'));
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin) {deniedHosts.add(url.hostname);return route.abort();}
      if(!['GET','HEAD'].includes(route.request().method())) {report.blockedWrites++;return route.abort();}
      return route.continue();
    });
    const page=await context.newPage();activePage=page;page.on('pageerror',e=>report.pageErrors.push({width,pagePath,error:e.message}));
    await page.goto(origin+pagePath,{waitUntil:'domcontentloaded'});
    const selector=pagePath==='/'?'.vx-asset-oil':'.cfd-option';
    await page.locator(selector).first().waitFor({state:'visible',timeout:15000});
    await page.waitForTimeout(1400);
    const result=await page.evaluate(()=>({pathname:location.pathname,overflow:document.documentElement.scrollWidth>innerWidth+1,
      rows:document.querySelectorAll('.cfd-option').length,
      oil:document.querySelector('.vx-asset-oil')?.textContent||null,
      gold:document.querySelector('.vx-asset-gold')?.textContent||null,
      submits:[...document.querySelectorAll('.cfd-terminal button[type=submit]')].map(b=>({disabled:b.disabled}))}));
    report.scenarios.push({mode:'actual-public-sample',width,pagePath,...result});
    if(result.overflow) report.findings.push(`Horizontal overflow: ${width} ${pagePath}`);
    if(pagePath.includes('trade')) {
      if(result.rows!==13)report.findings.push(`Missing catalog rows: ${width}`);
      if(!result.submits.length||result.submits.some(b=>!b.disabled))report.findings.push(`Display-only order form not blocked: ${width}`);
      const wti=page.locator('.cfd-option').filter({hasText:'WTIUSD'});await wti.click();
      await page.waitForTimeout(200);
      if(!(await page.locator('.cfd-ticker-bar').innerText()).includes('U.S. EIA'))report.findings.push(`WTI source missing: ${width}`);
    } else {
      if(!result.oil?.includes('U.S. EIA'))report.findings.push(`OIL source missing: ${width}`);
      if(!result.oil?.includes('WTI'))report.findings.push(`OIL benchmark WTI not identified: ${width}`);
    }
    await page.screenshot({path:path.join(OUT,`${pagePath==='/'?'home':'terminal'}-${width}.png`)});
    await context.close();activePage=null;
  }
  for(const state of ['stale','off','error','malformed']) {
    mode=state;
    const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
    await context.addInitScript(()=>localStorage.setItem('exchange_token','explicit-local-qa-fixture-not-a-production-token'));
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin&&['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
    const page=await context.newPage();activePage=page;page.on('pageerror',e=>report.pageErrors.push({state,error:e.message}));
    await page.goto(origin+'/trade?market=cfd',{waitUntil:'domcontentloaded'});
    await page.locator('.cfd-terminal').waitFor({state:'visible',timeout:15000});await page.waitForTimeout(1500);
    const result=await page.evaluate(()=>({rows:document.querySelectorAll('.cfd-option').length,
      lastKnown:document.body.textContent.includes('Last known'),
      submits:[...document.querySelectorAll('.cfd-terminal button[type=submit]')].map(b=>b.disabled),
      overflow:document.documentElement.scrollWidth>innerWidth+1}));
    report.scenarios.push({mode:`SIMULATED ${state}`,width:1280,...result});
    if(result.submits.some(disabled=>!disabled)||!result.submits.length)report.findings.push(`Order form not blocked in ${state}`);
    if(state==='stale'&&!result.lastKnown)report.findings.push('Stale reference is not visibly labelled');
    if(['stale','off'].includes(state)&&result.rows!==13)report.findings.push(`Catalog missing in ${state}`);
    await page.screenshot({path:path.join(OUT,`terminal-${state}.png`)});await context.close();activePage=null;
  }
  assert.equal(report.pageErrors.length,0,'Browser runtime errors');
})().catch(async error=>{
  report.findings.push(error instanceof Error?error.message:'QA failed');process.exitCode=1;
  if(activePage&&!activePage.isClosed()){
    report.failureUrl=activePage.url();
    try {await activePage.screenshot({path:path.join(OUT,'failure.png'),timeout:3000});}catch{}
  }
}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  report.blockedExternalHosts=[...deniedHosts];report.completedAt=new Date().toISOString();
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
  console.log('CFD_ROLLOUT_REPORT '+JSON.stringify(report));
  if(report.findings.length)process.exitCode=1;
});
