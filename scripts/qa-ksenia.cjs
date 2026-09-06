// Actual browser QA, not a fixture or production application entry point.
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const url = process.argv[2] || 'http://127.0.0.1:4179/copy-trading';
const output = path.resolve('node_modules/.cache/ksenia-qa', new URL(url).hostname);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const reports = [];
  try {
    if (process.env.QA_COMPARE_NAZAR) {
      const capture = async target => {
        const context = await browser.newContext({viewport:{width:1440,height:1000}});
        const page = await context.newPage();
        await page.goto(target,{waitUntil:'domcontentloaded',timeout:120000});
        await page.locator('[data-trader-id="VX-001"] .mini-chart-line').waitFor({timeout:120000});
        await page.locator('[data-trader-id="VX-001"]').getByRole('button',{name:'Профиль трейдера',exact:true}).click();
        await page.getByRole('button',{name:'ALL',exact:true}).click();
        const result = await page.locator('.profile-chart-column > section').first().evaluate(panel => ({
          text:panel.textContent, width:panel.getBoundingClientRect().width, height:panel.getBoundingClientRect().height,
          paths:Array.from(panel.querySelectorAll('path')).map(p=>({d:p.getAttribute('d'),stroke:getComputedStyle(p).stroke,fill:getComputedStyle(p).fill})),
        }));
        await context.close(); return result;
      };
      assert.deepEqual(await capture(url),await capture(process.env.QA_COMPARE_NAZAR));
      console.log('Nazar actual 1440px yellow panel text, geometry, paths, stroke and fill equal starting staging.');
    }
    for (const width of [1920,1440,1366,1280,1024,768,430,390,375]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      const card = page.locator('[data-trader-id="VX-KSENIA"]');
      await card.waitFor({ timeout: 120000 });
      await page.locator('[data-trader-id="VX-001"] .mini-chart-line').waitFor();
      assert.deepEqual(await page.locator('.trader-card h3').allTextContents().then(x=>x.slice(0,2)), ['Nazar','Ksenia']);
      assert.equal(await card.locator('[aria-label="Верифицирован"]').count(), 0);
      assert.equal(await card.getByRole('button', {name:'Депозит от $20 000',exact:true}).isEnabled(), false);
      const geometries = await page.locator('.trader-card').evaluateAll(cards => cards.slice(0,3).map(c => ({height:c.getBoundingClientRect().height,width:c.getBoundingClientRect().width})));
      if (width >= 1024) assert.ok(Math.max(...geometries.map(g=>g.height))-Math.min(...geometries.map(g=>g.height)) < 2);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await card.screenshot({ path: path.join(output, `card-${width}.png`) });
      await page.getByRole('textbox',{name:'Поиск трейдеров'}).fill('Ksenia');
      assert.equal(await page.locator('.trader-card').count(),1);
      await page.getByRole('button',{name:'Добавить Ksenia в избранное',exact:true}).click();
      await page.getByRole('tab',{name:'Избранное 1',exact:true}).click();
      await page.getByRole('button',{name:'Профиль трейдера',exact:true}).click();
      await page.getByRole('heading',{name:'Ksenia',exact:true}).waitFor();
      const periods = [];
      for (const [period, count, roi] of [['7D',7,'+62.0%'],['30D',30,'+117.0%'],['90D',90,'+468.0%'],['ALL',396,'+1756.0%']]) {
        await page.getByRole('button',{name:period,exact:true}).click();
        const text = await page.locator('.profile-chart-column').innerText();
        assert.ok(text.includes(roi));
        const bars = await page.locator('.daily-gain, .daily-loss').count();
        const titles = await page.locator('.daily-gain title, .daily-loss title').count();
        assert.equal(bars, count);
        assert.ok((await page.locator('.profile-analytics-workspace aside').innerText()).includes('446'));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        periods.push({ period, bars, titles });
      }
      const text = (await page.locator('main').innerText()).replace(/[\u00a0\u202f]/g,' ');
      assert.ok(text.includes('1 275 547 USDT'));
      assert.ok(text.includes('89,4%'));
      assert.ok(!text.includes('Средняя доходность'));
      assert.ok(!text.includes('Доход Nazar'));
      await page.locator('.profile-analytics-workspace').screenshot({path:path.join(output,`profile-${width}.png`)});
      await page.getByRole('button',{name:'Сделки',exact:true}).click();
      assert.equal(await page.locator('tbody tr').count(),20);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.getByRole('button',{name:'Убрать Ksenia из избранного',exact:true}).click();
      assert.deepEqual(errors,[]);
      reports.push({width,geometries,periods,trades:20,overflow:false,runtimeErrors:errors});
      await context.close();
    }
    const req = await browser.newContext();
    const response = await req.request.get(new URL('/review-synthetic.json',url).href);
    assert.equal(response.status(),200);
    console.log(JSON.stringify({url,reports,nazarHash:createHash('sha256').update(await response.text()).digest('hex')},null,2));
    await req.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
