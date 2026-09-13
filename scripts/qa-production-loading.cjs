'use strict';

/**
 * Read-only production loading/data audit.
 *
 * - Public market-data GETs go to the real VOLTEX production API.
 * - Signed-in pages use a synthetic localStorage identity only so route chunks
 *   and public market surfaces can be inspected without production credentials.
 * - /me is fulfilled locally; all other protected API reads are answered 503
 *   by the QA harness and every non-GET/HEAD request is blocked.
 * - No production account values are fabricated and no production writes run.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.VOLTEX_QA_PLAYWRIGHT || 'playwright');

const ORIGIN = (process.env.VOLTEX_QA_ORIGIN || 'https://voltextech.net').replace(/\/$/, '');
const API_ORIGIN = (process.env.VOLTEX_QA_API_ORIGIN || 'https://api.voltextech.net').replace(/\/$/, '');
const API = `${API_ORIGIN}/api/v1`;
const OUT = path.resolve(process.env.VOLTEX_QA_OUT || 'docs/qa/production-loading');
fs.mkdirSync(OUT, { recursive: true });

const report = {
  revision: process.env.GITHUB_SHA || null,
  target: ORIGIN,
  apiTarget: API_ORIGIN,
  startedAt: new Date().toISOString(),
  api: [],
  home: [],
  routes: [],
  pageErrors: [],
  consoleErrors: [],
  publicHttpErrors: [],
  failedAssets: [],
  blockedWrites: [],
  findings: [],
  warnings: [],
};

const critical = (message, detail) => report.findings.push(detail ? `${message}: ${detail}` : message);
const warn = (message, detail) => report.warnings.push(detail ? `${message}: ${detail}` : message);
const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
const listOf = (v, keys) => {
  for (const key of keys) if (Array.isArray(v?.[key])) return v[key];
  return Array.isArray(v) ? v : [];
};

async function fetchJson(url, timeoutMs = 15000) {
  const started = Date.now();
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ms = Date.now() - started;
  let body = null;
  try { body = await response.json(); } catch {}
  return { status: response.status, ok: response.ok, body, ms };
}

async function probe(name, pathname, validate, { timeoutMs = 15000, slowMs = 5000 } = {}) {
  const url = `${API}${pathname}`;
  try {
    const result = await fetchJson(url, timeoutMs);
    const row = { name, pathname, status: result.status, ms: result.ms, valid: false };
    if (!result.ok) {
      report.api.push(row);
      critical(`API ${name} returned ${result.status}`);
      return null;
    }
    let verdict = true;
    try { verdict = validate ? Boolean(validate(result.body)) : true; } catch { verdict = false; }
    row.valid = verdict;
    report.api.push(row);
    if (!verdict) critical(`API ${name} returned an unusable payload`);
    if (result.ms > slowMs) warn(`API ${name} is slow`, `${result.ms} ms`);
    return result.body;
  } catch (error) {
    report.api.push({ name, pathname, status: null, ms: null, valid: false, error: String(error?.message || error) });
    critical(`API ${name} failed`, String(error?.message || error));
    return null;
  }
}

function isPublicRead(pathname) {
  if (pathname === '/api/v1/pairs') return true;
  if (pathname.startsWith('/api/v1/market/external/')) return true;
  if (['/api/v1/market/tickers', '/api/v1/market/snapshot', '/api/v1/market/global', '/api/v1/market/assets/icons', '/api/v1/market/live'].includes(pathname)) return true;
  if (['/api/v1/cfd/config', '/api/v1/cfd/catalog', '/api/v1/cfd/tickers'].includes(pathname)) return true;
  if (pathname.startsWith('/api/v1/cfd/candles/')) return true;
  if (['/api/v1/futures/config', '/api/v1/futures/markets'].includes(pathname)) return true;
  if (pathname.startsWith('/api/v1/futures/mark-price/')) return true;
  if (pathname.startsWith('/api/v1/futures/funding-rate/')) return true;
  if (pathname.startsWith('/api/v1/futures/open-interest/')) return true;
  if (pathname.startsWith('/api/v1/futures/market-stats/')) return true;
  return false;
}

const syntheticMe = {
  id: 'voltex-production-loading-audit',
  email: 'qa@example.invalid',
  displayName: 'VOLTEX QA',
  phone: null,
  country: null,
  avatarUrl: null,
  isAdmin: true,
  kycStatus: 'NOT_STARTED',
  twoFactorEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function attachMonitoring(page, labelRef) {
  page.on('pageerror', (error) => {
    const row = { label: labelRef.current, error: error.message };
    report.pageErrors.push(row);
    critical(`Browser page error on ${labelRef.current}`, error.message);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    const row = { label: labelRef.current, text: message.text().slice(0, 500), url: location.url || null };
    report.consoleErrors.push(row);
    if (!location.url || location.url.startsWith(ORIGIN) || location.url.startsWith(API_ORIGIN)) {
      warn(`Browser console error on ${labelRef.current}`, row.text);
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    const url = new URL(response.url());
    const qaStub = response.headers()['x-voltex-qa-stub'] === '1';
    if (qaStub) return;
    if (url.origin !== ORIGIN && url.origin !== API_ORIGIN) return;
    const row = { label: labelRef.current, status: response.status(), method: request.method(), url: response.url() };
    report.publicHttpErrors.push(row);
    critical(`HTTP ${response.status()} on ${labelRef.current}`, `${request.method()} ${url.pathname}`);
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.origin !== ORIGIN && url.origin !== API_ORIGIN) return;
    if (url.pathname === '/api/v1/market/live') return;
    const type = request.resourceType();
    if (!['document', 'script', 'stylesheet', 'xhr', 'fetch'].includes(type)) return;
    const failure = request.failure()?.errorText || 'request failed';
    if (failure.includes('ERR_ABORTED')) return;
    const row = { label: labelRef.current, type, url: request.url(), error: failure };
    report.failedAssets.push(row);
    critical(`Failed ${type} on ${labelRef.current}`, `${url.pathname} (${failure})`);
  });
}

async function configureAuthenticatedContext(context) {
  await context.addInitScript(() => {
    localStorage.setItem('exchange_token', 'voltex-production-loading-audit');
    localStorage.setItem('exchange_lang', 'en');
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(method)) {
      report.blockedWrites.push({ method, url: request.url() });
      return route.abort('blockedbyclient');
    }
    const isApiHost = url.origin === ORIGIN || url.origin === API_ORIGIN;
    if (!isApiHost || !url.pathname.startsWith('/api/v1/')) return route.continue();
    if (url.pathname === '/api/v1/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'x-voltex-qa-stub': '1', 'cache-control': 'no-store' },
        body: JSON.stringify(syntheticMe),
      });
    }
    if (isPublicRead(url.pathname)) return route.continue();
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'x-voltex-qa-stub': '1', 'cache-control': 'no-store' },
      body: JSON.stringify({ error: 'qa_protected_read_not_executed' }),
    });
  });
}

async function waitCondition(page, label, predicate, timeout = 20000) {
  const started = Date.now();
  try {
    await page.waitForFunction(predicate, null, { timeout });
    return Date.now() - started;
  } catch {
    critical(`Homepage ${label} did not become ready`, `${timeout} ms`);
    return null;
  }
}

async function auditHomepage(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const labelRef = { current: `home-${width}` };
  attachMonitoring(page, labelRef);
  const navigationStarted = Date.now();
  try {
    const response = await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response || response.status() >= 400) critical(`Homepage navigation failed at ${width}px`, String(response?.status() ?? 'no response'));
    await page.waitForSelector('#home-live-terminal', { state: 'attached', timeout: 20000 });

    const priceMs = await waitCondition(page, 'BTC price', () => {
      const text = document.querySelector('.hs-summary-pair')?.textContent || '';
      return /BTC\/USDT/.test(text) && /\d/.test(text) && !text.includes('—');
    });
    const bookMs = await waitCondition(page, 'order book', () => document.querySelectorAll('#home-live-terminal .book-row').length >= 2);
    const chartMs = await waitCondition(page, 'candlestick chart', () => document.querySelectorAll('#home-live-terminal .hs-chart svg').length > 0);
    const tradesMs = await waitCondition(page, 'recent trades', () => document.querySelectorAll('#home-live-terminal .hs-trade-row').length > 0);
    const referencesMs = await waitCondition(page, 'GOLD/OIL references', () => ['.vx-asset-gold', '.vx-asset-oil'].every((selector) => {
      const text = document.querySelector(selector)?.textContent || '';
      return /\d/.test(text) && !text.includes('—');
    }));

    const snapshot = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      orderBookRows: document.querySelectorAll('#home-live-terminal .book-row').length,
      tradeRows: document.querySelectorAll('#home-live-terminal .hs-trade-row').length,
      chartSvgs: document.querySelectorAll('#home-live-terminal .hs-chart svg').length,
      dataUnavailable: (document.querySelector('#home-live-terminal')?.textContent || '').includes('Data unavailable'),
      routeBusy: Boolean(document.querySelector('[aria-busy="true"]')),
    }));
    const timings = {
      priceMs: priceMs === null ? null : Date.now() - navigationStarted,
      bookMs: bookMs === null ? null : Date.now() - navigationStarted,
      chartMs: chartMs === null ? null : Date.now() - navigationStarted,
      tradesMs: tradesMs === null ? null : Date.now() - navigationStarted,
      referencesMs: referencesMs === null ? null : Date.now() - navigationStarted,
    };
    report.home.push({ width, ...snapshot, ...timings });
    if (snapshot.overflow) critical(`Homepage horizontal overflow at ${width}px`);
    if (snapshot.dataUnavailable) critical(`Homepage terminal shows unavailable market data at ${width}px`);
    if (snapshot.routeBusy) critical(`Homepage remained route-busy at ${width}px`);
    for (const [name, ms] of Object.entries(timings)) if (ms !== null && ms > 8000) warn(`Homepage ${name} first data is slow at ${width}px`, `${ms} ms`);
    await page.screenshot({ path: path.join(OUT, `home-${width}.png`), fullPage: true });
  } catch (error) {
    critical(`Homepage browser audit failed at ${width}px`, String(error?.message || error));
    try { await page.screenshot({ path: path.join(OUT, `home-${width}-failure.png`), fullPage: true, timeout: 3000 }); } catch {}
  } finally {
    await context.close();
  }
}

const routeCases = [
  { name: 'markets', path: '/markets' },
  { name: 'spot', path: '/trade?pair=BTC%2FUSDT', chart: 'tradingview' },
  { name: 'cfd', path: '/trade?market=cfd&symbol=XAUUSD', chart: 'cfd' },
  { name: 'futures', path: '/futures', chart: 'tradingview' },
  { name: 'analytics', path: '/analytics' },
  { name: 'wallet', path: '/wallet' },
  { name: 'copy-trading', path: '/copy-trading' },
  { name: 'arbitrage', path: '/arbitrage' },
  { name: 'card', path: '/card' },
  { name: 'otc', path: '/otc' },
  { name: 'settings', path: '/settings' },
  { name: 'admin', path: '/admin' },
];

async function auditAuthenticatedRoutes(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  await configureAuthenticatedContext(context);
  for (const test of routeCases) {
    const page = await context.newPage();
    const labelRef = { current: `${test.name}-${width}` };
    attachMonitoring(page, labelRef);
    const started = Date.now();
    try {
      const response = await page.goto(`${ORIGIN}${test.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!response || response.status() >= 400) critical(`Route ${test.name} navigation failed at ${width}px`, String(response?.status() ?? 'no response'));
      try {
        await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 20000 });
      } catch {
        critical(`Route ${test.name} stuck in route loader at ${width}px`);
      }
      await page.waitForTimeout(1200);

      let chartState = null;
      if (test.chart === 'tradingview') {
        try {
          await page.waitForFunction(() => {
            const plot = document.querySelector('.voltex-tradingview-chart__plot');
            return Boolean(plot?.querySelector('iframe') || plot?.querySelector('.terminal-chart-unavailable'));
          }, null, { timeout: 18000 });
        } catch {}
        chartState = await page.evaluate(() => ({
          present: Boolean(document.querySelector('.voltex-tradingview-chart__plot')),
          iframe: Boolean(document.querySelector('.voltex-tradingview-chart__plot iframe')),
          unavailable: Boolean(document.querySelector('.voltex-tradingview-chart__plot .terminal-chart-unavailable')),
        }));
        if (!chartState.present) critical(`Route ${test.name} chart container missing at ${width}px`);
        if (chartState.unavailable) warn(`Route ${test.name} TradingView chart unavailable at ${width}px`);
        if (chartState.present && !chartState.iframe && !chartState.unavailable) warn(`Route ${test.name} chart did not finish loading at ${width}px`);
      } else if (test.chart === 'cfd') {
        try { await page.waitForFunction(() => document.querySelector('.cfd-owned-chart')?.getAttribute('data-chart-status') === 'ready', null, { timeout: 20000 }); } catch {}
        chartState = await page.evaluate(() => ({
          present: Boolean(document.querySelector('.cfd-owned-chart')),
          status: document.querySelector('.cfd-owned-chart')?.getAttribute('data-chart-status') || null,
          canvases: document.querySelectorAll('.cfd-owned-chart-canvas canvas').length,
        }));
        if (!chartState.present || chartState.status !== 'ready' || chartState.canvases < 1) critical(`CFD chart not ready at ${width}px`, JSON.stringify(chartState));
      }

      const snapshot = await page.evaluate(() => ({
        pathname: location.pathname,
        rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
        textLength: (document.body?.innerText || '').trim().length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
        routeBusy: Boolean(document.querySelector('[aria-busy="true"]')),
        spotTerminal: Boolean(document.querySelector('.trade-terminal.spot-terminal')),
        futuresTerminal: Boolean(document.querySelector('.trade-terminal.futures-terminal')),
        cfdTerminal: Boolean(document.querySelector('.trade-terminal.cfd-terminal')),
      }));
      const expectedPath = test.path.split('?')[0];
      if (snapshot.pathname !== expectedPath) critical(`Route ${test.name} redirected unexpectedly at ${width}px`, snapshot.pathname);
      if (!snapshot.rootChildren || snapshot.textLength < 20) critical(`Route ${test.name} rendered blank at ${width}px`);
      if (snapshot.routeBusy) critical(`Route ${test.name} remained route-busy at ${width}px`);
      if (snapshot.overflow) critical(`Route ${test.name} horizontal overflow at ${width}px`);
      if (test.name === 'spot' && !snapshot.spotTerminal) critical(`Spot terminal root missing at ${width}px`);
      if (test.name === 'futures' && !snapshot.futuresTerminal) critical(`Futures terminal root missing at ${width}px`);
      if (test.name === 'cfd' && !snapshot.cfdTerminal) critical(`CFD terminal root missing at ${width}px`);
      report.routes.push({ name: test.name, width, ms: Date.now() - started, ...snapshot, chart: chartState });
      await page.screenshot({ path: path.join(OUT, `${test.name}-${width}.png`), fullPage: true });
    } catch (error) {
      critical(`Route ${test.name} browser audit failed at ${width}px`, String(error?.message || error));
      try { await page.screenshot({ path: path.join(OUT, `${test.name}-${width}-failure.png`), fullPage: true, timeout: 3000 }); } catch {}
    } finally {
      await page.close();
    }
  }
  await context.close();
}

(async () => {
  const tickers = await probe('spot tickers', '/market/external/tickers', (body) => {
    const rows = listOf(body, ['tickers']);
    return rows.length > 0 && rows.some((row) => row?.pair === 'BTC/USDT' && positive(row.lastPrice));
  });
  await probe('BTC ticker', '/market/external/tickers/BTC-USDT', (body) => positive(body?.ticker?.lastPrice ?? body?.lastPrice));
  await probe('BTC order book', '/market/external/orderbook/BTC-USDT?limit=20', (body) => listOf(body, ['bids']).length > 0 && listOf(body, ['asks']).length > 0);
  await probe('BTC candles', '/market/external/candles/BTC-USDT?interval=15m&limit=80', (body) => listOf(body, ['candles']).length >= 20);
  await probe('BTC trades', '/market/external/trades/BTC-USDT?limit=30', (body) => listOf(body, ['trades']).length > 0);
  await probe('market overview', '/market/global', (body) => Boolean(body && typeof body === 'object'));
  await probe('market rankings', '/market/external/rankings', (body) => Boolean(body && typeof body === 'object'));

  const cfd = await probe('CFD tickers', '/cfd/tickers', (body) => {
    const rows = listOf(body, ['tickers']);
    return rows.length === 13 && rows.every((row) => positive(row?.price));
  }, { timeoutMs: 20000, slowMs: 6000 });
  await probe('XAUUSD candles', '/cfd/candles/XAUUSD?interval=15m&limit=80', (body) => listOf(body, ['candles', 'bars', 'data']).length >= 20, { timeoutMs: 20000, slowMs: 6000 });
  await probe('WTIUSD candles', '/cfd/candles/WTIUSD?interval=15m&limit=80', (body) => listOf(body, ['candles', 'bars', 'data']).length >= 20, { timeoutMs: 20000, slowMs: 6000 });
  await probe('futures config', '/futures/config', (body) => Boolean(body && typeof body === 'object'));
  await probe('futures markets', '/futures/markets', (body) => listOf(body, ['markets', 'symbols']).length > 0 || Array.isArray(body));
  await probe('BTC futures mark/index', '/futures/mark-price/BTC-USDT', (body) => positive(body?.markPrice) && positive(body?.indexPrice));
  await probe('BTC futures funding', '/futures/funding-rate/BTC-USDT?limit=1', (body) => Array.isArray(body?.history));
  await probe('BTC futures open interest', '/futures/open-interest/BTC-USDT', (body) => body && Object.prototype.hasOwnProperty.call(body, 'openInterest'));

  if (!tickers) critical('Spot ticker universe is unavailable');
  if (!cfd) critical('CFD ticker universe is unavailable');

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [1440, 1024, 390]) await auditHomepage(browser, width);
    for (const width of [1440, 1024, 390]) await auditAuthenticatedRoutes(browser, width);
  } finally {
    await browser.close();
  }

  if (report.blockedWrites.length) critical('Page-load audit attempted production writes', `${report.blockedWrites.length} blocked request(s)`);
  report.completedAt = new Date().toISOString();
  report.summary = {
    apiChecks: report.api.length,
    homeScenarios: report.home.length,
    routeScenarios: report.routes.length,
    criticalFindings: report.findings.length,
    warnings: report.warnings.length,
    pageErrors: report.pageErrors.length,
    publicHttpErrors: report.publicHttpErrors.length,
    failedAssets: report.failedAssets.length,
    blockedWrites: report.blockedWrites.length,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('VOLTEX_PRODUCTION_LOADING_AUDIT ' + JSON.stringify({ summary: report.summary, findings: report.findings, warnings: report.warnings, api: report.api, home: report.home, routes: report.routes }));
  if (report.findings.length) process.exitCode = 1;
})().catch((error) => {
  critical('Audit process failed', String(error?.stack || error));
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.error(error);
  process.exitCode = 1;
});
