/** Browser evidence against scripts/qa-professional-terminals.cjs (all writes blocked).
 * Uses actual public quotes/chart; does not inject market/account values. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = process.env.TERMINAL_QA_ORIGIN || 'http://127.0.0.1:4202';
const out = 'docs/qa/terminal-reference';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH, headless: true });
  const result = [];
  try {
    for (const [width, height] of [[1920,1080], [1440,900], [1366,768], [1280,900], [1024,900], [768,1024], [390,844]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.goto(`${origin}/__qa/start`);
        await page.waitForURL('**/trade');
        await page.goto(`${origin}/futures`);
        const chart = page.frameLocator('.voltex-tradingview-chart iframe');
        await chart.locator('[data-name="open-indicators-dialog"]:visible').waitFor({ timeout: 45000 });
        await page.waitForTimeout(2000);
        const geometry = await page.evaluate(() => {
          const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { x:r.x, y:r.y, width:r.width, height:r.height };
          };
          return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            chart:rect('.chart-area'), book:rect('.orderbook-area'), form:rect('.order-form-area'), bottom:rect('.bottom-panel'),
            frame:rect('.voltex-tradingview-chart iframe'), canvas:rect('.voltex-tradingview-chart__owned'),
            frames:document.querySelectorAll('.voltex-tradingview-chart iframe').length,
            buttons:[...document.querySelectorAll('.fo-submitPair button')].map(n=>({width:n.clientWidth, scrollWidth:n.scrollWidth})),
            background:getComputedStyle(document.querySelector('.chart-area')).backgroundColor,
            sidebar:document.querySelector('.reference-market-sidebar') ? rect('.reference-market-sidebar') : null,
            marketLists:document.querySelectorAll('.pairs-list').length,
          };
        });
        assert.ok(geometry.scrollWidth <= width, `page overflow at ${width}: ${geometry.scrollWidth}`);
        assert.equal(geometry.frames, 1);
        assert.ok(Math.abs(geometry.frame.width - geometry.canvas.width) <= 2, 'native frame fills chart');
        assert.ok(geometry.buttons.every(b => b.scrollWidth <= b.width + 1), 'action labels fit');
        if (width > 1024) {
          assert.ok(geometry.sidebar.width >= 218, 'persistent left search and market list');
          assert.equal(geometry.chart.x, geometry.sidebar.width, 'chart starts directly after sidebar');
          assert.ok(Math.abs(geometry.form.y + geometry.form.height - geometry.bottom.y - geometry.bottom.height) <= 1, `right rail spans lower panel: ${JSON.stringify(geometry)}`);
        }
        if (width > 600 && width <= 1024) assert.equal(geometry.book.y, geometry.form.y, 'tablet book and form share one row');
        await page.screenshot({ path:`${out}/futures-${width}.png`, fullPage:width > 600 && width <= 1024 });
        if (width === 390) {
          const chooser = page.locator('.ticker-bar .pair-selector');
          await chooser.click();
          const dialog = page.locator('.reference-market-dialog');
          await dialog.waitFor({state:'visible'});
          assert.equal(await dialog.locator('input').evaluate(n => n === document.activeElement), true);
          await page.keyboard.press('Escape');
          assert.equal(await dialog.isVisible(), false);
          await page.locator('.chart-area').scrollIntoViewIfNeeded();
          await page.waitForTimeout(1500);
          await page.screenshot({path:`${out}/futures-390-chart.png`});
          await page.locator('.fo-mlWrap').evaluate(n => window.scrollTo(0, n.getBoundingClientRect().top + scrollY - 110));
          await page.waitForTimeout(500);
          assert.equal(await page.locator('.fo-mlTrigger').first().evaluate(n => {
            const r = n.getBoundingClientRect();
            return n.contains(document.elementFromPoint(r.x + r.width/2, r.y + r.height/2));
          }), true, 'mobile leverage controls reachable above bottom navigation');
          await page.screenshot({path:`${out}/futures-390-controls.png`});
        }
        if (width === 1440) {
          await chart.locator('[data-name="open-indicators-dialog"]:visible').click();
          await chart.getByRole('dialog').waitFor({timeout:10000});
          await chart.getByRole('dialog').locator('[data-qa-id="close"]').click();
          await chart.getByRole('dialog').waitFor({state:'hidden'});
          assert.equal(await page.locator('.voltex-tradingview-chart__copyright a').isVisible(), true);
          geometry.nativeControls = 'Indicators opens and closes; attribution remains visible; iframe uncropped';
          const chooser = page.locator('.ticker-bar .pair-selector');
          const sidebar = page.locator('.reference-market-sidebar');
          await chooser.click();
          assert.equal(await sidebar.locator('input').evaluate(n => n === document.activeElement), true);
          assert.equal(await page.locator('dialog').count(), 0);
          await page.screenshot({path:`${out}/market-selector.png`});
          for (let i=0; i<20; i++) {
            const base = i%2 ? 'BTC' : 'ETH';
            await sidebar.locator('input').fill(base);
            await sidebar.locator('.pair-row').filter({hasText:new RegExp(`\\b${base}\\b`)}).first().click();
            await page.waitForFunction(expected => {
              const frame=document.querySelector('.voltex-tradingview-chart iframe');
              if (!frame) return false;
              try { return JSON.parse(decodeURIComponent(new URL(frame.src).hash.slice(1))).symbol === expected; } catch { return false; }
            }, `BYBIT:${base}USDT.P`);
            assert.equal(await page.locator('.voltex-tradingview-chart iframe').count(), 1);
          }
          await sidebar.locator('input').fill('');
          await page.setViewportSize({width:390,height:844});
          await page.locator('.reference-market-sidebar').waitFor({state:'detached'});
          await chooser.click();
          await page.locator('.reference-market-dialog[open]').waitFor();
          assert.equal(await page.locator('.pairs-list').count(), 1);
          await page.setViewportSize({width:1440,height:900});
          await sidebar.waitFor();
          assert.equal(await page.locator('dialog').count(), 0);
          assert.equal(await page.locator('.pairs-list').count(), 1);
          geometry.marketSelector = 'persistent search; 20 BTC/ETH selections; one matching iframe; responsive transition keeps one list and removes modal';
        }
        result.push(geometry);
        console.log(JSON.stringify(geometry));
      } finally { await page.close(); }
    }
    fs.writeFileSync(`${out}/browser-results.json`, JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
