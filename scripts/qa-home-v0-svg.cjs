'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express');
const {chromium}=require(process.env.HOME_QA_PLAYWRIGHT || 'playwright');
const {fixture}=require('./qa-home-v0-fixture.cjs');
const {pixels}=require('./qa-home-v0-pixels.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(mode='responsive') {
  const out=path.resolve('output/home-v0/'+(mode==='motion'?'motion':'updated'));
  fs.mkdirSync(out,{recursive:true});
  const report={fixtureOnly:true,clockAccelerated:false,errors:[],requests:[],responsive:[],samples:[],heap:[]};
  let server,browser,context,page;
  try {
    const app=express();app.use('/api/v1',(req,res)=>{
      report.requests.push(req.method+' '+req.path);
      if(req.method!=='GET')return res.status(405).end();
      return fixture(req,res);
    });
    app.use(express.static(path.resolve('frontend/dist')));
    app.get('*',(_,res)=>res.sendFile(path.resolve('frontend/dist/index.html')));
    server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:process.env.HOME_QA_BROWSER_CHANNEL||undefined,args:['--no-sandbox','--enable-precise-memory-info']});
    context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',reducedMotion:'no-preference',...(mode==='motion'?{recordVideo:{dir:path.join(out,'video'),size:{width:1440,height:900}}}:{})});
    await context.route('**/*',r=>new URL(r.request().url()).origin===origin||r.request().url().startsWith('data:')?r.continue():r.abort());
    await context.addInitScript(()=>localStorage.setItem('exchange_lang',localStorage.getItem('exchange_lang')||'ru'));
    page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.stack));
    const start=Date.now();await page.goto(origin);await page.locator('.v0-coins[data-ready=true]').waitFor();
    await page.locator('.v0-coins').scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>document.querySelector('.v0-coins')?.dataset.active==='true');
    report.coldReadyMs=Date.now()-start;
    const sample=()=>page.locator('.v0-coins').evaluate(host=>({elapsed:Number(host.dataset.elapsed),frames:Number(host.dataset.frames),active:host.dataset.active,
      coins:[...host.querySelectorAll('.v0-coin')].map(e=>{const b=e.getBoundingClientRect(),q=e.querySelector('.v0-quote').getBoundingClientRect(),img=e.querySelector('img');return {id:e.dataset.instrument,x:b.x+b.width/2,y:b.y+b.height/2,width:b.width,quoteX:q.x+q.width/2,loaded:img.complete&&img.naturalWidth>0};})}));
    const shot=name=>page.screenshot({path:path.join(out,name+'.png')});
    assert.equal(await page.locator('.v0-coins canvas').count(),0,'SVG scene must not depend on WebGL');
    assert.equal(await page.locator('.v0-motion-toggle').count(),0);
    await page.locator('.v0-coin img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
    const before=await sample();await wait(1000);const after=await sample();
    assert.equal(before.coins.length,8);assert.equal(after.coins.length,8);
    for(let i=1;i<8;i++)assert.ok(Math.hypot(after.coins[i].x-before.coins[i].x,after.coins[i].y-before.coins[i].y)>10,'every satellite visibly moves within 1s');
    assert.ok(after.frames>before.frames+15,'loop starts automatically after mount');
    report.autoStart={before,after};
    if(mode==='motion') {
      const start=Date.now();let firstPixels;
      for(const second of [0,.5,1,2,3,5,10,20,32,34]) {
        await wait(Math.max(0,start+second*1000-Date.now()));
        const s=await sample();report.samples.push({second,...s});await shot(second+'s');
        if(second===0)firstPixels=pixels(await page.locator('.v0-coins').screenshot());
        if(second===3){
          const next=pixels(await page.locator('.v0-coins').screenshot());assert.equal(next.width,firstPixels.width);assert.equal(next.height,firstPixels.height);
          let changed=0;for(let i=0;i<next.width*next.height;i++){let difference=0;for(let c=0;c<3;c++)difference+=Math.abs(next.data[i*next.channels+c]-firstPixels.data[i*firstPixels.channels+c]);if(difference>36)changed++;}
          report.changedPixelFraction=changed/(next.width*next.height);assert.ok(report.changedPixelFraction>.03,'actual scene pixels must move');
        }
        for(const c of s.coins){assert.ok(c.loaded);assert.ok(Math.abs(c.quoteX-c.x)<4,'quote moves with its asset');}
        assert.ok(s.coins[0].width>Math.max(...s.coins.slice(1).map(c=>c.width))*1.5,'BTC remains dominant');
      }
      report.wallSeconds=(Date.now()-start)/1000;
      await context.close();context=null;await page.video().saveAs(path.join(out,'full-cycle.webm'));
    } else {
      for(const width of [1920,1440,1366,1024,768,430,390,360,320]) {
        await page.setViewportSize({width,height:width<900?844:900});await page.locator('.v0-coins').scrollIntoViewIfNeeded();await wait(250);
        const geometry=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,broken:[...document.querySelectorAll('.v0-coin img')].filter(i=>!i.complete||!i.naturalWidth).length}));
        assert.ok(geometry.overflow<=1);assert.equal(geometry.broken,0);report.responsive.push(geometry);
        const a=await sample();await wait(400);const b=await sample();assert.ok(b.frames>a.frames);assert.ok(Math.hypot(b.coins[1].x-a.coins[1].x,b.coins[1].y-a.coins[1].y)>2);
        await shot('home-'+width);
      }
      for(const lang of ['ru','en','zh','es','hi','ja','ko']) for(const width of [1440,320]) {
        await page.setViewportSize({width,height:900});await page.evaluate(l=>localStorage.setItem('exchange_lang',l),lang);await page.reload({waitUntil:'networkidle'});await page.locator('.v0-coins').scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,lang+' overflow');
        await shot('home-'+lang+'-'+width);
      }
      await page.setViewportSize({width:1440,height:900});await page.goto(origin);await page.locator('.v0-coins[data-active=true]').waitFor();
      await page.emulateMedia({reducedMotion:'reduce'});await wait(100);const reduced=await sample();await wait(500);assert.equal((await sample()).frames,reduced.frames);await shot('home-reduced-motion');
      await page.emulateMedia({reducedMotion:'no-preference'});await wait(400);assert.ok((await sample()).frames>reduced.frames);
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
      await wait(100);const hidden=await sample();await wait(500);assert.equal((await sample()).frames,hidden.frames);
      await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await wait(400);assert.ok((await sample()).frames>hidden.frames);
      await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await wait(250);const offscreen=await sample();await wait(500);assert.equal((await sample()).frames,offscreen.frames);
      await page.locator('.v0-coins').scrollIntoViewIfNeeded();await wait(300);assert.ok((await sample()).frames>offscreen.frames);
      const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
      for(let i=0;i<8;i++) {
        const old=await page.locator('.v0-coins').elementHandle();const route=i%2?'/trade':'/futures';
        await page.locator('.product-shortcuts a[href="'+route+'"]').click();await page.waitForFunction(e=>!e.isConnected,old);
        const stopped=await old.evaluate(e=>e.dataset.frames);await wait(100);assert.equal(await old.evaluate(e=>e.dataset.frames),stopped);
        await page.goBack();await page.locator('.v0-coins[data-active=true]').waitFor();assert.equal(await page.locator('.v0-coins').count(),1);await old.dispose();
        await cdp.send('HeapProfiler.collectGarbage');report.heap.push((await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize').value);
      }
      assert.ok(report.heap.at(-1)-report.heap[1]<8*1024*1024,'bounded post-GC heap');
      for(const route of ['/login','/register']){await page.goto(origin+route,{waitUntil:'networkidle'});assert.ok(await page.locator('input[type=password]').count());await shot(route.slice(1));}
      report.guards={reducedMotion:true,hidden:true,offscreen:true,remounts:8,noWebglDependency:true};
    }
    assert.equal(report.errors.length,0);assert.ok(report.requests.every(x=>x.startsWith('GET ')),'no financial writes');
  } catch(e){report.errors.push(e.stack);process.exitCode=1;console.error(e);}
  finally {if(context)await context.close();if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({mode,errors:report.errors,responsive:report.responsive,wallSeconds:report.wallSeconds,changedPixels:report.changedPixelFraction,heap:report.heap}));}
  return report;
}
module.exports={run};
if(require.main===module)run(process.argv.includes('--motion')?'motion':'responsive');
