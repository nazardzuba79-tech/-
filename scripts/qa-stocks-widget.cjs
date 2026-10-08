// Built Stocks preview, no stock server/DB. Live mode uses official TV only.
// Never inspect provider DOM, responses, prices or sockets. Screenshots are visual evidence.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const ORIGIN = process.env.QA_WIDGET_ORIGIN || 'http://127.0.0.1:4432';
const OUT = path.resolve(process.env.QA_OUT || path.join(__dirname, '../output/stocks-widget'));
const LIVE = process.argv.includes('--live');
const SYMBOLS = ['AAPL','NVDA','MSFT','AMZN','GOOGL','META','TSLA','AVGO','COST','NFLX'];
const LANGS = ['ru','en','zh','es','hi','ja','ko'];
const WIDTHS = [1920,1440,1366,430,390,360,320];
fs.mkdirSync(OUT,{recursive:true});
const report = { live: LIVE, checks: 0, financialRequests: [], stockReads: [], pageErrors: [], views: [], timings: [], memory: [] };
const ok = (value, name) => { assert.ok(value,name);report.checks++; };
const href = symbol => '/stocks/'+encodeURIComponent('XNGS:'+symbol);
async function main() {
  const browser = await chromium.launch({headless:true});
  try {
    const ctx = await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
    await ctx.addInitScript(() => {if(window.top!==window)return;if(!localStorage.getItem('exchange_lang'))localStorage.setItem('exchange_lang','ru');localStorage.removeItem('exchange_token');});
    let blocked = false;
    await ctx.route('**/*',async route => {
      const req = route.request(),u=new URL(req.url());
      const official=/(^|\.)tradingview(-widget)?\.com$/.test(u.hostname);
      if(u.hostname!=='127.0.0.1' && !official && ['fetch','xhr'].includes(req.resourceType())) {
        report.financialRequests.push(u.hostname+u.pathname);return route.abort();
      }
      if(u.hostname==='127.0.0.1') {
        if (/^\/api(?:\/|$)/.test(u.pathname)) {report.financialRequests.push(u.pathname);return route.abort();}
        if(/^\/stocks(?:\/history)?\//.test(u.pathname) && req.resourceType()!=='document') {report.stockReads.push(u.pathname);return route.abort();}
        return route.continue();
      }
      if((u.hostname==='tradingview.com'||u.hostname.endsWith('.tradingview.com')||u.hostname==='tradingview-widget.com'||u.hostname.endsWith('.tradingview-widget.com')) && LIVE && !blocked) return route.continue();
      if(!LIVE && !blocked && u.pathname.endsWith('embed-widget-advanced-chart.js')) {
        // Lifecycle double ONLY; no fake market prices. One empty provider frame.
        return route.fulfill({contentType:'application/javascript',body:"const f=document.createElement('iframe');f.title='Lifecycle double — not market data';f.src='about:blank';f.style='width:100%;height:100%;border:0';document.querySelector('.tradingview-widget-container__widget').appendChild(f);"});
      }
      return route.abort();
    });
    const page=await ctx.newPage(); page.on('pageerror',error=>report.pageErrors.push(error.message));
    page.on('websocket',socket=>{const h=new URL(socket.url()).hostname;if(!/(^|\.)tradingview(-widget)?\.com$/.test(h))report.financialRequests.push('unexpected websocket host '+h);});
    const cdp=await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metric=async()=>{await cdp.send('HeapProfiler.collectGarbage');const m=await cdp.send('Performance.getMetrics');return {...await cdp.send('Memory.getDOMCounters'),jsHeapUsedBytes:m.metrics.find(x=>x.name==='JSHeapUsedSize').value};};
    const select=async symbol=>{
      const start=performance.now();await page.goto(ORIGIN+href(symbol));
      await page.locator('.vxs-tv-frame').waitFor();
      report.timings.push({symbol,ms:Math.round(performance.now()-start),kind:'cold navigation to VOLTEX widget host (not quote ready)'});
      await page.waitForTimeout(LIVE?8000:100);
      report.timings.push({symbol,ms:Math.round(performance.now()-start),kind:'cold navigation including settling wait'});
      ok(await page.locator('.vxs-tv-frame').count()===1,'exactly one selected host');
      ok(await page.locator('.vxs-tv').getAttribute('data-widget-symbol')==='NASDAQ:'+symbol,'exact symbol');
    };
    await select('AAPL');
    await page.screenshot({path:path.join(OUT,'desktop-aapl.png')});
    if(LIVE) {
      for(const symbol of SYMBOLS) {
        await select(symbol);await page.screenshot({path:path.join(OUT,'live-'+symbol+'.png')});
        report.views.push({symbol:'NASDAQ:'+symbol,frames:page.frames().map(f=>f.url().split('#')[0]),visualResult:'see screenshot; load is not proof of data availability'});
      }
      await page.setViewportSize({width:1440,height:900});await select('AAPL');
      report.memory.push({stage:'live before switches',...await metric()});
      for(let n=0;n<12;n++){
        const symbol=n%2?'AAPL':'NVDA',start=performance.now();
        await page.locator('.vxs-list-tile a[href="'+href(symbol)+'"]').click();
        await page.waitForFunction(s=>document.querySelector('.vxs-tv')?.getAttribute('data-widget-symbol')==='NASDAQ:'+s,symbol);
        report.timings.push({symbol,ms:Math.round(performance.now()-start),kind:'live SPA host replacement (not quote ready)'});
        await page.waitForTimeout(1500);
        ok(await page.locator('.vxs-tv-frame').count()===1,'one live host '+n);
      }
      report.memory.push({stage:'live after 12 switches',...await metric()});
      await page.setViewportSize({width:390,height:844});await select('NVDA');await page.screenshot({path:path.join(OUT,'mobile-nvda.png'),fullPage:true});
    } else {
      for(const lang of LANGS) for(const width of WIDTHS) {
        await page.setViewportSize({width,height:width<861?844:900});
        await page.evaluate(l=>localStorage.setItem('exchange_lang',l),lang);await select('AAPL');
        await page.waitForFunction(l=>document.querySelector('.vxs-tv-frame')?.srcdoc.includes('"locale":"'+l+'"'),lang==='zh'?'zh_CN':lang==='hi'?'en':lang);
        ok(true,lang+' official widget supported locale/fallback');
        ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),lang+' '+width+' no horizontal overflow');
        report.views.push({lang,width});
        if(lang==='ru')await page.screenshot({path:path.join(OUT,'fixture-'+width+'.png'),fullPage:true});
      }
      await page.setViewportSize({width:1440,height:900});await select('AAPL');
      await page.locator('.vxs-list-tile .vxs-row').first().locator('button').click();
      ok(await page.locator('.vxs-list-tile .vxs-row').first().locator('button').getAttribute('aria-pressed')==='true','favorites');
      await page.locator('.vxs-list-tile .vxs-tabs button').last().click();
      ok(await page.locator('.vxs-list-tile .vxs-row').count()===1,'favorites filter');
      await page.locator('.vxs-list-tile .vxs-tabs button').first().click();
      report.memory.push({stage:'before switches',...await metric()});
      for(let n=0;n<30;n++) {
        const symbol=SYMBOLS[(n+1)%SYMBOLS.length],start=performance.now();
        await page.locator('.vxs-list-tile a[href="'+href(symbol)+'"]').click();
        await page.waitForFunction(s=>document.querySelector('.vxs-tv')?.getAttribute('data-widget-symbol')==='NASDAQ:'+s,symbol);
        ok(await page.locator('.vxs-tv-frame').count()===1,'switch cleanup '+n);
        report.timings.push({symbol,ms:Math.round(performance.now()-start),kind:'SPA host replacement'});
      }
      report.memory.push({stage:'after 30 switches',...await metric()});
      await page.goBack();await page.locator('.vxs-tv-frame').waitFor();ok(await page.locator('.vxs-tv-frame').count()===1,'back');
      await page.goForward();await page.locator('.vxs-tv-frame').waitFor();ok(await page.locator('.vxs-tv-frame').count()===1,'forward');
      await page.locator('.vxs-list-tile .vxs-view-switch a[href*="overview"]').click();
      await page.locator('.vxo-page').waitFor();ok(await page.locator('.vxs-tv-frame').count()===0,'overview releases widget');
      ok(!await page.locator('.vxo-page').innerText().then(s=>/\bNaN\b|\bInfinity\b/.test(s)),'no fabricated numeric state');
      await page.screenshot({path:path.join(OUT,'overview.png'),fullPage:true});
      await page.locator('.vxo-search input').fill('NVDA');ok(await page.locator('a[href="'+href('NVDA')+'"]').count()>0,'search');
      blocked=true;await select('AAPL');await page.locator('.vxs-tv-error').waitFor();
      await page.screenshot({path:path.join(OUT,'blocked-script.png')});
      blocked=false;await page.locator('.vxs-tv-error button').click();await page.waitForTimeout(150);
      ok(await page.locator('.vxs-tv-error').count()===0,'retry recovers');
      for(const width of [430,390,360,320]){
        await page.setViewportSize({width,height:844});
        await page.locator('.vxs-list-button').click();
        await page.locator('.vxs-drawer a[href="'+href('NVDA')+'"]').click();
        await page.waitForFunction(()=>document.querySelector('.vxs-tv')?.getAttribute('data-widget-symbol')==='NASDAQ:NVDA');
        ok(await page.locator('.vxs-drawer').count()===0,'mobile drawer closes '+width);
        ok(await page.locator('.vxs-tv-frame').count()===1,'mobile one widget '+width);
        await page.locator('.vxs-list-button').click();
        await page.locator('.vxs-drawer a[href="'+href('AAPL')+'"]').click();
      }
      await page.goto(ORIGIN+'/stocks/UNKNOWN');ok(await page.locator('.vxs-tv-frame').count()===0,'unsupported id has no widget');
      await page.goto(ORIGIN+'/stocks');await page.waitForTimeout(200);await page.goto(ORIGIN+'/academy');
      ok(await page.locator('.vxs-tv-frame').count()===0,'route exit disposes context');
      report.memory.push({stage:'after exit',...await metric()});
    }
    ok(report.financialRequests.length===0,'zero financial requests');ok(report.stockReads.length===0,'zero stock API reads');ok(report.pageErrors.length===0,'no app errors');
    fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  } finally {await browser.close();}
}
main().catch(error=>{fs.writeFileSync(path.join(OUT,'failure.json'),JSON.stringify({...report,error:error.stack},null,2));console.error(error);process.exitCode=1;});
