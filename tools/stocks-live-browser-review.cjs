// Isolated visual/public-feed acceptance. A local non-account reader token is
// injected into this disposable browser only. This is NOT a normal-login/PG
// acceptance claim; production authentication and finance are not modified.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pw=require(process.env.STOCKS_TEST_PLAYWRIGHT_ROOT||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
async function main(){
  const origin=process.env.STOCKS_REVIEW_ORIGIN||'http://127.0.0.1:4484';assert.equal(new URL(origin).hostname,'127.0.0.1');
  const out=path.resolve(process.env.STOCKS_REVIEW_OUT||'output/stocks-live-review');fs.mkdirSync(out,{recursive:true});
  const browser=await pw.chromium.launch({headless:true}),proof={mode:'public-live-market-view-only',checks:[],pageErrors:[],financialRequests:[],externalRequestsBlocked:0,screenshots:[]};
  try{const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(()=>{localStorage.setItem('exchange_token','LOCAL_READ_ONLY_BROWSER_NO_ACCOUNT');localStorage.setItem('lang','en');});
    await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==origin){proof.externalRequestsBlocked++;await route.abort();return;}if(r.method()==='POST'&&/orders|cancel|balances|refresh/.test(u.pathname))proof.financialRequests.push({method:r.method(),path:u.pathname});await route.continue();});
    const page=await context.newPage();page.on('pageerror',e=>proof.pageErrors.push(e.message));
    await page.goto(origin+'/stocks/BYBIT%3AAAPLXUSDT');await page.locator('.vxg-market-head').waitFor();await page.locator('canvas').first().waitFor();
    await page.waitForFunction(()=>{const x=document.querySelector('.vxg-last strong');return x&&/\d/.test(x.textContent||'');},{timeout:20000});
    assert.ok(await page.locator('.vxg-pro-provenance').innerText().then(t=>t.includes('BYBIT')));proof.checks.push('actual Bybit quote and existing chart visible');
    await page.screenshot({path:path.join(out,'desktop-1440-bybit.png'),fullPage:true});proof.screenshots.push('desktop-1440-bybit.png');
    const canvas=await page.locator('.vxg-chart-section').boundingBox(),form=await page.locator('.vxg-submit').boundingBox();assert.ok(canvas&&form);assert.ok(canvas.x+canvas.width<=form.x+2);proof.checks.push('desktop chart stays inside its panel');
    for(const side of [0,1]){await page.locator('.vxg-sides button').nth(side).click();for(const type of [0,1]){await page.locator('.vxg-order-types button').nth(type).click();await page.locator('.vxg-submit').locator('..').locator('input').nth(1).fill('0.01');assert.equal(await page.locator('.vxg-submit').isEnabled(),true);await page.locator('.vxg-submit').click();}}proof.checks.push('Market/Limit BUY/SELL buttons are silent NO-OP');await page.locator('.vxg-timeframes button').getByText('5m',{exact:true}).click().catch(async()=>{await page.getByRole('button',{name:'5m',exact:true}).click();});
    for(const id of ['MEXC:TSLAXUSDT','OKX:XTSLA-USDT','KRAKEN:TSLAxUSD','BITGET:RTSLAUSDT']){await page.goto(origin+'/stocks/'+encodeURIComponent(id));await page.locator('.vxg-market-head').waitFor();await page.waitForTimeout(3000);assert.ok((await page.locator('.vxg-active-asset').innerText()).length>0);proof.checks.push('selected exact identity '+id);}
    await page.screenshot({path:path.join(out,'desktop-1440-bitget.png'),fullPage:true});proof.screenshots.push('desktop-1440-bitget.png');
    await page.setViewportSize({width:390,height:844});await page.goto(origin+'/stocks/BYBIT%3ATSLAXUSDT');await page.locator('.vxg-market-head').waitFor();await page.waitForTimeout(3500);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'mobile-390-chart.png'),fullPage:true});proof.screenshots.push('mobile-390-chart.png');proof.checks.push('390px chart has no page overflow');
    const mobile=page.locator('.vxg-mobile-tabs button');await mobile.nth(1).click();await page.screenshot({path:path.join(out,'mobile-390-trade.png'),fullPage:true});proof.screenshots.push('mobile-390-trade.png');
    for(const button of await page.locator('button.vxg-submit').all())if(await button.isEnabled())await button.click();
    assert.equal(proof.financialRequests.length,0);assert.deepEqual(proof.pageErrors,[]);proof.checks.push('zero financial POST, zero page exceptions');
    let reads=0;page.on('request',r=>{if(r.method()==='GET'&&/__stocks_global\/(state|history)/.test(r.url()))reads++;});
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});const beforeHidden=reads;await page.waitForTimeout(3500);assert.equal(reads,beforeHidden);proof.checks.push('hidden tab stops quote/history polling');
    await page.goto(origin+'/stocks');await page.waitForTimeout(2000);await page.screenshot({path:path.join(out,'mobile-390-catalogue.png'),fullPage:true});proof.screenshots.push('mobile-390-catalogue.png');
    const anonymous=await browser.newContext(),anon=await anonymous.newPage();await anon.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await anon.goto(origin+'/stocks');await anon.waitForURL(/\/login/);proof.checks.push('ordinary login route still required without a session');await anonymous.close();
  }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-result.json'),JSON.stringify(proof,null,2));}
  console.log(JSON.stringify(proof,null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
