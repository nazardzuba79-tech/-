'use strict';
// Actual production frontend, isolated fixture API. No production account or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'frontend/dist');
const out = path.resolve(process.env.QA_OUT || path.join(root, 'docs/qa/spot-idle-reads'));
const PAIRS = ['BTC/USDT', 'ETH/USDT'];
const CANDLES = Array.from({ length: 120 }, (_, i) => ({ time: Math.floor(Date.now()/60000)*60-(120-i)*60, open:84000, high:84200, low:83900, close:84100, volume:12 }));
const app = express();
app.use(express.static(dist, { index:false }));
app.get('*', (_req, res) => res.sendFile(path.join(dist,'index.html')));
async function waitFor(check, message) {
  for(let i=0;i<60;i++){if(check())return;await new Promise(r=>setTimeout(r,50));}
  assert.ok(check(),message);
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  let browser;
  const report={environment:'production bundle with isolated fixture API; no production requests',widths:[]};
  try {
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:900},locale:'en-US'});
      await context.addInitScript(()=>{
        localStorage.setItem('exchange_token','local-qa');localStorage.setItem('exchange_lang','ru');
        window.__qaVisibility='visible';
        Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__qaVisibility});
        Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__qaVisibility!=='visible'});
        window.__qaSetVisibility=value=>{window.__qaVisibility=value;document.dispatchEvent(new Event('visibilitychange'));};
      });
      const page=await context.newPage();
      const counts={open:0,history:0,chartTriggers:0,cancels:0,otherWrites:0},errors=[],orderQueries=[];
      const progress={width,counts,orderQueries,pageErrors:errors};
      report.widths.push(progress);
      let hasOrder=true;
      const row={id:'fixture-order',pair:'BTC/USDT',side:'BUY',type:'LIMIT',price:'84000',triggerPrice:null,ocoGroupId:null,originalQuantity:'0.1',remainingQuantity:'0.1',status:'OPEN',createdAt:new Date().toISOString()};
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url()),p=url.pathname;
        if(url.origin===origin&&!p.startsWith('/api/v1/'))return route.continue();
        const reply=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
        if(!['GET','HEAD','OPTIONS'].includes(request.method())){
          if(request.method()==='DELETE'&&p==='/api/v1/orders/fixture-order'){counts.cancels++;hasOrder=false;return reply({status:'CANCELLED'});}
          counts.otherWrites++;return route.fulfill({status:403,body:'fixture rejects unexpected mutation'});
        }
        if(p==='/api/v1/orders/me'){
          const status=url.searchParams.get('status');
          orderQueries.push(status);
          // PriceChart has a separate PENDING_TRIGGER-only display read. Do
          // not attribute it to the account panel's different three-status
          // request; report it explicitly instead of claiming all traffic stops.
          if(status==='PENDING_TRIGGER'){counts.chartTriggers++;return reply([]);}
          if(status==='FILLED,CANCELLED'){counts.history++;return reply([{...row,id:'fixture-history',status:'FILLED',remainingQuantity:'0'}]);}
          assert.equal(status,'PENDING_TRIGGER,OPEN,PARTIALLY_FILLED','unclassified orders request');
          counts.open++;return reply(hasOrder?[row]:[]);
        }
        if(p==='/api/v1/me')return reply({id:'qa',email:'qa@example.invalid',displayName:'QA',kycStatus:'NOT_STARTED',role:'USER',isAdmin:false});
        if(p==='/api/v1/balances')return reply([{asset:'USDT',available:'10000',locked:'0'},{asset:'BTC',available:'0.1',locked:'0'}]);
        if(p.includes('private-trading/access'))return reply({allowed:false});
        if(p.includes('support/conversations/mine'))return reply({conversation:null});
        if(p.includes('assets/icons'))return reply({icons:{}});
        if(p.includes('external/rankings'))return reply({gainers:[],losers:[]});
        if(p.includes('candles'))return reply({candles:CANDLES});
        if(p.includes('external/symbols'))return reply({symbols:PAIRS});
        if(p.includes('/market/pairs'))return reply(PAIRS.map(pair=>({pair,base:pair.split('/')[0],quote:'USDT'})));
        if(p.includes('orderbook'))return reply({bids:[[84000,1]],asks:[[84100,1]],fetchedAt:Date.now()});
        if(p.includes('snapshot'))return reply({pairs:PAIRS.map(pair=>({pair,lastPrice:84100,high24h:84200,low24h:83000,changePercent:1,quoteVolume24h:1e6,volume24h:100})),fetchedAt:Date.now()});
        if(p.includes('tickers'))return reply({tickers:PAIRS.map(pair=>({pair,lastPrice:84100,high24h:84200,low24h:83000,changePercent:1,quoteVolume24h:1e6,volume24h:100}))});
        if(p.startsWith('/api/v1/'))return reply([]);
        return route.fulfill({status:503,contentType:'application/json',body:'{"error":"external network disabled in QA"}'});
      });
      await page.goto(origin+'/trade',{waitUntil:'domcontentloaded'});
      await page.locator('.spot-terminal').waitFor();
      if(width<900)await page.locator('#mobile-trade-account').click();
      await page.locator('#spot-tab-open').click();
      await page.locator('[data-order-id="fixture-order"]').waitFor();
      const beforeVisible=counts.open;await page.waitForTimeout(8500);
      assert.ok(counts.open-beforeVisible>=2,'visible open orders retain their 4s cadence');
      await page.locator('#spot-tab-orderHistory').click();
      await page.locator('[data-order-id="fixture-history"]').waitFor();
      await page.evaluate(()=>window.__qaSetVisibility('hidden'));
      await page.waitForTimeout(200);
      const beforeHidden={open:counts.open,history:counts.history,chartTriggers:counts.chartTriggers};
      await page.waitForTimeout(12500);
      assert.equal(counts.open,beforeHidden.open,'hidden open-order reads must stop');
      assert.equal(counts.history,beforeHidden.history,'hidden history reads must stop');
      Object.assign(progress,{hiddenWindowMs:12500,hiddenOpenReads:counts.open-beforeHidden.open,hiddenHistoryReads:counts.history-beforeHidden.history,unchangedChartTriggerReads:counts.chartTriggers-beforeHidden.chartTriggers});
      await page.evaluate(()=>window.__qaSetVisibility('visible'));
      await waitFor(()=>counts.open>beforeHidden.open&&counts.history>beforeHidden.history,'return must immediately refresh both readers');
      assert.equal(counts.open,beforeHidden.open+1);assert.equal(counts.history,beforeHidden.history+1);
      const afterReturn={open:counts.open,history:counts.history};
      await page.evaluate(()=>{for(let i=0;i<5;i++)document.dispatchEvent(new Event('visibilitychange'));});
      await page.waitForTimeout(200);
      assert.equal(counts.open,afterReturn.open);assert.equal(counts.history,afterReturn.history);
      await page.locator('#spot-tab-open').click();
      await page.locator('[data-order-id="fixture-order"] button').click();
      await waitFor(()=>counts.cancels===1,'existing cancel endpoint must still work');
      await page.locator('[data-order-id="fixture-order"]').waitFor({state:'detached'});
      await page.locator('#spot-tab-assets').click();
      await page.locator('#spot-bottom-content table:visible').first().waitFor();
      assert.equal(counts.otherWrites,0,'only explicit isolated cancel allowed');
      assert.deepEqual(errors,[],'no uncaught browser errors');
      await page.screenshot({path:path.join(out,`spot-${width}.png`)});
      Object.assign(progress,{immediateReturn:true,cancels:counts.cancels,status:'PASS'});
      await context.close();
    }
    report.status='PASS';console.log(JSON.stringify(report,null,2));
  } catch(error){report.status='FAIL';report.error=String(error);throw error;}
  finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
