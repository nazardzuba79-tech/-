/** Local built-app QA. All API, quote and TradingView responses are synthetic
 * test fixtures. No provider, production account, order or database is contacted.
 * Build frontend first. Set PLAYWRIGHT_MODULE to an installed playwright module.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const symbols = ['XAUUSD','XAGUSD','XPTUSD','XPDUSD','WTIUSD','XBRUSD','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD'];
const app = express();
const dist = path.resolve(__dirname,'../frontend/dist');
app.use(express.static(dist));
app.get('*',(_,res)=>res.sendFile(path.join(dist,'index.html')));
(async()=>{
  const server = await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[], selected=[];let maxCharts=0, quoteRequests=0;
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>localStorage.setItem('exchange_token','LOCAL-SYNTHETIC-QA'));
    let release;const held=new Promise(resolve=>{release=resolve;});
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.href==='https://s3.tradingview.com/tv.js') return route.fulfill({contentType:'application/javascript',body:`window.TradingView={widget:function(config){const iframe=document.createElement('iframe');iframe.className='qa-tradingview';iframe.title=config.symbol;document.getElementById(config.container_id).appendChild(iframe);this.remove=()=>iframe.remove();}};`});
      if(url.origin!==base) return route.abort();
      if(!url.pathname.startsWith('/api/')) return route.continue();
      assert.equal(route.request().method(),'GET','QA must never send a financial write');
      let body=[];
      if(url.pathname.endsWith('/me')) body={id:'local-qa',email:'qa@example.invalid',displayName:'Synthetic QA',createdAt:'2020-01-01',isAdmin:false};
      if(url.pathname.endsWith('/cfd/tickers')) {
        quoteRequests++;await held;
        body={configured:true,tickers:symbols.map(symbol=>({symbol,name:symbol,price:symbol==='XPDUSD'?null:'123.45678',referenceStatus:symbol==='XPDUSD'?'unavailable':'available',status:'reference_only',stale:false,executionAllowed:false}))};
      }
      if(url.pathname.endsWith('/cfd/config')) body={minLeverage:1,maxLeverage:100,maxQuoteAgeMs:5000,leverageTiers:[],symbols};
      if(url.pathname.endsWith('/support/conversations/mine')) body={conversation:null,messages:[]};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(base+'/trade?market=cfd',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('button.cfd-option');
    assert.equal(await page.locator('button.cfd-option').count(),13);
    assert.deepEqual(await page.locator('.cfd-optionSymbol').allTextContents(),symbols);
    assert.deepEqual(await page.locator('button.cfd-option .cfd-price').allTextContents(),symbols.map(()=>'—'));
    release();
    await page.waitForFunction(()=>document.querySelector('button.cfd-option .cfd-price')?.textContent!=='—');
    for(const symbol of symbols) {
      const row=page.locator('button.cfd-option').filter({has:page.locator('.cfd-optionSymbol',{hasText:symbol})});
      await row.scrollIntoViewIfNeeded();await row.click();
      await page.waitForFunction(s=>document.querySelector('.cfd-symbol')?.textContent===s,symbol);
      await page.waitForSelector('.cfd-chart iframe');
      const count=await page.locator('.cfd-chart iframe').count();
      assert.equal(count,1);maxCharts=Math.max(maxCharts,count);
      assert.equal(await row.getAttribute('aria-pressed'),'true');
      selected.push(symbol);
    }
    assert.equal(await page.locator('button.cfd-option').filter({hasText:'XPDUSD'}).locator('.cfd-price').innerText(),'—');
    assert.equal(await page.locator('.cfd-form button[type=submit]').count(),1);
    assert.equal(await page.locator('.cfd-form button[type=submit]').isDisabled(),true);
    assert.deepEqual(errors,[]);
    const report={environment:'local built app; synthetic API and TradingView test double',displayedCount:13,selected,maxCharts,quoteRequests,pageErrors:errors,financialWrites:0,providerRequests:0};
    const output=path.resolve(__dirname,'../docs/qa/cfd-reference-coverage');fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

