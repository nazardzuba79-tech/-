/** CI-only browser fixture. No credentials, external requests or live backend. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.QA_OUT || 'output/regulatory-documents');
fs.mkdirSync(out, { recursive:true });
const report = { result:'FAIL', checks:[], widths:[320,360,390,430,768,1366,1440,1920], languages:['ru','en','zh','es','hi','ja','ko'], errors:[], fixtureOnly:true };
const check = (condition, name) => { assert.ok(condition, name); report.checks.push(name); };
const walk = directory => fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(path.join(directory,entry.name)) : [path.join(directory,entry.name)]);
const production = 'http://127.0.0.1:4280';
const review = 'http://127.0.0.1:4281';
let browser;
const servers = [];
async function ready(url) {
  for(let attempt=0;attempt<100;attempt++) {
    try { if((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error(`Local fixture unavailable: ${url}`);
}
async function main() {
  const dist=path.join(root,'frontend/dist');
  check(!fs.existsSync(path.join(dist,'review')), 'Production excludes isolated review directory');
  const publicImage=path.join(dist,'regulatory-documents','voltex-portfolio.png');
  check(fs.existsSync(publicImage),'Production includes the supplied collage');
  check(crypto.createHash('sha256').update(fs.readFileSync(publicImage)).digest('hex')==='275f0610d81e672728b9bcb1189c4dc93855e4497738094ff23ee412f81804cb','Production preserves the supplied image bytes');
  for(const file of walk(dist).filter(file=>/\.(js|html|json|css)$/.test(file))) {
    assert.doesNotMatch(fs.readFileSync(file,'utf8'), /PS2024\/0187|VARA-2024-001234|FINMA-FINTECH-2024-4587/);
  }
  check(true, 'Production excludes transcribed candidate identifiers');
  for(const [port, preview] of [[4280,true],[4281,false]]) {
    servers.push(spawn(process.execPath,[path.join(root,'frontend/node_modules/vite/bin/vite.js'),...(preview?['preview']:[]),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:path.join(root,'frontend'),stdio:'pipe'}));
  }
  await Promise.all([ready(production),ready(review+'/review/licences/index.html')]);
  browser = await chromium.launch({headless:true});
  const context=await browser.newContext();
  await context.route('**/*', route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/review/licences/portfolio.png')) return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=','base64')});
    if(![production,review].includes(url.origin)) return route.abort();
    if(url.pathname.startsWith('/api/')) return route.fulfill({contentType:'application/json',body:'{}'});
    if(route.request().method()!=='GET') return route.abort();
    return route.continue();
  });
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  for(const language of report.languages) {
    await page.goto(review+'/review/licences/index.html');
    await page.evaluate(language=>localStorage.setItem('exchange_lang',language),language);
    await page.reload();
    await page.locator(`main[lang="${language}"]`).waitFor();
    check(await page.locator('.licence-card').count()===7,`${language}: seven review cards`);
    check(await page.locator('.licences-review').isVisible(),`${language}: review context visible`);
    for(const width of report.widths) {
      await page.setViewportSize({width,height:900});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${language}/${width}: no horizontal overflow`);
      const columns=await page.locator('.licences-grid').evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length);
      check(columns===(width<=600?1:width<=1100?2:3),`${language}/${width}: grid columns`);
    }
    await page.goto(production+'/legal/licenses');
    await page.evaluate(language=>localStorage.setItem('exchange_lang',language),language);
    await page.reload();
    await page.locator(`main[lang="${language}"]`).waitFor();
    check(await page.locator('.licences-portfolio').isVisible(),`${language}: public supplied-material section accessible without authentication`);
    check(await page.locator('.licences-portfolio-image img').evaluate(image=>image.complete&&image.naturalWidth===1536&&image.naturalHeight===1024),`${language}: supplied image renders at original dimensions`);
    check(await page.locator('.licences-portfolio-status').count()===0,`${language}: removed portfolio label does not render`);
    check(await page.locator('.licence-card').count()===0,`${language}: no unverified public cards`);
    check(await page.locator('meta[name="robots"][content="noindex, nofollow"]').count()===1,`${language}: indexing deferred`);
  }
  await page.goto(production+'/legal/licenses');
  await page.evaluate(()=>localStorage.setItem('exchange_lang','ru'));
  await page.reload();
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`public/${width}: no horizontal overflow`);
    await page.screenshot({path:path.join(out,`public-${width}.png`),fullPage:true});
  }
  await page.goto(review+'/review/licences/index.html');
  await page.getByRole('button',{name:'RU',exact:true}).click();
  await page.locator('main[lang="ru"]').waitFor();
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    await page.screenshot({path:path.join(out,`review-${width}.png`),fullPage:true});
  }
  const opener=page.locator('.licence-document-button').first();
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog'); await dialog.waitFor();
  await page.waitForFunction(()=>{ const image=document.querySelector('dialog img');return image&&image.complete&&image.naturalWidth>0; });
  check(await dialog.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),'Image viewer renders test fixture');
  await page.getByRole('button',{name:'Увеличить',exact:true}).click();
  check((await dialog.locator('output').innerText())==='125%','Image zoom');
  await page.getByRole('button',{name:'Закрыть документ',exact:true}).focus();
  await page.keyboard.press('Tab');
  check(await page.evaluate(()=>Boolean(document.activeElement.closest('dialog'))),'Modal focus remains contained');
  await page.keyboard.press('Escape');
  check(await dialog.count()===0,'Escape closes viewer');
  check(await opener.evaluate(element=>element===document.activeElement),'Focus returns to opener');
  await page.goto(production+'/legal/about');
  await page.locator('a[href="/legal/licenses"]').first().waitFor();
  check(await page.locator('a[href="/legal/licenses"]').count()>0,'About footer links to licences');
  await page.locator('a[href="/legal/licenses"]').first().click();
  await page.locator('.licences-portfolio').waitFor();
  await page.goto(production+'/');
  await page.locator('a[href="/legal/licenses"]').first().waitFor();
  check(await page.locator('a[href="/legal/licenses"]').count()>0,'Homepage footer links to licences');
  check(report.errors.length===0,'No JavaScript page errors');
  report.result='PASS';
}
main().catch(error=>{ report.errors.push(error.stack);process.exitCode=1; }).finally(async()=>{
  if(browser)await browser.close();
  for(const server of servers)server.kill();
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({result:report.result,checks:report.checks.length,errors:report.errors},null,2));
});
