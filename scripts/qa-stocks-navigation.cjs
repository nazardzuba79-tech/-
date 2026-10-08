// Built UI, isolated read-only fixtures. Never forwards traffic to production.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { once } = require('node:events');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.QA_OUTPUT || path.join(root, 'output/stocks-navigation'));
// Reuse the existing terminal QA's read-only Express fixtures, without running
// its test driver. Keep crypto fixture responses identical across both suites.
const terminalQA = fs.readFileSync(path.join(__dirname, 'qa-spot-cfd-terminal.cjs'), 'utf8');
const boundary = terminalQA.indexOf('const DESKTOP =');
assert.ok(boundary > 0, 'terminal fixture boundary must exist');
const fixtureModule = { exports: {} };
vm.runInNewContext(terminalQA.slice(0, boundary) + '\nmodule.exports = app;', {
  require, __dirname, process, console, module: fixtureModule,
});
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'services/stocks/manifest.json')));
const now = Date.UTC(2026, 9, 7, 15);
const candles = Array.from({length: 30}, (_, n) => ({openTimeUtc: now-(30-n)*900000,
  closeTimeUtc: now-(29-n)*900000, open: '100', high: '102', low: '99', close: '101', volume: null, fetchedAt: now}));
const instruments = manifest.map(i => ({...i, latest: candles.at(-1), sessionChange: 1}));
const routes = ['/trade', '/futures', '/trade?market=cfd', '/stocks'];
const langs = ['ru','en','zh','es','hi','ja','ko'];
const report = { views: [], transitions: [], pageErrors: [], writesBlocked: 0, externalBlocked: 0, stockRequests: 0 };

