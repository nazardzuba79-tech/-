const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.MOBILE_REVIEW_PLAYWRIGHT || 'playwright');
const { createReviewServer } = require('./serve-mobile-review.cjs');
const output = path.resolve(__dirname, '../output/mobile-review');
fs.mkdirSync(output, { recursive: true });
const report = { baseCommit: 'c237649ccd93e74c68013c861ab9cbd38af56726', sourceCommit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: path.resolve(__dirname, '..') }).trim(), cases: [], errors: [], externalRequests: [], apiRequests: [], screenshots: [], paintedPlots: [] };
async function guardContext(context, origin) {
  context.on('request', request => {
    if (!request.url().startsWith(origin + '/')) report.externalRequests.push(request.url());
    if (/\/api\/|__disabled_review_api__/.test(request.url())) report.apiRequests.push(request.url());
  });
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
}
async function checkLayout(page, label) {
  const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    buttons: [...document.querySelectorAll('.review-nav button, .review-submit, .review-open-ticket')].map(button => ({ text: button.textContent, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })) }));
  assert(layout.scroll <= layout.width + 1, `${label}: horizontal overflow ${JSON.stringify(layout)}`);
  assert(layout.buttons.every(button => button.height >= 44 && button.width >= 44), `${label}: inaccessible primary controls`);
}
async function checkPaintedPlot(page, label) {
  await page.locator('[data-chart-state="candles"]').waitFor();
  const geometry = await page.locator('[data-chart-state="candles"]').boundingBox();
  assert(geometry.height >= 200, `${label}: compact plot lost its usable height ${geometry.height}`);
  // A mounted canvas alone is not a chart. Require actual down-candle ink.
  await page.waitForFunction(() => [...document.querySelectorAll('.review-chart canvas')].some(canvas => {
    if (canvas.width < 100 || canvas.height < 100) return false;
    const context = canvas.getContext('2d'); if (!context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i=0; i<pixels.length; i+=4) if (pixels[i]===247 && pixels[i+1]===166 && pixels[i+2]===0 && pixels[i+3]>0) count++;
    return count > 100;
  }));
  report.paintedPlots.push(`${label}: rendered candle pixels PASS`);
}
async function shot(page, name) {
  const file = `${name}.png`; await page.screenshot({ path: path.join(output, file), fullPage: true }); report.screenshots.push(file);
}
(async () => {
  let workerRevision = '';
  const server = createReviewServer({workerRevision:()=>workerRevision}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  report.runtime = { node: process.version, chromium: browser.version(), locale: 'en-US', physicalDevices: false, realTelegramLaunch: false };
  try {
    // Verify normal production bundle does not include or enable mobile clients.
    const production = path.resolve(__dirname, '../frontend/dist');
    assert(!fs.existsSync(path.join(production, 'mobile')), 'Mobile assets leaked into normal build');
    assert(!fs.readFileSync(path.join(production,'index.html'),'utf8').includes('manifest.webmanifest'));
    for (const host of ['voltextech.net', 'localhost.evil.test', '127.0.0.1.evil.test', '[2001:db8::1]', 'user@localhost']) {
      const deniedStatus = await new Promise((resolve,reject)=>require('node:http').get(origin+'/pwa',{headers:{host}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject));
      assert.equal(deniedStatus,403,`Unexpected accepted Host: ${host}`);
    }
    const writeDenied = await fetch(origin + '/api/v1/futures/orders', { method:'POST' }); assert.equal(writeDenied.status,405);
    for (const client of ['pwa', 'telegram']) for (const width of [320,360,390,430]) {
      const context = await browser.newContext({ locale:'en-US', viewport:{ width,height:844 }, isMobile:true, hasTouch:true, deviceScaleFactor:1 });
      await guardContext(context, origin);
      const page = await context.newPage();
      await page.goto(`${origin}/${client}${client === 'telegram' ? '?mock=1' : ''}`);
      await page.getByRole('heading',{name:'Make your next move.'}).waitFor();
      assert.equal(await page.getByText(/Update ready/).count(),0,'First install must not announce an update');
      await checkLayout(page, `${client}-${width}-markets`);
      assert(await page.locator('.review-brand svg').isVisible(),'Current VOLTEX brand must remain visible at every width');
      assert.equal(await page.locator('.review-brand span').filter({hasText:/^L$/}).evaluate(element=>getComputedStyle(element).color),'rgb(240, 196, 25)','Current yellow-L brand must be retained');
      if(width>=390) await shot(page,`${client}-${width}-markets`);
      await page.getByRole('button',{name:/BTC USDT Synthetic fixture/}).click();
      await page.locator('.review-chart canvas').first().waitFor();
      await page.waitForFunction(() => window.__mobileReview.fixtureMetrics.candleReads > 0);
      await checkPaintedPlot(page, `${client}-${width}`);
      await checkLayout(page, `${client}-${width}-chart`);
      if(width>=390) await shot(page,`${client}-${width}-chart`);
      await page.getByRole('button',{name:'Open order panel'}).click();
      await page.getByLabel('Order quantity').fill('0.01');
      assert(await page.getByRole('button',{name:'Trading locked'}).isDisabled());
      await checkLayout(page, `${client}-${width}-order`);
      if(width>=390) await shot(page,`${client}-${width}-order`);
      await context.setOffline(true);
      await page.getByRole('alert').filter({hasText:'Offline'}).waitFor();
      assert(await page.getByRole('button',{name:'Trading locked'}).isDisabled());
      await context.setOffline(false);
      // Backgrounding only pauses chart work; a temporary hide must keep the draft.
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      await page.getByRole('heading',{name:'Paused',exact:true}).waitFor();
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
      await page.getByLabel('Order quantity').waitFor();
      assert.equal(await page.getByLabel('Order quantity').inputValue(),'0.01','Visibility change discarded the draft');
      await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
      await page.getByRole('heading',{name:'Paused',exact:true}).waitFor();
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      assert.equal(await page.getByRole('heading',{name:'Paused',exact:true}).count(),1,'Visibility event incorrectly resumed a pagehidden client');
      await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
      await page.getByLabel('Order quantity').waitFor();
      assert.equal(await page.getByLabel('Order quantity').inputValue(),'0.01','Page restoration discarded the draft');
      if (client==='telegram') {
        await page.evaluate(()=>window.__mobileReview.sdk.emit('deactivated'));
        await page.getByRole('heading',{name:'Paused',exact:true}).waitFor();
        await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
        assert.equal(await page.getByRole('heading',{name:'Paused',exact:true}).count(),1,'Browser visibility incorrectly overrode Telegram inactivity');
        await page.evaluate(()=>window.__mobileReview.sdk.emit('activated'));
        await page.getByLabel('Order quantity').waitFor();
        assert.equal(await page.getByLabel('Order quantity').inputValue(),'0.01','Telegram reactivation discarded the draft');
        await page.evaluate(()=>window.__mobileReview.sdk.back());
        await page.locator('.review-chart canvas').first().waitFor();
        assert.equal(await page.getByRole('tab',{name:'Chart',exact:true}).getAttribute('aria-selected'),'true','Back from ticket skipped the chart');
      }
      await page.getByRole('navigation').getByRole('button',{name:'Spot',exact:true}).click();
      await page.locator('.review-chart canvas').first().waitFor();
      await checkLayout(page, `${client}-${width}-spot`);
      // Exercise each initial account section; absence remains unknown, never a fabricated zero.
      await page.getByRole('button',{name:'Positions',exact:true}).click();
      await page.getByText('Account not connected',{exact:true}).waitFor();
      assert((await page.locator('.review-facts').innerText()).includes('—'));
      await page.getByRole('navigation').getByRole('button',{name:'Futures',exact:true}).click();
      await page.getByRole('button',{name:'Orders',exact:true}).click();
      await page.getByRole('heading',{name:'Orders',exact:true}).waitFor();
      for(const name of ['Wallet','Copy']) {
        await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
        await checkLayout(page, `${client}-${width}-${name}`);
      }
      await page.getByRole('navigation').getByRole('button',{name:'Futures',exact:true}).click();
      await page.locator('.review-chart canvas').first().waitFor();
      if (client==='telegram') {
        assert.equal(await page.evaluate(()=>window.__mobileReview.trustedIdentity),null);
        await page.evaluate(()=>{const sdk=window.__mobileReview.sdk;sdk.viewportStableHeight=700;sdk.safeAreaInset={top:24,bottom:20,left:0,right:0};sdk.colorScheme='light';sdk.emit('viewportChanged');sdk.emit('themeChanged');});
        assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--tg-height')),'700px');
        assert.equal(await page.evaluate(()=>document.documentElement.dataset.telegramTheme),'light');
        assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--tg-top')),'36px');
        assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--tg-bottom')),'32px');
        await checkLayout(page, `${client}-${width}-safe-area`);
        if(width===390) await shot(page,'telegram-390-light-safe-area');
        await page.evaluate(()=>window.__mobileReview.sdk.emit('deactivated'));
        await page.getByRole('heading',{name:'Paused',exact:true}).waitFor();
        const telegramReads = await page.evaluate(()=>window.__mobileReview.fixtureMetrics.candleReads);
        if(width===390) await page.waitForTimeout(5200);
        assert.equal(await page.evaluate(()=>window.__mobileReview.fixtureMetrics.candleReads),telegramReads,'Minimized Telegram chart kept polling');
        assert.equal(await page.locator('.review-chart canvas').count(),0,'Inactive Telegram kept its live chart mounted');
        await page.evaluate(()=>window.__mobileReview.sdk.emit('activated'));
        await page.locator('.review-chart canvas').first().waitFor();
        await page.evaluate(()=>window.__mobileReview.sdk.back());
        await page.getByRole('heading',{name:'Make your next move.'}).waitFor();
        await page.getByRole('navigation').getByRole('button',{name:'Futures',exact:true}).click();
        await page.locator('.review-chart canvas').first().waitFor();
      }
      // Page visibility simulation exercises the actual event listener and effect cleanup.
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      await page.getByRole('heading',{name:'Paused',exact:true}).waitFor();
      const reads = await page.evaluate(()=>window.__mobileReview.fixtureMetrics.candleReads);
      await page.waitForTimeout(5200);
      assert.equal(await page.evaluate(()=>window.__mobileReview.fixtureMetrics.candleReads),reads,'Hidden chart kept polling');
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
      await page.locator('.review-chart canvas').first().waitFor();
      await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
      await page.getByRole('heading',{name:'Paused',exact:true}).waitFor();
      report.cases.push(`${client} ${width}px: markets, chart, order, offline, positions/orders/wallet/copy, draft preservation, visibility/pagehide${client==='telegram'?', SDK lifecycle, BackButton and safe area':''} PASS`);
      await context.close();
    }
    const context = await browser.newContext({ locale:'en-US' }); await guardContext(context, origin); const page = await context.newPage();
    await page.goto(origin+'/telegram?mock=1&invalid=1'); await page.getByRole('heading',{name:'Launch unavailable'}).waitFor();
    await page.goto(origin+'/telegram'); await page.getByText(/Telegram SDK unavailable/).waitFor();
    // A synthetic SDK-shaped object exercises the real-launch refusal branch.
    // This is not a real Telegram session and cannot authenticate an account.
    await page.addInitScript(() => { window.Telegram = { WebApp: {
      initData: 'synthetic-untrusted-raw-launch-detail', isActive: true,
      viewportStableHeight: innerHeight, colorScheme: 'dark',
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      ready() {}, expand() {}, close() {}, onEvent() {}, offEvent() {},
    } }; });
    await page.goto(origin+'/telegram');
    await page.getByText('Telegram account access is not enabled in this review. Open the local mock launch to continue.').waitFor();
    assert.equal(await page.getByRole('heading',{name:'Make your next move.'}).count(),0);
    assert(!(await page.locator('body').innerText()).includes('synthetic-untrusted-raw-launch-detail'));
    await page.goto(origin+'/pwa'); await page.getByRole('heading',{name:'Make your next move.'}).waitFor();
    await page.evaluate(()=>Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Worker activation timed out')),15000)),
    ]).then(()=>true));
    await page.reload();
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const cacheKeys = await page.evaluate(async()=>{const keys=await caches.keys();return(await Promise.all(keys.map(async key=>(await(await caches.open(key)).keys()).map(request=>new URL(request.url).pathname)))).flat();});
    assert(cacheKeys.length>0); assert(cacheKeys.every(key=>key.startsWith('/assets/')||key.startsWith('/mobile/')||key.startsWith('/fonts/inter/')));
    assert(!cacheKeys.some(key=>/api|wallet|orders|positions|mobile-review\.html/.test(key)));
    await page.getByRole('navigation').getByRole('button',{name:'Futures',exact:true}).click();
    await page.getByRole('button',{name:'Open order panel'}).click();
    await page.getByLabel('Order quantity').fill('0.123');
    workerRevision = 'update-test';
    await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());
    await page.getByText(/Update ready/).waitFor();
    assert.equal(await page.getByLabel('Order quantity').inputValue(),'0.123','An update discarded the open draft');
    assert(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting),'Update activated over an open session');
    await context.setOffline(true); await page.reload();
    await page.getByRole('heading',{name:'You are offline'}).waitFor();
    assert.equal(await page.locator('button').count(),0);
    await shot(page,'pwa-offline-shell');
    await context.close();
    report.cases.push('Invalid/missing/unverified-SDK Telegram launch fails closed with controlled text; SW caches static assets only; update waits and preserves draft; offline navigation shows locked shell PASS');
    assert.deepEqual(report.externalRequests,[]); assert.deepEqual(report.apiRequests,[]); assert.deepEqual(report.errors,[]);
    report.status='PASS';
  } finally {
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    await browser.close(); await new Promise(resolve=>server.close(resolve));
  }
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
