'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express');
const {chromium}=require(process.env.HOME_QA_PLAYWRIGHT || 'playwright');
const {fixture}=require('./qa-home-v0-fixture.cjs');
const {pixels}=require('./qa-home-v0-pixels.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const DESKTOP_IDS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','NFLX','AMD','TRXUSDT','AAPL','NVDA','TSLA','META','AMZN','MSFT','US500','NAS100','EURUSD','XAUUSD','WTI','USDJPY'];
const MOBILE_IDS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','AAPL','NVDA','TSLA','META','MSFT','US500','EURUSD','XAUUSD'];
const ICONS=['btc','eth','sol','xrp','bnb','netflix','amd','trx','apple','nvidia','tesla','meta','amazon','microsoft','us500','nas100','eurusd','gold','oil','usdjpy'];

// Inspect the rendered DOM, not an imported copy of the orbit implementation.
function rosterAndGeometry(sample,compact=false) {
  const expected=compact?MOBILE_IDS:DESKTOP_IDS;
  assert.deepEqual(sample.coins.map(c=>c.id),expected,'all requested assets are present once, with BTC in the centre');
  assert.equal(new Set(sample.coins.map(c=>c.id)).size,expected.length);
  assert.equal(new Set(sample.coins.map(c=>c.icon)).size,expected.length,'each asset has its own SVG');
  assert.deepEqual([1,2,3].map(ring=>sample.coins.filter(c=>c.ring===ring).length),compact?[3,4,4]:[6,6,7]);
  assert.deepEqual(sample.rings.map(r=>r.ring),[1,2,3]);
  let closestGap=Infinity;
  for(const coin of sample.coins) {
    assert.ok(coin.loaded,coin.id+' SVG loaded');
    assert.ok(coin.icon.endsWith('/'+ICONS[DESKTOP_IDS.indexOf(coin.id)]+'.svg'),coin.id+' correct local logo');
    assert.ok(coin.label.length>0,coin.id+' has a readable ticker');
    assert.ok(coin.width>0&&coin.height>0,coin.id+' is visible');
    assert.ok(coin.x-coin.width/2>=sample.host.x-1&&coin.x+coin.width/2<=sample.host.x+sample.host.width+1,coin.id+' horizontal bounds');
    assert.ok(coin.y-coin.height/2>=sample.host.y-1&&coin.y+coin.height/2<=sample.host.y+sample.host.height+1,coin.id+' vertical bounds');
    assert.ok(Math.abs(coin.rotation)<.001,coin.id+' logo remains upright');
    if(coin.quoteX!==null)assert.ok(Math.abs(coin.quoteX-coin.x)<4,'BTC quote remains attached');
    for(const other of sample.coins)if(other.id>coin.id) {
      // The faces are circles. Diagonally adjacent bounding boxes may overlap
      // without the visible badges doing so; measure their actual circular edges.
      const gap=Math.hypot(other.x-coin.x,other.y-coin.y)-(coin.width+other.width)/2;
      closestGap=Math.min(closestGap,gap);
      assert.ok(gap>=-.5,coin.id+' and '+other.id+' badges overlap by '+(-gap).toFixed(2)+'px');
    }
  }
  assert.equal(sample.coins[0].ring,0);
  assert.ok(sample.coins[0].width>Math.max(...sample.coins.slice(1).map(c=>c.width))*1.5,'BTC remains dominant');
  return closestGap;
}
function ringAngle(sample,coin) {
  const ring=sample.rings.find(r=>r.ring===coin.ring);
  return Math.atan2((coin.y-ring.y)/ring.ry,(coin.x-ring.x)/ring.rx);
}
const angleDelta=(next,previous)=>Math.atan2(Math.sin(next-previous),Math.cos(next-previous));

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
    const sample=()=>page.locator('.v0-coins').evaluate(host=>{
      const h=host.getBoundingClientRect();
      return {elapsed:Number(host.dataset.elapsed),frames:Number(host.dataset.frames),active:host.dataset.active,
        host:{x:h.x,y:h.y,width:h.width,height:h.height},
        rings:[...host.querySelectorAll('.v0-orbit-ring')].map(e=>{const b=e.getBoundingClientRect();return {ring:Number(e.dataset.ring),x:b.x+b.width/2,y:b.y+b.height/2,rx:b.width/2,ry:b.height/2};}),
        coins:[...host.querySelectorAll('.v0-coin')].map(e=>{
          const b=e.getBoundingClientRect(),q=e.querySelector('.v0-quote')?.getBoundingClientRect(),img=e.querySelector('img');
          const matrix=new DOMMatrixReadOnly(getComputedStyle(e).transform);
          return {id:e.dataset.instrument,ring:Number(e.dataset.ring),x:b.x+b.width/2,y:b.y+b.height/2,width:b.width,height:b.height,
            label:e.querySelector('.v0-coin-symbol')?.textContent||img.alt,rotation:Math.atan2(matrix.b,matrix.a),
            quoteX:q?q.x+q.width/2:null,icon:img.getAttribute('src'),loaded:img.complete&&img.naturalWidth>0};
        })};
    });
    const shot=name=>page.screenshot({path:path.join(out,name+'.png')});
    assert.equal(await page.locator('.v0-coins canvas').count(),0,'SVG scene must not depend on WebGL');
    assert.equal(await page.locator('.v0-motion-toggle').count(),0);
    await page.locator('.v0-coin img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
    const before=await sample();await wait(1000);const after=await sample();
    rosterAndGeometry(before);rosterAndGeometry(after);
    const firstSecondDisplacement=after.coins.slice(1).map((coin,index)=>({id:coin.id,px:Math.hypot(coin.x-before.coins[index+1].x,coin.y-before.coins[index+1].y)}));
    for(const coin of firstSecondDisplacement)assert.ok(coin.px>8,coin.id+' visibly moves within 1s');
    assert.ok(firstSecondDisplacement.filter(c=>c.px>15).length>firstSecondDisplacement.length/2,'majority moves more than 15px immediately');
    assert.ok(Math.hypot(after.coins[0].x-before.coins[0].x,after.coins[0].y-before.coins[0].y)<.1,'central BTC stays centred');
    assert.ok(after.frames>before.frames+15,'loop starts automatically after mount');
    report.autoStart={before,after,firstSecondDisplacement};
    if(mode==='motion') {
      const start=Date.now(),screens=[0,.5,1,2,3,5,10,20,32,34],turns=new Map();let firstPixels,previous;
      let closestGap=Infinity;
      // Keep sampling the actual rendered scene between screenshots. A 34s
      // recording covers the slowest (25s) orbit, including the loop seam.
      while(screens.length||Date.now()-start<34000) {
        const second=(Date.now()-start)/1000,s=await sample();report.samples.push({second,...s});
        closestGap=Math.min(closestGap,rosterAndGeometry(s));
        if(previous) {
          assert.ok(s.frames>previous.frames,'RAF must advance between continuous samples');
          assert.ok(s.elapsed>previous.elapsed,'animation clock must not stop');
          const velocities=new Map();
          for(let i=1;i<s.coins.length;i++) {
            const coin=s.coins[i],delta=angleDelta(ringAngle(s,coin),ringAngle(previous,previous.coins[i]));
            assert.ok((coin.ring===2?-delta:delta)>.001,coin.id+' moves continuously in its ring direction');
            turns.set(coin.id,(turns.get(coin.id)||0)+delta);
            const speed=delta/(s.elapsed-previous.elapsed);
            if(velocities.has(coin.ring))assert.ok(Math.abs(speed-velocities.get(coin.ring))<.003,'assets keep equal spacing on their ring');
            else velocities.set(coin.ring,speed);
          }
        }
        previous=s;
        const screenshotAt=screens[0];
        if(second>=screenshotAt) {
          screens.shift();await shot(screenshotAt+'s');
          if(screenshotAt===0)firstPixels=pixels(await page.locator('.v0-coins').screenshot());
          if(screenshotAt===3){
          const next=pixels(await page.locator('.v0-coins').screenshot());assert.equal(next.width,firstPixels.width);assert.equal(next.height,firstPixels.height);
          let changed=0;for(let i=0;i<next.width*next.height;i++){let difference=0;for(let c=0;c<3;c++)difference+=Math.abs(next.data[i*next.channels+c]-firstPixels.data[i*firstPixels.channels+c]);if(difference>36)changed++;}
          report.changedPixelFraction=changed/(next.width*next.height);assert.ok(report.changedPixelFraction>.03,'actual scene pixels must move');
          }
        }
        await wait(200);
      }
      report.continuity={samples:report.samples.length,closestBadgeGapPx:closestGap,turns:Object.fromEntries([...turns].map(([id,radians])=>[id,radians/(2*Math.PI)]))};
      for(const [id,turn] of Object.entries(report.continuity.turns))assert.ok(Math.abs(turn)>1,id+' completes a full continuous revolution');
      report.wallSeconds=(Date.now()-start)/1000;
      await context.close();context=null;await page.video().saveAs(path.join(out,'full-cycle.webm'));
    } else {
      for(const width of [1920,1440,1366,1024,768,430,390,360,320]) {
        await page.setViewportSize({width,height:width<900?844:900});await page.locator('.v0-coins').scrollIntoViewIfNeeded();await wait(250);
        const geometry=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,broken:[...document.querySelectorAll('.v0-coin img')].filter(i=>!i.complete||!i.naturalWidth).length}));
        assert.ok(geometry.overflow<=1);assert.equal(geometry.broken,0);report.responsive.push(geometry);
        const a=await sample();rosterAndGeometry(a,width<=900);await wait(400);const b=await sample();rosterAndGeometry(b,width<=900);assert.ok(b.frames>a.frames);
        for(let i=1;i<b.coins.length;i++)assert.ok(Math.hypot(b.coins[i].x-a.coins[i].x,b.coins[i].y-a.coins[i].y)>2,b.coins[i].id+' moves at '+width+'px viewport');
        Object.assign(geometry,{visibleAssets:b.coins.length,ringCounts:[1,2,3].map(ring=>b.coins.filter(c=>c.ring===ring).length)});
        await shot('home-'+width);
      }
      for(const lang of ['ru','en','zh','es','hi','ja','ko']) for(const width of [1440,320]) {
        await page.setViewportSize({width,height:900});await page.evaluate(l=>localStorage.setItem('exchange_lang',l),lang);await page.reload({waitUntil:'networkidle'});await page.locator('.v0-coins').scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,lang+' overflow');
        rosterAndGeometry(await sample(),width<=900);
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
