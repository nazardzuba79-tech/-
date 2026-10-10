// Research only, one official embed at a time. No provider DOM/data extraction.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(process.env.QA_OUT||'output/stocks-widget-regions');
const symbols=['RUS:SBER','TSE:7203','HKEX:700','SSE:600519','SZSE:000001','SSE:000001','HSI:HSI','SP:SPX','NASDAQ:NDX','TVC:DJI'];
(async()=>{
  fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:700}}),evidence=[];
    await page.route('**/*',route=>{const h=new URL(route.request().url()).hostname;return /(^|\.)tradingview(-widget)?\.com$/.test(h)?route.continue():route.abort();});
    for(const symbol of symbols){
      await page.goto('about:blank');
      await page.setContent('<!doctype html><html style="height:100%"><body style="margin:0;height:100%;background:#0f1014"><h2 style="color:white;font:20px Arial">Official embed research: '+symbol+'</h2><div class="tradingview-widget-container" style="height:620px"><div class="tradingview-widget-container__widget" style="height:588px"></div><div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/" style="color:#2962ff">Track all markets on TradingView</a></div><script async src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js">'+JSON.stringify({autosize:true,symbol,interval:'D',timezone:'Etc/UTC',theme:'dark',style:'1',locale:'en',allow_symbol_change:false,support_host:'https://www.tradingview.com'})+'</script></div></body></html>');
      await page.waitForTimeout(7000);
      const filename=symbol.replace(':','-')+'.png';await page.screenshot({path:path.join(out,filename)});
      evidence.push({symbol,interval:'D',screenshot:filename,frames:page.frames().map(f=>f.url().split('#')[0]),result:'Requires visual assessment; script/iframe load is not market-data availability'});
    }
    fs.writeFileSync(path.join(out,'research.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
