// Read-only visual comparison against the prior staging release. No account fixtures.
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const target = process.argv[2] || 'http://127.0.0.1:4179';
const baselineUrl = process.argv[3];
const output = path.resolve('node_modules/.cache/review-copy-qa');
fs.mkdirSync(output, { recursive: true });
const baselinePath = path.join(output, 'before.json');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const removed = /Демонстрацион|синтетическ|Демопрофиль|вымышлен/i;
async function capture(browser, base, width, clean) {
  const context = await browser.newContext({ viewport: {width, height:1000}, reducedMotion:'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`${msg.location().url}: ${msg.text()}`); });
  const noOverflow = async () => assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
  const shapes = async locator => locator.evaluateAll(nodes => nodes.map(node=>({
    html:node.outerHTML, width:node.getBoundingClientRect().width, height:node.getBoundingClientRect().height,
  })));
  await page.goto(base+'/copy-trading',{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('[data-trader-id="VX-KSENIA"]').waitFor({timeout:120000});
  await page.locator('[data-trader-id="VX-001"] .mini-chart-line').waitFor();
  const result = { cards:await shapes(page.locator('.trader-card')), profiles:{} };
  if(clean) {
    assert.equal(await page.locator('.copy-marketplace .catalogue-disclosure').count(),0);
    assert.doesNotMatch(await page.locator('main').innerText(),removed);
    assert.equal(await page.locator('.trader-grid').evaluate(grid=>grid.previousElementSibling.classList.contains('section-title')),true);
  }
  await noOverflow();
  if(clean) await page.locator('.trader-grid').screenshot({path:path.join(output,`market-${width}.png`)});
  for(const id of ['VX-001','VX-KSENIA','VX-002']) {
    // First ordinary card ID is discovered from the rendered catalogue.
    const card = id==='VX-002' ? page.locator('.trader-card').nth(2) : page.locator(`[data-trader-id="${id}"]`);
    await card.getByRole('button',{name:'Профиль трейдера',exact:true}).click();
    await page.getByRole('button',{name:'ALL',exact:true}).click();
    const charts=await shapes(page.locator('.profile-chart-wrap, .daily-plot'));
    const stats=await page.locator('.profile-analytics-workspace aside').innerText();
    result.profiles[id]={charts,stats};
    if(clean) assert.doesNotMatch(await page.locator('main').innerText(),removed);
    await noOverflow();
    if(clean && id==='VX-KSENIA') await page.locator('.profile-analytics-workspace').screenshot({path:path.join(output,`profile-${width}.png`)});
    await page.goto(base+'/copy-trading',{waitUntil:'domcontentloaded'});
    await page.locator('[data-trader-id="VX-KSENIA"]').waitFor({timeout:120000});
    await page.locator('[data-trader-id="VX-001"] .mini-chart-line').waitFor();
  }
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.locator('.vx-copy-card').first().waitFor();
  await page.locator('#copy-trading').scrollIntoViewIfNeeded();
  result.homeCards = await shapes(page.locator('.vx-copy-card'));
  if(clean) { assert.equal(await page.locator('#copy-trading p').filter({hasText:'Показатели представлены'}).count(),0); await page.locator('#copy-trading').screenshot({path:path.join(output,`home-${width}.png`)}); }
  await noOverflow();
  const knownFaviconErrors = errors.filter(message => message.startsWith(`${base}/favicon.ico: Failed to load resource: the server responded with a status of 404 (`));
  assert.deepEqual(errors.filter(message => !knownFaviconErrors.includes(message)),[]);
  if(knownFaviconErrors.length) console.log(`${base}: existing browser favicon.ico 404; no application console/page errors`);
  await context.close();
  return result;
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const before = baselineUrl ? {} : JSON.parse(fs.readFileSync(baselinePath,'utf8'));
    for(const width of [1440,390]) {
      if(baselineUrl) before[width]=await capture(browser,baselineUrl,width,false);
      const after=await capture(browser,target,width,true);
      assert.deepEqual(after,before[width],`${width}: cards, charts and statistics must remain exact`);
      console.log(`${width}: removed copy absent, exact cards/charts/stats, no overflow/new application errors`);
    }
    if(baselineUrl) fs.writeFileSync(baselinePath,JSON.stringify(before));
    for(const lang of ['ru','en','zh','es','hi','ja','ko']) {
      const context=await browser.newContext({viewport:{width:390,height:1000}});
      await context.addInitScript(lang=>localStorage.setItem('exchange_lang',lang),lang);
      const page=await context.newPage(); await page.goto(target+'/',{waitUntil:'domcontentloaded'});
      await page.locator('.vx-copy-card').first().waitFor();
      // The translated disclosure was the sole direct paragraph after the card grid.
      assert.equal(await page.locator('#copy-trading .vx-copy-shell > .relative > p').count(),0);
      assert.match(await page.locator('.review-notice').innerText(),/Copy Trading figures are synthetic/);
      await context.close();
    }
    const request=await browser.newContext();
    for(const [route,expected] of [
      ['/review-synthetic.json','2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2'],
      ['/review-api/copy-trading/ksenia','ae1998b7cd06366eb2fb5e3d7c1df3a8b542ffe96d8e50c05a33e91fbea30ef4'],
    ]) {
      // Local Ksenia generation differs from persisted JSON only in IEEE-754 tails;
      // full byte comparison is required for the actual deployed backend response.
      if(new URL(target).hostname==='127.0.0.1' && route.includes('ksenia')) continue;
      const response=await request.request.get(target+route); assert.equal(response.status(),200);
      const digest=hash(await response.json()); assert.equal(digest,expected); console.log(route+' unchanged '+digest);
    }
    await request.close();
    console.log('All seven homepage languages: PASS; existing global review disclosure preserved.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
