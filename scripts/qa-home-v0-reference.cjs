'use strict';
// Real browser/reference comparison at the same geometric scale. Local fixtures
// only. This is NOT a raster replacement of the functional website.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.HOME_QA_PLAYWRIGHT || 'playwright');
const { fixture } = require('./qa-home-v0.cjs');
const out = path.resolve('output/home-v0/reference');
const reference = process.env.HOME_V0_REFERENCE;
if (!reference || !fs.existsSync(reference)) throw Error('HOME_V0_REFERENCE must point to the verified archive public/images/voltex-reference.png');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(reference, path.join(out, 'reference.png'));
const report = { fixtureOnly: true, sourceSize: [1619,971], referenceHeroCrop: [0,60,1619,816], rows: [], errors: [] };
let browser, server;
(async () => {
  const app = express(); app.use('/api/v1', fixture);
  app.use('/__evidence', express.static(out));
  app.get('/__reference.png', (_req,res) => res.sendFile(path.resolve(reference)));
  app.use(express.static(path.resolve('frontend/dist')));
  app.get('*', (_req,res) => res.sendFile(path.resolve('frontend/dist/index.html')));
  server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.HOME_QA_BROWSER_CHANNEL || undefined, args: ['--no-sandbox','--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin || route.request().url().startsWith('data:') ? route.continue() : route.abort());
  await context.addInitScript(() => localStorage.setItem('exchange_lang','ru'));
  const page = await context.newPage(); page.on('pageerror',e=>report.errors.push(e.message));
  for (const width of [1920,1440,1366]) {
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.goto(origin,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.querySelector('.v0-coins')?.dataset.ready==='true');
    await page.locator('#home-live-terminal .book-row').first().waitFor();
    await page.screenshot({path:path.join(out,`desktop-${width}.png`)});
    await page.locator('.hs-root .hero').screenshot({path:path.join(out,`hero-${width}.png`)});
    const geometry=await page.evaluate(()=>{
      const b=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
      return {hero:b(document.querySelector('.hs-root .hero')), image:b(document.querySelector('.hs-root .art')), title:b(document.querySelector('#hs-title')), copy:b(document.querySelector('.hs-root .copy')), terminal:b(document.querySelector('.terminal-screen')), slots:b(document.querySelector('.v0-coins-labels')), coins:[...document.querySelectorAll('.v0-coin')].filter(e=>getComputedStyle(e).visibility!=='hidden').map(b), overflow:document.documentElement.scrollWidth-innerWidth};
    });
    assert.ok(geometry.overflow<=1);
    assert.equal(geometry.coins.length,20,'twenty requested markets: BTC centre and nineteen satellites');
    assert.ok(Math.abs(geometry.image.w-geometry.hero.w)<1,'unchanged full-width reference plate');
    assert.ok(geometry.copy.x < geometry.slots.x && geometry.terminal.x > geometry.slots.x,'copy/scene/terminal ordering retained');
    report.rows.push({width,geometry});
    // The reference has a drawn header/tape. Compare ONLY its corresponding
    // Hero crop; retain screenshot of the real full page above for context.
    const compare=await context.newPage();await compare.setViewportSize({width:1680,height:475});
    await compare.goto(origin);
    await compare.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;background:#070f1b;color:#dae7f6;font:13px Arial}header{height:44px;padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px}main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 12px}.pane{position:relative;aspect-ratio:1619/816;overflow:hidden}.ref{position:absolute;width:100%;height:auto;top:-7.352941%}.actual{width:100%;height:auto;display:block}</style></head><body><header><span>LEFT — voltex-reference.png · исходный эталон</span><span>RIGHT — реальный браузер · ${width}px · fixture-котировки</span></header><main><div class="pane"><img class="ref" src="${origin}/__reference.png"></div><div class="pane"><img class="actual" src="${origin}/__evidence/hero-${width}.png"></div></main></body></html>`);
    await compare.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
    await compare.screenshot({path:path.join(out,`comparison-${width}.png`)});
    fs.writeFileSync(path.join(out,`comparison-${width}.html`),(await compare.content()).replaceAll(origin+'/__reference.png','reference.png').replaceAll(origin+'/__evidence/',''));
    await compare.close();
  }
  assert.equal(report.errors.length,0);
  await context.close();
})().catch(e=>{report.errors.push(e.stack);process.exitCode=1;console.error(e)}).finally(async()=>{fs.writeFileSync(path.join(out,'alignment.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(browser)await browser.close();if(server)await new Promise(r=>server.close(r))});
