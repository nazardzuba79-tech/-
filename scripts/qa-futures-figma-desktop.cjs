/** Desktop-only geometry QA. Reuses the loopback fixture; never contacts production. */
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.FIGMA_QA_OUT || path.join(root, 'output/futures-figma'));
const port = 4445;
const origin = `http://127.0.0.1:${port}`;
const selectors = { header: '.global-header', ticker: '.ticker-bar', chart: '.chart-area', book: '.orderbook-area',
  form: '.order-form-area', bottom: '.bottom-panel', workspace: '.terminal',
  heading: '.archive-trading-heading', chartHeading: '.terminal-chart-heading',
  toolbar: '.chart-toolbar', bottomTabs: '.terminal-account-header', price: '.fo-priceInputRow',
  amount: '.fo-qtyInputRow', buy: '.fo-submitPair .buy', sell: '.fo-submitPair .sell' };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, 'qa-futures-proportions.cjs'), '--serve', '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture startup timed out')), 15000);
    server.stdout.on('data', () => { clearTimeout(timeout); resolve(); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Fixture exited: ${code}`)); });
  });
  const browser = await chromium.launch({ headless: true });
  const report = { cases: [], errors: [], external: [], writes: [] };
  try {
    for (const [width, height] of [[1920,1080], [1440,900], [1707,900], [1366,768]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {
          report.external.push(req.url()); return route.abort();
        }
        if (!['GET','HEAD'].includes(req.method())) report.writes.push({ url: req.url(), method: req.method() });
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      await page.goto(`${origin}/futures?pair=BTC%2FUSDT`);
      await page.locator('.rb-row').first().waitFor();
      await page.waitForTimeout(1200);
      const geometry = await page.evaluate(selectors => {
        const rect = n => { const r = n.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; };
        const parts = Object.fromEntries(Object.entries(selectors).map(([k,s]) => [k,rect(document.querySelector(s))]));
        const tabs = [...document.querySelectorAll('.order-family-tabs button')].map(n => ({ text:n.textContent, ...rect(n) }));
        return { ...parts, tabs, overflow:document.documentElement.scrollWidth-innerWidth };
      }, selectors);
      const near = (a,b,why) => assert.ok(Math.abs(a-b)<1.5, `${width}: ${why}: ${a} vs ${b}`);
      near(geometry.header.height,48,'48px global header (Bybit header above Figma 19:103; owner 2026-10-10)');
      near(geometry.ticker.height,48,'48px instrument bar');
      near(geometry.bottom.height,160,'160px empty account panel');
      near(geometry.book.width,286,'Figma orderbook width');
      near(geometry.form.width,300,'Figma order ticket width');
      near(geometry.chart.y,geometry.book.y,'aligned chart/book');
      near(geometry.chart.height,geometry.book.height,'equal chart/book height');
      near(geometry.book.x-geometry.chart.right,4,'chart/book gutter');
      near(geometry.form.x-geometry.book.right,4,'book/ticket gutter');
      near(geometry.bottom.y-geometry.chart.bottom,4,'bottom gutter');
      near(geometry.buy.height,42,'Figma submit height');
      near(geometry.sell.height,42,'Figma submit height');
      assert.equal(geometry.overflow,0,'no horizontal page overflow');
      assert.ok(geometry.buy.bottom<=height && geometry.sell.bottom<=height,'both trading actions visible');
      assert.ok(geometry.tabs.every(t=>t.x>=geometry.form.x && t.right<=geometry.form.right),'all order types inside ticket');
      assert.ok(geometry.tabs.every((t,i,a)=>!i || t.x>=a[i-1].right),'order type tabs do not overlap');
      assert.ok(geometry.chart.height > height * 0.60, 'chart dominates viewport height');
      await page.screenshot({ path:path.join(out,`desktop-${width}.png`) });
      const top = geometry.workspace.y;
      await page.screenshot({path:path.join(out,`workspace-${width}.png`),clip:{x:0,y:top,width,height:geometry.workspace.height}});
      await page.locator('.order-family-tabs button').nth(1).click();
      assert.equal(await page.locator('.fo-priceInputRow input').count(),0,'Market has no editable limit price input');
      await page.locator('.order-family-tabs button').first().click();
      await page.locator('.fo-priceInputRow input').fill('85000');
      assert.equal(await page.locator('.fo-priceInputRow input').inputValue(),'85000');
      // Existing collapse/expand and populated-table scrolling must survive the CSS change.
      await page.locator('.terminal-account-toggle').click();
      near((await page.locator('.bottom-panel').boundingBox()).height,44,'collapsed account header');
      await page.locator('.terminal-account-toggle').click();
      await context.addCookies([{name:'qa_state',value:'filled',url:origin}]);
      await page.reload();
      await page.locator('.futures-positions-table tbody tr').first().waitFor();
      near((await page.locator('.bottom-panel').boundingBox()).height,200,'200px populated account panel');
      assert.equal(await page.locator('.futures-positions-table tbody tr').count(),3,'all fixture positions retained');
      await page.waitForFunction(() => /\d/.test(document.querySelector('.rb-row')?.textContent || ''));
      await page.screenshot({path:path.join(out,`populated-top-${width}.png`)});
      await page.locator('.futures-positions-table tbody tr').last().scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(out,`populated-${width}.png`)});
      for (const tab of ['orders','orderHistory','positionHistory','assets','positions']) {
        const button = page.locator('#futures-tab-' + tab);
        await button.click();
        assert.equal(await button.getAttribute('aria-selected'),'true','account tab remains usable');
      }
      report.cases.push({width,height,geometry});
      await context.close();
    }
    assert.deepEqual(report.errors,[],'no runtime exceptions');
    assert.deepEqual(report.external,[],'no external requests');
    assert.ok(report.writes.every(r=>/\/private-trading\/native\/(execution-session|quote)$/.test(new URL(r.url).pathname)), 'no financial execution writes (fixture session/quote only)');
  } finally {
    await browser.close(); server.kill();
    fs.writeFileSync(path.join(out,'geometry.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({cases:report.cases.length,errors:report.errors,external:report.external,writeCount:report.writes.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
