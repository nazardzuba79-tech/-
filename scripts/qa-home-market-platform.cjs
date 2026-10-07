#!/usr/bin/env node
/** Production-bundle, loopback-only hero QA. No backend, account or external network.
 * QA_HERO_MODE=baseline QA_DIST=.home-hero-baseline-dist node scripts/qa-home-market-platform.cjs
 * QA_HERO_MODE=after QA_DIST=frontend/dist node scripts/qa-home-market-platform.cjs
 * QA_HERO_SERVE=1 keeps only the read-only preview server alive after QA.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./qa-mobile-trade-fixture.cjs');
const root = path.resolve(__dirname, '..');
const mode = process.env.QA_HERO_MODE || 'after';
const resumeTail = process.env.QA_HERO_TAIL === '1';
const visualOnly = process.env.QA_HERO_VISUAL === '1';
const screenshotsOnly = process.env.QA_HERO_SCREENSHOTS_ONLY === '1';
const dist = path.resolve(root, process.env.QA_DIST || 'frontend/dist');
const out = path.resolve(root, process.env.QA_OUT || `output/home-market-platform/${mode}`);
const port = Number(process.env.QA_PORT || 4198);
const origin = `http://127.0.0.1:${port}`;
let modernServer, modernOrigin;
const heroSelector = '#home-global-hero';
const widths = [[1920,1080],[1707,940],[1440,900],[1366,768],[430,932],[390,844],[360,800],[320,740]].filter(([width])=>!process.env.QA_HERO_WIDTHS||process.env.QA_HERO_WIDTHS.split(',').map(Number).includes(width));
fs.mkdirSync(out, { recursive: true });
assert(fs.existsSync(path.join(dist, 'index.html')), 'Build the requested production bundle first');
const report = { mode, fixtureOnly: true, productionAccess: false, profile: { chromium: 'headless', deviceScaleFactor: 1, cpuThrottle: 2, latencyMs: 40, downloadBytesPerSecond: 1250000, uploadBytesPerSecond: 625000 }, cases: [], checks: [], errors: [], consoleErrors: [], denied: [], writes: [], unknownApi: [], metrics: [], result: 'FAIL' };
if(resumeTail||visualOnly){
  const previous=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
  Object.assign(report,previous,{consoleErrors:[],unknownApi:[],denied:[]});
  if(visualOnly)report.metrics=[];
  if(previous.consoleErrors.length||previous.unknownApi.length||previous.denied.length)fs.writeFileSync(path.join(out,'fixture-gap-before-repair.json'),JSON.stringify({consoleErrors:previous.consoleErrors,unknownApi:previous.unknownApi,denied:previous.denied},null,2));
}
const fixture = cp.spawn(process.execPath, [path.join(__dirname, 'qa-perf-harness.cjs'), '--port', String(port), '--dist', dist], { cwd: root, stdio: ['ignore','pipe','pipe'], windowsHide: true });
const fixtureLog = fs.createWriteStream(path.join(out, 'fixture.log'));
fixture.stdout.pipe(fixtureLog); fixture.stderr.pipe(fixtureLog);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unavailable = { available: false, value: null, source: 'isolated-fixture', fetchedAt: 0, stale: true };
const syntheticLogo = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#343744"/></svg>';
const extraFixtures = {
  '/api/v1/market/listings': { listings: [] },
  '/api/v1/market/native-assets': { assets: [] },
  '/api/v1/market/display/spot-snapshot': { tickers: unavailable, overview: unavailable, sentiment: unavailable },
  '/api/v1/native-demo/assets': [],
  '/api/v1/native-simulations': [],
  '/api/v1/futures/native-listings': [],
  '/api/v1/futures/funding-history': [],
  '/api/v1/futures/account': { equity: '10000', availableBalance: '10000', walletBalance: '10000', unrealizedPnl: '0', initialMargin: '0', maintenanceMargin: '0' },
};

function instrument() {
  const state = window.__heroQa = { cls: 0, lcp: 0, longTasks: [], frames: [], observerErrors: [], activeIntervals: new Set(), activeTimeouts: new Set(), listeners: new Map(), observerCount: 0 };
  for (const [type, callback] of [['layout-shift', e => { if (!e.hadRecentInput) state.cls += e.value; }], ['largest-contentful-paint', e => { state.lcp = e.startTime; }], ['longtask', e => state.longTasks.push({ start: e.startTime, duration: e.duration })]]) {
    try { new PerformanceObserver(list => list.getEntries().forEach(callback)).observe({ type, buffered: true }); } catch (e) { state.observerErrors.push(String(e)); }
  }
  const nativeInterval = window.setInterval, nativeClearInterval = window.clearInterval;
  window.setInterval = function (fn, delay, ...args) { const id = nativeInterval.call(this, fn, delay, ...args); state.activeIntervals.add(id); return id; };
  window.clearInterval = function (id) { state.activeIntervals.delete(id); return nativeClearInterval.call(this, id); };
  const nativeTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;
  window.setTimeout = function (fn, delay, ...args) { let id; id = nativeTimeout.call(this, (...rest) => { state.activeTimeouts.delete(id); if (typeof fn === 'function') fn(...rest); else Function(fn)(); }, delay, ...args); state.activeTimeouts.add(id); return id; };
  window.clearTimeout = function (id) { state.activeTimeouts.delete(id); return nativeClearTimeout.call(this, id); };
  for (const [target, name] of [[window, 'window'], [document, 'document']]) {
    const add = target.addEventListener, remove = target.removeEventListener;
    target.addEventListener = function (type, fn, options) { const key = `${name}:${type}`; if (!state.listeners.has(key)) state.listeners.set(key, new Set()); state.listeners.get(key).add(fn); return add.call(this, type, fn, options); };
    target.removeEventListener = function (type, fn, options) { state.listeners.get(`${name}:${type}`)?.delete(fn); return remove.call(this, type, fn, options); };
  }
}

async function waitServer() {
  const modern=createFixture({dist,positions:'none'});
  modernServer=await new Promise(resolve=>{const s=modern.app.listen(0,'127.0.0.1',()=>resolve(s));});
  modernOrigin=`http://127.0.0.1:${modernServer.address().port}`;
  for (let i=0;i<100;i++) { try { if ((await fetch(origin + '/__qa/hits')).ok) return; } catch {} await sleep(100); }
  throw new Error('Local fixture server did not become ready');
}
async function createContext(browser, { width=1440, height=900, signed=false, lang='ru', reduced=false, logos='normal', video=false }={}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block', ...(video ? { recordVideo: { dir: path.join(out,'video'), size: { width:1440, height:900 } } } : {}) });
  await ctx.addInitScript(instrument);
  await ctx.addInitScript(({ signed, lang }) => { localStorage.setItem('exchange_lang', lang); if (signed) localStorage.setItem('exchange_token','header.eyJzdWIiOiJxYS11c2VyIiwic2lkIjoicWEtc2Vzc2lvbiJ9.fixture'); }, { signed,lang });
  const requests=[];
  await ctx.route('**/*', async route => {
    const request=route.request(), url=new URL(request.url()), method=request.method(); requests.push({ url: request.url(), method, type: request.resourceType() });
    if (!['GET','HEAD','OPTIONS'].includes(method)) { report.writes.push({ url:request.url(),method }); return route.abort('blockedbyclient'); }
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status:200,contentType:'text/css',body:'/* isolated QA: existing system font fallback */' });
    if (url.hostname==='market.voltextech.net'&&url.pathname.startsWith('/market/display/')) {
      const reply=await fetch(modernOrigin+'/api/v1'+url.pathname+url.search);
      return route.fulfill({status:reply.status,contentType:'application/json',body:await reply.text()});
    }
    if (url.hostname==='market.voltextech.net'&&['/market/nrx','/market/listings'].includes(url.pathname)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({serverTime:Date.now(),assets:[]})});
    if (url.pathname.startsWith('/api/')) {
      const body=extraFixtures[url.pathname];
      if (body!==undefined) return route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(body) });
      let reply;
      if(url.pathname==='/api/v1/cfd/display/tickers')reply=await fetch(origin+'/api/v1/cfd/tickers');
      else if(url.pathname.startsWith('/api/v1/cfd/display/candles/'))reply=await fetch(modernOrigin+'/api/v1/market/external/candles/'+url.pathname.split('/').at(-1)+url.search);
      else reply=await fetch(origin+url.pathname+url.search);
      if(reply.status===404 && /^\/api\/v1\/(?:market\/(?:display|futures\/candles|derivatives|universe|pairs|test-assets)|private-trading\/access)(?:\/|$)/.test(url.pathname)) reply=await fetch(modernOrigin+url.pathname+url.search);
      if (reply.status===404) report.unknownApi.push(url.pathname);
      let responseBody=await reply.text();
      if(reply.ok&&/^\/api\/v1\/market\/external\/(candles|trades)\//.test(url.pathname))responseBody=JSON.stringify({...JSON.parse(responseBody),pair:decodeURIComponent(url.pathname.split('/').at(-1)).replace('-','/'),interval:url.searchParams.get('interval')||'15m'});
      return route.fulfill({ status:reply.status,contentType:'application/json',body:responseBody });
    }
    if (url.origin !== origin) {
      if (request.resourceType()==='image') return route.fulfill({ status:200,contentType:'image/svg+xml',body:syntheticLogo });
      report.denied.push({url:request.url(),type:request.resourceType()}); return route.abort('blockedbyclient');
    }
    if (logos!=='normal' && url.pathname.startsWith('/hero/instruments/')) {
      if (logos==='missing') return route.fulfill({status:200,contentType:'image/svg+xml',body:'not an image'});
      await sleep(1800);
    }
    return route.continue();
  });
  await ctx.routeWebSocket('**/*', ws => ws.close());
  const page=await ctx.newPage();
  page.on('pageerror',e=>report.errors.push({page:page.url(),error:e.stack||String(e)}));
  page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push({page:page.url(),text:m.text()});});
  const cdp=await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:report.profile.cpuThrottle});
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:report.profile.latencyMs,downloadThroughput:report.profile.downloadBytesPerSecond,uploadThroughput:report.profile.uploadBytesPerSecond});
  return {ctx,page,cdp,requests};
}
async function openHome(page) {
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  await page.locator(heroSelector+' h1').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>{const image=document.querySelector('#home-global-hero .art');return !image||(image.complete&&image.naturalWidth>0);});
  await page.waitForFunction(()=>document.querySelector('#home-live-terminal .vx-real-candles')&&document.querySelectorAll('#home-live-terminal .hs-trade-row').length===6);
  await page.waitForTimeout(2200);
}
async function geometry(page) {
  return page.evaluate(selector=>{
    const hero=document.querySelector(selector), rect=hero.getBoundingClientRect();
    const boxes=[...hero.querySelectorAll('h1,p,a,button')].filter(n=>n.getBoundingClientRect().width&&getComputedStyle(n).visibility!=='hidden').map(n=>({tag:n.tagName,text:n.textContent.trim().slice(0,90),x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth}));
    return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,hero:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},boxes,heading:hero.querySelector('h1').textContent};
  },heroSelector);
}
async function columnGeometry(page) {
  return page.evaluate(()=>{
    const box=node=>{if(!node)return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const scene=document.querySelector('[data-market-visual]'),viewport=box(scene),copy=box(document.querySelector('#home-global-hero .copy')),terminal=box(document.querySelector('#home-global-hero .terminal-screen'));
    const tiles=[...scene.querySelectorAll('[data-market-tile]')].map(tile=>({symbol:tile.dataset.marketTile,...box(tile),opacity:Number(getComputedStyle(tile).opacity)}));
    const visible=tiles.filter(t=>t.opacity>.05&&t.bottom>viewport.y+2&&t.y<viewport.bottom-2);
    const overlap=(a,b)=>a&&b?Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)):0;
    const text=[];const walker=document.createTreeWalker(document.querySelector('#home-global-hero .copy'),NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){const node=walker.currentNode;if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.width&&r.height)text.push({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});}
    return{viewport,copy,terminal,visibleCount:visible.length,visibleSymbols:visible.map(t=>t.symbol),textOverlapArea:text.reduce((sum,t)=>sum+overlap(viewport,t),0),terminalOverlapArea:overlap(viewport,terminal),originalArt:document.querySelector('#home-global-hero .art')?.getAttribute('src'),heading:document.querySelector('#home-global-hero h1')?.textContent,tapeCount:document.querySelectorAll('#home-global-hero .hs-tape').length,actualTerminal:document.querySelector('#home-global-hero .terminal-screen #home-live-terminal')!==null};
  });
}
async function metrics(page,cdp,requests,label,duration=4000) {
  const first=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const frames=await page.evaluate(duration=>new Promise(resolve=>{const result=[];let previous=performance.now(),start=previous;const step=now=>{result.push(now-previous);previous=now;if(now-start<duration)requestAnimationFrame(step);else resolve(result);};requestAnimationFrame(step);}),duration);
  const last=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const data=await page.evaluate(()=>{const s=window.__heroQa;return {cls:s.cls,lcpMs:s.lcp,longTasks:s.longTasks,intervals:s.activeIntervals.size,timeouts:s.activeTimeouts.size,listeners:Object.fromEntries([...s.listeners].map(([k,v])=>[k,v.size])),resources:performance.getEntriesByType('resource').map(r=>({name:r.name,bytes:r.transferSize,encodedBytes:r.encodedBodySize,duration:r.duration,initiator:r.initiatorType})),heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null};});
  const sorted=frames.slice(1).sort((a,b)=>a-b), span=last.Timestamp-first.Timestamp;
  const result={label,...data,requestCount:requests.length,requests:[...requests],frameCount:frames.length,frameP50Ms:sorted[Math.floor(sorted.length*.5)],frameP95Ms:sorted[Math.floor(sorted.length*.95)],framesOver50Ms:frames.filter(n=>n>50).length,mainThreadMs:(last.TaskDuration-first.TaskDuration)*1000,scriptMs:(last.ScriptDuration-first.ScriptDuration)*1000,layoutMs:(last.LayoutDuration-first.LayoutDuration)*1000,windowMs:span*1000,jsHeapBytes:last.JSHeapUsedSize,domNodes:last.Nodes,listenersCdp:last.JSEventListeners};
  report.metrics.push(result); return result;
}
const check = name => {report.checks.push(name);console.log('PASS',name);};

