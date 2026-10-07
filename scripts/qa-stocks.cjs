// Browser QA against a local Vite server. All market/API traffic is intercepted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.QA_OUTPUT||path.join(root,'output/stocks-qa'));
const origin=process.env.QA_ORIGIN||'http://127.0.0.1:4422';
const manifest=JSON.parse(fs.readFileSync(path.join(root,'services/stocks/manifest.json')));
const now=Date.UTC(2026,9,7,15);
const candles=Array.from({length:300},(_,n)=>{const o=100+Math.sin(n*.19)*3+n*.03,c=o+Math.cos(n)*.7;return {openTimeUtc:now-(300-n)*900000,closeTimeUtc:now-(299-n)*900000,open:String(o),high:String(Math.max(o,c)+.6),low:String(Math.min(o,c)-.8),close:String(c),volume:null,fetchedAt:now};});
const instruments=manifest.map((i,n)=>({...i,latest:n%7===0?null:candles.at(-1),sessionChange:n%7===0?null:(n%9-4)*.41}));
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true});const results=[];let writes=0,external=0,stockRequests=0;const errors=[];
 try{for(const lang of ['ru','en','es','zh','hi','ja','ko']){const ctx=await browser.newContext();await ctx.addInitScript(l=>localStorage.setItem('exchange_lang',l),lang);
 await ctx.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(!['GET','HEAD'].includes(r.method())){writes++;return route.abort();}if(u.origin===origin&&u.pathname.startsWith('/stock-fixture/')){stockRequests++;const body=u.pathname.includes('/history/')?{candles,next:null}:{instruments};return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});}if(u.origin===origin&&!u.pathname.startsWith('/api/'))return route.continue();external++;return route.fulfill({contentType:'application/json',body:'{}'});});
 await ctx.routeWebSocket('**/*',ws=>ws.close());const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1920,1707,1440,1366,430,390,360,320]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/stocks');await page.locator('.stocks-row').nth(1).waitFor();assert.equal(await page.locator('.stocks-row').count(),251);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1,`${lang}/${width} overflow ${overflow}`);
 await page.screenshot({path:path.join(out,`${lang}-${width}.png`)});results.push({lang,width,rows:250,overflow});}
 await page.locator('.stocks-controls input').fill(instruments[0].symbol);assert.ok(await page.locator('.stocks-row').count()>1);await page.locator('.stocks-controls input').fill('');await page.locator('.stocks-star').first().click();assert.equal(await page.locator('.stocks-star').first().getAttribute('aria-pressed'),'true');
 await page.locator('.stocks-identity a').first().click();await page.locator('.stocks-chart canvas').first().waitFor();await page.screenshot({path:path.join(out,`${lang}-detail-320.png`),fullPage:true});
 if(lang==='ru'){
   await page.clock.install();let before=stockRequests;
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
   await page.clock.fastForward(16*60*1000);assert.equal(stockRequests,before);
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
   await page.waitForTimeout(100);assert.equal(stockRequests,before+2); // catalogue + selected history, not 250 subscriptions
 }
 const before=stockRequests;await page.goto(origin+'/academy');await page.waitForTimeout(100);assert.equal(stockRequests,before);await ctx.close();}
 assert.equal(writes,0);assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({results,writes,externalIntercepted:external,stockRequests,pageErrors:errors},null,2));console.log(JSON.stringify({views:results.length,detailViews:7,writes,externalIntercepted:external,pageErrors:errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
