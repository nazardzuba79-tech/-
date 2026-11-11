#!/usr/bin/env node
/* Built application, loopback fixtures only. No production session or egress.
 * PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE optionally select an installed browser.
 * --baseline records the original defect; default asserts the fixed behavior. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name)+1] : fallback;
const baseline = process.argv.includes('--baseline');
const dist = path.resolve(arg('--dist', 'frontend/dist'));
const out = path.resolve(arg('--out', 'docs/qa/order-ticket-691'));
const origin = 'http://127.0.0.1:4231';
const report = {environment:'isolated built application; synthetic fixtures; no production requests',baseline,cases:[]};
const families = ['LIMIT','MARKET','STOP','TAKE_PROFIT','OCO'];
const labels = ['Лимит','Рынок','Стоп','Тейк-профит','OCO'];
const asset = {pair:'ECLV/USDT',symbol:'ECLV',name:'ECLAVO',quote:'USDT',managed:true,version:1,listingId:'isolated-eclv',isTestAsset:true,isTradable:false,status:'SIMULATION',listingArmed:true,listingAt:'2026-11-06T13:00:00Z',initialPrice:0.014,provenance:{mode:'DEMO_MODEL',withdrawable:false},state:{phase:'live',lastPrice:0.014,openPrice24h:0.014,change24hPercent:0,high24h:0.014,low24h:0.014,volume24h:10,quoteVolume24h:0.14,serverTime:Date.now()}};
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const server=spawn(process.execPath,['scripts/qa-futures-account-harness.cjs','--dist',dist,'--port','4231','--budget'],{stdio:['ignore','pipe','pipe']});
  let browser;
  try {
    await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',code=>reject(new Error('fixture server exited '+code)));});
    let args=['--no-sandbox','--disable-dev-shm-usage'];
    if(process.env.CHROMIUM_ARGUMENTS_MODULE) args=(await import(process.env.CHROMIUM_ARGUMENTS_MODULE)).default.args.filter(arg=>!['--single-process','--disable-web-security','--allow-running-insecure-content'].includes(arg));
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args});
    for(const width of [1440,390]) for(const target of (baseline?['ECLV']:['ECLV','BTC','Futures'])) {
      const context=await browser.newContext({viewport:{width,height:900},locale:'ru-RU'});
      const page=await context.newPage(), writes=[],errors=[];
      await page.addInitScript(()=>{localStorage.setItem('exchange_token','qa-user-c');localStorage.setItem('exchange_lang','ru');});
      await page.routeWebSocket('**/*',socket=>socket.close());
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',async route=>{
        const req=route.request(),u=new URL(req.url()),p=u.pathname;
        const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        if(!['GET','HEAD','OPTIONS'].includes(req.method())) {
          if(/orders|private-trading|positions|demo\/vta/.test(p))writes.push({method:req.method(),path:p});
          return reply({error:'isolated fixture refuses every mutation'},403);
        }
        if(p.endsWith('/orders/access'))return reply({allowed:false});
        if(p.endsWith('/market/listings'))return reply({serverTime:Date.now(),assets:[asset]});
        if(p.includes('ECLV-USDT')&&p.includes('candles'))return reply({pair:'ECLV/USDT',interval:u.searchParams.get('interval')||'1h',candles:Array.from({length:220},(_,i)=>({time:Math.floor(Date.now()/1000)-(220-i)*3600,open:.014,high:.0141,low:.0139,close:.014,volume:10}))});
        if(u.origin===origin)return route.continue();
        return reply({error:'external network disabled in QA'},503);
      });
      const entry={width,target,writes,errors};report.cases.push(entry);
      await page.goto(origin+(target==='Futures'?'/futures':`/trade?pair=${target}%2FUSDT`),{waitUntil:'domcontentloaded'});
      const futures=target==='Futures';
      const form=page.locator(futures?'.fo-form':'.order-form-content').first();
      await form.waitFor({state:'attached'});
      if(!futures&&width===390)await page.locator('#mobile-trade-trade').click();
      await form.waitFor({state:'visible'});
      await sleep(400);
      if(baseline) {
        await form.locator('input[aria-label="Цена"]').fill('0.014');
        const total=form.locator('input[aria-label="Итого"]');
        await total.fill('2');entry.afterTyping2=await total.inputValue();
        entry.submitDisabled=await form.locator('button[type="submit"]').isDisabled();
        entry.totalInputType=await total.getAttribute('type');
        await page.screenshot({path:path.join(out,`before-${target}-${width}.png`)});
        entry.defectReproduced=entry.afterTyping2!=='2';
        assert.ok(entry.defectReproduced,'baseline must reproduce lost draft');
        await context.close();continue;
      }
      for(let f=0;f<(futures?4:families.length);f++) {
        const select=page.locator(futures?'.order-family-select select':'.order-type-select select').first();
        if(await select.isVisible())await select.selectOption(families[f]);
        else await page.locator(futures?'.order-family-tabs:visible':'.order-type-tabs:visible').first().locator('button').nth(f).click();
        for(const input of await form.locator('input[type="text"]:not([readonly]):not([disabled])').all()) {
          for(const value of ['2','2,','2,5','2.50']) {await input.fill(value);assert.equal(await input.inputValue(),value,`${target} ${families[f]} draft`);}
        }
        const total=form.locator('input[aria-label="Итого"]');
        await total.fill('2,5');assert.equal(await total.inputValue(),'2,5');
        if(!futures)for(const side of ['buy','sell']) {
          await page.locator('.order-form-tab.'+side).click();
          const before=await form.locator('input').evaluateAll(ns=>ns.map(n=>n.value));
          const cta=form.locator('button[type="submit"]');assert.equal(await cta.isDisabled(),false);
          await cta.click();await total.press('Enter');
          assert.deepEqual(await form.locator('input').evaluateAll(ns=>ns.map(n=>n.value)),before,'viewer click/Enter preserves all inputs');
        }
        else for(const side of ['buy','sell']) {
          const before=await form.locator('input').evaluateAll(ns=>ns.map(n=>n.value));
          const cta=form.locator('.submit-btn.'+side);assert.equal(await cta.isDisabled(),false);
          await cta.click();await total.press('Enter');
          assert.deepEqual(await form.locator('input').evaluateAll(ns=>ns.map(n=>n.value)),before,'Futures viewer click/Enter preserves inputs');
        }
        const range=form.locator('input[type="range"]').last();
        for(const percent of [0,25,50,75,100]) {await range.fill(String(percent));assert.equal(await range.inputValue(),String(percent));}
      }
      assert.deepEqual(writes,[],'zero financial mutation requests');
      assert.deepEqual(errors,[],'no uncaught JS errors');
      // Exact session boundary: a stale allowed response can never authorize the next user.
      await page.evaluate(()=>{localStorage.setItem('exchange_token','qa-user-a');window.dispatchEvent(new StorageEvent('storage',{key:'exchange_token'}));});
      await form.locator('input[aria-label="Итого"]').fill('2,5');
      await form.locator('.submit-btn').first().click();
      assert.deepEqual(writes,[],'no mutation after session change');
      await page.screenshot({path:path.join(out,`after-${target}-${width}.png`)});
      entry.status='PASS';entry.families=futures?families.slice(0,4):families;entry.financialRequests=writes.length;
      await context.close();
    }
    report.status='PASS';
  } catch(error) {report.status='FAIL';report.error=String(error);process.exitCode=1;}
  finally {if(browser)await browser.close();server.kill();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
