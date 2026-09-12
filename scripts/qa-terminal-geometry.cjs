/* Read-only browser QA against scripts/qa-professional-terminals.cjs and a built frontend.
   Uses real public market feeds. The preview server rejects every financial write. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.TERMINAL_QA_URL || 'http://127.0.0.1:4198';
const out = path.resolve('docs/qa/terminal-geometry');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const report = { geometry: [], symbols: [], rapid: [], pageErrors: [], consoleErrors: [], failedRequests: [] };
  page.on('pageerror', e => report.pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push({ text: m.text(), location: m.location() }); });
  page.on('requestfailed', r => report.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
  const route = market => market === 'futures' ? '/futures' : market === 'cfd' ? '/trade?market=cfd&symbol=XAUUSD' : '/trade';
  const row = market => market === 'spot' ? '.pair-select' : market === 'futures' ? '.left-panel .pair-row' : '.cfd-option';
  async function pick(market, name) {
    const rows = page.locator(row(market));
    // Market lists use separate base and quote spans. Match their combined text.
    const texts = await rows.allTextContents();
    const index = texts.findIndex(text => text.replace(/\s|\//g, '').includes(name));
    if (index < 0) throw new Error(`Missing real listed instrument ${market}:${name}`);
    await rows.nth(index).click({ force: true });
  }
  async function geometry(label) {
    const data = await page.evaluate(() => {
      const root = document.querySelector('.voltex-tradingview-chart');
      const plot = root?.querySelector('.voltex-tradingview-chart__plot');
      const iframe = plot?.querySelector('iframe');
      const footer = root?.querySelector('.voltex-tradingview-chart__copyright');
      const rect = node => node?.getBoundingClientRect();
      const chain = [];
      for (let node = iframe; node; node = node.parentElement) {
        const r = rect(node), s = getComputedStyle(node);
        chain.push({ tag: node.tagName, class: node.className, width: r.width, height: r.height, x: r.x, display: s.display, flex: s.flex, direction: s.flexDirection });
      }
      const book = document.querySelector('.orderbook-area');
      const side = cls => {
        const box = document.querySelector(cls); if (!box) return null;
        const r = rect(box); const rows = [...box.querySelectorAll('.ob-row')];
        const visible = rows.filter(n => rect(n).top >= r.top - 1 && rect(n).bottom <= r.bottom + 1);
        return { height: r.height, rendered: rows.length, visible: visible.length, prices: rows.map(n => Number(n.querySelector('.cell').textContent.replaceAll(',',''))), nearestY: rect(rows[0])?.y, rowYs:rows.map(n=>rect(n).y), scroll: getComputedStyle(box).overflowY };
      };
      const cells = [...document.querySelectorAll('.ob-row .cell')];
      let renderedSymbol=null;
      try { renderedSymbol=JSON.parse(decodeURIComponent(new URL(iframe.src).hash.slice(1))).symbol; } catch {}

      return { symbol: root?.getAttribute('data-symbol'), renderedSymbol, plotWidth: rect(plot)?.width, iframeWidth: rect(iframe)?.width,
        delta: iframe ? Math.abs(rect(plot).width - rect(iframe).width) : null,
        iframes: root?.querySelectorAll('iframe').length, hosts: root?.querySelectorAll('.voltex-tradingview-chart__owned').length,
        overflow: document.documentElement.scrollWidth - innerWidth, duplicateToolbar: !!document.querySelector('.terminal-chart-controls'),
        footerBelow: footer && rect(footer).top >= rect(plot).bottom - 1, footerHeight: rect(footer)?.height,
        providerInHeader: /BYBIT|OANDA|Perpetual Contract/i.test(document.querySelector('.ticker-bar, .cfd-ticker-bar')?.textContent || ''),
        bookWidth: rect(book)?.width, bookFont: cells[0] && getComputedStyle(cells[0].parentElement).fontSize,
        truncatedCells: cells.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => ({ text:n.textContent, width:n.clientWidth, scroll:n.scrollWidth })),
        depthOpacity: book?.querySelector('.ob-depth-bar') && getComputedStyle(book.querySelector('.ob-depth-bar')).opacity,
        asks: side('.orderbook-asks'), bids: side('.orderbook-bids'), chain };
    });
    report.geometry.push({ label, ...data });
    if (data.renderedSymbol && data.renderedSymbol !== data.symbol || data.delta !== null && data.delta > 2 || data.iframes > 1 || data.hosts !== 1 || data.overflow > 0 || data.duplicateToolbar || !data.footerBelow || data.providerInHeader || data.truncatedCells.length) console.log('CHECK', label, JSON.stringify(data));
    return data;
  }
  async function native() {
    const handle = await page.locator('.voltex-tradingview-chart iframe').elementHandle();
    const frame = await handle.contentFrame();
    await frame.locator('canvas').first().waitFor({ timeout: 25000 }).catch(() => {});
    return frame.evaluate(() => {
      const visible = node => node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
      return { canvases: document.querySelectorAll('canvas').length,
        indicators: [...document.querySelectorAll('[data-name="open-indicators-dialog"]')].some(visible),
        drawing: [...document.querySelectorAll('[data-name="measure"]')].some(visible),
        unavailable: /Invalid symbol|Недопустимый символ|Не удалось загрузить/i.test(document.body.innerText) };
    });
  }
  try {
    await page.goto(base + '/__qa/start');
    for (const market of ['spot', 'futures', 'cfd']) {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(base + route(market));
      await page.locator(row(market)).first().waitFor({ timeout: 45000 });
      const symbols = market === 'spot' ? ['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT'] : market === 'futures' ? ['BTCUSDT','ETHUSDT','XRPUSDT'] : ['XAUUSD','XAGUSD','WTIUSD','EURUSD'];
      for (const symbol of symbols) {
        await pick(market, symbol); await pause(6000);
        const controls = await native(); const dims = await geometry(`${market}:${symbol}`);
        report.symbols.push({ market, symbol, ...controls, delta: dims.delta });
        console.log('SYMBOL', market, symbol, JSON.stringify(controls));
      }
      await pick(market, symbols[0]); await pause(6000);
      for (const [width,height] of [[1920,1080],[1440,900],[1366,768],[390,844]]) {
        await page.setViewportSize({width,height}); await pause(1200);
        const dims=await geometry(`${market}:${width}x${height}`);
        report.symbols.push({market,symbol:dims.symbol,viewport:width,...await native()});
        await page.screenshot({ path: path.join(out, `${market}-${width}.png`), fullPage: width === 390 });
        if (width === 1920 && market !== 'cfd') await page.locator('.orderbook-area').screenshot({ path:path.join(out, `orderbook-${market}.png`) });
      }
      await page.setViewportSize({width:1440,height:900}); await pause(500);
      const names = market === 'cfd' ? ['XAUUSD','XAGUSD','WTIUSD','EURUSD','GBPUSD','XAUUSD','XAGUSD','WTIUSD','EURUSD','XAUUSD'] : ['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','ADAUSDT','BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','BTCUSDT'];
      for (let i=0;i<names.length;i++) { await pick(market,names[i]); await page.locator('.voltex-tradingview-chart iframe').waitFor({timeout:15000}); await geometry(`${market}:sequence-${i+1}`); }
      for (let i=0;i<20;i++) { await pick(market,names[i%names.length]); await pause(60); await geometry(`${market}:rapid-${i+1}`); }
      await pause(6500); const dims = await geometry(`${market}:after-20`); const controls = await native();
      report.rapid.push({market,switches:20,iframes:dims.iframes,hosts:dims.hosts,delta:dims.delta,...controls});
      await page.screenshot({path:path.join(out, market==='spot'?'symbol-switch-after-20.png':`${market}-after-20.png`)});
      console.log('MARKET DONE',market);
      fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));
    }
    const failures=report.geometry.filter(d=>d.delta!==null&&d.delta>2||d.iframes>1||d.hosts!==1||d.overflow>0||d.truncatedCells.length||d.renderedSymbol&&d.renderedSymbol!==d.symbol);
    if(failures.length) throw new Error(`${failures.length} geometry checks failed; see browser-report.json`);
  } finally {
    fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exitCode=1; });
