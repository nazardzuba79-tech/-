/** Browser regression for the REAL FuturesPairList with the REAL terminal CSS.
 * Local synthetic quotes only; no login, API, trading engine or production writes.
 * Checks actual painted text geometry, not merely a hidden DOM label or title.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const front = path.join(root, 'frontend');
const out = path.join(root, 'docs/qa/futures-pair-labels');
const report = { fixtureOnly: true, productionVerified: false, checks: [] };
const temp = fs.mkdtempSync(path.join(front, '.qa-pair-labels-'));
let browser, server, activePage;

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const source = fs.readFileSync(path.join(front, 'src/pages/FuturesPage.tsx'), 'utf8');
  const sheets = [...source.matchAll(/import ['"]\.\/(trade-terminal\/[^'"]+\.css)['"]/g)].map(m => m[1]);
  assert(sheets.length > 0, 'No production Futures styles found');
  // Only market input, artwork and translation are fixture adapters. Sorting,
  // search, favorites, row virtualization and the component itself are real.
  const mockPath = path.join(temp, 'mocks.tsx');
  fs.writeFileSync(mockPath, `import React from 'react';
const rows=[['BTC/USDT','77405.10','1.41'],['ETH/USDT','2468.49','1.76'],['JUP/USDT','0.2559','13.83'],['DOGE/USDT','0.0838','-8.48'],['1000PEPE/USDT','0.011014','14.52']];
const quotes=new Map(rows.map(([pair,lastPrice,changePercent24h],i)=>[pair,{lastPrice:Number(lastPrice),changePercent24h:Number(changePercent24h),quoteVolume24h:1000000-i}]));
export function useFuturesReference(){return quotes;}
export function useLanguage(){return {t:(key:string)=>({'trade.searchPair':'Поиск пары','trade.favorites':'Избранное','trade.price':'Цена','markets.change24h':'24ч %','trade.nothingFound':'Нет пар','nav.futures':'Фьючерсы'}[key]??key)};}
export function CryptoIcon({symbol,size}:{symbol:string;size:number}){return <span aria-hidden style={{display:'grid',placeItems:'center',width:size,height:size,borderRadius:'50%',background:'#245265',color:'#fff',fontSize:10}}>{symbol.slice(0,1)}</span>;}
`);
  fs.writeFileSync(path.join(temp, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  fs.writeFileSync(path.join(temp, 'entry.tsx'), `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FuturesPairList} from '../src/components/FuturesPairList';
${sheets.map(s => `import '../src/pages/${s}';`).join('\n')}
const symbols=['BTC/USDT','ETH/USDT','JUP/USDT','DOGE/USDT','1000PEPE/USDT','UNKNOWN/USDT',...Array.from({length:1500},(_,i)=>'FIXTURE'+i+'/USDT')];
function Fixture(){const [symbol,setSymbol]=useState('BTC/USDT');return <div className="trade-terminal futures-terminal futures-reference futures-studio terminal-studio" data-terminal-design="studio" data-selected={symbol}><div className="terminal"><aside className="left-panel reference-market-sidebar"><FuturesPairList symbols={symbols} symbol={symbol} onChange={setSymbol}/></aside><div className="chart-area"/><div className="orderbook-area"/><div className="order-form-area"/><div className="bottom-panel"/></div></div>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
`);
  const { build } = await import(pathToFileURL(path.join(front, 'node_modules/vite/dist/node/index.js')).href);
  const reactPlugin = createRequire(path.join(front, 'package.json'))('@vitejs/plugin-react').default;
  await build({ root: temp, configFile: false, publicDir: false, logLevel: 'warn',
    plugins: [reactPlugin(), { name: 'pair-labels-fixture', enforce: 'pre', resolveId(id, importer) {
      if (importer?.replaceAll('\\', '/').endsWith('/components/FuturesPairList.tsx') &&
        ['../lib/useFuturesReference', '../lib/i18n', './CryptoIcon'].includes(id)) return mockPath;
    } }], build: { outDir: path.join(temp, 'dist'), emptyOutDir: true } });
  const dist = path.join(temp, 'dist');
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');
  browser = await chromium.launch({ headless: true });
  for (const width of [1664, 1440, 1366, 1280, 1200, 1025, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ru-RU' });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const page = await context.newPage(); activePage = page;
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('Fixture page error:', e.message); });
    await page.goto(origin);
    // At mobile widths the app hosts this same component in a picker. Isolate
    // its available width here instead of claiming to exercise the full dialog.
    if (width < 1025) await page.addStyleTag({ content: `.trade-terminal .terminal{display:block!important}.reference-market-sidebar{display:flex!important;width:calc(100vw - 32px)!important;height:650px!important}` });
    const list = page.locator('.futures-pair-list');
    try { await list.locator('[data-row]').first().waitFor(); }
    catch (error) {
      report.readiness = { width, errors, html: await page.content(), nodes: await page.locator('.pairs-list, .reference-market-sidebar').evaluateAll(nodes => nodes.map(n => ({ tag:n.className, display:getComputedStyle(n).display, rect:n.getBoundingClientRect().toJSON(), rows:n.querySelectorAll('[data-row]').length }))) };
      throw error;
    }
    const dimensions = async () => list.locator('[data-row]').evaluateAll(rows => rows.slice(0, 5).map(row => {
      const name = row.querySelector('.p-name'), base = row.querySelector('.p-base');
      const price = row.querySelector('.p-price'), change = row.querySelector('.p-change');
      const range = document.createRange(); range.selectNodeContents(base);
      const full = range.getBoundingClientRect(), n = name.getBoundingClientRect(), r = row.getBoundingClientRect();
      const prefix = document.createRange(); prefix.setStart(base.firstChild, 0); prefix.setEnd(base.firstChild, Math.min(3, base.textContent.length));
      const p = prefix.getBoundingClientRect(), cell = base.getBoundingClientRect();
      return { pair: row.getAttribute('aria-label'), text: base.textContent, title: row.title,
        rowWidth:r.width, rowHeight:r.height, nameWidth:n.width, fullTextWidth:full.width,
        visiblePrefix: Math.min(p.right, cell.right, n.right)-Math.max(p.left, cell.left, n.left), prefixWidth:p.width,
        collision:n.right>price.getBoundingClientRect().left+0.5,
        price:price.textContent, change:change.textContent,
        priceClipped:price.scrollWidth>price.clientWidth+1, changeClipped:change.scrollWidth>change.clientWidth+1,
        rightOverflow:change.getBoundingClientRect().right>r.right+0.5 };
    }));
    if (width === 1664) {
      await list.evaluate(el => el.classList.remove('futures-pair-list'));
      const before = await page.locator('.pairs-list [data-row]').first().locator('.p-name').evaluate(el => el.getBoundingClientRect().width);
      report.beforeNameWidth = before;
      await page.locator('.reference-market-sidebar').screenshot({ path: path.join(out, 'before-1664-fixture.png') });
      await page.locator('.pairs-list').evaluate(el => el.classList.add('futures-pair-list'));
    }
    const geometry = await dimensions();
    assert(geometry.length >= 5, 'Missing real component rows');
    for (const row of geometry) {
      assert(row.nameWidth >= 32, `${width}: collapsed ticker ${JSON.stringify(row)}`);
      assert(row.visiblePrefix >= row.prefixWidth-0.5, `${width}: ticker prefix is not painted ${JSON.stringify(row)}`);
      if (row.text.length <= 4) assert(row.fullTextWidth <= row.nameWidth+0.5, `${width}: short ticker is truncated ${row.text}`);
      assert(!row.collision && !row.rightOverflow, `${width}: overlapping/out-of-bounds cells ${JSON.stringify(row)}`);
      assert(!row.priceClipped && !row.changeClipped, `${width}: financial text clipped ${JSON.stringify(row)}`);
      assert.equal(row.title, row.pair, 'Full pair hover text changed');
    }
    assert.equal(geometry[0].text, 'BTC', 'Default BTC pin changed');
    assert.equal(geometry[2].text, 'JUP', 'Fixture ordering changed');
    if (width === 1664) assert(report.beforeNameWidth < geometry[0].nameWidth, 'Regression did not reproduce');
    assert(await list.locator('[data-row]').count() < 100, 'Windowing was lost');
    await page.locator('.pairs-head-search').click();
    await page.locator('.pairs-head-input').fill('JUP');
    await list.locator('[aria-label="JUP/USDT"]').click();
    assert.equal(await page.locator('.trade-terminal').getAttribute('data-selected'), 'JUP/USDT');
    await list.locator('.p-star').click();
    assert.equal(await page.locator('.trade-terminal').getAttribute('data-selected'), 'JUP/USDT', 'Favorite click changed market');
    await page.locator('.pairs-head-input').fill('');
    await page.locator('.pairs-tab').click();
    assert.equal(await list.locator('[data-row]').count(), 1, 'Favorite filter changed');
    await page.locator('.pairs-tab').click();
    await page.locator('.pairs-head-input').fill('UNKNOWN');
    assert.equal(await list.locator('.p-price').innerText(), '—');
    assert.equal(await list.locator('.p-change').innerText(), '—');
    await page.locator('.pairs-head-input').fill('');
    await page.locator('.pch-sort').nth(1).click();
    assert.equal(await list.locator('[data-row]').first().getAttribute('aria-label'), '1000PEPE/USDT', '24h descending sort changed');
    assert.equal(await page.locator('.trade-terminal').getAttribute('data-selected'), 'JUP/USDT', 'Sort changed selected market');
    await page.locator('.reference-market-sidebar').screenshot({ path: path.join(out, `after-${width}-fixture.png`) });
    assert.deepEqual(errors, []);
    report.checks.push({ width, passed:true, geometry });
    await context.close();
  }
  report.passed = true;
}
main().catch(error => { report.passed = false; report.error = String(error.stack || error); console.error(error); process.exitCode = 1; })
  .finally(async () => {
    fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    if (!report.passed && activePage && !activePage.isClosed()) {
      await activePage.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
      if (fs.existsSync(path.join(temp,'dist'))) fs.cpSync(path.join(temp,'dist'),path.join(out,'failed-fixture-build'),{recursive:true});
    }
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  });
