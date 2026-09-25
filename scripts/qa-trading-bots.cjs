'use strict';
// Local production-bundle QA. Read-only fixtures shared in shape with qa-spot-cfd-terminal.
const express = require('express');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const dist = path.resolve(__dirname, '../frontend/dist');
const fs = require('node:fs');
const OUT = path.resolve(process.env.QA_OUT || 'docs/qa/trading-bots');
const PAIRS = ['BTC/USDT','ETH/USDT','SOL/USDT'];
const CANDLES=Array.from({length:120},(_,i)=>({time:Math.floor(Date.now()/1000)-(120-i)*60,open:84800,high:84950,low:84700,close:84890,volume:12}));
const app = express();
app.get('/api/v1/me', (_q,r)=>r.json({id:'qa',displayName:'QA',email:'qa@example.invalid',kycStatus:'NOT_STARTED',isAdmin:false,role:'USER'}));
app.get('/api/v1/futures/config',(_q,r)=>r.json({symbols:PAIRS,minLeverage:1,maxLeverage:100,leverageStep:1,fundingIntervalHours:8,highLeverageWarningThreshold:25,leverageTiers:[{notionalCap:null,maxLeverage:100,maintenanceMarginRate:0.005,maintenanceAmount:0}]}));
app.get('/api/v1/market/universe',(_q,r)=>r.json({available:true,value:{instruments:PAIRS.map(p=>({symbol:p,providerSymbol:p.replace('/',''),marketType:'linear_perpetual',baseAsset:p.split('/')[0],quoteAsset:'USDT',settleAsset:'USDT',status:'Trading',fundingIntervalMinutes:480}))}}));
app.get('/api/v1/market/external/tickers',(_q,r)=>r.json({tickers:PAIRS.map(p=>({pair:p,lastPrice:84890.1,high24h:85954.6,low24h:83535,changePercent:1.25,quoteVolume24h:3.19e9,volume24h:15000}))}));
app.get('/api/v1/market/external/symbols',(_q,r)=>r.json({symbols:PAIRS}));
app.get('/api/v1/market/pairs',(_q,r)=>r.json(PAIRS.map(p=>({pair:p,base:p.split('/')[0],quote:'USDT'}))));
app.get('/api/v1/futures/mark-price/:s',(_q,r)=>r.json({symbol:'BTCUSDT',markPrice:'84887.45',indexPrice:'84123.99'}));
app.get('/api/v1/futures/funding-rate/:s',(_q,r)=>r.json({history:[{rate:'0.0001',markPrice:'84887.45',indexPrice:'84123.99',appliedAt:new Date().toISOString()}]}));
app.get('/api/v1/futures/open-interest/:s',(_q,r)=>r.json({available:true,value:{openInterestBase:30894.9}}));
app.get('/api/v1/market/derivatives/:a',(_q,r)=>r.json({available:true,source:'qa',fetchedAt:Date.now(),stale:false,value:{turnover24hUsd:3.19e9,openInterestBase:30894.9,openInterestUsd:9.2e8}}));
app.get('/api/v1/wallet/overview',(_q,r)=>r.json({balances:{spot:[],futures:[],spotValueUsd:0,futuresValueUsd:0,totalValueUsd:0},valuationComplete:true,unpricedAssets:[],btcPriceUsd:84890}));
app.get('/api/v1/futures/positions',(_q,r)=>r.json([])); app.get('/api/v1/futures/orders',(_q,r)=>r.json([]));
app.get('/api/v1/orders',(_q,r)=>r.json([])); app.get('/api/v1/orders/history',(_q,r)=>r.json([]));
app.get('/api/v1/balances',(_q,r)=>r.json([]));
app.get('/api/v1/orderbook/:a/:b',(_q,r)=>r.json({bids:[['84880','1.2'],['84879','0.8']],asks:[['84892','0.9'],['84893','1.5']]}));
app.get('/api/v1/cfd/instruments',(_q,r)=>r.json({instruments:[{symbol:'XAUUSD',displayName:'Gold',category:'metals'},{symbol:'EURUSD',displayName:'Euro',category:'fx'}]}));
app.get('/api/v1/cfd/quotes',(_q,r)=>r.json({quotes:[{symbol:'XAUUSD',bid:2650.1,ask:2650.6,changePercent:0.4}]}));
app.get('/api/v1/cfd/positions',(_q,r)=>r.json({positions:[]}));
app.get('/api/v1/market/live',(_q,r)=>{r.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});r.write(': open\n\n');});
app.get('/api/v1/market/snapshot',(_q,r)=>r.json({pairs:PAIRS.map(p=>({pair:p,lastPrice:84890.1,changePercent:1.25,high24h:85954.6,low24h:83535,quoteVolume24h:3.19e9})),fetchedAt:Date.now()}));
app.get('/api/v1/market/assets/icons',(_q,r)=>r.json({icons:{}}));
app.get('/api/v1/market/external/rankings',(_q,r)=>r.json({source:'qa',rankings:[]}));
app.get('/api/v1/market/global',(_q,r)=>r.json({global:{totalVolume24hUsd:8.9e10,totalMarketCapUsd:2.4e12,btcDominancePercent:55.1,ethDominancePercent:null,marketCapChangePercent24h:-0.4},fearGreed:{value:61,classification:'Greed',updatedAt:Date.now()}}));
app.get('/api/v1/market/external/trades/:p',(_q,r)=>r.json({trades:[]}));
app.get('/api/v1/market/external/orderbook/:p',(_q,r)=>r.json({bids:[{price:'84880',quantity:'1.2'},{price:'84879',quantity:'0.8'}],asks:[{price:'84892',quantity:'0.9'},{price:'84893',quantity:'1.5'}],fetchedAt:Date.now()}));
app.get(['/api/v1/market/external/candles/:p','/api/v1/market/futures/candles/:p','/api/v1/cfd/candles/:s','/api/v1/private-trading/candles'],(_q,r)=>r.json({candles:CANDLES}));
app.get('/api/v1/cfd/config',(_q,r)=>r.json({configured:true,instruments:[{symbol:'XAUUSD',displayName:'Gold',category:'metals',minQuantity:0.01,quantityStep:0.01,leverage:20}]}));
app.get('/api/v1/cfd/tickers',(_q,r)=>r.json({tickers:[{symbol:'XAUUSD',bid:2650.1,ask:2650.6,last:2650.3,changePercent:0.4,high24h:2662,low24h:2640}]}));
app.get(['/api/v1/orders/me','/api/v1/futures/orders/me'],(_q,r)=>r.json([]));
app.get('/api/v1/futures/balances',(_q,r)=>r.json([]));
app.get('/api/v1/private-trading/access',(_q,r)=>r.json({allowed:false}));
app.get('/api/v1/support/conversations/mine',(_q,r)=>r.json({conversation:null}));
app.use('/api/v1',(_q,r)=>r.status(503).json({error:'Not supplied by local QA fixture'}));
app.use(express.static(dist,{index:false}));
app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));

