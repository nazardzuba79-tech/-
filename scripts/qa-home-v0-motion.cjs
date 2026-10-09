'use strict';
// Real-time, fixture-only evidence. Never accelerate the clock for this video.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const zlib = require('node:zlib'), express = require('express');
const { chromium } = require(process.env.HOME_QA_PLAYWRIGHT || 'playwright');
const { fixture } = require('./qa-home-v0.cjs');
const out = path.resolve('output/home-v0/motion'); fs.mkdirSync(out, { recursive: true });
const roster = ['BTCUSDT','AAPL','XAUUSD','ETHUSDT','NVDA','US500','WTI','EURUSD','SOLUSDT','XRPUSDT','MSFT','BNBUSDT','TSLA','ADAUSDT','XAGUSD','AMZN','DOGEUSDT','GBPUSD','GOOGL','TRXUSDT','BRENT','META','USDJPY','NAS100'];
const report = { fixtureOnly: true, clockAccelerated: false, frames: [], requests: [], errors: [] };
// Decode browser PNG pixels, not PNG hashes/DOM counters: count actual changed
// pixels in the rendered WebGL layer independently of moving HTML quote labels.
function pixels(buffer) {
  let width, height, channels, chunks = [];
  for (let i = 8; i < buffer.length;) {
    const n = buffer.readUInt32BE(i), type = buffer.toString('ascii', i + 4, i + 8), data = buffer.subarray(i + 8, i + 8 + n); i += n + 12;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[8], 8); channels = data[9] === 6 ? 4 : 3; assert.ok([2,6].includes(data[9])); }
    if (type === 'IDAT') chunks.push(data);
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks)), stride = width * channels, decoded = Buffer.alloc(height * stride);
  const paeth = (a,b,c) => { const p = a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; };
  for (let y=0;y<height;y++) for (let x=0;x<stride;x++) {
    const i=y*stride+x, a=x>=channels?decoded[i-channels]:0, b=y?decoded[i-stride]:0, c=y&&x>=channels?decoded[i-stride-channels]:0;
    const filter=raw[y*(stride+1)], predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
    assert.notEqual(predictor,undefined); decoded[i]=(raw[y*(stride+1)+1+x]+predictor)&255;
  }
  return { width,height,channels,data:decoded };
}
let browser, server, context;
(async () => {
  const app = express(); app.use('/api/v1', (req,res) => { report.requests.push(req.method+' '+req.path); return fixture(req,res); });
  app.use(express.static(path.resolve('frontend/dist'))); app.get('*',(_,res)=>res.sendFile(path.resolve('frontend/dist/index.html')));
  server = await new Promise(r=>{ const s=app.listen(0,'127.0.0.1',()=>r(s)); });
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({ channel: process.env.HOME_QA_BROWSER_CHANNEL || undefined,args:['--no-sandbox','--enable-unsafe-swiftshader','--enable-precise-memory-info']});
  context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',reducedMotion:'reduce',recordVideo:{dir:path.join(out,'video'),size:{width:1440,height:900}}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin || r.request().url().startsWith('data:') ? r.continue():r.abort());
  await context.addInitScript(()=>localStorage.setItem('exchange_lang','ru'));
  const page=await context.newPage(); page.on('pageerror',e=>report.errors.push(e.stack));
  const cdp=await context.newCDPSession(page); await cdp.send('Performance.enable');
  const started=Date.now(); await page.goto(origin); await page.waitForSelector('.v0-coins[data-ready=true]');
  assert.equal(await page.locator('.v0-motion-toggle').count(),0);
  const sample=()=>page.locator('.v0-coins').evaluate(host=>({time:performance.now(),...host.__voltexHeroSceneStats,active:host.dataset.active,
    coins:[...host.querySelectorAll('.v0-coin')].filter(e=>getComputedStyle(e).visibility!=='hidden').map(e=>{
      const b=e.getBoundingClientRect(), q=e.querySelector('.v0-quote').getBoundingClientRect();
      return {id:e.dataset.instrument,x:b.x+b.width/2,y:b.y+b.height/2,quoteX:q.x+q.width/2,quoteY:q.y,text:e.querySelector('.v0-quote').textContent};
    })}));
  const zero=await sample(); assert.equal(zero.elapsed,0); assert.equal(zero.centre,'BTCUSDT');
  await page.screenshot({path:path.join(out,'0s.png')});
  const layer0=pixels(await page.locator('.v0-coin-canvas').screenshot());
  await page.waitForTimeout(450); assert.equal((await sample()).frames,zero.frames,'system reduced motion remains static');
  report.videoCycleStartSeconds=(Date.now()-started)/1000;
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForSelector('.v0-coins[data-active=true]');
  const wallStart=Date.now(); report.frames.push(zero);
  for(let i=1;i<=25;i++) {
    const target=i*3;
    await page.waitForFunction(t=>document.querySelector('.v0-coins').__voltexHeroSceneStats.elapsed>=t,target,{timeout:10000,polling:40});
    const current=await sample(); report.frames.push(current);
    assert.equal(current.centre,roster[i%24],`central identity at ${target}s`);
    assert.equal(new Set(current.coins.map(x=>x.id)).size,current.coins.length); assert.ok(current.coins.length<=8);
    current.coins.forEach(coin=>assert.ok(Math.abs(coin.x-coin.quoteX)<1,'quote follows its own moving object'));
    await page.screenshot({path:path.join(out,`${target}s.png`)});
    if(i===1) {
      for(const id of ['BTCUSDT','AAPL']) {
        const a=zero.coins.find(x=>x.id===id),b=current.coins.find(x=>x.id===id);
        assert.ok(Math.hypot(b.x-a.x,b.y-a.y)>60,`${id}: real rendered DOM centre moved`);
      }
      const layer3=pixels(await page.locator('.v0-coin-canvas').screenshot()); assert.equal(layer3.data.length,layer0.data.length);
      let changed=0; for(let n=0;n<layer0.data.length;n+=layer0.channels) if(Math.abs(layer0.data[n]-layer3.data[n])+Math.abs(layer0.data[n+1]-layer3.data[n+1])+Math.abs(layer0.data[n+2]-layer3.data[n+2])>60)changed++;
      report.changedWebglPixelFraction=changed/(layer0.width*layer0.height);
      assert.ok(report.changedWebglPixelFraction>.08,'actual medallion pixels move; DOM/counters alone cannot pass');
    }
    if(i===3) { await page.waitForFunction(()=>document.querySelector('.v0-coins').__voltexHeroSceneStats.elapsed>=10); await page.screenshot({path:path.join(out,'10s.png')}); }
  }
  report.cycleWallSeconds=(Date.now()-wallStart)/1000; assert.ok(report.cycleWallSeconds>=75,'unaccelerated complete cycle and continuation');
  const final=await sample(); assert.ok(final.frames/ final.elapsed<=31,'30fps drawing cap');
  report.metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  // Loss/restoration while paused must not override the current system preference.
  await page.emulateMedia({reducedMotion:'reduce'}); await page.waitForTimeout(100);
  const beforeLoss=await sample();
  await page.locator('canvas.v0-coin-canvas').evaluate(canvas=>{window.__contextLoss=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');window.__contextLoss.loseContext();});
  await page.waitForSelector('.v0-coins[data-ready=false]'); await page.waitForTimeout(200);
  await page.evaluate(()=>window.__contextLoss.restoreContext()); await page.waitForSelector('.v0-coins[data-ready=true]');
  const restored=await sample(); assert.equal(restored.active,'false'); assert.equal(restored.elapsed,beforeLoss.elapsed);
  await page.waitForTimeout(300); assert.equal((await sample()).frames,restored.frames);
  await page.emulateMedia({reducedMotion:'no-preference'}); await page.waitForTimeout(300); assert.ok((await sample()).elapsed>restored.elapsed);
  report.contextRestore={preservesElapsed:true,respectsReducedMotion:true,resumes:true};
  assert.ok(report.requests.every(r=>r.startsWith('GET ')),'no financial writes'); assert.deepEqual(report.errors,[]);
  await context.close(); context=null;
})().catch(e=>{report.errors.push(e.stack);process.exitCode=1;console.error(e);}).finally(async()=>{
  if(context)await context.close(); if(browser)await browser.close(); if(server)await new Promise(r=>server.close(r));
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({out,samples:report.frames.length,cycleWallSeconds:report.cycleWallSeconds,changedWebglPixelFraction:report.changedWebglPixelFraction,errors:report.errors}));
});
