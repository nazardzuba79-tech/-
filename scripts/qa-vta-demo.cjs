'use strict';
// Production frontend + actual VTA/native services on disposable PostgreSQL.
// Only public market data is synthetic. Never accepts a remote database.
const express = require('express');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "frontend/dist");
const fs = require('node:fs');
const OUT = path.resolve(process.env.QA_OUT || path.join(root, "output/vta-demo"));
fs.mkdirSync(OUT, { recursive: true });
const PAIRS = ['BTC/USDT','ETH/USDT','SOL/USDT'];
const CANDLES=Array.from({length:120},(_,i)=>({time:Math.floor(Date.now()/1000)-(120-i)*60,open:84800,high:84950,low:84700,close:84890,volume:12}));
const app = express();
app.use(express.json());
const financialAttempts=[];
app.use((q,_r,next)=>{if(q.method==='POST' && /orders|vta\/sell/.test(q.path))financialAttempts.push(q.path);next();});
const {VOLTORA}=require(path.join(root, "dist/services/testMarkets/testAssetConfig.js"));
const {publicTestAsset}=require(path.join(root, "dist/services/testMarkets/testMarketService.js"));
const {PrismaClient}=require('@prisma/client');
const {randomUUID}=require('node:crypto');
const {VtaDemoSales}=require(path.join(root,'dist/services/testMarkets/VtaDemoSales.js'));
const {NativeDemoService}=require(path.join(root,'dist/private-trading/native/service.js'));
const {PrismaNativeRepository}=require(path.join(root,'dist/private-trading/native/store.js'));
const {FakeMarket}=require(path.join(root,'dist/private-trading/native/testing/liveFixture.js'));
const url=process.env.VOLTEX_PG_TEST_URL;
if(!url || new URL(url).hostname!=='127.0.0.1')throw Error('Disposable localhost PostgreSQL required');
const db=new PrismaClient({datasources:{db:{url}}});
let simNow=VOLTORA.listingAt-1000,available='4545454.54545454',usdt='0';
let saleRequests=0,loseResponse=false,isAdmin=true,privateReads=0,lookupRequests=0,nativeReads=0;
let postFailure=null,lookupFailure=null,releaseHeld=null,heldResponse=null,heldStatus=200;
const keys=new Map(), requested=[];
const owner={userId:randomUUID(),sessionId:randomUUID(),expiresAt:Number.MAX_SAFE_INTEGER};
const other={userId:randomUUID(),sessionId:randomUUID(),expiresAt:Number.MAX_SAFE_INTEGER};
const actor=q=>q.headers.authorization==='Bearer other'?other:owner;
const vta=new VtaDemoSales(db,()=>simNow);
const market=new FakeMarket({now:()=>simNow});
const originalMarks=market.marks.bind(market);
market.marks=async symbols=>{requested.push(...symbols);if(symbols.includes('VTAUSDT'))throw Error('External VTA price requested');return originalMarks(symbols);};
const native=new NativeDemoService(new PrismaNativeRepository(db,()=>({enabled:true,ownerId:owner.userId})),market,()=>simNow);
async function setupDatabase(){
 for(const a of [owner,other]){
  await db.user.create({data:{id:a.userId,email:a.userId+'@vta-browser.invalid',referralCode:a.userId,role:'ADMIN',passwordHash:'TEST_ONLY'}});
  await db.session.create({data:{id:a.sessionId,userId:a.userId}});
  await db.demoBalance.create({data:{userId:a.userId,asset:'USDT',available:'100000'}});
 }
 await native.initialize(owner,randomUUID());
 await db.demoBalance.create({data:{userId:owner.userId,asset:'VTA',available}});
 await db.balance.create({data:{userId:owner.userId,asset:'USDT',available:'50000'}});
}
const asyncRoute=fn=>(q,r,next)=>Promise.resolve(fn(q,r)).catch(error=>error.status?r.status(error.status).json({error:error.message,...(error.status===400?{vtaOutcome:'REJECTED'}:{})}):next(error));
const BN=require('bignumber.js');
app.use('/api/v1',require(path.join(root,'dist/api/routes/testMarkets.js')).testMarketsRouter(()=>simNow));
app.get('/api/v1/demo/vta',asyncRoute(async(q,r)=>{privateReads++;r.json(await vta.snapshot(actor(q).userId));}));
app.get('/api/v1/demo/vta/sales/:id',asyncRoute(async(q,r)=>{
 lookupRequests++;
 if(lookupFailure==='timeout')return;
 if(lookupFailure)return r.status(Number(lookupFailure)).json({error:'fixture lookup unavailable'});
 r.json(await vta.operation(actor(q).userId,q.params.id));
}));
app.post('/api/v1/demo/vta/sell',asyncRoute(async(q,r)=>{
 saleRequests++;
 if(postFailure==='timeout')return;
 if(postFailure)return r.status(Number(postFailure)).json({error:'fixture rate limit'});
 const receipt=await vta.sell({userId:actor(q).userId,...q.body});
 keys.set(q.body.requestId,receipt);
 const snapshot=await vta.snapshot(owner.userId); available=snapshot.balances.find(b=>b.asset==='VTA').available; usdt=snapshot.balances.find(b=>b.asset==='USDT').available;
 if(heldResponse){await heldResponse;if(heldStatus!==200)return r.status(heldStatus).json({error:'fixture expired session'});}
 if(loseResponse){loseResponse=false;return r.status(503).json({error:'Temporary response failure'});}
 r.json(receipt);
}));
app.get('/api/v1/me',(q,r)=>r.json({id:actor(q).userId,displayName:'QA',email:'qa@example.invalid',kycStatus:'NOT_STARTED',isAdmin,role:isAdmin?'ADMIN':'USER'}));
app.get('/api/v1/futures/config',(_q,r)=>r.json({symbols:PAIRS,minLeverage:1,maxLeverage:100,leverageStep:1,fundingIntervalHours:8,highLeverageWarningThreshold:25,leverageTiers:[{notionalCap:null,maxLeverage:100,maintenanceMarginRate:0.005,maintenanceAmount:0}]}));
app.get('/api/v1/market/universe',(_q,r)=>r.json({available:true,value:{instruments:PAIRS.map(p=>({symbol:p,providerSymbol:p.replace('/',''),marketType:'linear_perpetual',baseAsset:p.split('/')[0],quoteAsset:'USDT',settleAsset:'USDT',status:'Trading',fundingIntervalMinutes:480}))}}));
app.get('/api/v1/market/external/tickers',(_q,r)=>r.json({tickers:PAIRS.map(p=>({pair:p,lastPrice:84890.1,high24h:85954.6,low24h:83535,changePercent:1.25,quoteVolume24h:3.19e9,volume24h:15000}))}));
app.get('/api/v1/market/external/symbols',(_q,r)=>r.json({symbols:PAIRS}));
app.get('/api/v1/market/pairs',(_q,r)=>r.json(PAIRS.map(p=>({pair:p,base:p.split('/')[0],quote:'USDT'}))));
app.get('/api/v1/futures/mark-price/:s',(_q,r)=>r.json({symbol:'BTCUSDT',markPrice:'84887.45',indexPrice:'84123.99'}));
app.get('/api/v1/futures/funding-rate/:s',(_q,r)=>r.json({history:[{rate:'0.0001',markPrice:'84887.45',indexPrice:'84123.99',appliedAt:new Date().toISOString()}]}));
app.get('/api/v1/futures/open-interest/:s',(_q,r)=>r.json({available:true,value:{openInterestBase:30894.9}}));
app.get('/api/v1/market/derivatives/:a',(_q,r)=>r.json({available:true,source:'qa',fetchedAt:Date.now(),stale:false,value:{turnover24hUsd:3.19e9,openInterestBase:30894.9,openInterestUsd:9.2e8}}));
app.get('/api/v1/wallet/overview',(_q,r)=>r.json({real:{spot:[],futures:[],spotValueUsd:0,futuresValueUsd:0,totalValueUsd:0},valuationComplete:true,unpricedAssets:[],btcPriceUsd:84890}));
app.get('/api/v1/futures/positions',(_q,r)=>r.json([])); app.get('/api/v1/futures/orders',(_q,r)=>r.json([]));
app.get('/api/v1/orders',(_q,r)=>r.json([])); app.get('/api/v1/orders/history',(_q,r)=>r.json([]));
app.get('/api/v1/balances',(_q,r)=>r.json([]));
app.get('/api/v1/orderbook/:a/:b',(_q,r)=>r.json({bids:[['84880','1.2'],['84879','0.8']],asks:[['84892','0.9'],['84893','1.5']]}));
app.get('/api/v1/cfd/instruments',(_q,r)=>r.json({instruments:[{symbol:'XAUUSD',displayName:'Gold',category:'metals'},{symbol:'EURUSD',displayName:'Euro',category:'fx'}]}));
app.get('/api/v1/cfd/quotes',(_q,r)=>r.json({quotes:[{symbol:'XAUUSD',bid:2650.1,ask:2650.6,changePercent:0.4}]}));
app.get('/api/v1/cfd/positions',(_q,r)=>r.json({positions:[]}));
app.get('/api/v1/market/live',(_q,r)=>{r.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});r.write(': open\n\n');});
app.get(['/api/v1/market/snapshot','/api/v1/market/display/spot-snapshot'],(_q,r)=>r.json({_display:{mode:'snapshot',refreshMs:60000,capturedAt:Date.now()},tickers:{available:true,source:'fixture',fetchedAt:Date.now(),stale:false,value:PAIRS.map(pair=>({pair,lastPrice:'84890.1',bidPrice:'84889',askPrice:'84891',changePercent24h:'1.25',high24h:'85954.6',low24h:'83535',quoteVolume24h:'3190000000',volume24h:'15000'}))},overview:{available:false,reason:'fixture'},sentiment:{available:false,reason:'fixture'}}));
app.get('/api/v1/market/assets/icons',(_q,r)=>r.json({icons:{}}));
app.get('/api/v1/market/external/rankings',(_q,r)=>r.json({rankings:[],gainers:[],losers:[]}));
app.get('/api/v1/market/external/orderbook/:p',(_q,r)=>r.json({bids:[[84880,1.2],[84879,0.8],[84878,2.1]],asks:[[84892,0.9],[84893,1.5],[84894,1.1]],fetchedAt:Date.now()}));
app.get(['/api/v1/market/external/candles/:p','/api/v1/market/futures/candles/:p','/api/v1/cfd/candles/:s','/api/v1/private-trading/candles'],(_q,r)=>r.json({candles:CANDLES}));
app.get('/api/v1/cfd/config',(_q,r)=>r.json({configured:true,instruments:[{symbol:'XAUUSD',displayName:'Gold',category:'metals',minQuantity:0.01,quantityStep:0.01,leverage:20}]}));
app.get('/api/v1/cfd/tickers',(_q,r)=>r.json({tickers:[{symbol:'XAUUSD',bid:2650.1,ask:2650.6,last:2650.3,changePercent:0.4,high24h:2662,low24h:2640}]}));
app.get(['/api/v1/orders/me','/api/v1/futures/orders/me'],(_q,r)=>r.json([]));
app.get('/api/v1/futures/balances',(_q,r)=>r.json([]));
app.get('/api/v1/private-trading/access',(_q,r)=>r.json({allowed:false}));
app.get('/api/v1/support/conversations/mine',(_q,r)=>r.json({conversation:null}));
app.get('/api/v1/wallet/performance',(_q,r)=>r.status(503).json({error:'fixture unavailable'}));
app.get('/api/v1/private-trading/native/wallet',asyncRoute(async(q,r)=>{nativeReads++;r.json(await native.wallet(actor(q)));}));app.use('/api/v1',(_q,r)=>r.json([]));
app.use(express.static(dist,{index:false}));
app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));





