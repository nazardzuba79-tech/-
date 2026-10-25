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
  http200AndCanvas: 0, invalidDocumentCount: 0, poolSwitchChecks: [], unsafeLocalWrites: [],
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
  // Read-only contract: no trading write must reach the local VOLTEX host.
  page.on('request', req => {
    const target = new URL(req.url());
    if (target.origin === new URL(url).origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      report.unsafeLocalWrites.push({ method: req.method(), pathname: target.pathname });
    }
  });
  // Synthetic local-only session presence lets the *existing* RequireAuth guard
  // render the route in CI. No live backend credentials or authentication bypass.
  await page.addInitScript(() => window.localStorage.setItem('exchange_token', 'invalid-local-browser-qa-session'));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await page.getByRole('heading', { name: 'Токенизированные акции' }).waitFor({ timeout: 15000 });
  } catch (error) {
    report.initialUrl = page.url();
    report.initialText = (await page.locator('body').innerText().catch(() => '')).slice(0, 800);
    await page.screenshot({ path: artifactPath + '/route-diagnostic.png', fullPage: true }).catch(() => {});
    console.log('INITIAL_ROUTE_DIAGNOSTIC', JSON.stringify({ url: report.initialUrl, text: report.initialText }));
    throw error;
  }
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
  const search = page.getByRole('textbox', { name: 'Найти актив' });
  await search.fill('HOOD');
  if (await elements.count() !== 1 || !(await elements.first().innerText()).includes('HOODx')) {
    throw new Error('SEARCH_FILTER_FAILED');
  }
  await search.fill('');
  const requestedTickers = (process.env.STOCKS_QA_TICKERS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const reviewTickers = requestedTickers.length ? requestedTickers : report.tickers;
  for (const ticker of reviewTickers) {
    const i = report.tickers.indexOf(ticker);
    if (i < 0) throw new Error('MISSING_TEST_TICKER_' + ticker);
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
    if (response === 200 && loaded && canvasCount > 0) report.http200AndCanvas++;
    else report.invalidDocumentCount++;
    if (canvasCount > 0) report.providerFramesWithCanvas++;
    else if (frame) report.providerFramesWithoutCanvas++;
    else report.unavailableOrTimedOut++;
    console.log('STOCKS_IFRAME_QA', JSON.stringify(record));
    if (['SPYx','CRCLx','NVDAx','TSLAx','MSFTx','AAPLx','METAx','GOOGLx','QQQx','PLTRx'].includes(ticker)) {
      await page.screenshot({ path: artifactPath + '/' + ticker + '-desktop.png', fullPage: false });
    }
  }
  // URL state: persist through reload, Back/Forward and reject unallowlisted pool parameters.
  await page.getByRole('button', { name: /NVDAx/ }).first().click();
  if (new URL(page.url()).searchParams.get('asset') !== 'NVDAx') throw new Error('SELECTED_ASSET_NOT_IN_URL');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.vxson-market-head h2').getByText('NVDAx', { exact: false }).waitFor();
  if (new URL(page.url()).searchParams.get('asset') !== 'NVDAx') throw new Error('ASSET_LOST_ON_RELOAD');
  await page.goto(url + '?asset=NVDAx&pool=INVALID_ADDRESS_IN_QUERY', { waitUntil: 'domcontentloaded' });
  await page.locator('.vxson-market-head h2').getByText('NVDAx', { exact: false }).waitFor();
  const safeUrl = await page.locator('.vxson-frame iframe').getAttribute('src');
  if (!safeUrl?.startsWith('https://www.geckoterminal.com/solana/pools/') ||
      safeUrl.includes('INVALID_ADDRESS_IN_QUERY')) throw new Error('UNSAFE_POOL_QUERY');
  report.routeChecks = { reload: true, invalidPoolIgnored: true };
  // Different exchange pools for one ticker must produce distinct GeckoTerminal URLs.
  // Check without altering any backend state or modifying the source allowlist.
  await page.getByRole('button', { name: /NVDAx/ }).first().click();
  const poolSelect = page.getByRole('combobox', { name: 'Выбрать пул графика' });
  const options = await poolSelect.locator('option').evaluateAll(items => items.map(x => x.value));
  if (options.length < 2) throw new Error('EXPECTED_NVDA_ALTERNATIVE_POOL');
  const originalPool = await poolSelect.inputValue();
  const alternatePool = options.find(v => v !== originalPool);
  if (!alternatePool) throw new Error('MISSING_ALTERNATIVE_POOL_ADDRESS');
  await poolSelect.selectOption(alternatePool);
  const switchedUrl = await page.locator('.vxson-frame iframe').getAttribute('src');
  if (!switchedUrl?.includes('/pools/' + alternatePool)) throw new Error('POOL_SELECTOR_SWITCH_FAILED');
  await poolSelect.selectOption(originalPool);
  const restoredUrl = await page.locator('.vxson-frame iframe').getAttribute('src');
  if (!restoredUrl?.includes('/pools/' + originalPool)) throw new Error('POOL_SELECTOR_RESTORE_FAILED');
  report.poolSwitchChecks.push({ticker: 'NVDAx', originalPool, alternatePool, success: true});
  if (new URL(page.url()).searchParams.get('pool') !== originalPool) throw new Error('POOL_NOT_PERSISTED_IN_URL');
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloadedSource = await page.locator('.vxson-frame iframe').getAttribute('src');
  if (!reloadedSource?.includes('/pools/' + originalPool)) throw new Error('POOL_LOST_ON_RELOAD');
  const beforeRetry = await page.locator('.vxson-frame iframe').getAttribute('src');
  await page.getByRole('button', { name: 'Перезагрузить график' }).click();
  const afterRetry = await page.locator('.vxson-frame iframe').getAttribute('src');
  if (beforeRetry !== afterRetry) throw new Error('RETRY_SOURCE_CHANGED');
  report.routeChecks.poolReload = true;
  report.routeChecks.retryKeepsSource = true;

  if (report.unsafeLocalWrites.length) throw new Error('STOCKS_WRITES_OBSERVED_' + JSON.stringify(report.unsafeLocalWrites));
  if (report.invalidDocumentCount !== 0) throw new Error('STOCKS_DOCUMENT_OR_CANVAS_FAILURES_' + report.invalidDocumentCount);
  await page.goto(url + '?asset=SPYx', { waitUntil: 'domcontentloaded' });
  await page.locator('.vxson-market-head h2').getByText('SPYx', { exact: false }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('heading', { name: 'Токенизированные акции' }).waitFor();
  await page.waitForFunction(() => document.querySelector('.vxson-frame-status')?.textContent?.includes('Событие загрузки iframe получено'), null, { timeout: 20000 });
  // The chart may paint several seconds after iframe's load event.
  await page.waitForTimeout(8500);
  const mobileFrame = page.frames().find(f => f.url().startsWith('https://www.geckoterminal.com/solana/pools/'));
  report.mobileFrameFound = Boolean(mobileFrame);
  report.mobileCanvasCount = mobileFrame ? await mobileFrame.locator('canvas').count().catch(() => 0) : 0;
  report.mobilePass = (await page.locator('.vxson-market').count()) === 58 &&
    (await page.locator('.vxson-frame iframe').count()) === 1 &&
    report.mobileFrameFound && report.mobileCanvasCount > 0;
  await page.screenshot({ path: artifactPath + '/SPYx-mobile-after-reload.png', fullPage: true });
  if (!report.mobilePass) throw new Error('MOBILE_RELOAD_SMOKE_FAILED');
  report.pageErrors = warnings;
  if (warnings.length) throw new Error('STOCKS_JAVASCRIPT_ERRORS_' + warnings.length);
} finally {
  fs.writeFileSync(artifactPath + '/report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
console.log('STOCKS_BROWSER_SUMMARY', JSON.stringify({
  tested: report.results.length, iframeLoadedSignals: report.iframeLoadedSignals,
  providerFramesWithCanvas: report.providerFramesWithCanvas,
  providerFramesWithoutCanvas: report.providerFramesWithoutCanvas,
  unavailableOrTimedOut: report.unavailableOrTimedOut,
  mobilePass: report.mobilePass, http200AndCanvas: report.http200AndCanvas,
  poolSwitchChecks: report.poolSwitchChecks.length, routeChecks: report.routeChecks,
  unsafeLocalWrites: report.unsafeLocalWrites.length,
}));
