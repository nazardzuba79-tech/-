/** LARGE-VALUE LAYOUT QA — real browser, real components, synthetic values.
 *
 * The formatter is covered by Jest; what cannot be checked there is PIXELS:
 * whether a seven-figure P&L overlaps the cell beside it, pushes the page
 * into a horizontal scroll, or runs a percent sign off the edge of the card.
 * So this mounts the ACTUAL NativeDemoTicket and NativeDemoPanel and the
 * ACTUAL card renderer and measures their bounding boxes at desktop and
 * phone widths. Every value here is synthetic — no account, no network.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const req = createRequire(path.join(frontend, 'package.json'));
const esbuild = req('esbuild');
const out = path.join(root, 'docs/qa/native-demo/large-numbers');
fs.mkdirSync(out, { recursive: true });

// The magnitudes the owner asked for. `money`/`percent` are what a reader must see.
const CASES = [
  { id: 'profit-1_2m', pnl: '1200000', roi: '2400', money: '1,200,000.00', percent: '2,400.00' },
  { id: 'profit-10m', pnl: '10000000', roi: '20000', money: '10,000,000.00', percent: '20,000.00' },
  { id: 'loss-1_2m', pnl: '-1200000', roi: '-2400', money: '-1,200,000.00', percent: '-2,400.00' },
  { id: 'roi-20000', pnl: '250000', roi: '20000', money: '250,000.00', percent: '20,000.00' },
  { id: 'roi-128450', pnl: '4820000.5', roi: '128450.75', money: '4,820,000.50', percent: '128,450.75' },
  { id: 'roi-negative-99999', pnl: '-8750000.25', roi: '-99999.99', money: '-8,750,000.25', percent: '-99,999.99' },
];

const bundle = esbuild.buildSync({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import {NativeDemoTicket,NativeDemoPanel} from './src/pages/private-trading/NativeDemoControls';
import * as renderer from './src/lib/privateResultCard';
import './src/index.css';
import './src/pages/trade-terminal/ReferenceFuturesTerminal.css';
window.__cardRenderer=renderer;window.__qaErrors=[];
window.addEventListener('error',e=>window.__qaErrors.push(String(e.message)));
const position=(extra)=>({id:'p1',symbol:'BTCUSDT',side:'LONG',quantity:'1250.5',entryPrice:'50000',markPrice:'51000',lastPrice:'51000',leverage:'50',status:'OPEN',openedAt:1700000000000,closedAt:null,historical:false,
  unrealizedPnl:'0',realizedPnl:'0',netPnl:'0',roiPercent:'0',roiBasis:'1250000',closedRoiBasis:'1250000',fundingNet:'-48250.75',
  protection:{takeProfit:'1875000.5',stopLoss:null,quantity:null,triggerBy:'MARK'},liquidationPrice:'1875000.5',liquidationStatus:'ACCOUNT_CROSS_ESTIMATE',...extra});
function state(pnl,roi,closed){
  const rows=[position({unrealizedPnl:pnl,roiPercent:roi}),position({id:'p2',symbol:'ETHUSDT',side:'SHORT',unrealizedPnl:pnl,roiPercent:roi})];
  const done=rows.map(r=>({...r,status:'CLOSED',closedAt:1700000050000,netPnl:pnl,roiPercent:roi,liquidationPrice:null}));
  return{initialized:true,revision:9,source:'DEMO_BALANCE',asOf:1700000100000,
    model:{version:'VOLTEX_NATIVE_CROSS_V2',funding:{longCashflow:'-0.001',shortCashflow:'0.004',unit:'FRACTION',intervalMs:28800000}},
    account:{walletBalance:'10000000',initialDeposit:'10000000',unrealizedPnl:pnl,equity:'20000000',usedMargin:'1250000',orderReserve:'0',available:'18750000',maintenanceMargin:'275000.5',maintenanceRatio:'0.0001',liquidatable:false,deficit:'0'},
    positions:closed?[]:rows,history:closed?done:[],
    orders:[{id:'o1',symbol:'BTCUSDT',side:'LONG',type:'LIMIT',status:'OPEN',price:'1875000.5',quantity:'1250.5',filled:'0',averagePrice:null,createdAt:1700000000000}],
    events:[{id:'e1',kind:'CLOSE',time:1700000050000,positionId:'p1',orderId:null,symbol:'BTCUSDT',quantity:'1250.5',price:'58000',fee:'3625.25',cashflow:pnl,pricing:'LAST'}],entries:[]};
}
function controller(s){return{requested:true,allowed:true,checked:true,state:s,error:'',busy:false,card:null,setCard(){},dialog:null,setDialog(){},candle:null,setCandle(){},exitId:null,setExitId(){},selectedId:null,
  run:async()=>true,initialize(){},showCard(){},interaction:{},loader(){},selectEntry(){},exitOnChart(){},fail(){},pickEntry(){}};}
function App(){
  const[i,setI]=React.useState(0),[closed,setClosed]=React.useState(false);
  const cases=window.__cases;const s=state(cases[i].pnl,cases[i].roi,closed);const c=controller(s);
  window.__select=(n,isClosed)=>{setI(n);setClosed(!!isClosed);};
  return <div className="trade-terminal trade-terminal futures-reference">
    <div className="order-form-area"><NativeDemoTicket controller={c} symbol="BTC/USDT"/></div>
    <div className="bottom-panel"><NativeDemoPanel controller={c}/></div>
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: frontend, sourcefile: 'large-numbers-qa.tsx', loader: 'tsx',
  },
  bundle: true, jsx: 'automatic', write: false, outdir: path.join(out, 'bundle'), format: 'iife',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1'), 'import.meta.env': '{}' },
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
  // Root-absolute asset URLs belong to the real dev/prod server, not to this
  // one-file bundle. Left external: the webfonts simply fall back, which the
  // card does not care about (it pins Arial itself) and the table cares about
  // only in that its cells size to whatever font is actually drawn — which is
  // exactly what the clip and overlap checks below measure.
  external: ['/fonts/*', '/assets/*', '/img/*'],
});
const javascript = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
const stylesheet = bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text || '';

let server, browser;
const report = { fixtureOnly: true, scope: 'synthetic large financial values through the actual terminal components', checks: [], errors: [] };

/** Two boxes overlap when they intersect on BOTH axes by more than a hair. */
const overlaps = (a, b) => a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1;

