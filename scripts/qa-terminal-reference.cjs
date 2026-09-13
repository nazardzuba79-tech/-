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
    for (const [width, height] of [[1920,1080], [1440,900], [1366,768], [1024,900], [768,1024], [390,844]]) {
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
          };
        });
        assert.ok(geometry.scrollWidth <= width, `page overflow at ${width}: ${geometry.scrollWidth}`);
        assert.equal(geometry.frames, 1);
        assert.ok(Math.abs(geometry.frame.width - geometry.canvas.width) <= 2, 'native frame fills chart');
        assert.ok(geometry.buttons.every(b => b.scrollWidth <= b.width + 1), 'action labels fit');
        if (width > 1024) {
          assert.ok(Math.abs(geometry.chart.x) < 1, 'no permanent market sidebar');
          assert.ok(Math.abs(geometry.form.y + geometry.form.height - geometry.bottom.y - geometry.bottom.height) <= 1, `right rail spans lower panel: ${JSON.stringify(geometry)}`);
        }
        if (width > 600 && width <= 1024) assert.equal(geometry.book.y, geometry.form.y, 'tablet book and form share one row');
        await page.screenshot({ path:`${out}/futures-${width}.png`, fullPage:width > 600 && width <= 1024 });
        if (width === 390) {
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
          const chooser = page.locator('.ticker-bar .pair-selector');
          const dialog = page.locator('.reference-market-dialog');
          await chooser.click();
          await dialog.waitFor({state:'visible'});
          assert.equal(await dialog.locator('input').evaluate(n => n === document.activeElement), true);
          await page.screenshot({path:`${out}/market-selector.png`});
          await page.keyboard.press('Escape');
          assert.equal(await dialog.isVisible(), false);
          assert.equal(await chooser.evaluate(n => n === document.activeElement), true);
          for (let i=0; i<20; i++) {
            const base = i%2 ? 'BTC' : 'ETH';
            await chooser.click();
            await dialog.locator('input').fill(base);
            await dialog.locator('.pair-row').filter({hasText:new RegExp(`\\b${base}\\b`)}).first().click();
            assert.equal(await dialog.isVisible(), false);
            await page.waitForFunction(expected => {
              const frame=document.querySelector('.voltex-tradingview-chart iframe');
              if (!frame) return false;
              try { return JSON.parse(decodeURIComponent(new URL(frame.src).hash.slice(1))).symbol === expected; } catch { return false; }
            }, `BYBIT:${base}USDT.P`);
            assert.equal(await page.locator('.voltex-tradingview-chart iframe').count(), 1);
          }
          geometry.marketSelector = 'search focused; Escape restores focus; 20 alternating BTC/ETH selections; one matching iframe';
        }
        result.push(geometry);
        console.log(JSON.stringify(geometry));
      } finally { await page.close(); }
    }
    fs.writeFileSync(`${out}/browser-results.json`, JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
