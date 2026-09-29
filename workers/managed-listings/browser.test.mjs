// Actual production React routes + actual authenticated Express adapter + actual
// Cloudflare SQLite Worker. Only unrelated accounts/venue feeds are fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { mkdtemp,mkdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
const require=createRequire(import.meta.url),express=require('express'),jwt=require('jsonwebtoken');
const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE||'C:/Users/nazar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
process.env.JWT_SECRET='managed-listings-local-browser-auth-0001';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {adminListingsRouter}=require(path.join(root,'dist/api/routes/adminListings'));
const {ListingsStore}=require(path.join(root,'dist/services/managedListings/store'));
const {nrxPublicResponse}=require(path.join(root,'dist/services/testMarkets/nrxPublic'));
const {VOLTORA}=require(path.join(root,'dist/services/testMarkets/testAssetConfig'));
const {publicTestAsset}=require(path.join(root,'dist/services/testMarkets/testMarketService'));
const out=path.join(root,'docs/qa/managed-listings');await mkdir(out,{recursive:true});
const bundled=await build({entryPoints:[fileURLToPath(new URL('./src/index.js',import.meta.url))],bundle:true,write:false,format:'esm',external:['cloudflare:*']});
const persist=await mkdtemp(path.join(tmpdir(),'listings-browser-')),secret='browser-fixture-listings-secret-0001';
let forbiddenIO=0,financialWrites=0;
const mf=new Miniflare({...convertV4MiniflareOptions({durableObjectsPersist:persist,workers:[{name:'managed',modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-09-01',bindings:{LISTINGS_STORE_TOKEN:secret},durableObjects:{MANAGED_LISTINGS:{className:'ManagedListingsDO',useSQLite:true}},outboundService:()=>{forbiddenIO++;throw Error('Forbidden IO');}}]}),resourcePersistencePath:persist,isolatedResourcePersistencePath:persist,telemetry:{enabled:false}});
const store=new ListingsStore('https://listings.qa.invalid',secret,(url,init)=>mf.dispatchFetch(String(url),init));
const db={user:{findUnique:async({where})=>({id:where.id,role:where.id==='fixture-admin'?'ADMIN':'USER'})},$transaction:()=>{financialWrites++;throw Error('No financial writes allowed');}};
const app=express();app.use(express.json({limit:'110kb'}));app.use('/api/v1',adminListingsRouter(db,async()=>[{pair:'BTC/USDT'},{pair:'ETH/USDT'}],()=>store));
app.use(express.static(path.join(root,'output/managed-listings/dist'),{index:false}));app.get('*',(_,res)=>res.sendFile(path.join(root,'output/managed-listings/dist/index.html')));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(process.platform==='win32'?{channel:'msedge',headless:true}:{headless:true});
const report=[],png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const ticker={pair:'BTC/USDT',lastPrice:'65000',bidPrice:'64999',askPrice:'65001',high24h:'66000',low24h:'64000',volume24h:'100',quoteVolume24h:'6500000',changePercent24h:'1.2'};
async function contextFor(width,role='admin'){
  const context=await browser.newContext({viewport:{width,height:width===1440?1000:844}});
  await context.addInitScript(({token})=>{localStorage.setItem('exchange_token',token);localStorage.setItem('voltex_lang','ru');},{token:jwt.sign({sub:role==='admin'?'fixture-admin':'fixture-user'},process.env.JWT_SECRET)});
  await context.routeWebSocket('**/*',ws=>ws.close());
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>{errors.push(String(e));console.log('PAGE ERROR',String(e));});
  page.on('requestfailed',r=>{if(r.url().startsWith(origin))console.log('LOCAL REQUEST FAILED',r.url(),r.failure());});
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname;requests.push({host:url.hostname,path:p,method:req.method()});
    const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(url.origin==='https://listings.qa.invalid'){
      assert.ok(['GET','HEAD','OPTIONS'].includes(req.method()));assert.equal(req.headers().authorization,undefined);
      const res=await mf.dispatchFetch(req.url(),{method:req.method(),headers:{Origin:origin}});return route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:await res.text()});
    }
    if(url.origin===origin&&p.startsWith('/api/v1/admin/listings'))return route.continue();
    if(url.origin===origin&&!p.startsWith('/api/v1/'))return route.continue();
    if(url.hostname==='market.voltextech.net'&&p.toUpperCase().includes('NRX')){
      const res=nrxPublicResponse(new Request(req.url()));return route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:await res.text()});
    }
    if(!['GET','HEAD','OPTIONS'].includes(req.method())){financialWrites++;return json({error:'No writes in QA'},403);}
    if(p==='/api/v1/me')return json({id:role==='admin'?'fixture-admin':'fixture-user',role:role==='admin'?'ADMIN':'USER',isAdmin:role==='admin',email:'fixture@example.invalid',kycStatus:'APPROVED'});
    if(p==='/api/v1/market/test-assets')return json({serverTime:Date.now(),assets:[publicTestAsset(VOLTORA,Date.now())]});
    if(p==='/api/v1/market/display/spot-snapshot')return json({_display:{mode:'snapshot',capturedAt:Date.now(),refreshMs:60000},tickers:{available:true,source:'fixture',fetchedAt:Date.now(),stale:false,value:[ticker]},overview:{available:false},sentiment:{available:false}});
    if(p==='/api/v1/market/external/tickers')return json({tickers:[ticker]});
    if(p==='/api/v1/market/external/symbols')return json([{pair:'BTC/USDT',base:'BTC',quote:'USDT'}]);
    if(p==='/api/v1/market/assets/icons')return json({icons:{}});
    if(p==='/api/v1/market/external/rankings')return json({rankings:[]});
    if(p==='/api/v1/balances')return json([{asset:'USDT',available:'0',locked:'0'}]);
    if(p==='/api/v1/private-trading/access')return json({allowed:false});
    if(p==='/api/v1/support/conversations/mine')return json({conversation:null});
    if(p==='/api/v1/market/live')return route.fulfill({status:204,body:''});
    if(p==='/api/v1/market/snapshot')return json({pairs:[],fetchedAt:Date.now()});
    if(p==='/api/v1/futures/config')return json({symbols:[]});
    if(p.startsWith('/api/v1/'))return json([]);
    return route.abort();
  });
  return {context,page,errors,requests};
}
try{
  for(const width of [1440,390]){
    const {context,page,errors,requests}=await contextFor(width),symbol=width===1440?'QATHIRD':'QAFOURTH';
    await page.goto(origin+'/admin/listings');await page.getByRole('button',{name:'Создать листинг',exact:true}).waitFor();
    await page.getByRole('button',{name:'Создать листинг',exact:true}).click();
    await page.getByLabel('Название',{exact:true}).fill(`Orbit ${width}`);await page.getByLabel('Тикер',{exact:true}).fill(symbol);
    await page.getByLabel('Начальная цена').fill('0.025');await page.getByLabel('Owner allocation').fill('12000');
    await page.getByLabel('Дата и время').fill(new Date(Date.now()+35_000).toISOString().slice(0,19));
    await page.locator('input[type=file]').setInputFiles({name:'orbit.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.getByRole('button',{name:'Создать черновик',exact:true}).click();await page.getByText('Черновик сохранён. Баланс не изменён.').waitFor();
    const rows=await store.call('/admin/listings'),draft=rows.find(r=>r.ticker===symbol);assert.equal(draft.status,'draft');assert.ok(draft.seed);
    assert.equal((await mf.dispatchFetch(`https://listings.qa.invalid/market/test-assets/${symbol}-USDT`)).status,404);
    await page.getByRole('button',{name:'Preview',exact:true}).click();await page.locator('.listing-preview svg').waitFor();
    await page.screenshot({path:path.join(out,`admin-preview-${width}.png`),fullPage:true});
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Publish',exact:true}).click();await page.getByText('Листинг опубликован. Начисление выполняется отдельно.').waitFor();
    assert.equal((await store.call(`/admin/listings/${draft.id}`)).seed,draft.seed);
    await page.getByRole('link',{name:'Открыть рынок ↗'}).click();
    await page.locator('.vta-countdown').waitFor();
    await page.goto(origin+'/markets');const row=page.locator(`.test-market-row[data-pair="${symbol}/USDT"]`);await row.waitFor();
    await row.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`markets-${width}.png`)});
    // Use the actual market row navigation, not a specially built preview terminal.
    await row.locator('.test-market-open').click();await page.waitForURL(/\/trade\?/);
    console.log('Opened market',width,page.url(),draft.listingAt,new Date().toISOString());
    await page.locator('.vta-countdown').waitFor();
    assert.match(await page.locator('.vta-prelisting').innerText(),new RegExp(symbol));
    await page.screenshot({path:path.join(out,`countdown-${width}.png`)});
    await page.locator('.chart-area canvas').first().waitFor({state:'visible',timeout:45000});
    if(width===390)await page.locator('.terminal-mobile-chart-tabs').getByRole('button',{name:'Стакан',exact:true}).click();
    await page.locator('.ob-row').first().waitFor({state:'visible',timeout:15000});
    assert.ok(requests.some(r=>r.host==='listings.qa.invalid'&&r.path.includes('/candles')));
    const live=await(await mf.dispatchFetch(`https://listings.qa.invalid/market/test-assets/${symbol}-USDT`)).json();assert.equal(live.state.phase,'live');
    await page.getByRole('tab',{name:'Сделки',exact:true}).click();await page.locator('.nrx-tape-row:not(.nrx-tape-labels)').first().waitFor();
    await page.screenshot({path:path.join(out,`live-${width}.png`)});
    const candlesBefore=await(await mf.dispatchFetch(`https://listings.qa.invalid/market/test-assets/${symbol}-USDT/candles?interval=5m`)).json();
    await page.reload();await page.locator('.chart-area canvas').first().waitFor();
    const other=await contextFor(width,'user');await other.page.goto(origin+`/trade?pair=${symbol}%2FUSDT`);await other.page.locator('.chart-area canvas').first().waitFor();
    const candlesAfter=await(await mf.dispatchFetch(`https://listings.qa.invalid/market/test-assets/${symbol}-USDT/candles?interval=5m`)).json();
    assert.ok(candlesBefore.candles.length && candlesAfter.candles.length);
    assert.equal(candlesBefore.candles[0].time,candlesAfter.candles[0].time);
    assert.equal(candlesBefore.candles[0].open,candlesAfter.candles[0].open);
    assert.deepEqual(candlesAfter.candles.slice(0,-1),candlesBefore.candles.slice(0,-1));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(other.errors,[]);
    assert.equal(requests.filter(r=>r.host!=='listings.qa.invalid'&&r.path.includes(symbol)&&r.path.startsWith('/api/v1/market')).length,0);
    report.push({width,symbol,create:true,preview:true,publish:true,draftPrivate:true,stableSeed:true,marketsNavigation:true,automaticLive:true,chart:true,tape:true,reload:true,otherBrowser:true,errors,financialWrites,forbiddenIO});
    await context.close();await other.context.close();
  }
  assert.equal(financialWrites,0);assert.equal(forbiddenIO,0);
  await writeFile(path.join(out,'browser-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){for(const [i,context] of browser.contexts().entries())for(const [j,page] of context.pages().entries()){
  await page.screenshot({path:path.join(out,`failure-${i}-${j}.png`),fullPage:true}).catch(()=>{});
  await writeFile(path.join(out,`failure-${i}-${j}.txt`),page.url()+'\n'+await page.locator('body').innerText());
}throw error;}finally{await browser.close();server.close();await mf.dispose();}