async function main() {
  server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Large value layout QA — synthetic</title><link rel="stylesheet" href="/bundle.css"></head><body style="margin:0"><div id="root"></div><script>window.__cases=${JSON.stringify(CASES)};</script><script src="/bundle.js"></script></body></html>`);
    } else if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(javascript); }
    else if (request.url === '/bundle.css') { response.setHeader('Content-Type', 'text/css'); response.end(stylesheet); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });

  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, locale: 'ru-RU', timezoneId: 'UTC' });
    await context.route('**/*', r => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(origin);
    await page.locator('.native-demo-panel table').waitFor();

    for (const example of CASES) {
      for (const closed of [false, true]) {
        await page.evaluate(([i, c]) => window.__select(i, c), [CASES.indexOf(example), closed]);
        if (closed) await page.getByRole('tab', { name: 'P&L' }).click();
        else await page.getByRole('tab', { name: /^Позиции/ }).click();
        await page.locator('.native-demo-panel tbody tr').first().waitFor();

        const measured = await page.evaluate(() => {
          const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
          const rows = [...document.querySelectorAll('.native-demo-panel tbody tr')];
          const cells = rows.map(tr => [...tr.children].map(td => {
            const style = getComputedStyle(td);
            const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)$/.exec(style.backgroundColor);
            return { text: td.innerText.trim(), sticky: style.position === 'sticky',
              opaque: !alpha || Number(alpha[1]) >= 1, ...box(td) };
          }));
          // A cell is clipped when its content is wider than the box drawing it.
          const clipped = rows.flatMap(tr => [...tr.children])
            .filter(td => td.scrollWidth > td.clientWidth + 1).map(td => td.innerText.trim());
          const scroller = document.querySelector('.native-table-scroll');
          return {
            cells, clipped,
            panelText: document.querySelector('.bottom-panel').innerText,
            ticketText: document.querySelector('.order-form-area').innerText,
            pageScrollWidth: document.documentElement.scrollWidth, viewport: innerWidth,
            // The table may scroll inside its own container — that is by design.
            tableScrolls: scroller ? scroller.scrollWidth > scroller.clientWidth : false,
            headers: [...document.querySelectorAll('.native-demo-panel th')].map(th => th.innerText.trim()),
          };
        });

        // 1. The page itself never scrolls sideways; only the table's own box may.
        assert(measured.pageScrollWidth <= measured.viewport + 1,
          `${example.id}/${closed ? 'closed' : 'open'}@${width}: page scrolls horizontally (${measured.pageScrollWidth} > ${measured.viewport})`);
        // 2. No cell hides part of its own content.
        assert.deepEqual(measured.clipped, [], `${example.id}@${width}: clipped cells`);
        // 3. Cells in a row never sit on top of one another.
        for (const row of measured.cells) {
          for (let a = 0; a < row.length; a++) for (let b = a + 1; b < row.length; b++) {
            // A pinned column is SUPPOSED to sit above what scrolls under it;
            // it is opaque, so nothing is garbled. Every other pair must not touch.
            if (row[a].sticky || row[b].sticky) continue;
            assert(!overlaps(row[a], row[b]), `${example.id}@${width}: cells "${row[a].text}" and "${row[b].text}" overlap`);
          }
          // Whatever is pinned must be opaque, or the row beneath shows through it.
          for (const cell of row.filter(c => c.sticky)) {
            assert(cell.opaque, `${example.id}@${width}: the pinned column is transparent`);
          }
          assert.equal(row.length, measured.headers.length, `${example.id}@${width}: row lost a column`);
        }
        // 4. The values are actually on screen, in full, with their units.
        const surface = measured.panelText + '\n' + measured.ticketText;
        assert(surface.includes(example.money), `${example.id}@${width}: ${example.money} is not rendered`);
        assert(surface.includes(example.percent + '%'), `${example.id}@${width}: ${example.percent}% is not rendered`);
        for (const bad of [/\d[eE][+-]?\d/, /NaN/, /Infinity|∞/]) {
          assert(!bad.test(surface), `${example.id}@${width}: ${bad} appears in the terminal`);
        }
      }
    }
    await page.evaluate(() => window.__select(4, false));
    await page.getByRole('tab', { name: /^Позиции/ }).click();
    await page.screenshot({ path: path.join(out, `terminal-${width}.png`), fullPage: true });
    report.checks.push({ name: `tables-and-totals-${width}`, passed: true, cases: CASES.length * 2 });

    // ---- the card itself, measured glyph by glyph ----
    const cardGeometry = await page.evaluate(cases => cases.map(example => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1080px;pointer-events:none';
      document.body.append(host);
      try {
        host.innerHTML = window.__cardRenderer.privateResultCardSvg({
          id: 'qa', symbol: 'BTCUSDT', side: 'LONG', leverage: '50', mode: 'DEMO_LIVE', status: 'OPEN',
          label: 'qa', unrealizedPnl: example.pnl, roiPercent: example.roi,
          entryPrice: '1875000.5', valuationPrice: '1999999.99', usdPnl: null, asOf: '2026-08-08T12:00:00.000Z',
        });
        const svg = host.querySelector('svg');
        const fields = [...svg.querySelectorAll('[data-field]')].map(node => {
          const b = node.getBBox(), m = node.getScreenCTM ? null : null;
          // Text lives inside translated groups; compose to card coordinates.
          let x = b.x, y = b.y, node2 = node;
          while (node2 && node2 !== svg) {
            const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(node2.getAttribute?.('transform') || '');
            if (t) { x += Number(t[1]); y += Number(t[2]); }
            node2 = node2.parentNode;
          }
          return { name: node.dataset.field, text: node.textContent, left: x, top: y, right: x + b.width, bottom: y + b.height };
        });
        const bags = [...svg.querySelectorAll('[data-artwork="money-bags"] > g')].map(g => {
          const b = g.getBBox(), t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)\s*scale\(\s*([\d.]+)/.exec(g.getAttribute('transform'));
          const [dx, dy, s] = [Number(t[1]), Number(t[2]), Number(t[3])];
          return { left: dx + b.x * s, top: dy + b.y * s, right: dx + (b.x + b.width) * s, bottom: dy + (b.y + b.height) * s };
        });
        return { id: example.id, fields, bags };
      } finally { host.remove(); }
    }), CASES);

    for (const card of cardGeometry) {
      for (const f of card.fields) {
        assert(f.left >= 0 && f.right <= 1080, `${card.id}: card field ${f.name} "${f.text}" runs outside 0..1080 (${f.left.toFixed(1)}..${f.right.toFixed(1)})`);
        assert(f.top >= 0 && f.bottom <= 1215, `${card.id}: card field ${f.name} "${f.text}" runs outside 0..1215 (${f.top.toFixed(1)}..${f.bottom.toFixed(1)})`);
        for (const bag of card.bags) {
          assert(!overlaps(f, bag), `${card.id}: card field ${f.name} "${f.text}" overlaps a money bag`);
        }
      }
      // Two text fields never sit on top of each other either.
      for (let a = 0; a < card.fields.length; a++) for (let b = a + 1; b < card.fields.length; b++) {
        const [x, y] = [card.fields[a], card.fields[b]];
        if (x.name.startsWith('roi-') && y.name.startsWith('roi-')) continue;       // digits + percent share a line
        if (x.name === 'roi-line' || y.name === 'roi-line') continue;                // wrapper of the two above
        if (x.name.startsWith('profit-') && y.name.startsWith('profit-')) continue;  // number + USDT share a line
        if (x.name === 'profit-line' || y.name === 'profit-line') continue;
        if (x.name === 'side' || y.name === 'side' || x.name === 'leverage' || y.name === 'leverage') continue; // one badge
        assert(!overlaps(x, y), `${card.id}: card fields ${x.name} and ${y.name} overlap`);
      }
      // The bags stay whole inside the card, at their enlarged size.
      for (const bag of card.bags) {
        assert(bag.left >= 0 && bag.right <= 1080 && bag.top >= 0 && bag.bottom <= 1215,
          `${card.id}: a money bag is cropped by the card edge`);
      }
    }
    report.checks.push({ name: `card-geometry-${width}`, passed: true, cases: cardGeometry.length,
      bags: cardGeometry[0].bags.map(b => ({ w: Math.round(b.right - b.left), h: Math.round(b.bottom - b.top) })) });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
}
main().catch(e => { report.passed = false; report.failure = String(e.message || e); console.error(e); process.exitCode = 1; })
  .finally(async () => {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await browser?.close(); server?.close();
  });