const forbiddenCopy = /\b(?:demo|test|simulation|simulated|synthetic|fixture|preview|sandbox)\b|not tradable|демо|тест|симуляц|синтетич|предпросмотр/i;
async function cleanCopy(page, label) {
 const text=await page.locator('body').innerText();
 const match=text.match(forbiddenCopy);
 if(match)throw Error('Forbidden customer copy '+label+': '+match[0]);
 fs.writeFileSync(OUT+'/'+label+'.txt',text);
}
async function marketDisplayQA(browser,origin,width) {
 const ctx=await browser.newContext({viewport:{width,height:1100},locale:'ru-RU'});
 await ctx.addInitScript(()=>{localStorage.setItem('exchange_token','fixture');localStorage.setItem('exchange_lang','ru');});
 const externalVta=[],errors=[],reads=[];
 await ctx.route('**/*',r=>{const url=r.request().url();if(!url.startsWith(origin)&&/VTA|VOLTORA/i.test(decodeURIComponent(url)))externalVta.push(url);return url.startsWith(origin)?r.continue():r.abort();});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('request',q=>{if(q.url().includes('/spot-book/VTA-USDT'))reads.push(q.url());});
 const audit=async phase=>{
  for(const route of ['/markets','/wallet']){
   await page.goto(origin+route);
   if(route==='/wallet')await page.getByRole('button',{name:'Финансирование',exact:true}).click();
   await page.locator(route==='/markets'?'.test-market-row[data-pair="VTA/USDT"]':'.wallet-funding-row[data-asset="VTA"]').waitFor({state:'attached'});
   await cleanCopy(page,phase+'-'+route.slice(1)+'-'+width);
   await page.screenshot({path:OUT+'/'+phase+'-'+route.slice(1)+'-'+width+'.png',fullPage:true});
  }
 };
 simNow=VOLTORA.listingAt-5000;await audit('before');
 await page.goto(origin+'/trade?pair=VTA%2FUSDT');
 await page.locator('[role="timer"]').waitFor();
 await cleanCopy(page,'before-trade-'+width);
 await page.screenshot({path:OUT+'/before-trade-'+width+'.png',fullPage:true});
 if(await page.locator('.ob-row').count())throw Error('Pre-listing depth leaked');
 await page.evaluate(()=>window.__listingDocument='same-document');
 const writes=financialAttempts.length;
 simNow=VOLTORA.listingAt+60000;
 // Advance only the server fixture clock. The existing countdown/store must wake by itself.
 await page.waitForFunction(()=>!document.querySelector('[role="timer"]'),{},{timeout:15000});
 await page.locator('.chart-area canvas').first().waitFor({state:'attached'});
 await page.waitForFunction(()=>document.querySelector('.ticker-bar .value.price')?.textContent.includes('0.01'));
 if(await page.evaluate(()=>window.__listingDocument)!=='same-document')throw Error('Listing reloaded document');
 if(width<900){await page.locator('#mobile-trade-chart').click();await page.locator('.terminal-mobile-chart-tabs').getByRole('button',{name:'Стакан',exact:true}).click();}
 await page.waitForFunction(()=>['.orderbook-bids','.orderbook-asks'].every(selector=>{
  const area=document.querySelector('.orderbook-area').getBoundingClientRect();
  return Array.from(document.querySelectorAll(selector+' .ob-row')).filter(row=>{
   const r=row.getBoundingClientRect(),p=row.parentElement.getBoundingClientRect();
   return r.height>0&&r.top>=Math.max(area.top,p.top)-1&&r.bottom<=Math.min(area.bottom,p.bottom,innerHeight-54)+1;
  }).length>=10;
 }));
 const levels=await page.locator('.orderbook-area').evaluate(el=>{
  const read=s=>Array.from(el.querySelectorAll(s+' .ob-row')).map(row=>({price:Number(row.querySelector('.cell').title),quantity:Number(row.querySelectorAll('.cell')[1].title),depth:row.querySelector('.ob-depth-bar').style.transform}));
  return {bids:read('.orderbook-bids'),asks:read('.orderbook-asks'),spread:el.querySelector('.ob-spread-detail').textContent};
 });
 if(Math.max(...levels.bids.map(l=>l.price))>=Math.min(...levels.asks.map(l=>l.price))||[...levels.bids,...levels.asks].some(l=>!l.price||!l.quantity||l.depth==='scaleX(0)'))throw Error('Invalid rendered depth');
 await cleanCopy(page,'after-trade-'+width);await page.screenshot({path:OUT+'/after-trade-'+width+'.png',fullPage:true});
 const bookUrl=origin+'/api/v1/market/display/spot-book/VTA-USDT';
 const book=await (await fetch(bookUrl)).json();
 const tape=await (await fetch(origin+'/api/v1/market/external/trades/VTA-USDT')).json();
 if(!tape.trades.length||tape.trades.some(t=>t.timestamp>simNow))throw Error('Tape empty or future');
 const row=page.locator('.orderbook-bids .ob-row').first(),price=await row.locator('.cell').first().getAttribute('title');
 await row.click();if(width<900)await page.locator('#mobile-trade-trade').click();
 const form=page.locator('.order-form-area');
 await page.waitForFunction(p=>document.querySelector('.order-form-area input[aria-label="Цена"]')?.value===p,price);
 await form.locator('.order-form-tabs').getByRole('button',{name:'Продать',exact:true}).click();
 await form.locator('input[type="number"][aria-label="Количество"]').fill('100');
 await form.locator('button[type="submit"]').click();
 await form.getByRole('alert').filter({hasText:'Этот тип ордера для данного актива недоступен.'}).waitFor();
 if(financialAttempts.length!==writes)throw Error('Book click LIMIT mutated finances');
 await form.getByRole('button',{name:'Рынок',exact:true}).click();
 for(const value of [0,25,50,75,100]){
  await form.getByRole('button',{name:value+'%',exact:true}).click();
  const backgrounds=await form.locator('.slider-step').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor));
  if(backgrounds.some(c=>c!=='rgba(0, 0, 0, 0)'))throw Error('Percentage button red/green fill: '+backgrounds);
 }
 if(await form.locator('button[type="submit"]').isDisabled()||Number(await form.getByLabel('Итого',{exact:true}).inputValue())<=0)throw Error('Live SELL did not become ready');
 await page.mouse.move(0,0);await page.screenshot({path:OUT+'/percentages-'+width+'.png',fullPage:true});
 await page.reload();if(width<900){await page.locator('#mobile-trade-chart').click();await page.locator('.terminal-mobile-chart-tabs').getByRole('button',{name:'Стакан',exact:true}).click();}
 await page.locator('.orderbook-bids .ob-row').first().waitFor();
 if(JSON.stringify(await (await fetch(bookUrl)).json())!==JSON.stringify(book))throw Error('Fixed server tick changed on reload');
 const oldText=await page.locator('.orderbook-area').innerText();simNow+=10000;
 await page.waitForFunction(old=>document.querySelector('.orderbook-area')?.innerText!==old,oldText,{timeout:15000});
 await audit('after');
 if(externalVta.length||errors.length)throw Error(JSON.stringify({externalVta,errors}));
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);if(overflow>1)throw Error('Mobile overflow '+overflow);
 await ctx.close();return {width,levels,tapeCount:tape.trades.length,externalVta,errors,reads:reads.length,transition:'same document; timer to chart, ticker, book and form; server fixture clock only',copy:'trade/markets/wallet before and after PASS',percentageBackground:'transparent at all five steps',overflow};
}

