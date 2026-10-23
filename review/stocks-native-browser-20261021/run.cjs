// Native browser QA only. Launch server and Chromium as children of THIS process.
// No runtime edits, production credentials, provider requests or financial engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(process.env.STOCKS_BROWSER_SOURCE_ROOT || path.join(__dirname, '../..'));
assert.equal(process.versions.node, '22.23.3', 'Pinned Node runtime required');
const candidate = '5ed0d70b9efd1b2922d9e234fd2546be1468fbfb';
const out = path.resolve(process.env.STOCKS_BROWSER_EVIDENCE || path.join(__dirname, 'evidence'));
fs.mkdirSync(out, { recursive: true });
const pwPath = process.env.STOCKS_PLAYWRIGHT_MODULE;
assert(pwPath, 'Explicit isolated Playwright module required');
const { chromium } = require(pwPath);
const base = 'http://127.0.0.1:4178', terminal = '/stocks/BINANCE%3AAAPLBUSDT';
const results = { candidate, result: 'NOT_RUN', checks: [], externalRequestsBlocked: 0, screenshots: [], browserVersion: null };
let server, browser, page;
const failures = [], stderr = [], stdout = [];
const check = (name, detail = {}) => { results.checks.push({ name, result: 'PASS', ...detail }); console.log('PASS '+name); };
const pause = ms => new Promise(r => setTimeout(r, ms));
const fixtureRoot = path.join(root, 'services/stocks-global/testing/fixtures/venues');
const candleBytes = fs.readFileSync(path.join(fixtureRoot, 'binance-vision/klines_AAPLBUSDT_15m_limit5.json'));
results.candleFixtureSha256 = crypto.createHash('sha256').update(candleBytes).digest('hex');
results.startedAt = new Date().toISOString();
results.node = process.version;
results.playwright = require(path.join(pwPath, 'package.json')).version;
async function json(url, options) { const r=await fetch(base+url, options); return {status:r.status,body:await r.json()}; }
async function evidence() {return (await json('/__qa/evidence')).body;}
async function shot(name) {
  const file = name+'.png';
  await page.screenshot({path:path.join(out,file),fullPage:false,mask:[page.locator('.vxg-ticket > .vxg-available')]});
  results.screenshots.push(file);
}
async function login(label) {
  await page.locator('#login-email').fill(label+'@fixture.invalid');
  await page.locator('#login-password').fill('local-review');
  await Promise.all([page.waitForURL(/\/stocks/),page.locator('.vx-auth-submit').click()]);
}
async function newContext(viewport) {
  const c=await browser.newContext({viewport,locale:'ru-RU',serviceWorkers:'block'});
  await c.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===base||['data:','blob:'].includes(u.protocol))return route.continue();results.externalRequestsBlocked++;return route.abort();});
  await c.addInitScript(()=>{localStorage.setItem('exchange_lang','ru');});
  page=await c.newPage();page.on('pageerror',e=>failures.push(e.message));return c;
}
async function readyChart() {
  await page.mouse.move(1, 1); // Clear crosshair hover before comparing the last captured candle.
  await page.locator('.vxg-ohlc').filter({hasText:'341.49'}).waitFor();
  const legend=await page.locator('.vxg-ohlc').innerText();
  for(const value of ['341.49','341.57','341.42','V'])assert(legend.includes(value),'Missing native OHLCV '+value);
  assert(/0[,.]759/.test(legend),'Missing captured volume');
  assert.equal(await page.locator('.vxg-chart-overlay').count(),0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const pixels=await page.locator('.vxg-plot canvas').evaluateAll(canvases=>{
    let up=0,down=0;
    for(const c of canvases){const g=c.getContext('2d');if(!g)continue;const d=g.getImageData(0,0,c.width,c.height).data;
      for(let i=0;i<d.length;i+=4){if(d[i+3]>30&&d[i+1]>d[i]*1.35&&d[i+1]>d[i+2]*1.1)up++;if(d[i+3]>30&&d[i]>d[i+1]*1.3&&d[i]>d[i+2]*1.1)down++;}}
    return {up,down};
  });
  assert(pixels.up>5&&pixels.down>5,'Candle canvas has not rendered both source directions');
  return {legend,pixels};
}
async function quietSubmitCases(context,label) {
  const requests=[];const listener=req=>{const u=new URL(req.url());if(u.origin===base&&['POST','DELETE'].includes(req.method())&&u.pathname.startsWith('/__stocks_global/')&&!u.pathname.endsWith('/lease'))requests.push({method:req.method(),path:u.pathname});};
  context.on('request',listener);
  const before=await evidence();
  for(const side of ['Купить','Продать'])for(const type of ['Market','Limit']) {
    await page.locator('.vxg-sides button').filter({hasText:side}).click();
    await page.locator('.vxg-order-types button').filter({hasText:type}).click();
    for(const [field,value] of [['Цена','341.46'],['Количество','0.1'],['Итого','34.146']]){const input=page.getByLabel(field,{exact:true});assert(await input.isEditable());await input.fill(value);}
    const draft=await page.locator('.vxg-ticket form input').evaluateAll(inputs=>inputs.map(i=>i.value));
    const messages=await page.locator('.vxg-ticket > .vxg-error,.vxg-ticket > .vxg-success').allTextContents();
    assert(await page.locator('.vxg-submit').isEnabled());
    await page.locator('.vxg-submit').click();
    await page.getByLabel('Количество',{exact:true}).press('Enter');
    await page.getByLabel('Итого',{exact:true}).press('Enter');
    await pause(100);
    assert.deepEqual(await page.locator('.vxg-ticket form input').evaluateAll(inputs=>inputs.map(i=>i.value)),draft);
    assert.deepEqual(await page.locator('.vxg-ticket > .vxg-error,.vxg-ticket > .vxg-success').allTextContents(),messages);
    assert.equal(await page.locator('.vxg-success').count(),0);
  }
  const after=await evidence();assert.deepEqual(requests,[]);assert.equal(after.tradeRequests,before.tradeRequests);assert.deepEqual(after.commands,before.commands);
  context.off('request',listener);check(label+' native click/Enter silent BUY/SELL Market/Limit',{financialRequests:0,combinations:4});
}
(async()=>{
  assert.equal(execFileSync('git',['rev-parse',candidate],{cwd:root,encoding:'utf8'}).trim(),candidate);
  // Harness and shipped application must still match the accepted candidate.
  const changes=execFileSync('git',['diff',candidate,'--','src','frontend/src','services','prisma','package.json','package-lock.json','frontend/package.json','frontend/package-lock.json'],{cwd:root,encoding:'utf8'});
  assert.equal(changes,'','Application/harness drift from candidate');
  results.buildIndexSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'frontend/dist/index.html'))).digest('hex');
  server=spawn(process.execPath,['services/stocks-global/testing/local-access-qa.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test',STOCKS_LOCAL_ACCESS_QA:'true'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',b=>stdout.push(b.toString()));server.stderr.on('data',b=>stderr.push(b.toString()));
  let ready=false;
  for(let i=0;i<50;i++){if(server.exitCode!==null)throw Error('QA_SERVER_EXIT_'+server.exitCode);try{const e=await evidence();assert.equal(e.tradeRequests,0);ready=true;break;}catch{}await pause(100);}
  assert(ready,'SAME_NAMESPACE_READINESS_FAILED');check('same-process namespace readiness');
  browser=await chromium.launch({headless:true});results.browserVersion=browser.version();
  let context=await newContext({width:1440,height:900});
  // Readiness also from Playwright's own API request context, before first navigation.
  assert.equal((await context.request.get(base+'/__qa/evidence')).status(),200);check('browser namespace readiness');
  await page.goto(base+'/');assert(!new URL(page.url()).pathname.startsWith('/login'));assert.equal(await page.locator('.vxg-terminal').count(),0);await shot('guest-home');
  await page.goto(base+terminal);await page.locator('#login-email').waitFor();assert.equal(new URL(page.url()).pathname,'/login');assert.equal(new URL(page.url()).searchParams.get('next'),terminal);assert.equal(await page.locator('.vxg-terminal').count(),0);await shot('guest-login');check('guest normal VOLTEX login and return URL');
  for(const route of ['catalogue','state','history?id=BINANCE%3AAAPLBUSDT','portfolio'])assert.equal((await context.request.get(base+'/__stocks_global/'+route)).status(),401);
  check('guest protected API denied');
  await login('viewer');const chart=await readyChart();check('viewer native captured-data chart',chart);await shot('viewer-chart-desktop');
  await page.locator('nav[aria-label="Навигация Stocks"] a[href="/stocks"]').click();await page.locator('a[href="'+terminal+'"]').waitFor();assert((await page.locator('.vxo-original-row').count())>0);await page.locator('a[href="'+terminal+'"]').click();await readyChart();check('normal Stocks navigation and instrument selection');
  await quietSubmitCases(context,'desktop');await shot('viewer-order-noop-desktop');
  const token=await page.evaluate(()=>localStorage.getItem('exchange_token'));const headers={Authorization:'Bearer '+token};
  const state=await (await context.request.get(base+'/__stocks_global/state',{headers})).json();
  assert.equal(state.account.canTrade,false);assert.deepEqual(state.orders,[]);assert.deepEqual(state.fills,[]);assert.deepEqual(state.positions,{});assert.equal(state.wallets.USDT.cash,'0.00000000');
  const portfolio=await (await context.request.get(base+'/__stocks_global/portfolio',{headers})).json();assert.deepEqual(portfolio.positions,{});
  assert.equal((await context.request.get(base+'/__stocks_global/state?accountId=fixture-owner',{headers})).status(),422);
  assert.equal((await context.request.post(base+'/__stocks_global/orders',{headers:{...headers,'X-Stocks-Token':state.token},data:{instrumentId:'BINANCE:AAPLBUSDT',currency:'USDT',side:'BUY',type:'MARKET',quantity:'0.1',id:'fixture-forged'}})).status(),401);
  assert.deepEqual((await evidence()).commands,[]);check('viewer personal isolation and forged request denied');
  await page.setViewportSize({width:390,height:844});await readyChart();await shot('viewer-chart-mobile');
  await page.locator('.vxg-mobile-tabs button').filter({hasText:'Торговля'}).click();await quietSubmitCases(context,'mobile');await shot('viewer-order-noop-mobile');
  await page.setViewportSize({width:1440,height:900});
  await page.locator('nav[aria-label="Навигация Stocks"] a[href="/wallet"]').click();await page.locator('.top-nav-profile-btn').click();await page.locator('.top-nav-profile-menu button').click();await page.waitForURL(base+'/');assert.equal(await page.evaluate(()=>localStorage.getItem('exchange_token')),null);
  await page.goto(base+terminal);await page.locator('#login-email').waitFor();assert.equal((await context.request.get(base+'/__stocks_global/state',{headers})).status(),401);check('ordinary UI logout revokes fixture and closes Stocks');await shot('logout-login');
  await login('viewer');await readyChart();await context.request.post(base+'/__qa/revoke',{maxRedirects:0});await page.waitForURL(/\/login\?next=/,{timeout:12000});assert.equal(await page.locator('.vxg-terminal').count(),0);assert.equal(await page.locator('.vxg-plot canvas').count(),0);check('revocation clears protected view through polling');await shot('revoked-login');await context.close();
  for(const [i,label] of ['owner','second'].entries()){
    context=await newContext({width:1440,height:900});await page.goto(base+terminal);await login(label);await readyChart();
    await page.locator('.vxg-order-types button').filter({hasText:'Limit'}).click();await page.getByLabel('Цена',{exact:true}).fill('300');await page.getByLabel('Количество',{exact:true}).fill('0.1');
    assert(await page.locator('.vxg-submit').isEnabled());const before=await evidence();
    const response=page.waitForResponse(r=>r.url()===base+'/__stocks_global/orders'&&r.request().method()==='POST');await page.locator('.vxg-submit').click();assert.equal((await response).status(),503);
    const after=await evidence();assert.equal(after.tradeRequests,before.tradeRequests+1);assert.equal(after.commands.length,before.commands.length+1);assert.equal(after.commands.at(-1).actor,'fixture-'+label);assert.equal(after.commands.at(-1).command,'submitObserved');assert.equal(await page.locator('.vxg-success').count(),0);
    check('permitted fixture trader '+(i+1)+' reaches existing paper dispatch',{requests:1,command:'submitObserved',intentionalStubStatus:503});await shot('trader-'+(i+1)+'-dispatch');await context.close();
  }
  assert.deepEqual(failures,[],'Uncaught application errors');results.result='PASS';
})().catch(async e=>{results.result=browser?'FAIL':'NOT_RUN';results.failure=e.message;console.error(e.message);if(page&&!page.isClosed()){try{await shot('failure');}catch{}}process.exitCode=1;}).finally(async()=>{
  await browser?.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),pause(3000)]);if(server.exitCode===null)server.kill('SIGKILL');}
  results.finishedAt=new Date().toISOString();results.serverExitCode=server?.exitCode;results.serverSignal=server?.signalCode;
  fs.writeFileSync(path.join(out,'server-stdout.txt'),stdout.join(''));fs.writeFileSync(path.join(out,'server-stderr.txt'),stderr.join(''));
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({result:results.result,checks:results.checks.length,failure:results.failure}));
});
