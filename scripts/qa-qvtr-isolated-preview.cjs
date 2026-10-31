const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
  const out=path.resolve(process.env.QVTR_PREVIEW_OUT||'artifacts/qvtr-isolated'),browser=await chromium.launch({headless:true});
  const checks=[],series=JSON.parse(fs.readFileSync(path.join(out,'series.json'),'utf8'));
  try{for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith('file:')?route.continue():(requests.push(route.request().url()),route.abort()));
    await page.goto('file:///'+path.join(out,'index.html').replace(/\\/g,'/'));
    for(const interval of ['1m','5m','15m','1h']){await page.locator(`[data-interval="${interval}"]`).click();
      const valid=await page.evaluate(count=>document.querySelector('svg').querySelectorAll('rect').length===count&&count>0&&document.body.scrollWidth<=innerWidth&&document.body.innerText.includes('ІЗОЛЬОВАНА СИМУЛЯЦІЯ'),series[interval].length);
      if(!valid)throw Error('CHART_OR_LAYOUT_'+width+'_'+interval);checks.push({width,interval,pass:true});}
    await page.locator('[data-interval="5m"]').click();await page.screenshot({path:path.join(out,`preview-${width}.png`),fullPage:true});
    await page.reload();if(!await page.locator('[data-interval="5m"]').getAttribute('aria-pressed').then(x=>x==='true'))throw Error('RELOAD');
    if(errors.length||requests.length)throw Error(JSON.stringify({errors,requests}));await page.close();
  }}finally{await browser.close();}
  fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({checks,externalRequests:0,pageErrors:0},null,2));console.log(JSON.stringify({pass:checks.length,externalRequests:0,pageErrors:0}));
})().catch(e=>{console.error(e);process.exitCode=1});
