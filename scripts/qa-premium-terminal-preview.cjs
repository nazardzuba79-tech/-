/* Local visual review only. All market/account values below are isolated fixtures.
 * No production connections or financial writes are permitted. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const playwright = process.env.QA_PLAYWRIGHT_MODULE || 'playwright';
process.env.QA_PLAYWRIGHT_MODULE = playwright;
const phase = process.env.PREVIEW_PHASE || 'after';
const out = path.join(root, 'docs/qa/premium-terminals-preview');
fs.mkdirSync(out, {recursive:true});
// Reuse the repository's existing read-only terminal API fixtures.
let source = fs.readFileSync(path.join(__dirname, 'qa-spot-cfd-terminal.cjs'), 'utf8').split('const DESKTOP =')[0];
source = source.replace("path.resolve(__dirname, '../frontend/dist')", 'process.env.PREVIEW_DIST || path.resolve(__dirname, "../frontend/dist")');
source = source.replace("app.use('/api/v1',(_q,r)=>r.json([]));", `
app.get('/api/v1/cfd/display/tickers',(_q,r)=>r.json({configured:true,tickers:[
 {symbol:'XAUUSD',name:'Gold Spot',price:'2650.30',changePercent24h:'0.4',status:'sampled',marketClosed:false,asOf:Date.now(),fetchedAt:Date.now(),providerTimestamp:Date.now()},
 {symbol:'WTIUSD',name:'Crude Oil WTI',price:'72.18',changePercent24h:'-0.85',status:'market_closed',marketClosed:true,asOf:Date.now(),fetchedAt:Date.now(),providerTimestamp:Date.now()}
]}));
app.get('/api/v1/cfd/display/candles/:s',(_q,r)=>r.json({candles:CANDLES.map((c,i)=>({...c,open:2640+Math.sin(i/8)*12+i*.06,close:2640+Math.sin((i+1)/8)*12+i*.06,high:2655+Math.sin(i/8)*12+i*.06,low:2635+Math.sin(i/8)*12+i*.06})),source:'isolated QA',stale:false}));
app.use('/api/v1',(_q,r)=>r.status(503).json({error:'Unavailable in isolated preview'}));`);
source = source.replace('const app = express();', `const app = express();
app.use((q,r,next)=>{if(!['GET','HEAD'].includes(q.method))return r.status(403).json({error:'Preview: financial writes blocked'});next();});
app.use((q,r,next)=>{const json=r.json.bind(r);r.json=body=>{if(q.path.includes('/display')&&body&&typeof body==='object')body._display={mode:'snapshot',capturedAt:Date.now(),refreshMs:q.path.includes('/cfd/')?21600000:60000};return json(body);};next();});
app.use('/review',express.static(${JSON.stringify(out)}));`);
source=source.replace("app.get('/api/v1/me'", `
app.get('/api/v1/cfd/config',(_q,r)=>r.json({minLeverage:1,maxLeverage:100,highLeverageWarningThreshold:25,leverageTiers:[{notionalCap:null,maxLeverage:100,maintenanceMarginRate:0.005,maintenanceAmount:0}]}));
const tickerRows=PAIRS.map(pair=>({pair,lastPrice:'84890.10',bidPrice:'84880.0',askPrice:'84890.2',high24h:'85954.60',low24h:'83535.00',changePercent24h:'1.25',quoteVolume24h:'3190000000',volume24h:'15000'}));
app.get('/api/v1/market/display/spot-snapshot',(q,r)=>r.json({tickers:{available:true,value:tickerRows,source:'isolated QA',fetchedAt:Date.now(),stale:false},overview:{available:false,reason:'fixture'},sentiment:{available:false,reason:'fixture'}}));
app.get('/api/v1/market/display',(q,r)=>r.json({version:1,type:'snapshot',status:'live',sequence:1,quotes:tickerRows.map(t=>({...t,id:'linear_perpetual:'+t.pair.replace('/',''),symbol:t.pair,providerSymbol:t.pair.replace('/',''),marketType:'linear_perpetual',provider:'bybit',lastPrice:Number(t.lastPrice),high24h:Number(t.high24h),low24h:Number(t.low24h),changePercent24h:1.25,quoteVolume24h:3190000000,volume24h:15000,markPrice:84887.45,indexPrice:84123.99,receivedAt:Date.now(),fetchedAt:Date.now(),stale:false}))}));
app.get('/api/v1/market/external/candles/:pair',(q,r)=>r.json({pair:q.params.pair.replace('-','/'),interval:q.query.interval,candles:CANDLES.map((c,i)=>({...c,open:84000+Math.sin(i/8)*600+i*4,close:84000+Math.sin((i+1)/8)*600+i*4,high:84800+Math.sin(i/8)*600+i*4,low:83400+Math.sin(i/8)*600+i*4}))}));
app.get('/api/v1/market/futures/candles/:pair',(q,r)=>r.json({retCode:0,result:{category:'linear',symbol:q.params.pair.replace('-',''),list:CANDLES.map((c,i)=>[String(c.time*1000),String(84000+Math.sin(i/8)*600+i*4),String(84800+Math.sin(i/8)*600+i*4),String(83400+Math.sin(i/8)*600+i*4),String(84000+Math.sin((i+1)/8)*600+i*4),'12','1000000']).reverse()}}));
app.get('/api/v1/market/display/spot-book/:pair',(q,r)=>r.json({pair:q.params.pair.replace('-','/'),fetchedAt:Date.now(),bids:Array.from({length:18},(_,i)=>({price:String(84880-i*.1),quantity:String(.001+i*.015)})),asks:Array.from({length:18},(_,i)=>({price:String(84890+i*.1),quantity:String(.004+i*.011)}))}));
app.get('/api/v1/cfd/display/candles/:s',(q,r)=>r.json({symbol:q.params.s,interval:q.query.interval,fetchedAt:Date.now(),bars:CANDLES.map((c,i)=>({openTime:c.time*1000,open:2640+Math.sin(i/8)*12+i*.06,close:2640+Math.sin((i+1)/8)*12+i*.06,high:2655+Math.sin(i/8)*12+i*.06,low:2635+Math.sin(i/8)*12+i*.06,volume:100+i}))}));
app.get('/api/v1/me'`);
const sandbox = {require:createRequire(__filename),__dirname,process,console,URL,setTimeout,clearTimeout};
source=source.replace('quotes:tickerRows.map','rows:tickerRows.map').replace("marketType:'linear_perpetual',provider:'bybit',lastPrice:Number(t.lastPrice)","marketType:'linear_perpetual',provider:'bybit',baseAsset:t.pair.split('/')[0],quoteAsset:'USDT',settleAsset:'USDT',lastPrice:Number(t.lastPrice)");
vm.runInNewContext(source + '\nthis.previewApp=app;', sandbox);
const server = sandbox.previewApp.listen(Number(process.env.PREVIEW_PORT || 4266),'127.0.0.1');
const sizes = [[1366,768],[1440,900],[1920,1080],[390,844],[430,932]];
const report = {phase,fixture:true,results:[],errors:[],blockedExternal:[],writes:[],requests:[],interactions:[]};
const {chromium} = require(playwright);
let browser;
function visualCandles(price, interval) {
 const seconds = ({'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400})[interval] || 3600;
 let seed=73, close=price*.985;
 const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 return Array.from({length:180},(_,i)=>{const open=close;close+=price*((random()-.48)*.002+Math.sin(i/19)*.00015);return {time:Math.floor(Date.now()/1000/seconds)*seconds-(180-i)*seconds,open,close,high:Math.max(open,close)+random()*price*.0005,low:Math.min(open,close)-random()*price*.0005,volume:2+random()*30};});
}
async function step(page,name,action){try{await action();report.interactions.push({name,result:'PASS'});}catch(e){report.interactions.push({name,result:'FAIL',error:e.message});}}
async function interactions(page,market,width){
 const prefix=market+'-'+width;
 const shot=label=>page.screenshot({path:path.join(out,phase+'-'+prefix+'-'+label+'.png')});
 if(width<901){const tab=page.locator('#mobile-trade-trade, #mobile-futures-trade');await tab.first().click();}
 const family=page.locator(market==='futures'?'.fo-panel .order-family-tabs [role=tab]':market==='spot'?'.order-type-tab':'.cfd-order-panel .order-family-tabs button');
 await step(page,prefix+' order-type selection',async()=>{for(let i=0;i<await family.count();i++){const b=family.nth(i);if(await b.isEnabled()){await b.click();await page.waitForTimeout(50);}}if(await family.count())await family.nth(market==='cfd'?1:0).click();});
 if(market==='futures'){
  await step(page,prefix+' margin/leverage dialogs within viewport',async()=>{for(const index of [0,1]){await page.locator('.fo-mlTrigger').nth(index).click();const pop=page.locator('.fo-mlPopover');await pop.waitFor();const box=await pop.boundingBox();if(box.x<0||box.x+box.width>width+1)throw Error('Popover clipped horizontally');await shot('margin-leverage-'+index);await page.locator('.fo-mlTrigger').nth(index).click();}});
  // #328 replaced the expanding TP/SL card with a checkbox beside «Только уменьшение».
  await step(page,prefix+' quantity, TP/SL and reduce-only',async()=>{await page.locator('.fo-qtyInputRow input').fill('0.01');const tp=page.locator('.fo-tpslToggle input');await tp.check();await page.locator('[data-entry-take-profit]').waitFor();await shot('tpsl');await tp.uncheck();const reduce=page.locator('.fo-reduceOnlyRow input');await reduce.check();if(!await tp.isDisabled())throw Error('TP/SL must be unavailable on a reduce-only order');await reduce.uncheck();});
  await step(page,prefix+' margin, leverage and percentage selection',async()=>{
   await page.locator('.fo-mlTrigger').first().click();await page.locator('.fo-mlMode').first().click();
   await page.locator('.fo-mlTrigger').first().click();await page.locator('.fo-mlMode').nth(1).click();
   await page.locator('.fo-mlTrigger').nth(1).click();await page.locator('.fo-mlChip').filter({hasText:/^5x$/}).click();
   const range=page.locator('.percent-slider-continuous input[type=range]');await range.fill('25');
   if(!(Number(await page.locator('.fo-qtyInputRow input').inputValue())>0))throw Error('Percentage quantity not updated');
   await page.locator('.fo-qtyInputRow input').fill('0.01');await shot('sizing');
  });
  await step(page,prefix+' positions actions visible',async()=>{if(width<901)await page.locator('#mobile-futures-positions').click();const rows=page.locator('.futures-positions-table tbody tr');if(!await rows.count())throw Error('Seeded position missing');await shot('positions');if(width<901)await page.locator('#mobile-futures-trade').click();});
 }else if(market==='spot'){
  await step(page,prefix+' buy/sell, quantity and percentage sizing',async()=>{for(const index of [1,0]){const b=page.locator('.order-form-tab').nth(index);await b.click();if(await b.getAttribute('aria-pressed')!=='true')throw Error('Side did not select');}const inputs=page.locator('.order-form-content input[type=number]');await inputs.nth(0).fill('84890.1');await inputs.nth(1).fill('0.01');await page.locator('.slider-step[aria-label="25%"] ').click();if(!(Number(await inputs.nth(1).inputValue())>0))throw Error('Percentage did not size quantity');await shot('sizing');});
  if(width===1440)await step(page,prefix+' order book click fills price',async()=>{const row=page.locator('.ob-row').first();await row.click();const price=Number(await page.locator('.order-form-content input[type=number]').first().inputValue());if(!(price>84000))throw Error('Book price was not selected');});
 }else{
  await step(page,prefix+' long/short leverage and quantity',async()=>{await page.locator('.cfd-sideTab').nth(1).click();if(await page.locator('.cfd-sideTab').nth(1).getAttribute('aria-pressed')!=='true')throw Error('Short not selected');await page.locator('.cfd-sideTab').nth(0).click();await page.locator('.cfd-form input[type=number]').fill('0.01');await page.locator('.leverage-control button').filter({hasText:/^5x$/}).click();await shot('sizing');});
 }
 await step(page,prefix+' CTA reachable and support does not cover action',async()=>{
  const cta=page.locator('.submit-btn, .cfd-submit').first();await cta.scrollIntoViewIfNeeded();
  // Browser viewport-only scrolling ignores a fixed bottom navigation bar.
  // Centre via normal scrolling, then verify the button is actually exposed.
  await cta.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  const clear=await cta.evaluate(el=>{const r=el.getBoundingClientRect();return [0.15,.5,.85].every(f=>{const hit=document.elementFromPoint(r.x+r.width*f,r.y+r.height/2);return hit===el||el.contains(hit);});});
  if(!clear){await shot('cta-overlap');const diagnostic=await cta.evaluate(el=>{const r=el.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,220),scrollHeight:document.documentElement.scrollHeight,innerHeight};});throw Error('CTA covered or clipped '+JSON.stringify(diagnostic));}
 });
 if(width===1440){
  await step(page,prefix+' instrument switch',async()=>{const item=page.locator(market==='cfd'?'.cfd-option':'.pair-row').nth(1);if(await item.count()&&await item.isVisible()){await item.click();await shot('instrument');}else if(market==='futures'){await page.locator('.pair-selector').first().click();await shot('instruments');await page.keyboard.press('Escape');}else throw Error('Instrument selector unavailable');});
 }
}
let nativeFixture;
async function ensureNativeFixture(){
 // Futures reads the disposable native demo fixture (never production). Start
 // it here when nothing is listening yet, so the script runs on its own in CI.
 const health=async()=>{try{const h=await(await fetch('http://127.0.0.1:4267/health')).json();return h.fixtureMarket&&h.kind==='isolated-native-demo-preview';}catch{return false;}};
 if(await health())return;
 const {spawn}=require('node:child_process');
 nativeFixture=spawn(process.execPath,[path.join(__dirname,'serve-native-demo-review.cjs')],{cwd:root,env:{...process.env,PORT:'4267',NATIVE_PREVIEW_FIXTURE:'1'},stdio:'ignore'});
 for(let i=0;i<60;i++){if(await health())return;await new Promise(r=>setTimeout(r,500));}
 throw Error('Disposable native fixture did not start on :4267');
}
(async()=>{
 await new Promise(r=>server.listening?r():server.once('listening',r));
 if(!process.env.PREVIEW_MARKET||process.env.PREVIEW_MARKET==='futures')await ensureNativeFixture();
 const origin='http://127.0.0.1:'+server.address().port;
 if(process.env.PREVIEW_SERVE==='1'){console.log('ISOLATED PREVIEW '+origin);return;}
 browser=await chromium.launch({headless:true});
 for(const [market,url] of [['spot','/trade'],['futures','/futures'],['cfd','/trade?market=cfd']]){
  if(process.env.PREVIEW_MARKET && market!==process.env.PREVIEW_MARKET)continue;
  const matrix=process.env.PREVIEW_VIEWPORT?[process.env.PREVIEW_VIEWPORT.split('x').map(Number)]:process.env.PREVIEW_SMOKE==='1'?[[1440,900]]:market==='futures'?[...sizes,[320,700],[393,852],[768,1024]]:sizes;
  for(const [width,height] of matrix){
   // Explicit locale: a container LANG such as `en-US@posix` is rejected by Intl
   // and would otherwise be reported as a page error of the terminal itself.
   const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'en-US'});
   let scenario='normal';
   await ctx.addInitScript(()=>{localStorage.setItem('exchange_token','local-premium-preview');localStorage.setItem('exchange_lang','ru');});
   let nativeToken;
   if(market==='futures'){
    const native='http://127.0.0.1:4267';
    const health=await (await ctx.request.get(native+'/health')).json();
    if(!health.fixtureMarket||health.kind!=='isolated-native-demo-preview')throw Error('Native QA server must be isolated');
    const html=await(await ctx.request.get(native+'/futures')).text();
    nativeToken=JSON.parse(/localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html)[1]);
    const headers={Authorization:'Bearer '+nativeToken};
    const state=await(await ctx.request.get(native+'/api/v1/private-trading/native/state',{headers})).json();
    if(!state.initialized)await ctx.request.post(native+'/api/v1/private-trading/native/initialize',{headers,data:{acceptedModel:state.model.version,idempotencyKey:'premium-preview-init'}});
    await ctx.request.post(native+'/api/v1/private-trading/native/commands',{headers,data:{kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'0.01',leverage:'10',idempotencyKey:'premium-preview-position'}});
    await ctx.addInitScript(token=>localStorage.setItem('exchange_token',token),nativeToken);
   }
   await ctx.route('**/*',route=>{
    const req=route.request(),u=new URL(req.url());report.requests.push(u.href);
    if(market==='spot'&&['/api/v1/balances','/api/v1/orders'].includes(u.pathname)){
     if(scenario==='error')return route.fulfill({status:503,json:{error:'Isolated QA unavailable'}});
     if(scenario==='loading')return new Promise(resolve=>setTimeout(resolve,4000)).then(()=>route.fulfill({json:[]}));
    }
    // Deterministic chart-only fixtures, identical for baseline and candidate.
    if(u.pathname.includes('/candles/')){
     const symbol=u.pathname.split('/').pop(),interval=u.searchParams.get('interval');
     const candles=visualCandles(market==='cfd'?(symbol==='WTIUSD'?72.18:2650.3):market==='futures'?50222:84890,interval);
     const json=market==='futures'?{retCode:0,result:{category:'linear',symbol:symbol.replace('-',''),list:candles.map(c=>[String(c.time*1000),String(c.open),String(c.high),String(c.low),String(c.close),String(c.volume)]).reverse()}}:market==='cfd'?{symbol,interval,fetchedAt:Date.now(),bars:candles.map(c=>({...c,openTime:c.time*1000})),_display:{mode:'snapshot',capturedAt:Date.now(),refreshMs:21600000}}:{pair:symbol.replace('-','/'),interval,candles};
     return route.fulfill({json});
    }
    if(market==='spot'&&u.pathname==='/api/v1/balances')return route.fulfill({json:[{asset:'USDT',available:'25000',locked:'0'},{asset:'BTC',available:'0.5',locked:'0'}]});
    if(market==='futures'&&u.pathname.startsWith('/api/v1/')){
     if(!['GET','HEAD'].includes(req.method())&&!u.pathname.endsWith('/native/execution-session')&&!(u.pathname.endsWith('/native/commands')&&req.postDataJSON()?.kind==='REFRESH')){report.writes.push(u.pathname);return route.abort();}
     return route.fetch({url:'http://127.0.0.1:4267'+u.pathname+u.search}).then(response=>route.fulfill({response}));
    }
    if(!['GET','HEAD'].includes(req.method())){report.writes.push(u.pathname);return route.abort();}
    if(u.origin===origin||u.protocol==='data:')return route.continue();
    if(u.pathname.startsWith('/api/v1/')||u.hostname==='market.voltextech.net'){
     const localPath=u.pathname.startsWith('/api/v1/')?u.pathname:'/api/v1'+u.pathname;
     return route.fetch({url:origin+localPath+u.search}).then(response=>route.fulfill({response}));
    }
    report.blockedExternal.push(u.host);return route.abort();
   });
   await ctx.routeWebSocket(/.*/, ws=>ws.onMessage(async message=>{
    try{const request=JSON.parse(String(message));for(const topic of request.args||[]){if(!topic.startsWith('orderbook.'))continue;const symbol=topic.split('.').pop();const book=market==='futures'?await(await ctx.request.get('http://127.0.0.1:4267/api/v1/market/display/futures-book/'+symbol)).json():null;ws.send(JSON.stringify({topic,type:'snapshot',ts:Date.now(),data:{s:symbol,u:1,seq:1,b:book?.bids?.map(r=>[r.price,r.quantity])||Array.from({length:25},(_,i)=>[String(84880-i*.1),String(.001+i*.015)]),a:book?.asks?.map(r=>[r.price,r.quantity])||Array.from({length:25},(_,i)=>[String(84890+i*.1),String(.004+i*.011)])}}));}}catch{}
   }));
   const page=await ctx.newPage();page.setDefaultTimeout(6000);
   page.on('pageerror',e=>report.errors.push({market,width,error:e.message}));
   await page.goto(origin+url,{waitUntil:'domcontentloaded'});
   await page.locator('.trade-terminal').waitFor();await page.waitForTimeout(1800);
   const key=market+'-'+width+'x'+height;
   await page.screenshot({path:path.join(out,phase+'-'+key+'.png'),fullPage:false});
   const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,classes:document.querySelector('.trade-terminal').className,inputs:[...document.querySelectorAll('input')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({type:e.type,font:getComputedStyle(e).fontSize,height:e.getBoundingClientRect().height})),buttons:[...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.textContent.trim()).slice(-35)}));
   report.results.push({market,width,height,...result});
   if(width<901){
    for(const tab of ['trade','account','positions']){
     const button=page.locator('#mobile-trade-'+tab+', #mobile-futures-'+tab);
     if(await button.count()&&await button.first().isVisible()){
      await button.first().click();await page.waitForTimeout(150);
      await page.screenshot({path:path.join(out,phase+'-'+key+'-'+tab+'.png'),fullPage:false});
     }
    }
   }
   if(width===1440){for(const [label,selector] of Object.entries({header:'.global-header',stats:'.ticker-bar, .futures-ticker-bar, .cfd-ticker-bar',form:'.fo-panel, .order-form-area, .cfd-form-area',positions:'.bottom-panel, .cfd-bottom-panel',book:'.orderbook-area'})){const el=page.locator(selector).first();if(await el.count()&&await el.isVisible())await el.screenshot({path:path.join(out,phase+'-'+market+'-detail-'+label+'.png')});}}
   if(width===1440||width===390)await interactions(page,market,width);
   if(market==='spot'&&width===1440){
    scenario='loading';await page.goto(origin+url,{waitUntil:'domcontentloaded'});await page.locator('.trade-terminal').waitFor();await page.waitForTimeout(300);
    await page.screenshot({path:path.join(out,phase+'-spot-loading.png')});
    scenario='error';await page.goto(origin+url,{waitUntil:'domcontentloaded'});await page.locator('.terminal-account-state[role=alert]').first().waitFor();
    await page.screenshot({path:path.join(out,phase+'-spot-error.png')});
    report.interactions.push({name:'spot error remains visible with retry',result:await page.locator('.terminal-account-retry').count()?'PASS':'FAIL'});
   }
   await ctx.close();console.log(phase+' '+key+' overflow='+result.overflow);
  }
 }
})().catch(e=>{report.errors.push({error:e.stack});process.exitCode=1;}).finally(async()=>{
 if(process.env.PREVIEW_SERVE==='1')return;
 if(browser)await browser.close();server.closeAllConnections();server.close();if(nativeFixture)nativeFixture.kill();
 report.blockedExternal=[...new Set(report.blockedExternal)];
 fs.writeFileSync(path.join(out,phase+'-browser.json'),JSON.stringify(report,null,2));
 const failed=report.interactions.filter(i=>i.result!=='PASS');
 console.log(JSON.stringify({phase,screens:report.results.length,interactions:report.interactions.length,failedInteractions:failed,errors:report.errors,overflows:report.results.filter(r=>r.overflow).map(r=>[r.market,r.width]),writes:report.writes}));
 // A failed interaction, page error or horizontal overflow fails the run.
 if(failed.length||report.errors.length||report.results.some(r=>r.overflow))process.exitCode=1;
});
