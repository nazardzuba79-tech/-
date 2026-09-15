/** Actual Futures route and NativeDemoService, disposable market/account fixtures only. */
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),front=path.join(root,'frontend'),out=path.join(root,'docs/qa/native-demo');fs.mkdirSync(out,{recursive:true});
const report={fixtureOnly:true,productionVerified:false,checks:[],errors:[]};
let browser,server,activePage;
async function main(){
 const chartModule=path.join(front,'node_modules/lightweight-charts/dist/lightweight-charts.production.mjs');
 const shim=path.join(os.tmpdir(),'native-demo-chart-observer.mjs');
 fs.writeFileSync(shim,`export * from ${JSON.stringify(chartModule)};import{createChart as original,CandlestickSeries}from ${JSON.stringify(chartModule)};export function createChart(...a){const c=original(...a);window.__nativeQaChart=c;const add=c.addSeries.bind(c);c.addSeries=(type,...rest)=>{const s=add(type,...rest);if(type===CandlestickSeries)window.__nativeQaSeries=s;return s;};return c;}`);
 const {build}=await import(path.join(front,'node_modules/vite/dist/node/index.js'));
 await build({root:front,resolve:{alias:{'lightweight-charts':shim}},define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api/v1')}});
 server=spawn(process.execPath,['scripts/serve-native-demo-review.cjs'],{cwd:root,env:{...process.env,PORT:'4178',NATIVE_PREVIEW_FIXTURE:'1'},stdio:['ignore','pipe','pipe']});
 const log=fs.createWriteStream(path.join(out,'server.log'));server.stdout.pipe(log);server.stderr.pipe(log);
 const origin='http://127.0.0.1:4178';for(let i=0;i<60;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
 const {chromium}=require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT||'playwright');browser=await chromium.launch({headless:true});
 async function newPage(width){const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true,locale:'ru-RU',timezoneId:'UTC'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.routeWebSocket('**/*',ws=>ws.close());const page=await context.newPage();activePage=page;page.setDefaultTimeout(25000);page.on('pageerror',e=>report.errors.push(e.message));await page.goto(origin+'/futures');await page.locator('.native-demo-controls').getByRole('button',{name:'Начать торговлю',exact:true}).click();await page.locator('.native-demo-controls form').waitFor();await page.waitForFunction(()=>window.__nativeQaSeries?.data().length>10);return{page,context};}
 async function state(page){return page.evaluate(async()=>{const r=await fetch('/api/v1/private-trading/native/state',{headers:{Authorization:'Bearer '+localStorage.getItem('exchange_token')}});if(!r.ok)throw Error('state '+r.status);return r.json();});}
 async function command(page,click){const pending=page.waitForResponse(r=>r.url().endsWith('/native/commands')&&r.request().method()==='POST');await click();const r=await pending;const body=await r.json();assert(r.ok(),JSON.stringify(body));await page.waitForFunction(()=>!document.querySelector('.native-demo-controls button[type=submit]')?.disabled);return body;}
 async function chooseCandle(page,after){
  await page.locator('.chart-area').scrollIntoViewIfNeeded();
  const points=await page.evaluate(after=>{const c=window.__nativeQaChart,s=window.__nativeQaSeries,r=c.chartElement().getBoundingClientRect();
   const rows=s.data().slice(0,-3).filter(x=>typeof x.time==='number'&&x.open!==undefined&&(!after||x.time*1000>after+3600000));
   const visible=rows.map(x=>({...x,x:c.timeScale().timeToCoordinate(x.time)})).filter(x=>x.x>35&&x.x<r.width-90);
   return [.35,.55,.75].flatMap(f=>{const x=visible[Math.floor(visible.length*f)];return x?[.85,.15,.5].map(h=>({time:x.time,x:r.left+x.x,y:r.top+s.priceToCoordinate(x.low+(x.high-x.low)*h)})):[];});},after??null);
  assert(points.length,'No visible closed candle');
  for(const p of points){await page.mouse.click(p.x,p.y);try{await page.locator('.native-candle').waitFor({timeout:700});return p;}catch{}}
  throw Error('Native chart candle selection did not accept a visible wick/body click');
 }
 for(const width of [1440,390]){
  const{page,context}=await newPage(width),ticket=page.locator('.native-demo-controls');
  // Direction IS the submit button: the ticket carries Long and Short, no side selector.
  let s=await command(page,()=>ticket.getByRole('button',{name:'Long',exact:true}).click());assert.equal(s.positions.length,1);assert.equal(s.positions[0].side,'LONG');assert(s.events.some(e=>e.kind==='OPEN'));const longId=s.positions[0].id;
  s=await command(page,()=>ticket.getByRole('button',{name:'Short',exact:true}).click());assert.equal(s.positions.length,2);assert.equal(s.positions[1].side,'SHORT');
  await ticket.getByRole('tab',{name:'Лимитный',exact:true}).click();await ticket.getByLabel('Лимитная цена',{exact:true}).fill('100000');s=await command(page,()=>ticket.getByRole('button',{name:'Short',exact:true}).click());assert(s.orders.some(o=>o.status==='OPEN'));
  await page.getByRole('tab',{name:/^Открытые ордера/}).click();s=await command(page,()=>page.getByRole('button',{name:'Отменить',exact:true}).click());assert(!s.orders.some(o=>o.status==='OPEN'));
  await page.getByRole('tab',{name:/^Позиции/}).click();const row=page.locator('.native-demo-panel tbody tr').filter({hasText:'LONG'});await row.getByRole('button',{name:'TP/SL',exact:true}).click();await page.getByLabel('Цена TP',{exact:true}).fill('100000');s=await command(page,()=>page.locator('.native-action-dialog').getByRole('button',{name:'Подтвердить',exact:true}).click());assert.equal(s.positions.find(p=>p.id===longId).protection.takeProfit,'100000');
  await row.getByRole('button',{name:'Рыночный',exact:true}).click();await page.getByLabel('Количество закрытия',{exact:true}).fill('0.1');s=await command(page,()=>page.locator('.native-action-dialog').getByRole('button',{name:'Подтвердить',exact:true}).click());assert(s.events.some(e=>e.kind==='CLOSE'&&e.quantity==='0.1'));
  await row.getByRole('button',{name:'P&L Card · BTCUSDT',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Сохранить PNG',exact:true}).click();await(await download).saveAs(path.join(out,`card-${width}.png`));await page.locator('.private-card-dialog').getByRole('button',{name:'Закрыть',exact:true}).click();
  const before=(await state(page)).revision;await page.reload();await page.locator('.native-demo-controls form').waitFor();assert((await state(page)).revision>=before);assert.equal((await state(page)).positions.length,2);
  // No mode switch anywhere and no demo/test wording: this account has one
  // trading backend and the UI never says so. Header links must not collide
  // with header actions, and nothing may overflow the viewport.
  const layout=await page.evaluate(()=>{
   const box=e=>{const r=e.getBoundingClientRect();return{l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height};};
   const actions=document.querySelector('.global-header .header-actions'),a=actions&&box(actions);
   const visible=[...document.querySelectorAll('.global-header .main-nav .nav-item')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(box).filter(b=>b.w>0&&b.h>0);
   const overlaps=a?visible.filter(b=>b.r>a.l+1&&b.l<a.r-1&&b.b>a.t&&b.t<a.b).length:0;
   const banned=['Demo · Cross','Тестовый баланс','Условия Demo','Сервер рассчитывает','Historical Test','PREVIEW_FIXTURE','isolatedPreview','productionVerified','Ревизия'];
   const text=['.order-form-area','.bottom-panel','.chart-area'].map(q=>document.querySelector(q)?.innerText??'').join('\n');
   return{overlaps,switches:document.querySelectorAll('.native-mode-switch').length,leaks:banned.filter(w=>text.includes(w)),
     modeChip:document.querySelector('.native-mode-row .native-mode-chip')?.textContent??null,
     cardButtons:document.querySelectorAll('.native-card-btn').length,
     tabs:[...document.querySelectorAll('.bottom-tabs [role=tab]')].map(t=>t.textContent),
     scrollWidth:document.documentElement.scrollWidth,width:innerWidth,
     liquidationHeader:[...document.querySelectorAll('.native-demo-panel th')].some(th=>th.textContent==='Цена ликв.')};
  });
  report.checks.push({name:`layout-${width}`,passed:true,layout});
  assert.equal(layout.overlaps,0,'header navigation overlaps header actions');
  assert.equal(layout.switches,0,'a Real/Demo switch is still rendered');
  assert.deepEqual(layout.leaks,[],'demo/test wording is still rendered');
  assert.equal(layout.modeChip,'Cross');assert(layout.cardButtons>0,'no P&L card button');
  assert.deepEqual(layout.tabs.map(t=>t.replace(/ \(\d+\)$/,'')),['Открытые ордера','Позиции','История ордеров','История торговли','Активы','P&L']);
  assert(!(await page.url()).includes('demo=1'),'the terminal still depends on ?demo=1');
  assert(layout.scrollWidth<=layout.width+1,'page scrolls horizontally');assert(layout.liquidationHeader);
  // 10M shared collateral: a net-short BTC book liquidates only at an absurd price, a net long never.
  const liqCells=await page.locator('.native-demo-panel tbody tr').evaluateAll(rows=>rows.map(r=>r.children[4]?.textContent));
  const liq=(await state(page)).positions.map(p=>p.liquidationPrice);
  assert(liqCells.length===liq.length&&liq.every(v=>v===null||Number(v)>500000),'10M collateral liquidation estimate: '+liqCells.join());
  report.checks.push({name:`cross-liquidation-far-${width}`,passed:true,liquidation:liq});
  await page.screenshot({path:path.join(out,`terminal-${width}.png`),fullPage:true});report.checks.push({name:`long-short-limit-cancel-tpsl-partial-close-png-reload-${width}`,passed:true});await context.close();
  const h=await newPage(width),p=h.page,t=p.locator('.native-demo-controls');await t.getByRole('button',{name:'Выбрать вход на графике',exact:true}).click();const picked=await chooseCandle(p);let hs=await command(p,()=>t.getByRole('button',{name:'Long',exact:true}).click());assert.equal(hs.positions.length,1);assert(hs.positions[0].historical);assert(hs.positions[0].unrealizedPnl!==null);assert(hs.events.some(e=>e.pricing==='SELECTED_POINT'));await p.locator('[data-position-line]').waitFor();
  await p.locator('.native-demo-panel').getByRole('button',{name:'На графике',exact:true}).click();await chooseCandle(p,picked.time*1000);hs=await command(p,()=>t.getByRole('button',{name:'Закрыть на выбранной свече',exact:true}).click());assert.equal(hs.history.length,1);assert.equal(hs.positions.length,0);assert(hs.history[0].netPnl!==null);
  await t.getByRole('tab',{name:'Лимитный',exact:true}).click();await t.getByRole('button',{name:'Выбрать вход на графике',exact:true}).click();
  await chooseCandle(p);
  // Use the candle the terminal actually selected (narrow mobile bars can resolve to a neighbour).
  const selectedTime=Number(await p.locator('.native-candle').getAttribute('data-open-time'))/1000;
  const bar=await p.evaluate(time=>window.__nativeQaSeries.data().find(x=>x.time===time),selectedTime);
  const limit=(Math.ceil(((bar.low+bar.open)/2)*10)/10).toFixed(1);
  assert(await t.getByText('Buy исполняется, если Low ≤ цены').isVisible());
  await t.getByLabel('Лимитная цена',{exact:true}).fill(limit);
  hs=await command(p,()=>t.getByRole('button',{name:'Long',exact:true}).click());
  const limitPosition=hs.positions.find(x=>x.historical);assert(limitPosition,'historical wick limit did not fill');
  assert(Number(limitPosition.entryPrice)<=Number(limit));assert.equal(hs.entries.find(e=>e.positionId===limitPosition.id).candle.pricePoint,'OPEN');
  report.checks.push({name:`native-historical-limit-wick-${width}`,passed:true,limit,low:bar.low,entry:limitPosition.entryPrice});
  await p.getByRole('tab',{name:'P&L',exact:true}).click();await p.screenshot({path:path.join(out,`history-${width}.png`),fullPage:true});report.checks.push({name:`native-chart-click-history-entry-pnl-exit-${width}`,passed:true});await h.context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}
main().catch(async e=>{report.passed=false;report.failure=String(e.stack||e);if(activePage&&!activePage.isClosed())await activePage.screenshot({path:path.join(out,'failed.png'),fullPage:true}).catch(()=>{});console.error(e);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();server?.kill('SIGTERM');});