async function panelStates(page, width, expected) {
 await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
 await page.evaluate(()=>document.fonts.ready);
 if(width<900)await page.locator('#mobile-trade-trade').click();
 const form=page.locator('.order-form-area'), states={};
 await form.locator('input[type="number"][aria-label="Количество"]').waitFor();
 if(await form.locator('.order-form-tabs button[aria-pressed="true"]').innerText()!=='Купить'||await form.locator('.order-type-tabs').first().locator('[aria-pressed="true"]').innerText()!=='Лимит')throw Error('Default Spot selection changed');
 await page.screenshot({path:OUT+'/'+(expected?'vta':'ordinary')+'-default-'+width+'.png',fullPage:true});
 await form.locator('.order-type-tabs').first().getByRole('button',{name:'Рынок',exact:true}).click();
 await page.waitForFunction(()=>Number(document.querySelector('.order-form-area input[aria-label="Цена"]')?.value.replace('≈','').trim())>0);
 for(const side of ['Купить','Продать'])for(const type of ['Лимит','Рынок','Стоп','Тейк-профит','OCO']){
  await form.locator('.order-form-tabs').getByRole('button',{name:side,exact:true}).click();
  await form.locator('.order-type-tabs').first().getByRole('button',{name:type,exact:true}).click();
  const geometry=await form.evaluate(el=>{
   for(const node of [document.scrollingElement,...document.querySelectorAll("*")]){if(node && node.scrollTop)node.scrollTop=0;}
   const origin=el.getBoundingClientRect();
   // Asset-specific trigger-price text may wrap differently (0.010... vs 84890).
   // Compare control placement excluding only that measured text height.
   const hints=Array.from(el.querySelectorAll('.form-group > .form-label:not(:first-child)')).map(e=>e.getBoundingClientRect());
   return Array.from(el.querySelectorAll('.order-form-tabs button,.order-type-tabs button,input:not([type="hidden"]),.slider-step,.available-balance,button[type="submit"]')).filter(e=>e.getBoundingClientRect().height>0).map(e=>{
    const r=(e.closest('.input-group')??e).getBoundingClientRect(),css=getComputedStyle(e);
    return {tag:e.tagName,type:e.getAttribute('type'),pressed:e.getAttribute('aria-pressed'),x:Math.round(r.x-origin.x),y:Math.round(r.y-origin.y-hints.filter(h=>h.bottom<=r.y).reduce((sum,h)=>sum+h.height,0)),w:Math.round(r.width),h:Math.round(r.height),font:css.font,padding:css.padding,color:css.color,background:css.backgroundColor};
   });
  });
  const key=side+'/'+type;states[key]=geometry;
  if(expected){
   if(JSON.stringify(geometry)!==JSON.stringify(expected[key])){fs.writeFileSync(OUT+'/parity-failure-'+width+'.json',JSON.stringify({key,ordinary:expected[key],vta:geometry},null,2));throw Error('Standard form geometry differs: '+key+' '+width);}
   if(side==='Купить'||type!=='Рынок'){
    await form.locator('input[type="number"][aria-label="Количество"]').fill('100');
    const attempts=financialAttempts.length;
    await form.locator('button[type="submit"]').click();
    const message=side==='Купить'?'Покупка этого актива недоступна.':'Этот тип ордера для данного актива недоступен.';
    await form.getByRole('alert').filter({hasText:message}).waitFor();
    if(financialAttempts.length!==attempts)throw Error('Unsupported operation reached a trading endpoint');
   }
  }
 }
 await form.locator('.order-form-tabs').getByRole('button',{name:'Купить',exact:true}).click();
 await form.locator('.order-type-tabs').first().getByRole('button',{name:'Лимит',exact:true}).click();
 return states;
}

