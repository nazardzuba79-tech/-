#!/usr/bin/env node
/** Real browser QA of the built route and actual calculator module.
 * All fixture transport is denied except the existing shell's synthetic /me.
 * No calculator API responses exist. Use PLAYWRIGHT_MODULE when not installed.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createReviewServer } = require('./serve-trading-tools-review.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/qa/trading-tools');
const MODES = ['pnl', 'size', 'liquidation', 'risk-reward', 'dca', 'fees'];
const WIDTHS = [[1366,768],[1440,900],[1920,1080],[320,844],[360,844],[390,844],[430,932],[768,1024]];
const counts = value => ({ calculator: value.attempts.filter(item => !item.path.endsWith('/api/v1/me')).length, shell: value.attempts.filter(item => item.path.endsWith('/api/v1/me')).length, timers: value.timers.length, copies: value.copies.length });
const probe = page => page.evaluate(() => ({ attempts: window.__toolsProbe.attempts, timers: window.__toolsProbe.timers, copies: window.__toolsProbe.copies, blockedResources:window.__toolsProbe.blockedResources }));
const snapshot = async (page, requests) => ({ ...counts(await probe(page)), static: requests.filter(request => request.category === 'static').length });

async function makePage(browser, base, moduleOnly = false, viewport = { width:1440, height:900 }) {
  const context = await browser.newContext({ viewport, reducedMotion:'reduce' });
  const page = await context.newPage();
  const requests = [], errors = [], protocolRequests = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', event => {
    const url = new URL(event.request.url);
    protocolRequests.push({ method:event.request.method, path:url.origin+url.pathname,
      initiator:{ type:event.initiator.type, frames:(event.initiator.stack?.callFrames||[]).slice(0,4).map(frame=>({ function:frame.functionName, file:frame.url.split('?')[0], line:frame.lineNumber })) } });
  });
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ method: request.method(), path: url.origin + url.pathname, type: request.resourceType(), category: url.pathname.startsWith('/api/') ? 'shell' : 'static', external: url.origin !== base });
    return url.origin === base ? route.continue() : route.abort();
  });
  page.on('pageerror', error => errors.push(String(error)));
  await page.clock.install({ time: new Date('2026-10-01T00:00:00Z') });
  await page.goto(base + (moduleOnly ? '/__qa/module' : '/tools'), { waitUntil:'networkidle' });
  await page.locator('.vx-trading-tools').waitFor();
  return { context, page, requests, errors, protocolRequests };
}

async function choose(page, mode) {
  await page.locator(`button[data-tools-mode="${mode}"]`).click();
}
async function example(page) {
  await page.locator('[data-tools-action="example"]').click();
  await page.locator('[data-tools-status="ready"]').waitFor();
}

async function exerciseModes(page, requests, prefix, rows, screenshots = false) {
  for (const mode of MODES) {
    const before = await snapshot(page, requests);
    await choose(page, mode); await example(page);
    const fields = page.locator('input[data-tools-field]:not([type="checkbox"])');
    assert.ok(await fields.count() > 0, `${mode} has inputs`);
    const copy = page.locator('[data-tools-action="copy"]');
    if (await copy.count()) { await copy.click(); assert.ok((await probe(page)).copies.length > before.copies, `${mode} copied locally`); }
    const method = page.locator('[data-tools-action="method"]');
    if (await method.count()) {
      await method.click();
      assert.equal(await method.evaluate(node=>node.closest('details').open),true,`${mode} method opens`);
      await method.click();
      assert.equal(await method.evaluate(node=>node.closest('details').open),false,`${mode} method closes`);
    }
    if (screenshots) await page.screenshot({ path:path.join(OUT, `${mode}-1440.jpg`), type:'jpeg', quality:85, fullPage:true });
    const first = fields.first();
    if (await first.getAttribute('type') !== 'checkbox' && await first.evaluate(element => element.tagName === 'INPUT')) {
      await first.fill(''); await page.keyboard.press('Tab');
      assert.equal(await page.locator('[data-tools-status="ready"]').count(), 0, `${mode} clears result when required input missing`);
      await example(page);
    }
    await page.locator('[data-tools-action="reset"]').click();
    assert.equal(await page.locator('[data-tools-status="ready"]').count(), 0, `${mode} reset does not fabricate zero result`);
    await example(page);
    const after = await snapshot(page, requests);
    rows.push({ action:`${prefix}/${mode}/example-edit-copy-method-reset`, calculator:after.calculator-before.calculator, shell:after.shell-before.shell, static:after.static-before.static, timersScheduled:after.timers-before.timers });
  }
}

async function exerciseDcaRows(page, requests, rows) {
  const before = await snapshot(page, requests);
  await choose(page,'dca'); await example(page);
  while (await page.locator('[data-tools-row]').count() < 50) await page.locator('[data-tools-action="add-row"]').click();
  for (let index = 2; index < 50; index++) {
    await page.locator(`input[data-tools-field="rows.${index}.price"]`).fill('100');
    await page.locator(`input[data-tools-field="rows.${index}.quantity"]`).fill('1');
  }
  await page.locator('[data-tools-status="ready"]').waitFor();
  assert.equal(await page.locator('[data-tools-row]').count(),50);
  assert.equal(await page.locator('[data-tools-action="add-row"]').isDisabled(),true);
  const after = await snapshot(page, requests);
  rows.push({ action:'module/offline/DCA-50-rows', calculator:after.calculator-before.calculator, shell:after.shell-before.shell, static:after.static-before.static, timersScheduled:after.timers-before.timers });
  await page.locator('[data-tools-action="reset"]').click();
}

async function exercisePnlIsolation(page, requests, rows) {
  const before = await snapshot(page, requests);
  await choose(page,'pnl'); await example(page);
  await page.locator('[data-tools-field="side"][data-tools-value="short"]').click();
  await page.locator('input[data-tools-field="leverage"]').fill('7');
  const advanced = page.locator('.tt-advanced').first();
  if (!await advanced.evaluate(node=>node.open)) await advanced.locator('summary').click();
  await page.locator('input[data-tools-field="funding"]').fill('42');
  const futuresResult = await page.locator('[data-tools-result]').innerText();
  await page.locator('[data-tools-field="market"][data-tools-value="spot"]').click();
  assert.equal(await page.locator('[data-tools-status="ready"]').count(),0,'Spot starts with separate blank draft');
  await example(page);
  assert.equal(await page.locator('[data-tools-field="side"], input[data-tools-field="leverage"], input[data-tools-field="funding"]').count(),0,'Spot has no futures-only inputs');
  assert.ok(!(await page.locator('[data-tools-result]').innerText()).includes('funding'),'Spot result excludes funding');
  await page.locator('[data-tools-field="market"][data-tools-value="futures"]').click();
  assert.equal(await page.locator('input[data-tools-field="leverage"]').inputValue(),'7');
  assert.equal(await page.locator('input[data-tools-field="funding"]').inputValue(),'42');
  assert.equal(await page.locator('[data-tools-field="side"][data-tools-value="short"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-tools-result]').innerText(),futuresResult,'Futures draft and result restored exactly');
  const after = await snapshot(page, requests);
  rows.push({ action:'module/offline/PnL-Futures-Spot-Futures', calculator:after.calculator-before.calculator, shell:after.shell-before.shell, static:after.static-before.static, timersScheduled:after.timers-before.timers });
}

async function exerciseEdgeStates(page, requests, rows) {
  const before = await snapshot(page, requests);
  await choose(page,'pnl'); await example(page);
  await page.locator('input[data-tools-field="exit"]').fill('54000');
  assert.equal(await page.locator('.tt-primary-result strong.is-negative').count(),1,'negative net result stays negative');
  await page.locator('input[data-tools-field="entry"]').fill('0.00000001');
  await page.locator('input[data-tools-field="exit"]').fill('0.00000002');
  await page.locator('input[data-tools-field="quantity"]').fill('100000000000000000000000000000');
  await page.locator('[data-tools-status="ready"]').waitFor();
  assert.ok(!/NaN|Infinity/.test(await page.locator('[data-tools-result]').innerText()));
  await page.locator('input[data-tools-field="entry"]').fill('12,34,56');
  await page.locator('[data-tools-status="invalid"]').waitFor();
  await choose(page,'liquidation'); await example(page);
  const liquidationDetails=page.locator('.tt-advanced').first();
  if(!await liquidationDetails.evaluate(node=>node.open)) await liquidationDetails.locator('summary').click();
  await page.locator('input[data-tools-field="costs"]').fill('10000');
  await page.locator('[data-tools-status="insufficient_margin"]').waitFor();
  assert.ok((await page.locator('.tt-primary-result strong').innerText()).includes('—'),'insufficient margin does not claim a liquidation price');
  await choose(page,'size'); await example(page);
  const sizeDetails=page.locator('.tt-advanced').first();
  if(!await sizeDetails.evaluate(node=>node.open)) await sizeDetails.locator('summary').click();
  await page.locator('input[data-tools-field="budget"]').fill('0.01');
  await page.locator('[data-tools-status="ready"]').waitFor();
  assert.ok(!/NaN|Infinity/.test(await page.locator('[data-tools-result]').innerText()));
  const after=await snapshot(page,requests);
  rows.push({ action:'module/offline/negative-tiny-long-invalid-insufficient-budget',calculator:after.calculator-before.calculator,shell:after.shell-before.shell,static:after.static-before.static,timersScheduled:after.timers-before.timers });
}

async function main() {
  fs.mkdirSync(OUT, { recursive:true });
  const fixture = await createReviewServer(0);
  const base = `http://127.0.0.1:${fixture.port}`;
  const browser = await chromium.launch({ headless:true });
  const report = { generatedAt:new Date().toISOString(), environment:{ node:process.version, platform:process.platform, browser:browser.version() }, measured:true, calculatorRows:[], integratedRows:[], responsive:[], limitations:[] };
  try {
    const isolated = await makePage(browser, base, true);
    report.isolatedInitial = await snapshot(isolated.page, isolated.requests);
    assert.equal(report.isolatedInitial.calculator, 0);
    assert.equal(report.isolatedInitial.shell, 0);
    await exerciseModes(isolated.page, isolated.requests, 'module/StrictMode', report.calculatorRows);
    await isolated.context.setOffline(true);
    await exerciseModes(isolated.page, isolated.requests, 'module/offline', report.calculatorRows);
    await exerciseDcaRows(isolated.page, isolated.requests, report.calculatorRows);
    await exercisePnlIsolation(isolated.page, isolated.requests, report.calculatorRows);
    await exerciseEdgeStates(isolated.page, isolated.requests, report.calculatorRows);
    for (const hidden of [false,true]) {
      await isolated.page.evaluate(hidden => { Object.defineProperty(document,'hidden',{ configurable:true,value:hidden }); Object.defineProperty(document,'visibilityState',{ configurable:true,value:hidden?'hidden':'visible' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); }, hidden);
      const before = await snapshot(isolated.page, isolated.requests);
      await isolated.page.clock.runFor(12 * 60 * 60 * 1000);
      const after = await snapshot(isolated.page, isolated.requests);
      report.calculatorRows.push({ action:`module/${hidden?'hidden':'visible'}/12h-virtual-idle`, calculator:after.calculator-before.calculator, shell:after.shell-before.shell, static:after.static-before.static, timersScheduled:after.timers-before.timers });
    }
    const beforeReal = await snapshot(isolated.page, isolated.requests);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const afterReal = await snapshot(isolated.page, isolated.requests);
    report.calculatorRows.push({ action:'module/3s-real-idle', calculator:afterReal.calculator-beforeReal.calculator, shell:afterReal.shell-beforeReal.shell, static:afterReal.static-beforeReal.static, timersScheduled:afterReal.timers-beforeReal.timers });
    await isolated.page.evaluate(() => window.__toolsFixture.unmount());
    await isolated.page.locator('.vx-trading-tools').waitFor({ state:'detached' });
    await isolated.page.clock.runFor(12 * 60 * 60 * 1000);
    await isolated.page.evaluate(() => window.__toolsFixture.remount());
    await isolated.page.locator('.vx-trading-tools').waitFor();
    assert.equal(await isolated.page.locator('[data-tools-status="ready"]').count(), 0, 'reentry clears previous drafts');
    const isolatedProbe = await probe(isolated.page);
    assert.deepEqual(isolatedProbe.attempts, [], 'zero attempted calculator transports, including offline');
    assert.ok(isolatedProbe.timers.every(timer => timer.kind !== 'setInterval'), 'no calculator intervals');
    assert.deepEqual(isolated.errors, [], 'no isolated runtime errors');
    report.isolatedTransports = isolatedProbe.attempts;
    report.isolatedTimers = isolatedProbe.timers;
    report.isolatedStaticRequests = isolated.requests;
    report.isolatedRequestInitiators = isolated.protocolRequests;
    report.isolatedBlockedResources = isolatedProbe.blockedResources;
    assert.deepEqual(report.isolatedBlockedResources,[], 'isolated calculator creates no blocked resource attempts');
    await isolated.context.close();
    if(process.argv.includes('--module-only')) {
      fs.writeFileSync(path.join(OUT,'network-module.json'),JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify({passed:true,moduleOnly:true,calculatorActions:report.calculatorRows.length,calculatorAttempts:report.isolatedTransports.length},null,2));
      return;
    }

    const integrated = await makePage(browser, base);
    report.integratedInitial = await snapshot(integrated.page, integrated.requests);
    assert.equal(report.integratedInitial.calculator, 0);
    await exerciseModes(integrated.page, integrated.requests, 'integrated', report.integratedRows, true);
    // Calculator navigation carries only its allowlisted mode, never draft values.
    await choose(integrated.page,'pnl'); await example(integrated.page);
    const pnlEntry = await integrated.page.locator('input[data-tools-field="entry"]').inputValue();
    await choose(integrated.page,'fees');
    await integrated.page.goBack();
    await integrated.page.locator('button[data-tools-mode="pnl"][aria-selected="true"], button[data-tools-mode="pnl"][aria-pressed="true"]').waitFor();
    assert.equal(await integrated.page.locator('input[data-tools-field="entry"]').inputValue(),pnlEntry);
    assert.ok([...new URL(integrated.page.url()).searchParams.keys()].every(key=>key==='calc'));
    const disclosure = integrated.page.locator('.tt-advanced summary').first();
    await disclosure.focus(); await integrated.page.keyboard.press('Enter');
    assert.equal(await disclosure.evaluate(node=>node.parentElement.open),true,'Enter opens the advanced disclosure');
    await integrated.page.keyboard.press('Enter');
    assert.equal(await disclosure.evaluate(node=>node.parentElement.open),false,'Enter closes the advanced disclosure');
    const beforeIdle = await snapshot(integrated.page, integrated.requests);
    await integrated.page.clock.runFor(12 * 60 * 60 * 1000);
    await integrated.page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('pointerdown')); });
    const afterIdle = await snapshot(integrated.page, integrated.requests);
    report.integratedRows.push({ action:'integrated/12h-virtual-idle-and-wake', calculator:afterIdle.calculator-beforeIdle.calculator, shell:afterIdle.shell-beforeIdle.shell, static:afterIdle.static-beforeIdle.static, timersScheduled:afterIdle.timers-beforeIdle.timers });
    await choose(integrated.page, 'pnl'); await example(integrated.page);
    await integrated.page.evaluate(() => { localStorage.setItem('exchange_token','tools-fixture-user-b'); window.dispatchEvent(new StorageEvent('storage',{ key:'exchange_token',newValue:'tools-fixture-user-b' })); });
    await integrated.page.locator('[data-tools-action="example"]').waitFor();
    assert.equal(await integrated.page.locator('[data-tools-status="ready"]').count(), 0, 'account change clears drafts');
    await example(integrated.page);
    await integrated.page.evaluate(() => { history.pushState({},'', '/legal/terms'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await integrated.page.locator('.vx-trading-tools').waitFor({state:'detached'});
    await integrated.page.goBack();
    await integrated.page.locator('.vx-trading-tools').waitFor();
    assert.equal(await integrated.page.locator('[data-tools-status="ready"]').count(),0,'route reentry clears financial inputs');
    report.integratedTransports = (await probe(integrated.page)).attempts;
    assert.ok(report.integratedTransports.every(attempt => attempt.path.endsWith('/api/v1/me') && attempt.kind === 'fetch'), 'only existing shell profile/session reads');
    report.integratedStaticRequests = integrated.requests;
    report.integratedRequestInitiators = integrated.protocolRequests;
    report.integratedBlockedResources = (await probe(integrated.page)).blockedResources;
    assert.deepEqual(integrated.errors, [], 'no integrated runtime errors');
    await integrated.page.evaluate(() => { localStorage.removeItem('exchange_token'); window.dispatchEvent(new StorageEvent('storage',{key:'exchange_token',newValue:null})); });
    await integrated.page.locator('.vx-trading-tools').waitFor({state:'detached'});
    report.logout={workspaceUnmounted:true,path:new URL(integrated.page.url()).pathname};
    await integrated.context.close();

    for (const [width,height] of WIDTHS) {
      const state = await makePage(browser, base, false, { width,height });
      await example(state.page);
      const geometry = await state.page.evaluate(() => ({ overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth), toolWidth:document.querySelector('.vx-trading-tools').getBoundingClientRect().width, headerCount:document.querySelectorAll('header.global-header').length }));
      assert.equal(geometry.overflow,0, `no horizontal overflow at ${width}`);
      assert.equal(geometry.headerCount,1, `one real header at ${width}`);
      await state.page.screenshot({ path:path.join(OUT,`width-${width}.jpg`), type:'jpeg',quality:85,fullPage:true });
      if(width===390){
        await choose(state.page,'dca');await example(state.page);await state.page.screenshot({path:path.join(OUT,'dca-390.jpg'),type:'jpeg',quality:85,fullPage:true});
        await choose(state.page,'pnl');await example(state.page);
        await state.page.locator('input[data-tools-field="entry"]').fill('12,34,56');
        await state.page.locator('[data-tools-status="invalid"]').waitFor();
        await state.page.screenshot({path:path.join(OUT,'invalid-390.jpg'),type:'jpeg',quality:85,fullPage:true});
        await example(state.page);
        await state.page.locator('input[data-tools-field="entry"]').fill('0.00000001');
        await state.page.locator('input[data-tools-field="exit"]').fill('0.00000002');
        await state.page.locator('input[data-tools-field="quantity"]').fill('100000000000000000000000000000');
        await state.page.locator('[data-tools-status="ready"]').waitFor();
        assert.equal(await state.page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0,'long financial output fits phone');
        await state.page.screenshot({path:path.join(OUT,'large-numbers-390.jpg'),type:'jpeg',quality:85,fullPage:true});
      }
      report.responsive.push({ width,height,...geometry, pageErrors:state.errors });
      await state.context.close();
    }
    report.serverReads = fixture.hits;
    report.limitations.push('Global Google Fonts requests are existing static shell dependencies and are blocked by the fixture CSP. Blocked resource attempts are reported separately from served static files. No production service is contacted.','The isolated development React fixture replays StrictMode effects; integrated screenshots use the production bundle.','No asset selector exists: all quantities are manual base-asset units. Asset-switch scenarios are not applicable.');
    fs.writeFileSync(path.join(OUT,'network.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({ passed:true,calculatorActions:report.calculatorRows.length,integratedActions:report.integratedRows.length,widths:report.responsive.length,calculatorAttempts:report.isolatedTransports.length,shellReads:report.integratedTransports.length },null,2));
  } catch(error) {
    report.failure=String(error.stack||error);fs.writeFileSync(path.join(OUT,'network-failed.json'),JSON.stringify(report,null,2)+'\n');throw error;
  } finally { await browser.close(); await new Promise(resolve=>fixture.server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
