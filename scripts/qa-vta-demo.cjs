'use strict';
// Production bundle, isolated HTTP fixtures: private VTA prelisting gate,
// market estimate, uncertain-response retry, reload persistence and wallet.
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
const {VOLTORA}=require(path.join(root, "dist/services/testMarkets/testAssetConfig.js"));
const {publicTestAsset}=require(path.join(root, "dist/services/testMarkets/testMarketService.js"));
let simNow=VOLTORA.listingAt-1000;let available='4545454.54545454',usdt='0';const sales=[],keys=new Map();let saleRequests=0,loseResponse=false;
const BN=require('bignumber.js');
app.get('/api/v1/market/test-assets',(_q,r)=>r.json({serverTime:simNow,assets:[publicTestAsset(VOLTORA,simNow)]}));
app.get('/api/v1/demo/vta',(_q,r)=>r.json({balances:[{asset:'VTA',available,locked:'0'},{asset:'USDT',available:usdt,locked:'0'}],sales}));
app.post('/api/v1/demo/vta/sell',(q,r)=>{saleRequests++;if(keys.has(q.body.requestId))return r.json(keys.get(q.body.requestId));const price=String(publicTestAsset(VOLTORA,simNow).state.lastPrice);const proceeds=new BN(price).times(q.body.quantity).toFixed();available=new BN(available).minus(q.body.quantity).toFixed();usdt=new BN(usdt).plus(proceeds).toFixed();const receipt={id:q.body.requestId,price,quantity:q.body.quantity,proceeds};keys.set(receipt.id,receipt);sales.unshift({...receipt,createdAt:new Date().toISOString()});if(loseResponse){loseResponse=false;return r.status(503).json({error:'Temporary response failure'});}r.json(receipt);});

app.get('/api/v1/me', (_q,r)=>r.json({id:'qa',displayName:'QA',email:'qa@example.invalid',kycStatus:'NOT_STARTED',isAdmin:true,role:'ADMIN'}));
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
app.get('/api/v1/market/snapshot',(_q,r)=>r.json({pairs:PAIRS.map(p=>({pair:p,lastPrice:84890.1,changePercent:1.25,high24h:85954.6,low24h:83535,quoteVolume24h:3.19e9})),fetchedAt:Date.now()}));
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
app.get('/api/v1/private-trading/native/wallet',(_q,r)=>r.status(403).json({error:'fixture not enabled'}));app.use('/api/v1',(_q,r)=>r.json([]));
app.use(express.static(dist,{index:false}));
app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')));




(async()=>{const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({headless:true});const rows=[];try{for(const width of [1440,390]){const ctx=await browser.newContext({viewport:{width,height:1000},locale:'ru-RU'});await ctx.addInitScript(()=>{localStorage.setItem('exchange_token','fixture');localStorage.setItem('exchange_lang','ru');});await ctx.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());const page=await ctx.newPage();const errors=[];page.on('console',m=>{if(m.type()==='error')console.error(m.text())});page.on('pageerror',e=>{errors.push(String(e));console.error(String(e))});await page.goto(origin+'/trade?pair=VTA%2FUSDT');if(width<900)await page.locator('#mobile-trade-trade').click();const button=page.getByRole('button',{name:'Продать VTA',exact:true});await button.waitFor();if(await button.isEnabled())throw Error('prelisting sale enabled');simNow=VOLTORA.listingAt+60000;await page.reload();if(width<900)await page.locator('#mobile-trade-trade').click();await page.getByLabel('Количество VTA',{exact:true}).fill('100');await page.waitForTimeout(500);if(!await button.isEnabled())throw Error('live sale disabled');const estimate=await page.locator('.vta-demo-balance').allTextContents();await page.screenshot({path:OUT+'/vta-form-'+width+'.png',fullPage:true});loseResponse=true;await button.click();await page.getByRole('button',{name:'Проверить продажу'}).waitFor();await page.getByRole('button',{name:'Проверить продажу'}).click();await page.getByRole('status').filter({hasText:'Продано'}).waitFor();if(keys.size!==rows.length+1)throw Error('duplicate sale');await page.reload();if(width<900)await page.locator('#mobile-trade-trade').click();await page.locator('.vta-demo-spot details summary').waitFor();await page.goto(origin+'/wallet');await page.waitForTimeout(1000);await page.screenshot({path:OUT+'/wallet-debug.png'});await page.getByRole('button',{name:'Финансирование',exact:true}).click();await page.locator('.vta-demo-wallet').waitFor();await page.screenshot({path:OUT+'/vta-wallet-'+width+'.png',fullPage:true});const over=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);if(over>1||errors.length)throw Error(JSON.stringify({over,errors}));rows.push({width,prelisting:'blocked',autoEstimate:estimate,retry:'one fill',reload:'persisted',wallet:await page.locator('.vta-demo-wallet').innerText(),errors,over});simNow=VOLTORA.listingAt-1000;await ctx.close();}}finally{fs.writeFileSync(OUT+'/vta-browser.json',JSON.stringify({rows,saleRequests,uniqueSales:keys.size},null,2));await browser.close();server.close();}console.log(JSON.stringify({rows,saleRequests,uniqueSales:keys.size}));})().catch(e=>{console.error(e);process.exitCode=1;});