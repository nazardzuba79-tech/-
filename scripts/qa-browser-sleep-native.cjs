/** Actual production bundle + actual native engine, loopback fixture only. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),origin='http://127.0.0.1:4277',out=path.join(root,'output/browser-sleep-native');
fs.mkdirSync(out,{recursive:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let server,browser,page;
const checks=[],errors=[];
async function start(){
  server=cp.spawn(process.execPath,['scripts/serve-native-demo-review.cjs'],{cwd:root,env:{...process.env,PORT:'4277',NATIVE_PREVIEW_FIXTURE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const log=fs.createWriteStream(path.join(out,'server.log'),{flags:'a'});server.stdout.pipe(log);server.stderr.pipe(log);
  for(let i=0;i<80;i++){try{const h=await(await fetch(origin+'/health')).json();if(h.fixtureMarket&&h.kind==='isolated-native-demo-preview')return;}catch{}await delay(100);}
  throw Error('Fixture startup failed');
}
async function stop(){if(!server||server.exitCode!==null)return;await new Promise(r=>{server.once('exit',r);server.kill();});}
const snap=p=>p.evaluate(()=>window.__readBudget.snapshot());
const advance=(p,ms)=>p.evaluate(ms=>window.__readBudget.advance(ms),ms);
async function wake(p){await p.mouse.click(8,8);await p.waitForFunction(()=>!document.querySelector('[data-browser-phase]'),null,{timeout:15000});}
async function scenario(width){
  const context=await browser.newContext({viewport:{width,height:1000},locale:'ru-RU',timezoneId:'UTC'});
  const html=await(await context.request.get(origin+'/futures')).text();
  const match=/localStorage\.setItem\("exchange_token",("[a-f0-9]{48}")\)/.exec(html);assert(match);
  const token=JSON.parse(match[1]);let serial=0;
  const api=async(endpoint,data)=>{const r=await context.request[data?'post':'get'](origin+'/api/v1/private-trading/native/'+endpoint,{headers:{Authorization:'Bearer '+token},...(data?{data}: {})});const body=await r.json();assert(r.ok(),endpoint+': '+JSON.stringify(body));if(body.orders)body.orders=body.orders.filter(o=>['OPEN','PARTIALLY_FILLED'].includes(o.status));return body;};
  const command=data=>api('commands',{...data,idempotencyKey:'sleep-qa-'+width+'-'+(++serial)});
  const first=await api('state');await api('initialize',{acceptedModel:first.model.version,idempotencyKey:'sleep-qa-init'});
  await command({kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'MARKET',quantity:'1',leverage:'10'});
  await command({kind:'OPEN',symbol:'BTCUSDT',side:'LONG',type:'LIMIT',price:'40000',quantity:'0.1',leverage:'10'});
  const authority=await api('state');assert.equal(authority.positions.length,1);assert.equal(authority.orders.length,1);
  const bootstrap=fs.readFileSync(path.join(__dirname,'qa-browser-read-budget-fixture.js'),'utf8');
  await context.addInitScript({content:'window.__browserSleepQa=true;window.__browserSleepToken='+JSON.stringify(token)+';'+bootstrap});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  // Public summaries and icon metadata use the server's current display
  // fixture contracts; no native/account response is intercepted here.
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  if(process.env.QA_TRACE_EXCEPTIONS==='1'){
    const debug=await context.newCDPSession(page),seen=new Set();
    await debug.send('Debugger.enable');await debug.send('Debugger.setPauseOnExceptions',{state:'all'});
    debug.on('Debugger.paused',event=>{const description=event.data?.description||JSON.stringify(event.data);if(!seen.has(description)){seen.add(description);console.log('QA exception',description);}void debug.send('Debugger.resume').catch(()=>{});});
  }
  await page.goto(origin+'/futures');await page.locator('.chart-surface').waitFor();
  await page.waitForFunction(()=>document.querySelector('.fo-priceInputRow input')?.value && document.querySelector('.futures-account-balance .mono')?.textContent?.trim()!=='—');
  await page.locator('#budget-qa').evaluate(e=>e.style.display='none');
  const mobile=page.locator('#mobile-futures-trade');if(await mobile.isVisible())await mobile.click();
  const price=page.locator('.fo-priceInputRow input'),qty=page.locator('.fo-qtyInputRow input');
  await price.fill('48000');await qty.fill('0.25');await page.waitForTimeout(300);
  const submitBox=await page.locator('.fo-submitPair .buy').boundingBox();assert(submitBox);
  await advance(page,300001);assert.equal(await page.locator('[data-browser-phase]').getAttribute('data-browser-phase'),'sleeping');
  const sleeping=await snap(page);await advance(page,1800000);assert.deepEqual((await snap(page)).hits,sleeping.hits);
  await page.screenshot({path:path.join(out,'sleep-'+width+'.png')});
  // Simulate process loss on the disposable server, with the persisted repository intact.
  await stop();await start();
  await page.mouse.click(submitBox.x+submitBox.width/2,submitBox.y+submitBox.height/2);
  await page.waitForFunction(()=>!document.querySelector('[data-browser-phase]'),null,{timeout:15000});
  assert.equal(await price.inputValue(),'48000');assert.equal(await qty.inputValue(),'0.25');
  const restored=await api('state');assert.equal(restored.positions[0].id,authority.positions[0].id);assert.equal(restored.orders[0].id,authority.orders[0].id);
  assert.equal(restored.account.settleBalance,authority.account.settleBalance);
  const waking=await snap(page);
  assert.equal((waking.hits['GET /api/v1/me']||0)-(sleeping.hits['GET /api/v1/me']||0),1);
  assert.equal(waking.hits['POST /api/v1/private-trading/native/commands']||0,sleeping.hits['POST /api/v1/private-trading/native/commands']||0);
  checks.push({width,name:'30m sleep, cold server restart, balance/position/order and draft preserved',pass:true});
  const live = await api('live');
  const mobilePositions = page.locator('#mobile-futures-positions');
  if (await mobilePositions.isVisible()) await mobilePositions.click();
  await page.locator('#futures-tab-positions').click();
  await page.waitForFunction(expected => {
    const row = document.querySelector('.futures-position-row[data-side]');
    const number = element => Number(element?.textContent.replace(/[^0-9.+-]/g, ''));
    return row && Math.abs(number(row.querySelector('.futures-position-money')) - expected.pnl) < 0.011
      && Math.abs(number(row.querySelectorAll('td')[4]) - expected.mark) < 0.011;
  }, {pnl:Number(live.positions[0].unrealizedPnl),mark:Number(live.positions[0].markPrice)});
  checks.push({width,name:'restored visible mark and unrealized P&L match native authority',pass:true});
  if (await mobile.isVisible()) await mobile.click();
  const balanceText=await page.locator('.futures-account-balance .mono').first().textContent();
  await page.evaluate(()=>window.__readBudget.hidden(true));
  await context.route('**/api/v1/me',r=>r.fulfill({status:503,json:{error:'isolated offline fixture'}}));
  await page.evaluate(()=>window.__readBudget.hidden(false));
  await page.waitForFunction(()=>document.querySelector('[data-browser-phase]')?.getAttribute('data-browser-phase')==='error');
  const failed=await snap(page);await advance(page,1800000);assert.deepEqual((await snap(page)).hits,failed.hits);
  assert.equal(await page.locator('.futures-account-balance .mono').first().textContent(),balanceText);
  assert.equal(await qty.inputValue(),'0.25');
  await context.unroute('**/api/v1/me');await wake(page);
  checks.push({width,name:'failed session refresh preserves balance/draft, no retry storm; explicit retry recovers',pass:true});
  // A position closed elsewhere while this tab sleeps must disappear on return.
  await page.evaluate(()=>window.__readBudget.hidden(true));
  await command({kind:'CLOSE',positionId:restored.positions[0].id,quantity:'1'});
  await page.evaluate(()=>window.__readBudget.hidden(false));await page.waitForFunction(()=>!document.querySelector('[data-browser-phase]'),null,{timeout:15000});
  await advance(page,1000);
  const positionsTab=page.locator('#mobile-futures-positions');if(await positionsTab.isVisible())await positionsTab.click();
  await page.locator('#futures-tab-positions').click();
  await page.waitForFunction(()=>document.querySelectorAll('.futures-positions-table tbody tr[data-side]').length===0);
  assert.equal((await api('state')).positions.length,0);
  await page.reload();await page.locator('.chart-surface').waitFor();await page.waitForTimeout(500);
  await page.locator('#budget-qa').evaluate(e=>e.style.display='none');
  assert.equal((await api('state')).positions.length,0);assert.equal((await api('state')).orders.length,1);
  checks.push({width,name:'external close is not resurrected; F5 retains resting order',pass:true});
  if(width===1440){
    // Exercise the iframe ownership boundary without a third-party live feed.
    await context.route('https://qa-chart.example.invalid/focused',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body><textarea aria-label="Chart notes" style="width:300px;height:150px">Fixture drawing notes</textarea></body></html>'}));
    await context.route('https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js',r=>r.fulfill({contentType:'application/javascript',body:'(()=>{const frame=document.createElement("iframe");frame.src="https://qa-chart.example.invalid/focused";frame.style="width:100%;height:250px";document.currentScript.parentElement.querySelector(".tradingview-widget-container__widget").appendChild(frame);})();'}));
    await page.getByRole('button',{name:'TradingView',exact:true}).click();
    await page.locator('.voltex-tradingview-chart__owned iframe').waitFor();
    await page.frameLocator('.voltex-tradingview-chart__owned iframe').getByRole('textbox',{name:'Chart notes'}).click();
    const focus = await page.evaluate(()=>({frame:document.activeElement?.tagName,owned:!!document.activeElement?.closest('.voltex-tradingview-chart__owned'),documentFocused:document.hasFocus()}));
    assert.deepEqual(focus,{frame:'IFRAME',owned:true,documentFocused:true});
    await advance(page,600001);
    assert.equal(await page.locator('[data-browser-phase]').count(),0);
    assert.equal(await page.locator('.voltex-tradingview-chart__owned iframe').count(),1);
    checks.push({width,name:'focused cross-origin owned chart survives ten minutes of parent-input silence',pass:true,focus});
    await page.mouse.click(8,8);
    await advance(page,299999);assert.equal(await page.locator('[data-browser-phase]').count(),0);
    await advance(page,1);assert.equal(await page.locator('[data-browser-phase]').getAttribute('data-browser-phase'),'sleeping');
    await page.waitForFunction(()=>!document.querySelector('.voltex-tradingview-chart__owned iframe'));
    checks.push({width,name:'leaving the owned chart restores the exact five-minute idle deadline',pass:true});
    await wake(page);await page.locator('.voltex-tradingview-chart__owned iframe').waitFor();
    await page.frameLocator('.voltex-tradingview-chart__owned iframe').getByRole('textbox',{name:'Chart notes'}).click();
    await page.evaluate(()=>window.__readBudget.hidden(true));
    await page.waitForFunction(()=>!document.querySelector('.voltex-tradingview-chart__owned iframe'));
    await page.evaluate(()=>window.__readBudget.hidden(false));await page.waitForFunction(()=>!document.querySelector('[data-browser-phase]'));
    await page.locator('.voltex-tradingview-chart__owned iframe').waitFor();
    checks.push({width,name:'hidden overrides focused TradingView; iframe detached and freshly mounted on wake',pass:true});
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'native viewport overflow');
  await page.screenshot({path:path.join(out,'restored-'+width+'.png')});
  await context.close();console.log('PASS native sleep '+width);
}
(async()=>{try{await start();browser=await chromium.launch({channel:'msedge',headless:true});for(const w of[1440,390])await scenario(w);assert.deepEqual(errors,[]);}
finally{if(page&&!page.isClosed()){fs.writeFileSync(path.join(out,'last-browser-state.json'),JSON.stringify(await snap(page).catch(()=>({})),null,2));await page.screenshot({path:path.join(out,'last.png')}).catch(()=>{});}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));await browser?.close();await stop();}})().catch(e=>{console.error(e);process.exitCode=1;});
