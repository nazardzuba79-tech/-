/**
 * Localhost-only browser smoke. Never declares candles proven solely from iframe load.
 * A provider may forbid access from GitHub-hosted runners; failures are reported, not hidden.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/tmp/stocks-qa-playwright/node_modules/playwright');
const url = 'http://127.0.0.1:5173/stocks';
const artifactPath = process.env.STOCKS_EMBED_QA_DIR || '/tmp/stocks-embed-qa';
fs.mkdirSync(artifactPath, { recursive: true });
const report = {
  origin: url, runAtUtc: new Date().toISOString(), total: 0,
  iframeLoadedSignals: 0, providerFramesWithCanvas: 0,
  providerFramesWithoutCanvas: 0, unavailableOrTimedOut: 0,
  results: [], caveat: 'An iframe load event or canvas does not prove OHLCV correctness, candle rendering or commercial permission.',
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const iframeResponseStatus = new Map();
  page.on('response', response => {
    if (response.url().includes('geckoterminal.com/solana/pools/')) {
      const address = response.url().split('/pools/')[1]?.split(/[?/#]/)[0];
      if (address) iframeResponseStatus.set(address, response.status());
    }
  });
  const warnings = [];
  page.on('pageerror', error => warnings.push(String(error).slice(0, 240)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('heading', { name: 'Токенизированные акции' }).waitFor();
  const elements = page.locator('.vxson-market');
  const total = await elements.count();
  if (total !== 58) throw new Error('EXPECTED_58_ASSETS_GOT_' + total);
  report.total = total;
  const labels = await elements.locator('strong').allTextContents();
  report.tickers = labels.map(s => s.split('/')[0].trim());
  if (new Set(report.tickers).size !== 58) throw new Error('DUPLICATE_TICKERS');
  if (await page.locator('.vxson-trade-off button:not([disabled])').count() !== 0) {
    throw new Error('STOCKS_TRADE_CONTROL_ENABLED');
  }
  await page.locator('.vxson-filter-mode').selectOption('active');
  if (await elements.count() !== 36) throw new Error('BAD_ACTIVE_COUNT');
  await page.locator('.vxson-filter-mode').selectOption('checked');
  if (await elements.count() !== 22) throw new Error('BAD_EXTRA_VERIFIED_COUNT');
  await page.locator('.vxson-filter-mode').selectOption('all');
  for (const [i, ticker] of report.tickers.entries()) {
    const active = page.locator('.vxson-market').nth(i);
    await active.click();
    await page.locator('.vxson-market-head h2').getByText(ticker, { exact: false }).waitFor({ timeout: 6000 });
    const src = await page.locator('.vxson-frame iframe').getAttribute('src');
    if (!src?.startsWith('https://www.geckoterminal.com/solana/pools/') || !src.includes('embed=1')) {
      throw new Error('UNEXPECTED_IFRAME_SOURCE_' + ticker);
    }
    const poolAddress = src.split('/pools/')[1].split('?')[0];
    await delay(2600);
    const state = await page.locator('.vxson-frame-status').innerText();
    const loaded = state.includes('Событие загрузки iframe получено');
    const frame = page.frames().find(f => f.url().startsWith('https://www.geckoterminal.com/solana/pools/' + poolAddress));
    let canvasCount = 0;
    let pageText = '';
    if (frame) {
      try {
        canvasCount = await frame.locator('canvas').count();
        pageText = (await frame.locator('body').innerText({ timeout: 1000 })).slice(0, 120);
      } catch { /* frame inaccessible or navigation in progress: record as unproven */ }
    }
    const response = iframeResponseStatus.get(poolAddress) ?? null;
    const record = { ticker, poolAddress, status: response, iframeLoadEvent: loaded,
      providerFrameFound: Boolean(frame), canvasCount,
      contentSample: pageText.replace(/\s+/g, ' ').slice(0, 120) };
    report.results.push(record);
    if (loaded) report.iframeLoadedSignals++;
    if (canvasCount > 0) report.providerFramesWithCanvas++;
    else if (frame) report.providerFramesWithoutCanvas++;
    else report.unavailableOrTimedOut++;
    console.log('STOCKS_IFRAME_QA', JSON.stringify(record));
    if (ticker === 'SPYx' || ticker === 'CRCLx') {
      await page.screenshot({ path: artifactPath + '/' + ticker + '-desktop.png', fullPage: false });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('heading', { name: 'Токенизированные акции' }).waitFor();
  report.mobilePass = (await page.locator('.vxson-market').count()) === 58 &&
    (await page.locator('.vxson-frame iframe').count()) === 1;
  await page.screenshot({ path: artifactPath + '/SPYx-mobile-after-reload.png', fullPage: true });
  if (!report.mobilePass) throw new Error('MOBILE_RELOAD_SMOKE_FAILED');
  report.pageErrors = warnings;
} finally {
  fs.writeFileSync(artifactPath + '/report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
console.log('STOCKS_BROWSER_SUMMARY', JSON.stringify({
  tested: report.results.length, iframeLoadedSignals: report.iframeLoadedSignals,
  providerFramesWithCanvas: report.providerFramesWithCanvas,
  providerFramesWithoutCanvas: report.providerFramesWithoutCanvas,
  unavailableOrTimedOut: report.unavailableOrTimedOut,
  mobilePass: report.mobilePass,
}));
