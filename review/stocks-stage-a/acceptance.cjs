'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run({OUT,cleanups,users,password,fixture,apiOrigin,docker,api,gateway,pg,NODE}){
  const {pagesWorker,originProxy,APP,API}=await import('../../services/stocks-global/edge-transport/test-support.mjs');
  const proxy=await originProxy({after:fn=>cleanups.push(fn)},4438,{apiOrigin,preserveClientIp:true});assert.ok(proxy.mode.startsWith('real Nginx TLS'));
  let captured;
  const mf=await pagesWorker({after:fn=>cleanups.push(fn)},{outbound:async request=>{captured=request.clone();return proxy.outbound(request);}});
  const login=async index=>{const r=await proxy.tlsFetch(new Request(API+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:users[index]+'@example.invalid',password})}));assert.equal(r.status,200,'ordinary compiled VOLTEX login');return(await r.json()).token;};
  const tokens=[await login(0),await login(1)];
  const send=(token,route='catalogue',init={})=>mf.dispatchFetch(APP+'/__stocks_global/'+route,{...init,headers:{host:new URL(APP).host,authorization:'Bearer '+token,...init.headers}});
  const checks={normalLogin:true};
  for(const token of tokens){const r=await send(token);assert.equal(r.status,200);const data=await r.json();assert.ok(data.catalogue.length>0);assert.ok(data.catalogue.every(row=>!row.online&&row.display===null),'no provider rights -> no fabricated prices');const s=await send(token,'state?id=BYBIT%3AAAPLXUSDT');assert.equal(s.status,200);const state=await s.json();assert.equal(state.account.canTrade,false);assert.deepEqual(state.quotes,{});for(const verb of ['orders','cancel','refresh','balances'])assert.equal((await send(token,verb,{method:'POST',headers:{origin:APP}})).status,403);}
  checks.bothReadersCatalogueTerminalAndFinanceOff=true;
  await send(tokens[0]);assert.ok(captured);assert.equal((await proxy.outbound(captured.clone())).status,403,'captured HMAC/nonce replay denied');
  assert.equal((await proxy.tlsFetch(new Request(API+'/__stocks_global/catalogue',{headers:{authorization:'Bearer '+tokens[0],origin:APP}}))).status,403,'valid JWT without transport HMAC denied');
  assert.equal((await proxy.tlsFetch(new Request(API+'/api/v1/stocks-test-cash/identity',{headers:{authorization:'Bearer '+tokens[0]}}))).status,404);
  assert.equal((await send(tokens[0].slice(0,-4)+'xxxx')).status,401);
  checks.forgeryReplayAndPrivateAuthorityDenied=true;
  // Independent container on the run's internal bridge sees no host-loopback listeners.
  const probe=`const net=require('net');(async()=>{for(const p of [4437,4438,13020])await new Promise((r,j)=>{const s=net.connect(p,'host.docker.internal');s.setTimeout(3000,()=>{s.destroy();j(Error('TIMEOUT_NOT_PROOF'))});s.once('connect',()=>{s.destroy();j(Error('PRIVATE_PORT_EXPOSED '+p))});s.once('error',e=>['ECONNREFUSED','EACCES','EPERM','ENETUNREACH'].includes(e.code)?r():j(e));});console.log('PRIVATE_PORTS_DENIED');})().catch(e=>{console.error(e.message);process.exitCode=1;});`;
  assert.match(docker(['run','--rm','--network',JSON.parse(docker(['inspect',api]))[0].HostConfig.NetworkMode,'--add-host','host.docker.internal:host-gateway',NODE,'node','-e',probe]),/PRIVATE_PORTS_DENIED/);checks.privatePortsDenied=true;
  const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE||'playwright');const browser=await chromium.launch();cleanups.push(()=>browser.close());
  const browserErrors=[];
  const dist=path.resolve('frontend/dist');
  const openContext=async(width,onFinancial=()=>{})=>{
    const context=await browser.newContext({viewport:{width,height:width===390?844:900},locale:'ru-RU',serviceWorkers:'block'});
    await context.addInitScript(()=>localStorage.setItem('exchange_lang','ru'));
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.pathname.startsWith('/__stocks_global/')&&req.method()==='POST')onFinancial();
      if(url.origin===APP&&url.pathname.startsWith('/__stocks_global/')){const r=await mf.dispatchFetch(req.url(),{method:req.method(),headers:{...req.headers(),host:new URL(APP).host},...(req.postData()?{body:req.postData()}:{} )});return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});}
      if(url.origin===API){const r=await proxy.tlsFetch(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{} )}));return route.fulfill({status:r.status,headers:{...Object.fromEntries(r.headers),'access-control-allow-origin':APP},body:Buffer.from(await r.arrayBuffer())});}
      if(url.origin===APP){let f=path.resolve(dist,'.'+decodeURIComponent(url.pathname));if(!f.startsWith(dist+path.sep)&&f!==dist)return route.abort();if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(dist,'index.html');const ext=path.extname(f);return route.fulfill({status:200,body:fs.readFileSync(f),contentType:({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[ext]||'text/html'});}
      return route.abort();
    });
    return context;
  };
  for(const [index,width]of [[0,1440],[1,390]]){
    let financialPosts=0;const context=await openContext(width,()=>financialPosts++);
    const page=await context.newPage();page.on('pageerror',e=>browserErrors.push(e.message));
    await page.goto(APP+'/stocks');await page.locator('#login-email').fill(users[index]+'@example.invalid');await page.locator('#login-password').fill(password);await Promise.all([page.waitForURL(/\/stocks/),page.locator('.vx-auth-submit').click()]);
    await page.locator('a[href*="/stocks/"]').first().waitFor({timeout:30000});await page.screenshot({path:path.join(OUT,'catalogue-'+width+'.png')});
    await page.goto(APP+'/stocks/BYBIT%3AAAPLXUSDT');await page.locator('.vxg-plot').waitFor({timeout:30000});
    if(width===390)await page.locator('.vxg-mobile-tabs button').filter({hasText:'Торговля'}).click();
    for(const side of ['Купить','Продать'])for(const type of ['Market','Limit']){await page.locator('.vxg-sides button').filter({hasText:side}).click();await page.locator('.vxg-order-types button').filter({hasText:type}).click();if(type==='Limit')await page.getByLabel('Цена',{exact:true}).fill('99');await page.getByLabel('Количество',{exact:true}).fill('0.1');const draft=await page.locator('.vxg-ticket form input').evaluateAll(xs=>xs.map(x=>x.value));await page.locator('.vxg-submit').click();await page.getByLabel('Количество',{exact:true}).press('Enter');await pause(100);assert.deepEqual(await page.locator('.vxg-ticket form input').evaluateAll(xs=>xs.map(x=>x.value)),draft);}
    assert.equal(financialPosts,0,'BUY/SELL must emit no financial POST');assert.equal(await page.locator('.vxg-error,.vxg-success').count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
    await page.screenshot({path:path.join(OUT,'terminal-'+width+'.png')});await context.close();
  }
  assert.deepEqual(browserErrors,[]);checks.desktop1440Mobile390AndSilentButtons=true;
  // Normal logout then a fresh login, and explicit server-side revocation.
  const logout=await proxy.tlsFetch(new Request(API+'/api/v1/auth/logout',{method:'POST',headers:{authorization:'Bearer '+tokens[0]}}));assert.equal(logout.status,200);assert.equal((await send(tokens[0])).status,401);tokens[0]=await login(0);assert.equal((await send(tokens[0])).status,200);
  fixture('revoke');assert.equal((await send(tokens[0])).status,401);tokens[0]=await login(0);assert.equal((await send(tokens[0])).status,200);checks.logoutReloginSessionRevocation=true;
  for(const endpoint of ['me','balances','orders/me','futures/positions'])assert.equal((await proxy.tlsFetch(new Request(API+'/api/v1/'+endpoint,{headers:{authorization:'Bearer '+tokens[0]}}))).status,200,endpoint+' regression');
  checks.cryptoReadPaths=true;
  const startReaders=async()=>{
    const contexts=[];
    for(let i=0;i<2;i++){
      const context=await openContext(1440,()=>{throw Error('BENCHMARK_FINANCIAL_POST');});contexts.push(context);
      await context.addInitScript(token=>localStorage.setItem('exchange_token',token),tokens[i]);
      const page=await context.newPage();await page.goto(APP+'/stocks/BYBIT%3AAAPLXUSDT');await page.locator('.vxg-plot').waitFor({timeout:30000});
    }
    return async()=>{for(const context of contexts)await context.close();};
  };
  return{checks,tokens,mf,proxy,startReaders,bridge:'Browser isolated DNS/asset bridge -> actual workerd -> real CA-pinned Nginx TLS -> Docker gateway -> compiled production-base API -> new PG18.6',realQuotes:false};
}
module.exports={run};