const assert = require('node:assert/strict');
const report = { environment:'Local production bundle, mocked read-only API; no live trades', checks:[], layouts:[], errors:[] };
const check = (name, condition) => { assert.ok(condition, name); report.checks.push(name); };
(async () => {
  fs.mkdirSync(OUT,{recursive:true});
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true, ...(process.env.QA_BROWSER_CHANNEL ? {channel:process.env.QA_BROWSER_CHANNEL} : {})});
  try {
    for (const width of [1920,1440,1024,390,320]) {
      const context=await browser.newContext({viewport:{width,height:1000}});
      await context.addInitScript(()=>{localStorage.setItem('exchange_token','local-qa-only');localStorage.setItem('exchange_lang','ru');});
      await context.route('**/*',route=>new URL(route.request().url()).origin===base ? route.continue() : route.abort());
      const page=await context.newPage(), writes=[], errors=[];
      page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/trading-bots'); await page.locator('[data-bot]').first().waitFor();
      check(width+': seven bots',await page.locator('[data-bot]').count()===7);
      const layout=await page.evaluate(()=>{
        const h=document.querySelector('.global-header'),s=getComputedStyle(h);
        const left=h.querySelector('.header-left').getBoundingClientRect(),right=h.querySelector('.header-actions').getBoundingClientRect();
        const nav=h.querySelector('.main-nav');
        return {width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,background:s.backgroundColor,texture:s.backgroundImage,font:s.fontFamily,headerOverlap:left.right>right.left+1,navClipped:Math.max(0,nav.scrollWidth-nav.clientWidth)};
      });
      report.layouts.push(layout);
      check(width+': no horizontal overflow',layout.overflow<=1);
      check(width+': solid graphite header',layout.background==='rgb(26, 27, 32)'&&layout.texture==='none');
      check(width+': header clusters separate',!layout.headerOverlap);
      check(width+': no clipped navigation links',layout.navClipped===0);
      await page.screenshot({path:path.join(OUT,'bots-'+width+'.png'),fullPage:true});
      const values=await page.locator('.vb-bot .vb-roi').allTextContents();
      check(width+': positive model range',values.every(v=>parseFloat(v.replace('+',''))>=120&&parseFloat(v.replace('+',''))<=217));
      check(width+': model disclosure visible',await page.locator('.vb-data-note').isVisible());
      await page.locator('[data-bot="atlas"] .vb-open').click();
      check(width+': modal opens',await page.locator('dialog[open]').count()===1);
      await page.locator('#vb-budget').fill('2499');
      check(width+': minimum enforced',await page.getByRole('button',{name:'Посмотреть план',exact:true}).isDisabled());
      await page.locator('#vb-budget').fill('2500');
      await page.getByRole('button',{name:'Посмотреть план',exact:true}).click();
      check(width+': local plan shown',await page.locator('.vb-plan').isVisible());
      await page.getByRole('button',{name:'7д',exact:true}).click();
      check(width+': 7-day period',await page.getByRole('button',{name:'7д',exact:true}).getAttribute('aria-pressed')==='true');
      await page.screenshot({path:path.join(OUT,'bot-detail-'+width+'.png')});
      await page.keyboard.press('Escape');
      check(width+': Escape closes modal',await page.locator('dialog').count()===0);
      check(width+': focus restored',await page.locator('[data-bot="atlas"] .vb-open').evaluate(el=>el===document.activeElement));
      await page.locator('[data-bot="atlas"] .vb-heart').click();
      await page.reload();await page.locator('[data-bot]').first().waitFor();
      check(width+': stable after reload',JSON.stringify(await page.locator('.vb-bot .vb-roi').allTextContents())===JSON.stringify(values));
      check(width+': favorite retained',await page.locator('[data-bot="atlas"] .vb-heart').getAttribute('aria-pressed')==='true');
      await page.getByRole('button',{name:'DCA',exact:true}).click();
      check(width+': category filter',await page.locator('[data-bot]').count()===1);
      await page.getByRole('button',{name:'Все стратегии',exact:true}).click();
      await page.getByLabel('Сортировка ботов').selectOption('minimum');
      check(width+': minimum sorting',await page.locator('[data-bot]').first().getAttribute('data-bot')==='atlas');
      if(await page.locator('.nav-burger').isVisible()) {
        await page.locator('.nav-burger').click();
        check(width+': mobile bots link',await page.locator('.nav-mobile-menu a[href="/trading-bots"]').isVisible());
        check(width+': mobile robot icon',await page.locator('.nav-mobile-menu a[href="/trading-bots"] svg.trading-bot-icon').count()===1);
        check(width+': bots follows OTC in mobile menu',await page.locator('.nav-mobile-menu a[href="/otc"] + a[href="/trading-bots"]').count()===1);
      } else if(width>=1440) {
        const botsLink=page.locator('.main-nav > a[href="/trading-bots"]');
        check(width+': top-level active bots tab',await botsLink.isVisible()&&await botsLink.evaluate(el=>el.classList.contains('nav-active')));
        check(width+': robot icon',await botsLink.locator('svg.trading-bot-icon').count()===1);
        check(width+': bots is last product',await page.locator('.main-nav > a').last().getAttribute('href')==='/trading-bots');
        await page.locator('.main-nav .nav-item-wrap > a').focus();
        check(width+': keyboard trading menu',await page.locator('.nav-dropdown a[href="/trade"]').isVisible());
        check(width+': no duplicate bots submenu',await page.locator('.nav-dropdown a[href="/trading-bots"]').count()===0);
      }
      check(width+': zero writes',writes.length===0);
      check(width+': zero uncaught errors',errors.length===0);
      await context.close();
    }
    const context=await browser.newContext();
    await context.addInitScript(()=>{localStorage.setItem('exchange_token','local-qa-only');localStorage.setItem('exchange_lang','ru');});
    const page=await context.newPage();
    await page.clock.install({time:new Date('2026-09-27T23:59:58Z')});
    await page.goto(base+'/trading-bots');await page.locator('[data-bot]').first().waitFor();
    const before=await page.locator('.vb-bot .vb-roi').allTextContents();
    await page.clock.fastForward(3000);
    const after=await page.locator('.vb-bot .vb-roi').allTextContents();
    check('Monday boundary refreshes an open page',JSON.stringify(before)!==JSON.stringify(after));
    await context.close();
    for(const width of [1920,1440,1024,390]) {
      const context=await browser.newContext({viewport:{width,height:900}});
      await context.addInitScript(()=>{localStorage.setItem('exchange_token','local-qa-only');localStorage.setItem('exchange_lang','ru');});
      await context.route('**/*',route=>new URL(route.request().url()).origin===base ? route.continue() : route.abort());
      const page=await context.newPage();
      for(const [name,url] of [['futures','/futures'],['spot','/trade'],['cfd','/trade?market=cfd'],['markets','/markets']]) {
        await page.goto(base+url);
        await page.locator('header').first().waitFor();
        const layout=await page.locator('header').first().evaluate(h=>{const s=getComputedStyle(h),left=h.querySelector('.header-left').getBoundingClientRect(),right=h.querySelector('.header-actions').getBoundingClientRect(),nav=h.querySelector('.main-nav');return {background:s.backgroundColor,texture:s.backgroundImage,overflow:document.documentElement.scrollWidth-innerWidth,height:h.getBoundingClientRect().height,overlap:left.right>right.left+1,navClipped:Math.max(0,nav.scrollWidth-nav.clientWidth)};});
        report.layouts.push({name,width,...layout});
        check(name+' '+width+': shared graphite',layout.background==='rgb(26, 27, 32)'&&layout.texture==='none');
        check(name+' '+width+': no overflow',layout.overflow<=1);
        check(name+' '+width+': header controls separate',!layout.overlap);
        if(width>1024) check(name+' '+width+': approved desktop header height',layout.height===68);
        check(name+' '+width+': no clipped navigation links',layout.navClipped===0);
        await page.screenshot({path:path.join(OUT,name+'-header-'+width+'.png')});
      }
      await context.close();
      const homeContext=await browser.newContext({viewport:{width,height:900}});
      await homeContext.addInitScript(()=>localStorage.setItem('exchange_lang','ru'));
      await homeContext.route('**/*',route=>new URL(route.request().url()).origin===base ? route.continue() : route.abort());
      const home=await homeContext.newPage(), homeErrors=[];
      home.on('pageerror',e=>homeErrors.push(e.message));
      await home.goto(base+'/');
      await home.locator('header a[href="/register"]').waitFor();
      const homeLayout=await home.evaluate(()=>{const h=document.querySelector('header');const s=getComputedStyle(h);const children=[...h.firstElementChild.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect());return {background:s.backgroundColor,overflow:document.documentElement.scrollWidth-innerWidth,overlap:children.some((r,i)=>i>0&&r.left<children[i-1].right)};});
      report.layouts.push({name:'home',width,...homeLayout});

      check('home '+width+': graphite and no overlapping controls',homeLayout.background==='rgb(26, 27, 32)'&&!homeLayout.overlap&&homeLayout.overflow<=1);
      await home.screenshot({path:path.join(OUT,'home-header-'+width+'.png')});
      await home.goto(base+'/trading-bots');
      await home.waitForURL(/login/);
      check('home '+width+': no uncaught errors',homeErrors.length===0);
      check(width+': bots route preserves authentication',home.url().includes('next='));
      await homeContext.close();
    }
  } catch(e) { report.errors.push(e.stack);process.exitCode=1; }
  finally {
    fs.writeFileSync(path.join(OUT,'browser.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({checks:report.checks.length,layouts:report.layouts,errors:report.errors},null,2));
    await browser.close();server.closeAllConnections();server.close();
  }
})().catch(e=>{console.error(e);process.exit(1);});
