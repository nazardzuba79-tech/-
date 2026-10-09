#!/usr/bin/env node
/** Production-bundle, loopback-only QA for the homepage orbit. No backend, account or external network.
 * QA_HERO_MODE=baseline QA_DIST=.home-hero-baseline-dist node scripts/qa-home-market-platform.cjs   (metrics/screens only)
 * QA_HERO_MODE=after QA_DIST=frontend/dist node scripts/qa-home-market-platform.cjs
 * QA_HERO_WIDTHS=1440,390 limits the width matrix; QA_HERO_VIDEO=0 skips the real-time recordings.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { createFixture } = require('./qa-mobile-trade-fixture.cjs');
const root = path.resolve(__dirname, '..');
const mode = process.env.QA_HERO_MODE || 'after';
const dist = path.resolve(root, process.env.QA_DIST || 'frontend/dist');
const out = path.resolve(root, process.env.QA_OUT || `output/home-market-platform/${mode}`);
const baselineReportPath=path.resolve(root,process.env.QA_HERO_BASELINE_REPORT||'output/home-market-platform/baseline/report.json');
const port = Number(process.env.QA_PORT || 4198);
const origin = `http://127.0.0.1:${port}`;
let modernServer, modernOrigin;
const heroSelector = '#home-global-hero';
const widths = [[1920,1080],[1707,940],[1440,900],[1366,768],[430,932],[390,844],[360,800],[320,740]].filter(([width])=>!process.env.QA_HERO_WIDTHS||process.env.QA_HERO_WIDTHS.split(',').map(Number).includes(width));
fs.mkdirSync(out, { recursive: true });
assert(fs.existsSync(path.join(dist, 'index.html')), 'Build the requested production bundle first');
const report = { mode, fixtureOnly: true, productionAccess: false, profile: { chromium: 'headless', deviceScaleFactor: 1, cpuThrottle: 2, latencyMs: 40, downloadBytesPerSecond: 1250000, uploadBytesPerSecond: 625000 }, cases: [], checks: [], errors: [], consoleErrors: [], denied: [], writes: [], unknownApi: [], metrics: [], result: 'FAIL' };
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
async function createContext(browser, { width=1440, height=900, signed=false, lang='ru', reduced=false, logos='normal', video=false, quoteMode='fresh', snapshot=null }={}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block', ...(video ? { recordVideo: { dir: path.join(out,'video'), size: { width:1440, height:900 } } } : {}) });
  await ctx.addInitScript(instrument);
  await ctx.addInitScript(({ signed, lang, snapshot }) => { localStorage.setItem('exchange_lang', lang); if (signed) localStorage.setItem('exchange_token','header.eyJzdWIiOiJxYS11c2VyIiwic2lkIjoicWEtc2Vzc2lvbiJ9.fixture'); if(snapshot)localStorage.setItem('voltex.home.market.v1',snapshot); }, { signed,lang,snapshot });
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
      if(reply.ok&&url.pathname==='/api/v1/market/external/tickers'&&quoteMode!=='fresh'){
        const body=JSON.parse(responseBody),invalid={'BTC/USDT':'0','ETH/USDT':'NaN','SOL/USDT':'','XRP/USDT':'Infinity','ADA/USDT':'-1'};
        if(quoteMode==='stale')body.tickers=[];
        if(quoteMode==='missing')body.tickers=body.tickers.map(row=>row.pair in invalid?{...row,lastPrice:invalid[row.pair]}:row);
        responseBody=JSON.stringify(body);
      }
      if(reply.ok&&/^\/api\/v1\/cfd\/(?:display\/)?tickers$/.test(url.pathname)&&quoteMode!=='fresh'){
        const body=JSON.parse(responseBody);body.tickers=body.tickers.map(row=>({...row,...(quoteMode==='missing'?{price:null,status:'unavailable'}:{status:quoteMode==='sampled'?'sampled':'stale',stale:quoteMode==='stale'})}));responseBody=JSON.stringify(body);
      }
      return route.fulfill({ status:reply.status,contentType:'application/json',body:responseBody });
    }
    if (url.origin !== origin) {
      if (request.resourceType()==='image') return route.fulfill({ status:200,contentType:'image/svg+xml',body:syntheticLogo });
      report.denied.push({url:request.url(),type:request.resourceType()}); return route.abort('blockedbyclient');
    }
    if (logos!=='normal' && url.pathname.startsWith('/hero/medallions/')) {
      if (logos==='missing') return route.fulfill({status:200,contentType:'image/webp',body:'not an image'});
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
async function metrics(page,cdp,requests,label,duration=4000) {
  const first=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const frames=await page.evaluate(duration=>new Promise(resolve=>{const result=[];let previous=performance.now(),start=previous;const step=now=>{result.push(now-previous);previous=now;if(now-start<duration)requestAnimationFrame(step);else resolve(result);};requestAnimationFrame(step);}),duration);
  const last=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const data=await page.evaluate(()=>{const s=window.__heroQa;return {cls:s.cls,lcpMs:s.lcp,longTasks:s.longTasks,intervals:s.activeIntervals.size,timeouts:s.activeTimeouts.size,listeners:Object.fromEntries([...s.listeners].map(([k,v])=>[k,v.size])),resources:performance.getEntriesByType('resource').map(r=>({name:r.name,bytes:r.transferSize,encodedBytes:r.encodedBodySize,duration:r.duration,initiator:r.initiatorType})),heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null};});
  const sorted=frames.slice(1).sort((a,b)=>a-b), span=last.Timestamp-first.Timestamp;
  const result={label,...data,requestCount:requests.length,requests:[...requests],frameCount:frames.length,frameP50Ms:sorted[Math.floor(sorted.length*.5)],frameP95Ms:sorted[Math.floor(sorted.length*.95)],framesOver50Ms:frames.filter(n=>n>50).length,mainThreadMs:(last.TaskDuration-first.TaskDuration)*1000,scriptMs:(last.ScriptDuration-first.ScriptDuration)*1000,layoutMs:(last.LayoutDuration-first.LayoutDuration)*1000,windowMs:span*1000,jsHeapBytes:last.JSHeapUsedSize,domNodes:last.Nodes,listenersCdp:last.JSEventListeners};
  result.motionProfile=await page.evaluate(()=>({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,state:document.querySelector('[data-market-visual]')?.dataset.motionState||null}));
  result.marketRequestPaths=requests.filter(request=>/\/api\/v1\/(?:market\/external\/|market\/global|cfd\/(?:display\/)?tickers|futures\/config)/.test(request.url)).map(request=>new URL(request.url).pathname).sort();
  const baselinePath=baselineReportPath;
  if(mode==='after'&&fs.existsSync(baselinePath)){const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8')).metrics.find(metric=>metric.label===label);if(baseline){const before=baseline.requests.filter(request=>/\/api\/v1\/(?:market\/external\/|market\/global|cfd\/(?:display\/)?tickers|futures\/config)/.test(request.url)).map(request=>new URL(request.url).pathname).sort();assert.deepEqual(result.marketRequestPaths,before,`${label} keeps original market request budget`);result.marketRequestBudgetUnchanged=true;}}
  report.metrics.push(result); return result;
}

const check = name => {report.checks.push(name);console.log('PASS',name);};
const heroAnimations = page => page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.dataset?.marketTile).map(a=>({state:a.playState,time:Math.round(Number(a.currentTime)),symbol:a.effect.target.dataset.marketTile})));
async function setPhase(page, offset) {
  await page.evaluate(offset=>{const tiles=[...document.querySelectorAll('[data-market-tile]')];
    document.getAnimations().filter(a=>a.effect?.target?.dataset?.marketTile).forEach(a=>{const i=tiles.indexOf(a.effect.target);a.pause();a.currentTime=((tiles.length-i)%tiles.length)*2500+offset;});},offset);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
// Everything the orbit may not touch: copy text, links, buttons, the projected
// laptop screen and, below it, the laptop deck. Measured on the live frame.
async function orbitClearance(page) {
  return page.evaluate(()=>{
    const R=b=>({x:b.left,y:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height});
    const copy=document.querySelector('#home-global-hero .copy');const text=[];
    const walker=document.createTreeWalker(copy,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.width&&r.height)text.push(R(r));}
    for(const a of copy.querySelectorAll('a,button'))text.push(R(a.getBoundingClientRect()));
    const screen=document.querySelector('#home-global-hero .terminal-screen'),m=new DOMMatrix(getComputedStyle(screen).transform),base=screen.offsetParent.getBoundingClientRect();
    const pt=(x,y)=>{const p=m.transformPoint(new DOMPoint(x,y));return[base.left+screen.offsetLeft+p.x/p.w,base.top+screen.offsetTop+p.y/p.w];};
    const TL=pt(0,0),BL=pt(0,600),edgeAt=y=>TL[0]+(BL[0]-TL[0])*(y-TL[1])/(BL[1]-TL[1]);
    const art=document.querySelector('#home-global-hero .art').getBoundingClientRect(),mobile=innerWidth<=900,sc=Math.max(art.width/1672,art.height/941);
    const deck=[art.left+(art.width-1672*sc)*(mobile?1:.5)+581*sc,art.top+(art.height-941*sc)/2+766*sc];
    const deckYAt=x=>deck[1]+(BL[1]-deck[1])*(x-deck[0])/(BL[0]-deck[0]);
    // Each medallion is a pre-rendered image with a 1.32x margin for bevel and shadow; the coin itself is the inner circle.
    const coinRect=t=>{const b=t.querySelector('.vm-coin').getBoundingClientRect();const d=b.width/1.32,cx=b.left+b.width/2,cy=b.top+b.height/2;return{x:cx-d/2,y:cy-d/2,right:cx+d/2,bottom:cy+d/2,width:d,height:d};};
    const parts=[...document.querySelectorAll('[data-market-tile]')].filter(t=>Number(getComputedStyle(t).opacity)>.05).flatMap(t=>[coinRect(t),...[...t.querySelectorAll('.vm-asset-badge')].map(f=>R(f.getBoundingClientRect()))]).filter(b=>b.width>1&&b.height>1);
    // Solid tiers of the platform render; its glow and floor reflection are soft and may touch the floor under the laptop.
    const pb=document.querySelector('.vm-orbit-platform').getBoundingClientRect();
    const slice=(y0,y1,hw)=>({x:pb.left+pb.width*(.5-hw),y:pb.top+pb.height*y0,right:pb.left+pb.width*(.5+hw),bottom:pb.top+pb.height*y1,width:pb.width*2*hw,height:pb.height*(y1-y0)});
    const pedestalParts=[slice(.17,.45,.27),slice(.30,.62,.335),slice(.50,.70,.415),slice(.70,.80,.30)];
    const pedestal={x:pedestalParts[2].x,y:pedestalParts[0].y,right:pedestalParts[2].right,bottom:pedestalParts[3].bottom,width:pedestalParts[2].width,height:pedestalParts[3].bottom-pedestalParts[0].y};
    const toggle=R(document.querySelector('[data-motion-toggle]').getBoundingClientRect());
    const all=[...parts,...pedestalParts,toggle];
    const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y));
    let textOverlap=0,minTextGap=1e9;for(const p of all)for(const t of text){textOverlap+=overlap(p,t);if(Math.max(0,Math.min(p.bottom,t.bottom)-Math.max(p.y,t.y))>0)minTextGap=Math.min(minTextGap,p.x-t.right);}
    // Only the vertical span shared with the screen matters; above its top edge is open sky.
    let minScreenGap=1e9;for(const p of all){const y0=Math.max(p.y,TL[1]),y1=Math.min(p.bottom,BL[1]);if(y0<=y1)for(const y of [y0,y1])minScreenGap=Math.min(minScreenGap,edgeAt(y)-p.right);}
    // The deck's top-left edge runs from its front corner up to the screen's lower-left corner;
    // below the corner the laptop's front edge runs right almost flat, so the floor there is open.
    const rightLimit=y=>y<=BL[1]?edgeAt(y):y<=deck[1]?BL[0]+(deck[0]-BL[0])*(y-BL[1])/(deck[1]-BL[1]):1e9;
    // Phones stack the laptop artwork under the scene: the platform may sit on the globe but must stay above the laptop's screen.
    const screenTop=Math.min(TL[1],pt(1000,0)[1]);
    let deckGap=1e9;for(const p of pedestalParts){if(mobile)deckGap=Math.min(deckGap,screenTop-p.bottom);else for(const y of [p.y,p.bottom])deckGap=Math.min(deckGap,rightLimit(y)-p.right);}
    const centre=[...document.querySelectorAll('[data-market-tile]')].map(coinRect).sort((a,b)=>b.width-a.width)[0];
    return{textOverlap,minTextGap:Math.round(minTextGap),minScreenGap:Math.round(minScreenGap),deckGap:Math.round(deckGap),pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,visibleParts:parts.length,centre:R(centre),pedestal,heroBottom:document.querySelector('#home-global-hero .hero').getBoundingClientRect().bottom};
  });
}
async function orbitContent(page) {
  return page.evaluate(()=>{const coins=[...document.querySelectorAll('[data-market-tile]')];
    return{count:coins.length,round:coins.every(c=>{const img=c.querySelector('img.vm-coin');return !!img&&img.naturalWidth===img.naturalHeight&&img.naturalWidth>=640&&img.complete;}),
      textOnly:coins.every(c=>/^(?:CFD|STOCKS SOON)?$/.test(c.textContent)),quotes:document.querySelectorAll('.vm-card-price,.vm-card-note,.vm-card-change,.vm-card-symbol').length,
      badges:Object.fromEntries(coins.map(c=>[c.dataset.marketTile,c.querySelector('.vm-asset-badge')?.textContent||null])),
      logos:[...new Set(coins.map(c=>c.querySelector('img')?.getAttribute('src')).filter(Boolean))].sort(),platform:document.querySelector('img.vm-orbit-platform')?.getAttribute('src')||null,front:coins.map(c=>({s:c.dataset.marketTile,w:c.querySelector('.vm-coin').getBoundingClientRect().width})).sort((a,b)=>b.w-a.w)[0].s,
      originalArt:document.querySelector('#home-global-hero .art')?.getAttribute('src'),heading:document.querySelector('#hs-title')?.textContent,terminals:document.querySelectorAll('#home-live-terminal').length};});
}
const motionState=page=>page.evaluate(()=>{const s=document.querySelector('[data-market-visual]');return{state:s.dataset.motionState,reason:s.dataset.motionReason};});
async function waitState(page,state){await page.waitForFunction(state=>document.querySelector('[data-market-visual]')?.dataset.motionState===state,state,{timeout:5000});}
async function frozen(page,reason){
  await waitState(page,'paused');const a=await heroAnimations(page);await page.waitForTimeout(700);const b=await heroAnimations(page);
  assert.deepEqual(b.map(x=>x.time),a.map(x=>x.time),`orbit frozen while ${reason}`);assert(b.every(x=>x.state==='paused'),`all orbit clocks paused while ${reason}`);
  assert((await motionState(page)).reason.includes(reason),`pause reason ${reason}`);
}
async function spaRoute(page,route){await page.evaluate(route=>{history.pushState({},'',route);window.dispatchEvent(new PopStateEvent('popstate'));},route);await page.waitForTimeout(1600);}

async function main() {
  await waitServer();
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM?{executablePath:process.env.QA_CHROMIUM}:{})});
    for(const [width,height] of widths){
      // Resting composition (reduced motion) for review screenshots; the
      // phase sweep then checks clearance through a whole turn.
      const {ctx,page}=await createContext(browser,{width,height,reduced:true});
      await openHome(page);
      await page.screenshot({path:path.join(out,`home-${width}.png`)});
      const pageWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
      assert(pageWidth<=width+1,`horizontal overflow ${width}`);
      if(mode==='after'){
        const content=await orbitContent(page);
        assert.equal(content.count,8,'eight markets on one ring');assert(content.round,'every medallion is a loaded square pre-render');assert.equal(content.platform,'/hero/medallions/platform.webp','platform pre-render');
        assert.deepEqual(content.badges,{BTC:null,AAPL:'STOCKS SOON',OIL:'CFD',GOLD:'CFD',ETH:null,NVDA:'STOCKS SOON',EURUSD:'CFD',SOL:null},'category badges');
        assert(content.textOnly,'medallions carry mark, ticker and badge only');assert.equal(content.quotes,0,'no quote, change or unavailable labels');
        assert.equal(content.front,'BTC','resting composition leads with BTC');assert.equal(content.originalArt,'/hero/sapphire-refined.png');assert.equal(content.heading,'OWN YOUR FUTURE.');assert.equal(content.terminals,1);
        const sweep=[];
        for(let offset=0;offset<20000;offset+=250){await setPhase(page,offset);const c=await orbitClearance(page);sweep.push({offset,...c});}
        const worst={textOverlap:Math.max(...sweep.map(s=>s.textOverlap)),minTextGap:Math.min(...sweep.map(s=>s.minTextGap)),minScreenGap:Math.min(...sweep.map(s=>s.minScreenGap)),deckGap:Math.min(...sweep.map(s=>s.deckGap)),pageWidth:Math.max(...sweep.map(s=>s.pageWidth))};
        const rest=sweep[0];
        report.cases.push({name:`orbit-${width}`,width,height,content,rest:{centre:rest.centre,pedestal:rest.pedestal,heroBottom:rest.heroBottom,visibleParts:rest.visibleParts},phases:sweep.length,worst});
        assert.equal(worst.textOverlap,0,`orbit never covers copy or CTA at ${width}`);assert(worst.minTextGap>=10,`orbit keeps ${worst.minTextGap}px from copy at ${width}`);
        assert(worst.minScreenGap>=6,`orbit keeps ${worst.minScreenGap}px from the laptop screen at ${width}`);assert(worst.deckGap>=4,`platform stays above the laptop deck at ${width} (${worst.deckGap}px)`);
        assert(worst.pageWidth<=width+1,`no overflow during motion at ${width}`);
      }
      await ctx.close();
    }
    check(`${widths.length} widths: resting screenshots, no overflow${mode==='after'?', no copy/laptop intersection across 90 phases of the cycle':''}`);

    // Live motion and every pause path in a real browser.
    const life=await createContext(browser,{width:1440,height:900});const page=life.page;
    await openHome(page);
    if(mode==='after'){
      await waitState(page,'running');let anims=await heroAnimations(page);assert.equal(anims.length,8,'one compositor animation per medallion');
      const t1=anims.map(a=>a.time);await page.waitForTimeout(1200);const t2=(await heroAnimations(page)).map(a=>a.time);assert(t2.every((t,i)=>t>t1[i]),'orbit runs while visible');
      {const b=await page.locator('.vm-orbit-scene').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height*.42);}await frozen(page,'hover');await page.mouse.move(5,890);await waitState(page,'running');check('pointer hover pauses and resumes');
      await page.focus('[data-motion-toggle]');await frozen(page,'focus');await page.evaluate(()=>document.activeElement.blur());await waitState(page,'running');check('keyboard focus on the control pauses and resumes');
      await page.click('[data-motion-toggle]');await page.mouse.move(5,890);await page.evaluate(()=>document.activeElement.blur());await frozen(page,'manual');
      assert.equal(await page.getAttribute('[data-motion-toggle]','aria-pressed'),'true');await page.click('[data-motion-toggle]');await page.mouse.move(5,890);await page.evaluate(()=>document.activeElement.blur());await waitState(page,'running');check('manual pause holds until resumed');
      const before=life.requests.length;
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
      await frozen(page,'hidden');await page.waitForTimeout(1500);
      await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});await waitState(page,'running');
      report.cases.push({name:'hidden-tab-fixture',requestsWhileHidden:life.requests.length-before});check('hidden tab (visibility event) freezes the orbit and resumes');
      await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await frozen(page,'offscreen');await page.evaluate(()=>window.scrollTo(0,0));await waitState(page,'running');check('offscreen pauses and resumes');
      // Leave for Spot and Futures and come back: no leaked clocks or listeners.
      const listeners=()=>page.evaluate(()=>({vis:window.__heroQa.listeners.get('document:visibilitychange')?.size||0,intervals:window.__heroQa.activeIntervals.size}));
      const l0=await listeners();
      for(const route of ['/trade?pair=BTC%2FUSDT','/futures?pair=BTC%2FUSDT']){
        await spaRoute(page,route);assert.equal((await heroAnimations(page)).length,0,`orbit animations released on ${route}`);
        await spaRoute(page,'/');await page.locator('[data-market-visual]').waitFor();await waitState(page,'running');assert.equal((await heroAnimations(page)).length,8,'exactly eight clocks after return');
      }
      const l1=await listeners();assert.equal(l1.vis,l0.vis,'visibility listeners stable after Spot/Futures round trips');
      report.cases.push({name:'route-round-trips',listenersBefore:l0,listenersAfter:l1});check('Spot and Futures round trips release and restore the orbit');
    }
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(600);
    await metrics(page,life.cdp,life.requests,'running-1440',8000);
    if(mode==='after'){await page.click('[data-motion-toggle]');await page.mouse.move(5,890);await page.evaluate(()=>document.activeElement.blur());await waitState(page,'paused');await metrics(page,life.cdp,life.requests,'paused-1440',8000);}
    await life.ctx.close();
    if(mode==='after'){
      const reduced=await createContext(browser,{width:390,height:844,reduced:true});await openHome(reduced.page);await reduced.page.evaluate(()=>document.querySelector('[data-market-visual]').scrollIntoView({block:'center'}));
      await frozen(reduced.page,'reduced-motion');const times=(await heroAnimations(reduced.page)).map(a=>a.time);assert.deepEqual(times,times.map((_,i)=>((8-i)%8)*2500),'reduced motion rests at the full composition');
      await reduced.ctx.close();check('reduced motion shows the complete resting composition');
      // Cold visit, then a warm repeat visit in the same profile.
      const visits=await createContext(browser,{width:1440,height:900});const t0=Date.now();await visits.page.goto(origin+'/',{waitUntil:'domcontentloaded'});await visits.page.locator('[data-market-visual]').waitFor();
      const cold={readyMs:Date.now()-t0,heroAssetRequests:visits.requests.filter(r=>/\/hero\/medallions\//.test(r.url)).length};await visits.page.waitForTimeout(2500);
      const mark=visits.requests.length;const t1=Date.now();await visits.page.reload({waitUntil:'domcontentloaded'});await visits.page.locator('[data-market-visual]').waitFor();
      const warmEntries=await visits.page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>/\/hero\/medallions\//.test(r.name)).map(r=>({name:r.name.split('/').pop(),transfer:r.transferSize})));
      report.cases.push({name:'cold-and-warm-visit',cold,warm:{readyMs:Date.now()-t1,requests:visits.requests.length-mark,heroAssets:warmEntries}});await visits.ctx.close();check('cold and warm visits measured');
    }
    if(mode==='after'&&process.env.QA_HERO_VIDEO!=='0'){
      for(const [w,h] of [[1440,900],[390,844]]){
        const rec=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:1,colorScheme:'dark',reducedMotion:'no-preference',recordVideo:{dir:path.join(out,'video'),size:{width:w,height:h}}});
        await rec.route(/^(?!http:\/\/127\.0\.0\.1)/,r=>r.abort());const p=await rec.newPage();await p.goto(origin+'/',{waitUntil:'domcontentloaded'});await p.locator('[data-market-visual]').waitFor();
        if(w<=900)await p.evaluate(()=>window.scrollTo(0,document.querySelector('.vm-orbit-platform').getBoundingClientRect().bottom+scrollY-innerHeight+40));
        await p.mouse.move(2,h-2);await p.waitForTimeout(1500+20000+1200);const v=p.video();await rec.close();fs.copyFileSync(await v.path(),path.join(out,`orbit-cycle-${w}.webm`));
      }
      check('real-time recordings of one full cycle at 1440 and 390');
    }
    report.result=report.errors.length||report.consoleErrors.length||report.unknownApi.length||report.writes.length?'FAIL':'PASS';
  } finally {
    await browser?.close();fixture.kill();modernServer?.close();
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    console.log('HOME_ORBIT_QA',JSON.stringify({result:report.result,checks:report.checks.length,errors:report.errors.length,consoleErrors:report.consoleErrors.length,unknownApi:report.unknownApi,writes:report.writes.length,denied:report.denied.length}));
    if(report.result!=='PASS')process.exitCode=1;
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
