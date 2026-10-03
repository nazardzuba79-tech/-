/** Shared dropdown visual review. Real bundle, loopback fixtures only. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
const arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const phase = arg('--phase', 'after');
const home = args.includes('--home');
const surface = home ? '-home' : '';
const out = path.resolve(arg('--out', 'docs/qa/header-dropdowns'));
const port = arg('--port', '4398');
const origin = `http://127.0.0.1:${port}`;
const groups = [['markets', '/markets', ['/tools']], ['trading', '/trade', ['/trade', '/trade?market=cfd']],
  ['otc', '/otc', ['/otc', '/arbitrage']], ['academy', '/academy', ['/academy/learn', '/academy/knowledge', '/academy/faq', '/academy/glossary']]];
fs.mkdirSync(out, { recursive: true });
const fixture = spawn(process.execPath, ['scripts/qa-futures-proportions.cjs', '--serve', '--port', port,
  '--dist', path.resolve(arg('--dist', 'frontend/dist')), '--out', out, ...(home ? ['--signed-out'] : [])], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; fixture.stdout.on('data', d => { serverLog += d; }); fixture.stderr.on('data', d => { serverLog += d; });
const report = { phase, surface: home ? 'home' : 'futures', widths: arg('--widths','1920,1600,1440,1366,390').split(',').map(Number), cases: [], pageErrors: [], external: [], financialWrites: [] };
let browser;
async function run() {
  for (let i=0; i<100; i++) {
    if (fixture.exitCode !== null) throw new Error(serverLog);
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(r => setTimeout(r,100));
  }
  browser = await chromium.launch();
  for (const width of report.widths) {
    const context = await browser.newContext({ viewport:{width,height:width===390?844:1000}, locale:'ru-RU', deviceScaleFactor:1 });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { report.external.push(url.origin); return route.abort(); }
      if (!['GET','HEAD'].includes(request.method()) && !/\/native\/(quote|execution-session)$/.test(url.pathname)) {
        report.financialWrites.push(url.pathname); return route.abort();
      }
      return route.continue();
    });
    await context.routeWebSocket(/.*/, socket => socket.close());
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    for (const [name, href, destinations] of groups) {
      await page.goto(`${origin}${home ? '/' : '/futures?pair=BTC%2FUSDT'}`, {waitUntil:'networkidle'});
      assert.equal(new URL(page.url()).pathname, home ? '/' : '/futures', 'QA must stay on the intended surface');
      const desktopNav = home ? 'header nav' : '.nav-desktop-links';
      const burger = page.locator(home ? 'header button[aria-label="Меню"]' : '.nav-burger');
      if (phase === 'after' && await burger.isVisible()) {
        const bounds = await burger.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'drawer trigger must be fully visible');
      }
      const desktop = await page.locator(`${desktopNav} a[href="${href}"]`).first().isVisible();
      if (!desktop && !await burger.isVisible() && phase === 'before') {
        const file=`${phase}-${name}-${width}.png`;
        await page.screenshot({path:path.join(out,file),animations:'disabled'});
        report.cases.push({width,group:name,unavailable:true,screenshot:file});
        continue;
      }
      if (!desktop) await burger.click();
      const nav = page.locator(home ? 'header nav:visible' : desktop ? '.nav-desktop-links' : '.nav-mobile-menu');
      const heading = nav.locator(`a[href="${href}"]`).first();
      await heading.scrollIntoViewIfNeeded();
      if (desktop) await heading.hover();
      else {
        const toggle = heading.locator('..').locator(':scope > .header-disclosure-toggle');
        if (await toggle.count()) await toggle.click();
      }
      const panel = nav.locator('.header-disclosure-panel:visible, .nav-dropdown:visible');
      if (phase === 'after') {
        await panel.waitFor();
        const bounds = await panel.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'panel stays inside viewport');
        assert.deepEqual(await panel.locator('a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))), destinations);
        const cards = await panel.locator('.header-menu-card').evaluateAll(nodes=>nodes.map(card=>{
          const icon=card.querySelector('.header-menu-icon'), title=card.querySelector('.header-menu-title'), description=card.querySelector('.header-menu-description');
          const rect=icon.getBoundingClientRect(), style=getComputedStyle(title), desc=getComputedStyle(description);
          return { svg:icon.querySelectorAll('svg').length, tile:rect.width, size:parseFloat(style.fontSize), weight:Number(style.fontWeight), description:description.textContent, descSize:parseFloat(desc.fontSize) };
        }));
        for (const card of cards) { assert.equal(card.svg,1); assert.ok(card.tile>=32&&card.tile<=36); assert.ok(card.size>=13&&card.size<=14); assert.ok(card.weight>=600); assert.ok(card.descSize>=11&&card.descSize<=12); assert.ok(card.description.length>0); }
        assert.equal(await nav.locator('a[href="/card"]').innerText(),'Crypto-Card');
        const last=panel.locator('a').last(); await last.scrollIntoViewIfNeeded();
        assert.ok(await last.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}), 'menu card must receive pointer events');
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
      const file=`${phase}${surface}-${name}-${width}.png`;
      await page.screenshot({path:path.join(out,file),animations:'disabled'});
      report.cases.push({width,group:name,mobile:!desktop,screenshot:file});
      await page.keyboard.press('Escape');
    }
    await context.close();
  }
  assert.deepEqual(report.pageErrors,[]); assert.deepEqual(report.financialWrites,[]);
  console.log(JSON.stringify({phase,cases:report.cases.length,pageErrors:report.pageErrors,financialWrites:report.financialWrites}));
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  fs.writeFileSync(path.join(out,`${phase}${surface}-report.json`),JSON.stringify(report,null,2)+'\n');
  await browser?.close(); fixture.kill();
});