(async () => {
 await setupDatabase();
 const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true}); const rows=[];
 try {
  const display=[];
  for(const width of [1440,390]) { display.push(await marketDisplayQA(browser,origin,width));fs.writeFileSync(OUT+'/market-display.json',JSON.stringify(display,null,2)); }
  for(const width of [1440,390]) {
  const ctx=await browser.newContext({viewport:{width,height:1000},locale:'ru-RU'});
  await ctx.addInitScript(()=>{localStorage.setItem('exchange_token','fixture');localStorage.setItem('exchange_lang','ru');});
  await ctx.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  const page=await ctx.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  simNow=VOLTORA.listingAt+60000;
  await page.goto(origin+'/trade?pair=BTC%2FUSDT');
  const ordinaryGeometry=await panelStates(page,width);
  await page.goto(origin+'/trade?pair=VTA%2FUSDT');
  await panelStates(page,width,ordinaryGeometry);
  simNow=VOLTORA.listingAt-1000; await page.reload();
  if(width<900)await page.locator('#mobile-trade-trade').click();
  const form=page.locator('.order-form-area');
  const button=form.locator('button[type="submit"]');
  const quantity=form.locator('input[type="number"][aria-label="Количество"]');
  await button.waitFor();
  if(!await form.locator('.order-form-tabs').getByRole('button',{name:'Купить',exact:true}).getAttribute('aria-pressed').then(x=>x==='true'))throw Error('VTA default side differs from Spot');
  await form.locator('.order-form-tabs').getByRole('button',{name:'Продать',exact:true}).click();
  await form.locator('.order-type-tabs').first().getByRole('button',{name:'Рынок',exact:true}).click();
  await quantity.fill('100'); const preListingWrites=saleRequests; await button.click();
  await form.getByRole('alert').filter({hasText:'Этот актив пока не торгуется'}).waitFor();
  if(saleRequests!==preListingWrites)throw Error('prelisting write');
  if(await page.locator('.vta-demo-spot').count())throw Error('custom panel returned');
  await page.evaluate(()=>window.__saleListingDocument=true);
  simNow=VOLTORA.listingAt+60000;
  await page.waitForFunction(()=>!document.querySelector('[role="timer"]'),{},{timeout:15000});
  if(!await page.evaluate(()=>window.__saleListingDocument))throw Error('Sale transition reloaded the page');
  if(width<900)await page.locator('#mobile-trade-trade').click();
  await form.locator('.order-form-tabs').getByRole('button',{name:'Продать',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.order-form-area .amount')?.textContent.includes('VTA') && document.querySelector('.order-form-area .amount')?.textContent.includes('4545'));
  await form.locator('.order-type-tabs').first().getByRole('button',{name:'Рынок',exact:true}).click();
  await form.getByRole('button',{name:'100%',exact:true}).click();
  if(await quantity.inputValue()!==available)throw Error('100% lost decimal precision');
  await quantity.fill('100');
  await page.waitForFunction(()=>Number(document.querySelector('.order-form-area input[aria-label="Итого"]')?.value)>0);
  const estimate=await form.getByLabel('Итого',{exact:true}).inputValue();
  if(Math.abs(Number(estimate)-Number(publicTestAsset(VOLTORA,simNow).state.lastPrice)*100)>0.011)throw Error('incorrect estimate');
  if(!await form.locator('.order-form-tabs').getByRole('button',{name:'Купить',exact:true}).isEnabled())throw Error('BUY tab must stay selectable');
  if(!await form.getByRole('button',{name:'Лимит',exact:true}).isEnabled())throw Error('LIMIT tab must stay selectable');
  if(width===1440 && await page.getByText('Не удалось загрузить график',{exact:true}).count())throw Error('VTA chart failed');
  await page.screenshot({path:OUT+'/vta-form-'+width+'.png',fullPage:true});
  loseResponse=true; await button.click();
  await form.getByRole('alert').waitFor();
  if(await quantity.isEnabled())throw Error('uncertain sale quantity editable');
  const intentBefore=await page.evaluate(id=>JSON.parse(localStorage.getItem('voltex:vta-sale:v1:'+id)),owner.userId);
  lookupFailure='429'; await page.reload();
  if(width<900)await page.locator('#mobile-trade-trade').click();
  await form.getByRole('alert').waitFor();
  if(await quantity.inputValue()!=='100'||await quantity.isEnabled())throw Error('reload lost original intent');
  postFailure='429'; await button.click(); await form.getByRole('alert').waitFor();
  await page.waitForFunction(()=>!document.querySelector('.order-form-area button[type="submit"]').disabled);
  postFailure='timeout'; await button.click();
  await page.waitForFunction(()=>!document.querySelector('.order-form-area button[type="submit"]').disabled,{},{timeout:25000});
  const intentAfter=await page.evaluate(id=>JSON.parse(localStorage.getItem('voltex:vta-sale:v1:'+id)),owner.userId);
  if(JSON.stringify(intentBefore)!==JSON.stringify(intentAfter))throw Error('429/timeout replaced ambiguous intent');
  const writesBeforeReload=saleRequests;
  postFailure=null; lookupFailure=null; await page.reload();
  if(width<900)await page.locator('#mobile-trade-trade').click();
  await page.waitForFunction(()=>document.querySelector('.order-form-area input[type="number"][aria-label="Количество"]')?.value==='');
  if(keys.size!==rows.length+1||saleRequests!==writesBeforeReload)throw Error('duplicate/automatic sale');
  await page.screenshot({path:OUT+'/vta-form-after-sale-'+width+'.png',fullPage:true});
  await page.reload();
  if(width<900)await page.locator('#mobile-trade-account').click();
  await page.locator('#spot-tab-orderHistory').click();
  await page.getByRole('cell',{name:'VTA/USDT',exact:true}).first().waitFor();
  await page.locator('#spot-tab-assets').click();
  await page.getByRole('cell',{name:'VTA',exact:true}).waitFor();
  const usdtRow=page.getByRole('row').filter({has:page.getByRole('cell',{name:'USDT',exact:true})});
  if(!new BN((await usdtRow.getByRole('cell').nth(1).innerText()).replace(/,/g,'')).eq(usdt))throw Error('Spot Assets lost USDT proceeds');
  const vtaRow=page.getByRole('row').filter({has:page.getByRole('cell',{name:'VTA',exact:true})});
  if(!new BN((await vtaRow.getByRole('cell').nth(1).innerText()).replace(/,/g,'')).eq(available))throw Error('Spot Assets lost remaining VTA');
  await page.goto(origin+'/wallet');
  await page.getByRole('button',{name:'Финансирование',exact:true}).click();
  const asset=page.locator('.wallet-funding-row[data-asset="VTA"]'); await asset.waitFor();
  if(await page.locator('.vta-demo-wallet').count())throw Error('custom wallet card returned');
  const wallet=await asset.innerText();
  const cash=await page.locator('.wallet-funding-row[data-asset="USDT"]').innerText();
  if(!cash.replace(/\s/g,'').includes(Number(usdt).toLocaleString('ru-RU',{maximumFractionDigits:2}).replace(/\s/g,'')))throw Error('Wallet lost sale USDT');
  if(!wallet.replace(/\s/g,'').includes(Number(available).toLocaleString('ru-RU',{maximumFractionDigits:8}).replace(/\s/g,'')))throw Error('Wallet wrong VTA remaining');
  if(await page.locator('.wallet-funding').getAttribute('data-account-scope')!=='SIMULATION_SPOT')throw Error('wrong account scope');
  if(await page.locator('.wallet-funding').getByRole('button',{name:'Вывести',exact:true}).count())throw Error('simulation withdrawal exposed');
  const projection=await vta.snapshot(owner.userId);
  const displayedTotal=await page.locator('.wallet-funding-total').innerText();
  if(!displayedTotal.replace(/\s/g,'').includes(Number(projection.totalValueUsd).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/\s/g,'')))throw Error('server projection total mismatch');
  const unified=await native.wallet(owner);
  if(!new BN(unified.assetsValue).eq(new BN(100000).plus(usdt)))throw Error('native simulation cash double-counted');
  if(requested.includes('VTAUSDT'))throw Error('external VTA pricing');
  await page.screenshot({path:OUT+'/vta-wallet-'+width+'.png',fullPage:true});
  const over=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  if(over>1||errors.length)throw Error(JSON.stringify({over,errors}));
  rows.push({width,uiParity:'10 side/order-type combinations identical; unsupported submissions refused with zero POSTs',prelisting:'blocked',autoEstimate:estimate,retry:'one fill',reload:'standard history and assets persisted',wallet,cash,remainingVta:available,simulationUsdt:usdt,serverTotal:projection.totalValueUsd,nativeAssetsValue:unified.assetsValue,errors,over});
  simNow=VOLTORA.listingAt-1000; await ctx.close();
 }
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 await ctx.addInitScript(()=>{localStorage.setItem('exchange_token','fixture');localStorage.setItem('exchange_lang','ru');});
 await ctx.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 const page=await ctx.newPage();
 simNow=VOLTORA.listingAt+60000;
 await page.goto(origin+'/trade?pair=VTA%2FUSDT');
 const form=page.locator('.order-form-area'), quantity=form.locator('input[type="number"][aria-label="Количество"]');
 await form.locator('.order-form-tabs').getByRole('button',{name:'Продать',exact:true}).click();
 await form.locator('.order-type-tabs').first().getByRole('button',{name:'Рынок',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.order-form-area input[type="range"]').disabled);
 await quantity.fill('100');
 const beforeSwitch=keys.size;
 heldResponse=new Promise(resolve=>releaseHeld=resolve);heldStatus=401;
 await form.locator('button[type="submit"]').click();
 const switchDeadline=Date.now()+10000;
 while(keys.size===beforeSwitch){if(Date.now()>switchDeadline)throw Error("sale did not reach commit before session switch");await new Promise(r=>setTimeout(r,10));}
 await page.evaluate(()=>{
  localStorage.removeItem('exchange_token');window.dispatchEvent(new StorageEvent('storage',{key:'exchange_token',newValue:null}));
  localStorage.setItem('exchange_token','other');window.dispatchEvent(new StorageEvent('storage',{key:'exchange_token',newValue:'other'}));
 });
 await page.waitForFunction(()=>document.querySelector('.order-form-area .amount')?.textContent.includes('0.00000000'));
 releaseHeld();heldResponse=null;
 await page.waitForFunction(()=>!document.querySelector('.order-form-area button[type="submit"]').disabled);
 if(await page.evaluate(()=>localStorage.getItem('exchange_token'))!=='other')throw Error('old 401 logged out the new account');
 if(await quantity.inputValue()!=='')throw Error('old completion leaked quantity into another account');
 const switchWrites=saleRequests;
 await page.evaluate(()=>{localStorage.setItem('exchange_token','fixture');window.dispatchEvent(new StorageEvent('storage',{key:'exchange_token',newValue:'fixture'}));});
 await page.waitForFunction(id=>localStorage.getItem('voltex:vta-sale:v1:'+id)===null,owner.userId);
 if(saleRequests!==switchWrites)throw Error('returning to owner automatically sold');
 rows.push({sessionSwitch:'logout + account switch during committed request; late 401 cannot clear new session; original receipt recovered with GET'});
 // Two visible tabs explicitly attempt the same exact remaining balance.
 const tab2=await ctx.newPage();await tab2.goto(origin+'/trade?pair=VTA%2FUSDT');
 for(const tab of [page,tab2]){
  const f=tab.locator('.order-form-area');await f.locator('.order-form-tabs').getByRole('button',{name:'Продать',exact:true}).click();
  await f.locator('.order-type-tabs').first().getByRole('button',{name:'Рынок',exact:true}).click();
  await tab.waitForFunction(()=>!document.querySelector('.order-form-area input[type="range"]').disabled);
  await f.getByRole('button',{name:'100%',exact:true}).click();
  if(await f.locator('input[type="number"][aria-label="Количество"]').inputValue()!==available)throw Error('full sale lost exact quantity');
 }
 const beforeFull=keys.size, exactRemaining=available;
 await Promise.all([page,tab2].map(tab=>tab.locator('.order-form-area button[type="submit"]').click()));
 await Promise.all([page,tab2].map(tab=>tab.waitForFunction(()=>!document.querySelector('.order-form-area button[type="submit"]').disabled)));
 if(available!=='0'||keys.size!==beforeFull+1)throw Error('concurrent full sale oversold or left dust');
 const fills=await db.demoOrder.findMany({where:{userId:owner.userId}});
 if(fills.length!==keys.size||!fills.some(o=>o.originalQuantity.toString()===exactRemaining))throw Error('full sale receipt mismatch');
 if((await db.balance.findFirstOrThrow({where:{userId:owner.userId}})).available.toString()!=='50000'||await db.withdrawal.count({where:{userId:owner.userId}}))throw Error('real funds changed');
 rows.push({twoTabs:'one full fill; no oversell; no dust',exactSold:exactRemaining,remainingVta:available,simulationUsdt:usdt,realUsdt:'50000'});
 await tab2.close();
 await page.goto(origin+'/wallet');
 await page.getByRole('button',{name:'Финансирование',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.wallet-funding')?.getAttribute('data-account-scope')==='SIMULATION_SPOT');
 await page.evaluate(()=>{localStorage.setItem('exchange_token','other');window.dispatchEvent(new StorageEvent('storage',{key:'exchange_token',newValue:'other'}));});
 await page.waitForFunction(()=>document.querySelector('.wallet-funding')?.getAttribute('data-account-scope')==='REAL_FUNDING');
 if(await page.locator('.wallet-funding [data-asset="VTA"]').count())throw Error('owner VTA leaked into switched wallet');
 await page.evaluate(()=>{localStorage.setItem('exchange_token','fixture');window.dispatchEvent(new StorageEvent('storage',{key:'exchange_token',newValue:'fixture'}));});
 await page.waitForFunction(()=>document.querySelector('.wallet-funding')?.getAttribute('data-account-scope')==='SIMULATION_SPOT');
 rows.push({walletSwitch:'account scope resets on cross-tab session change; owner projection never leaks'});

 const before=privateReads;
 await page.goto(origin+'/trade?pair=BTC%2FUSDT');
 await page.locator('.order-form-area .order-type-tabs').waitFor();
 for(const label of ['Купить','Лимит','Рынок','Стоп','Тейк-профит','OCO']) {
  if(!await page.locator('.order-form-area').getByRole('button',{name:label,exact:true}).first().isEnabled())throw Error('ordinary Spot disabled '+label);
 }
 if(privateReads!==before)throw Error('ordinary Spot read private ledger');
 isAdmin=false; simNow=VOLTORA.listingAt+60000;
 await page.goto(origin+'/trade?pair=VTA%2FUSDT');
 await page.locator('.order-form-area button[type="submit"]').waitFor();
 await page.waitForTimeout(400);
 await page.locator('.order-form-area .order-form-tabs').getByRole('button',{name:'Продать',exact:true}).click();
 await page.locator('.order-form-area .order-type-tabs').first().getByRole('button',{name:'Рынок',exact:true}).click();
 await page.locator('.order-form-area input[type="number"][aria-label="Количество"]').fill('100');
 const ordinaryWrites=saleRequests; await page.locator('.order-form-area button[type="submit"]').click();
 await page.locator('.order-form-area [role="alert"]').waitFor();
 if(saleRequests!==ordinaryWrites)throw Error('non-admin private sale submitted');
 if(privateReads!==before)throw Error('non-admin private read');
 rows.push({ordinarySpot:'all controls enabled, zero private reads',nonAdmin:'blocked, zero private reads'});
 await ctx.close();
 } finally {
  fs.writeFileSync(OUT+'/vta-browser.json',JSON.stringify({rows,saleRequests,uniqueSales:keys.size,lookupRequests,nativeReads},null,2));
  await browser.close(); server.closeAllConnections(); server.close(); await db.$disconnect();
 }
 console.log(JSON.stringify({rows,saleRequests,uniqueSales:keys.size}));
})().catch(e=>{console.error(e);process.exitCode=1;});