async function main() {
  await waitServer();
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM?{executablePath:process.env.QA_CHROMIUM}:{})});
    if(!resumeTail){for(const [width,height] of widths){
      const {ctx,page,cdp,requests}=await createContext(browser,{width,height});
      await openHome(page);
      const shape=await geometry(page);
      await page.screenshot({path:path.join(out,`home-${width}.png`)});
      assert.equal(shape.overflow,false,`horizontal overflow ${width}`);
      if(mode==='after'){
        const column=await columnGeometry(page);report.cases.push({name:`column-${width}`,width,height,...column});assert.equal(column.originalArt,'/hero/sapphire-refined.png');assert.equal(column.heading,'OWN YOUR FUTURE.');assert.equal(column.actualTerminal,true,'real terminal visibility target remains in original laptop');assert.equal(column.tapeCount,1,'original live market tape is present');
        assert.equal(column.visibleCount,width>900?5:3,`compact column visible cards at ${width}`);
        assert.equal(column.textOverlapArea,0,`column must not cover real copy/CTA at ${width}`);
        assert.equal(column.terminalOverlapArea,0,`column must not cover real laptop display at ${width}`);
        const baselinePath=path.join(root,'output/home-market-platform/baseline/report.json');
        if(fs.existsSync(baselinePath)){
          const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8')).cases.find(c=>c.width===width&&!c.name);
          if(baseline)for(const label of ['OWN YOUR FUTURE.','Открыть терминал','Смотреть рынки']){
            const before=baseline.boxes.find(b=>b.text===label),after=shape.boxes.find(b=>b.text===label);
            assert(before&&after,`preserved original ${label}`);
            for(const key of ['x','y','width','height'])assert(Math.abs(before[key]-after[key])<1,`original ${label} ${key} unchanged at ${width}`);
          }
        }
      }
      if(width===1440||width===390)await metrics(page,cdp,requests,`home-${width}`);
      report.cases.push({width,height,signed:false,...shape});
      await ctx.close();
    }
    check(`${widths.length} viewport screenshots and horizontal layout`);
    if(!screenshotsOnly){for(const signed of [false,true]){
      const {ctx,page}=await createContext(browser,{signed,width:1440});
      if(signed){
        await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
        await page.waitForURL(/\/futures/); await page.waitForTimeout(2500);
        assert.equal(await page.locator(heroSelector).count(),0,'authenticated root preserves default trading redirect');
        report.cases.push({name:'authenticated-root-redirect',path:new URL(page.url()).pathname});
      }else{
        await openHome(page);assert(await page.locator(heroSelector+' a[href="/trade"]').count()>0);
        report.cases.push({name:'guest',...(await geometry(page))});
      }
      await ctx.close();
    }
    check('guest and authenticated fixture render');
    }
    }
    if(mode==='after'&&!screenshotsOnly)await afterChecks(browser);
    assert.deepEqual(report.errors,[],'uncaught browser errors');
    assert.deepEqual(report.consoleErrors,[],'browser console errors');
    assert.deepEqual(report.unknownApi,[],'missing isolated fixture endpoints');
    assert.deepEqual(report.denied,[],'unexpected nonlocal request');
    assert.deepEqual(report.writes,[],'unexpected browser write attempt');
    report.result='PASS';
  } finally {
    if(browser)await browser.close();
    report.checks=[...new Set(report.checks)];
    report.cases=[...new Map(report.cases.map(c=>[c.name||`viewport-${c.width}`,c])).values()];
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    if(process.env.QA_HERO_SERVE!=='1'){fixture.kill();fixtureLog.end();modernServer?.close();}
    else console.log(`Read-only preview remains at ${origin}; PID ${fixture.pid}`);
  }
  console.log(JSON.stringify({result:report.result,out,checks:report.checks.length,metrics:report.metrics.map(m=>({label:m.label,lcpMs:m.lcpMs,cls:m.cls,mainThreadMs:m.mainThreadMs,frameP95Ms:m.frameP95Ms,requests:m.requestCount})),unknownApi:[...new Set(report.unknownApi)],errors:report.errors,consoleErrors:report.consoleErrors.length}));
}
async function motion(page) {
  return page.locator('[data-market-visual]').evaluate(scene=>({
    state:scene.dataset.motionState,reasons:scene.dataset.motionReason,
    animations:scene.getAnimations({subtree:true}).map(a=>({time:a.currentTime,state:a.playState,duration:a.effect.getTiming().duration})),
    tiles:[...scene.querySelectorAll('[data-market-tile]')].map(tile=>{const b=tile.getBoundingClientRect(),s=getComputedStyle(tile);return {symbol:tile.dataset.marketTile,x:b.x,y:b.y,width:b.width,height:b.height,opacity:Number(s.opacity),transform:s.transform};}),
    viewport:(()=>{const b=scene.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};})(),
  }));
}
async function assertFrozen(page, reason) {
  await page.waitForFunction(reason=>{const el=document.querySelector('[data-market-visual]');return el?.dataset.motionState==='paused'&&el.dataset.motionReason.includes(reason);},reason);
  await page.waitForTimeout(80);
  const before=await motion(page);await page.waitForTimeout(650);const after=await motion(page);
  assert(before.animations.every((a,i)=>Math.abs(Number(a.time)-Number(after.animations[i].time))<2),`${reason} animation clocks must freeze`);
  report.cases.push({name:`pause-${reason}`,before,after});
}
async function waitRunning(page) { await page.waitForFunction(()=>document.querySelector('[data-market-visual]')?.dataset.motionState==='running'); }
async function spaRoute(page, route) { await page.evaluate(route=>{history.pushState({},'',route);window.dispatchEvent(new PopStateEvent('popstate'));},route); await page.waitForTimeout(1600); }
async function afterChecks(browser) {
  if(!resumeTail){
  // Actual 28 second timeline, sampled in the same stable part of each step.
  const cycle=await createContext(browser,{video:true});
  await openHome(cycle.page);await cycle.page.mouse.move(0,0);await waitRunning(cycle.page);
  const initial=await motion(cycle.page);assert.equal(initial.animations.length,7);assert(initial.animations.every(a=>a.duration===28000));
  const phases=[],started=Date.now();
  for(let phase=0;phase<8;phase++){
    await cycle.page.waitForTimeout(Math.max(0,started+phase*4000-Date.now()));
    const value=await motion(cycle.page),size=await geometry(cycle.page);
    const centered=[...value.tiles].filter(t=>t.opacity>.05).sort((a,b)=>Math.abs(a.y+a.height/2-(value.viewport.y+value.viewport.height/2))-Math.abs(b.y+b.height/2-(value.viewport.y+value.viewport.height/2)))[0];
    phases.push({phase,atMs:Date.now()-started,center:centered.symbol,...value,hero:size.hero});
    await cycle.page.screenshot({path:path.join(out,`phase-${phase}-${centered.symbol}.png`)});
  }
  assert.equal(new Set(phases.slice(0,7).map(p=>p.center)).size,7,'each of seven instruments must actually reach the center');
  assert.equal(phases[7].center,phases[0].center,'last-to-first cycle returns seamlessly');
  for(const p of phases){assert.deepEqual(p.viewport,phases[0].viewport,'column viewport remains stationary');assert.deepEqual(p.hero,phases[0].hero,'original hero and copy do not change height');}
  const firstCenter=phases[0].tiles.find(t=>t.symbol===phases[0].center),nextCenter=phases[1].tiles.find(t=>t.symbol===firstCenter.symbol);assert(nextCenter.y<firstCenter.y-20,'visible cards move upward between steps');
  for(const tile of phases[0].tiles){const last=phases[7].tiles.find(t=>t.symbol===tile.symbol);assert(Math.abs(last.x-tile.x)<3&&Math.abs(last.y-tile.y)<3,`${tile.symbol} wrap position stable`);}
  report.cases.push({name:'real-full-cycle',phases});
  const video=cycle.page.video();await cycle.ctx.close();
  const source=await video.path();fs.copyFileSync(source,path.join(out,'market-platform-cycle.webm'));check('real upward column cycle, all seven center phases, last-to-first continuity and recorded video');
  if(visualOnly)return;

  const life=await createContext(browser);const page=life.page;
  await openHome(page);await page.mouse.move(0,0);await waitRunning(page);
  const start=await motion(page);await page.waitForTimeout(300);const advanced=await motion(page);assert(Number(advanced.animations[0].time)>Number(start.animations[0].time)+150);check('visible scene advances');
  await page.locator('[data-market-visual]').hover();await assertFrozen(page,'hover');await page.mouse.move(0,0);await waitRunning(page);
  const toggle=page.locator('[data-motion-toggle]');await toggle.focus();await assertFrozen(page,'focus');
  await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-pressed'),'true');
  await toggle.evaluate(n=>n.blur());await page.mouse.move(0,0);await assertFrozen(page,'manual');
  await toggle.focus();await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-pressed'),'false');
  await toggle.evaluate(n=>n.blur());await page.mouse.move(0,0);await waitRunning(page);check('hover, keyboard focus, manual pause and resume');
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await assertFrozen(page,'offscreen');await page.evaluate(()=>window.scrollTo(0,0));await waitRunning(page);check('offscreen compositor clocks pause and resume');
  // Chromium headless keeps background pages visible. Dispatch the real event
  // with an explicit visibility fixture; this tests the app handler, not OS scheduling.
  const requestsBefore=life.requests.length;
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await assertFrozen(page,'hidden');const cdpBefore=Object.fromEntries((await life.cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  await page.waitForTimeout(2000);const cdpAfter=Object.fromEntries((await life.cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  report.cases.push({name:'visibility-event-fixture',requests:life.requests.length-requestsBefore,mainThreadMs:(cdpAfter.TaskDuration-cdpBefore.TaskDuration)*1000,windowMs:2000});
  await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await waitRunning(page);check('hidden visibility event stops animation without new requests');
  await page.emulateMedia({reducedMotion:'reduce'});await assertFrozen(page,'reduced-motion');
  const reduced=await motion(page);assert.equal(reduced.animations.length,7);assert.equal((await columnGeometry(page)).visibleCount,5);await page.screenshot({path:path.join(out,'reduced-motion.png')});
  await page.emulateMedia({reducedMotion:'no-preference'});await waitRunning(page);check('live reduced-motion preference renders complete static composition');
  await life.ctx.close();

  for(const logos of ['slow','missing']){
    const ctx=await createContext(browser,{width:390,height:844,logos});await openHome(ctx.page);await ctx.page.mouse.move(0,0);
    const shape=await geometry(ctx.page);assert.equal(shape.overflow,false);assert.equal(await ctx.page.locator('[data-market-tile]').count(),7);
    if(logos==='missing')assert(await ctx.page.locator('[data-market-tile] img').evaluateAll(imgs=>imgs.every(i=>getComputedStyle(i).visibility==='hidden')),'failed local logos hide image glyph and retain symbol');
    const cls=await ctx.page.evaluate(()=>window.__heroQa.cls);assert(cls<.01,`${logos} logos reserve their layout`);
    await ctx.page.screenshot({path:path.join(out,`${logos}-logos-390.png`)});report.cases.push({name:`${logos}-logos`,cls,...shape});await ctx.ctx.close();
  }
  check('slow and absent local logos preserve geometry and symbol fallback');
  }
  const locales=await createContext(browser);await openHome(locales.page);
  for(const [label,code] of [['EN','en'],['ES','es'],['中文','zh'],['RU','ru']]){
    await locales.page.getByRole('button',{name:'Language / Язык / 语言',exact:true}).click();
    await locales.page.getByRole('button',{name:label,exact:true}).click();await locales.page.waitForTimeout(600);
    const shape=await geometry(locales.page);assert.equal(shape.overflow,false);assert(!shape.heading.includes('home.hero.'));report.cases.push({name:`language-switch-${code}`,...shape});
    await locales.page.screenshot({path:path.join(out,`locale-${code}.png`)});
  }
  await locales.ctx.close();check('actual language control switches new hero copy');
  const zoom=await createContext(browser,{width:1440,height:900,reduced:true});await openHome(zoom.page);
  await zoom.page.evaluate(()=>document.documentElement.style.zoom='2');await zoom.page.waitForTimeout(500);
  const zoomGeometry=await geometry(zoom.page);assert.equal(zoomGeometry.overflow,false,'200% CSS zoom layout');
  await zoom.page.screenshot({path:path.join(out,'zoom-200.png')});report.cases.push({name:'200%-css-zoom',...zoomGeometry});await zoom.ctx.close();
  // Browser-page zoom changes the layout viewport to half its CSS width.
  const reflow=await createContext(browser,{width:720,height:450,reduced:true});await openHome(reflow.page);assert.equal((await geometry(reflow.page)).overflow,false);await reflow.page.screenshot({path:path.join(out,'zoom-200-reflow.png')});await reflow.ctx.close();check('200% zoom and 720 CSS pixel reflow');

  const routes=await createContext(browser);await openHome(routes.page);
  await routes.page.locator('#home-global-hero .actions .primary').click();await routes.page.waitForURL(/\/login\?next=/);assert(decodeURIComponent(routes.page.url()).includes('/trade'));check('guest CTA keeps protected route and next target');
  await routes.page.evaluate(()=>localStorage.setItem('exchange_token','header.eyJzdWIiOiJxYS11c2VyIn0.fixture'));
  const routeRows=[];
  for(const target of ['/trade?pair=BTC%2FUSDT','/futures?pair=BTC%2FUSDT','/trade?market=cfd']){
    await spaRoute(routes.page,target);assert.equal(await routes.page.locator('[data-market-platform-hero]').count(),0);
    routeRows.push({target,url:routes.page.url(),heading:await routes.page.locator('body').innerText().then(t=>t.slice(0,160))});
  }
  await routes.page.evaluate(()=>localStorage.removeItem('exchange_token'));await spaRoute(routes.page,'/');await routes.page.locator(heroSelector).waitFor();await routes.page.mouse.move(0,0);await waitRunning(routes.page);
  const counts=[];
  for(let round=0;round<4;round++){
    await routes.page.locator('#home-global-hero .actions .primary').click();await routes.page.waitForURL(/\/login/);
    const unmounted=await routes.page.evaluate(()=>({sceneAnimations:document.getAnimations().filter(a=>a.effect?.target?.hasAttribute('data-market-tile')).length,intervals:window.__heroQa.activeIntervals.size,listeners:Object.fromEntries([...window.__heroQa.listeners].map(([k,v])=>[k,v.size]))}));assert.equal(unmounted.sceneAnimations,0);
    await spaRoute(routes.page,'/');await routes.page.locator(heroSelector).waitFor();await routes.page.mouse.move(0,0);await waitRunning(routes.page);
    counts.push(await routes.page.evaluate(()=>({round:window.__heroQa.remountRound=(window.__heroQa.remountRound||0)+1,intervals:window.__heroQa.activeIntervals.size,visibility:window.__heroQa.listeners.get('document:visibilitychange')?.size,animations:document.querySelector('[data-market-visual]').getAnimations({subtree:true}).length})));
  }
  assert(counts.every(c=>c.animations===7));assert.equal(counts.at(-1).visibility,counts[1].visibility,'visibility listener count stable after warm remount');assert.equal(counts.at(-1).intervals,counts[1].intervals,'interval count stable after warm remount');
  report.cases.push({name:'home-spot-futures-cfd-home',routes:routeRows,remounts:counts});await routes.ctx.close();check('protected route chain and four remounts keep exactly seven animations with stable global timers/listeners');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
