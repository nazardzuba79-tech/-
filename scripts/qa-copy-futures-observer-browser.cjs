// Offline, isolated frontend fixture only. No real account, worker or funds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require(process.env.COPY_FUTURES_OBSERVER_PLAYWRIGHT || 'playwright');
const root = path.resolve('output/copy-futures-observer/frontend');
assert(fs.existsSync(path.join(root, 'index.html')), 'Build flagged review frontend first');
const app = express(); app.use(express.json());
const endpoint = '/api/v1/copy-trading/futures-demo-observer';
let subscription = null, events = [], scanned = 0, writes = 0, failGet = false;
const snapshot = () => ({ mode: 'OBSERVATION_ONLY', automaticCopying: false,
  subscription, events });
app.get(endpoint, (_req, res) => {
  if (failGet) return res.status(503).json({ code: 'FIXTURE_OUTAGE' });
  res.json(snapshot());
});
app.put(endpoint + '/subscription', (req, res) => {
  writes++;
  if (!['VX-001','VX-KSENIA'].includes(req.body.traderId)
    || !req.body.maxLeverage || !req.body.maxFillUsdt) return res.status(400).json({ code: 'INVALID_OBSERVER_REQUEST' });
  subscription = { traderId: req.body.traderId, status: 'OBSERVING', lastRevision: 1,
    maxLeverage: req.body.maxLeverage, maxFillUsdt: req.body.maxFillUsdt };
  res.json({ mode: 'OBSERVATION_ONLY', automaticCopying: false, status: 'OBSERVING' });
});
app.post(endpoint + '/scan', (_req, res) => {
  writes++; scanned++;
  if (!subscription || subscription.status !== 'OBSERVING') return res.status(409).json({ code: 'OBSERVER_STOPPED' });
  subscription.lastRevision++;
  if (scanned === 1) events = [{ sourceEventId: 'fixture-source-1', kind: 'OPEN',
    symbol: 'BTCUSDT', quantity: '0.125', price: '61000', status: 'OBSERVED_ONLY' }];
  res.json({ mode: 'OBSERVATION_ONLY', automaticCopying: false, scannedRevisions: 1,
    accepted: scanned === 1 ? 1 : 0, rejected: 0, lastRevision: subscription.lastRevision, hasMore: false });
});
app.delete(endpoint + '/subscription', (_req, res) => {
  writes++; if (subscription) subscription.status = 'STOPPED';
  res.json({ mode: 'OBSERVATION_ONLY', automaticCopying: false, status: 'STOPPED' });
});
app.use(express.static(root));
app.get('*', (_req,res) => res.sendFile(path.join(root,'index.html')));

async function main() {
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const errors = [], unexpectedWrites = [], external = [], cases = [];
  const open = async (width,lang='en') => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(({lang}) => {
      localStorage.setItem('exchange_token','isolated-review-token');
      localStorage.setItem('exchange_lang',lang);
    }, {lang});
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort(); // no external services
      if (request.method() !== 'GET' && !url.pathname.startsWith(endpoint)) {
        unexpectedWrites.push(url.pathname); return route.abort();
      }
      if (url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith(endpoint))
        return route.fulfill({ contentType: 'application/json', body: '{}' });
      return route.continue();
    });
    await page.goto(origin + '/copy-trading/futures-demo-observer');
    await page.locator('form').waitFor();
    return { ctx, page };
  };
  try {
    const desktop = await open(1440), page = desktop.page;
    await page.getByText('No observer subscription', {exact:true}).waitFor();
    await page.getByText('Automatic copying: OFF', {exact:true}).waitFor();
    await page.getByLabel('Maximum observed leverage').fill('3');
    await page.getByLabel('Maximum observed fill (USDT)').fill('900');
    await page.getByRole('button',{name:'Save observation'}).click();
    await page.getByText('Observing confirmed demo events — NO order copying',{exact:true}).waitFor();
    assert.equal(writes,1);
    await page.getByRole('button',{name:'Check new source fills'}).click();
    await page.getByText(/BTCUSDT · OPEN · 0.125 @ 61000/).waitFor();
    assert.equal(writes,2);
    await page.reload();
    await page.getByText(/BTCUSDT · OPEN · 0.125 @ 61000/).waitFor();
    const out = path.resolve('output/copy-futures-observer');fs.mkdirSync(out,{recursive:true});
    await page.screenshot({path:path.join(out,'futures-observer-1440.png'),fullPage:true});
    cases.push('1440 subscribe, scan, no orders, reload');
    const mobile = await open(390), mobilePage = mobile.page;
    await mobilePage.getByText(/BTCUSDT · OPEN · 0.125 @ 61000/).waitFor();
    assert.equal(await mobilePage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await mobilePage.screenshot({path:path.join(out,'futures-observer-390.png'),fullPage:true});
    await mobilePage.getByRole('button',{name:'Stop observing'}).click();
    await mobilePage.getByText('Observation stopped',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Refresh status'}).click();
    await page.getByText('Observation stopped',{exact:true}).waitFor();
    await mobile.ctx.close();await desktop.ctx.close();
    cases.push('390 independent device, stop and desktop synchronization');
    for(const lang of ['ru','zh','es','hi','ja','ko']){
      const {ctx,page} = await open(390,lang);
      await page.getByText('Automatic copying: OFF',{exact:true}).count().catch(()=>0);
      await page.locator('h1').waitFor();
      assert.ok((await page.locator('h1').innerText()).length>4);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      await ctx.close();cases.push(lang+' mobile layout');
    }
    const switched = await open(1440);
    await switched.page.getByText(/BTCUSDT · OPEN · 0.125 @ 61000/).waitFor();
    // Real cross-tab storage update, not a synthetic same-tab event: browsers
    // emit storage to OTHER documents sharing the origin.
    const secondTab = await switched.ctx.newPage();
    await secondTab.goto(origin + '/copy-trading/futures-demo-observer');
    await secondTab.evaluate(() => localStorage.setItem('exchange_token', 'other-account-session'));
    await switched.page.waitForFunction(() =>
      !document.body.textContent?.includes('0.125 @ 61000'), null, { timeout: 10000 });
    assert.equal(await switched.page.getByText(/BTCUSDT · OPEN · 0.125 @ 61000/).count(), 0);
    await switched.ctx.close(); cases.push('account switch clears prior observer state');

    failGet = true;
    const faulty = await open(1440);
    await faulty.page.getByRole('alert').waitFor();
    assert.equal(await faulty.page.getByRole('button',{name:/Save observation/i}).isDisabled(),true);
    await faulty.ctx.close();cases.push('API failure does not claim confirmed observer');
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedWrites, []);
    assert.deepEqual(external, []);
    fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({
      passed:true,cases,writes,unexpectedWrites,errors,backend:'isolated in-memory observation fixture',production:false,
    },null,2));
    console.log('PASS Futures observer browser',cases.length,'cases');
  } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
}
main().catch(err => {console.error(err);process.exitCode=1;});