(async () => {
  fs.mkdirSync(out, {recursive:true});
  const server = fixtureModule.exports.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({headless:true});
  try {
    for (const lang of langs) {
      const ctx = await browser.newContext({viewport:{width:1920,height:1000}, locale:'en-US', serviceWorkers:'block'});
      await ctx.addInitScript(l => {localStorage.setItem('exchange_lang',l);localStorage.setItem('exchange_token','isolated-qa');}, lang);
      await ctx.route('**/*', async route => {
        const request = route.request(), u = new URL(request.url());
        if (!['GET','HEAD'].includes(request.method())) {report.writesBlocked++; return route.abort();}
        if (u.origin === 'http://127.0.0.1:4431') {
          report.stockRequests++;
          return route.fulfill({contentType:'application/json',body:JSON.stringify(u.pathname.includes('/history/')?{candles,next:null}:{instruments})});
        }
        if (u.origin === origin) return route.continue();
        report.externalBlocked++;
        if (u.hostname === 'market.voltextech.net') {
          const response = await route.fetch({url:origin+'/api/v1'+u.pathname+u.search});
          return route.fulfill({response});
        }
        return route.abort();
      });
      await ctx.routeWebSocket('**/*', socket => socket.close());
      const page = await ctx.newPage(); page.on('pageerror',e => report.pageErrors.push(e.message));
      // Stocks opens on its working panel; phones keep the list in a drawer.
      const waitStock = () => page.locator('.vxs-terminal').waitFor();
      const openFirstInstrument = async (width) => {
        if (width <= 860) await page.locator('.vxs-list-button').first().click();
        // Not the reopened active row: a link to the current URL replaces history.
        await page.locator('.vxs-row:not(.is-active) > a:visible').first().click();
      };
      async function chooseMenu(width) {
        if (width <= 430) {
          await page.locator('.bottom-trading-trigger').click();
          return page.locator('.bottom-trading-panel');
        }
        const desktop = page.locator('.nav-desktop-links');
        if (await desktop.isVisible()) {
          const disclosure = desktop.locator('.header-disclosure').filter({has:page.locator('.header-disclosure-heading > a[href="/trade"]')});
          await page.mouse.move(0, 0);
          await disclosure.hover();
          await disclosure.locator('.header-disclosure-panel').waitFor();
          return disclosure.locator('.header-disclosure-panel');
        }
        await page.locator('.nav-burger').click();
        const disclosure = page.locator('.nav-mobile-menu .header-disclosure').filter({has:page.locator('.header-disclosure-heading > a[href="/trade"]')});
        await disclosure.locator('.header-disclosure-toggle').click();
        return disclosure.locator('.header-disclosure-panel');
      }
      for (const width of [1920,1440,1366,430,390,360,320]) {
        await page.setViewportSize({width,height:1000});
        await page.goto(origin+'/stocks'); await waitStock();
        const panel = await chooseMenu(width);
        assert.deepEqual(await panel.locator(':scope > a').evaluateAll(a=>a.map(e=>e.getAttribute('href'))),routes);
        const stockLabel = await panel.locator('a[href="/stocks"]').innerText();
        assert.ok(!stockLabel.includes('stocks.'), lang+' has translated stock label');
        assert.equal(await page.locator('.nav-desktop-links > a[href="/stocks"]').count(),0);
        assert.equal(await page.locator('.bottom-nav > a, .bottom-nav > button').count(),4);
        if (width <= 430) assert.ok(await panel.locator('a[href="/stocks"]').evaluate(el => {
          const r = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(r.right - 16, r.top + r.height / 2));
        }), 'stock choice must not be covered by support launcher');
        const box = await panel.boundingBox(); assert.ok(box && box.x>=0 && box.x+box.width<=width+1 && box.y>=0 && box.y+box.height<=1001, `${lang}/${width} panel clipped`);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        await page.screenshot({path:path.join(out,`${lang}-${width}-navigation.png`)});
        report.views.push({lang,width,stockLabel,menuBounds:box});
      }
      // Shared HomeHeader must expose the same single stock menu item.
      await page.setViewportSize({width:1920,height:1000}); await page.goto(origin+'/');
      const homeTrade = page.locator('.header-disclosure:visible').filter({has:page.locator('.header-disclosure-heading > a[href="/trade"]')});
      await page.mouse.move(0, 0);
      await homeTrade.hover();
      await homeTrade.locator('.header-disclosure-panel').waitFor();
      assert.equal(await homeTrade.locator('a[href="/stocks"]').count(),1);
      assert.equal(await page.locator('nav > a[href="/stocks"]').count(),0);
      if (lang === 'ru') {
        await page.screenshot({path:path.join(out,'ru-home-desktop-navigation.png')});
        for (const width of [1920,430,390,360,320]) {
          await page.setViewportSize({width,height:1000});
          const baseline = {};
          async function terminalSnapshot() {
            await page.locator('.trade-terminal').waitFor(); await page.waitForTimeout(700);
            return page.evaluate(() => {
              const el = document.querySelector('.trade-terminal'), css = getComputedStyle(el);
              const panel = el.querySelector('.chart-area,.cfd-chart-area');
              return {classes:el.className, tokens:Object.fromEntries(['--bg-primary','--bg-secondary','--text-primary','--border-color','--accent-yellow','--color-buy','--color-sell'].map(k=>[k,css.getPropertyValue(k)])),
                chart:panel?{background:getComputedStyle(panel).backgroundColor,radius:getComputedStyle(panel).borderRadius}:null,
                pair:new URLSearchParams(location.search).get('pair'),market:new URLSearchParams(location.search).get('market')};
            });
          }
          for (const target of routes.slice(0,3)) { await page.goto(origin+target); baseline[target]=await terminalSnapshot(); }
          await page.goto(origin+'/trade'); await terminalSnapshot();
          for (const target of ['/futures','/trade?market=cfd','/stocks','/trade']) {
            const menu = await chooseMenu(width); await menu.locator(`a[href="${target}"]`).click();
            await page.waitForURL(u=>u.pathname+u.search===target || target==='/futures'&&u.pathname==='/futures');
            if (target==='/stocks') await waitStock(); else await terminalSnapshot();
          }
          for (const target of routes.slice(0,3)) {
            if (target!=='/trade') {const menu=await chooseMenu(width);await menu.locator(`a[href="${target}"]`).click();}
            const after=await terminalSnapshot(); assert.deepEqual(after,baseline[target],`${width} ${target} terminal style/route isolation`);
          }
          const menu=await chooseMenu(width); await menu.locator('a[href="/stocks"]').click(); await waitStock();
          await openFirstInstrument(width); await page.locator('.vxs-chart-host canvas').first().waitFor();
          const detailURL=page.url(); await page.goBack();await waitStock();await page.goForward();await page.locator('.vxs-chart-host canvas').first().waitFor();
          assert.equal(page.url(),detailURL); await page.reload();await page.locator('.vxs-chart-host canvas').first().waitFor();
          const detailMenu=await chooseMenu(width);
          if(width<=430) assert.equal(await detailMenu.locator('[aria-current="page"]').getAttribute('href'),'/stocks');
          await detailMenu.locator('a[href="/trade"]').click();await terminalSnapshot();
          await page.goBack();await page.locator('.vxs-chart-host canvas').first().waitFor();
          await page.goForward();await terminalSnapshot();
          report.transitions.push({width,sequence:'Spot → Futures → CFD → Stocks → Spot',terminalStylesAndRouteState:'unchanged',backForward:true,directDetailReload:true});
        }
      }
      await ctx.close();
    }
    assert.deepEqual(report.pageErrors,[]); assert.equal(report.writesBlocked,0);
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({...report,views:report.views.length}));
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
