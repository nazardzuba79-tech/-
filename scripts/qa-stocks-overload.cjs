// Built Professional B UI against disposable paper accounts. All market data,
// identities and injected failures below are fixtures; external traffic is denied.
// Build with VITE_STOCKS_ENABLED=true VITE_STOCKS_WIDGET_PREVIEW=true
// VITE_STOCKS_GLOBAL_SIMULATOR=true. Run with QA_DIST / QA_OUT as needed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const dist = path.resolve(process.env.QA_DIST || path.join(root, 'frontend/dist-stocks-global'));
const out = path.resolve(process.env.QA_OUT || path.join(root, 'output/stocks-overload'));
const id = 'BYBIT:AAPLXUSDT', prefix = '/__stocks_global/';
const report = { fixtureOnly: true, externalApiCalls: 0, productionWrites: 0, assertions: [], views: [], requests: [], recoveryTimers: [], pageErrors: [], externalBlocked: [], unexpectedWrites: [] };
function check(value, name) { assert.ok(value, name); report.assertions.push(name); }
async function until(predicate, message) {
  const started = Date.now();
  while (!await predicate()) { if (Date.now() - started > 10000) throw Error(message); await new Promise(resolve => setTimeout(resolve, 25)); }
}
const countReads = () => report.requests.filter(r => r.method === 'GET' && ['state', 'history'].includes(r.route)).length;
const orderRequests = () => report.requests.filter(r => r.method === 'POST' && r.route === 'orders');
const writeRequests = () => report.requests.filter(r => r.method === 'POST');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  check(fs.existsSync(path.join(dist, 'index.html')), 'enabled frontend production build exists');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-stocks-overload-'));
  let app, browser;
  try {
    const { createServer } = await import(pathToFileURL(path.join(root, 'services/stocks-global/server.mjs')).href);
    const { CATALOG } = await import(pathToFileURL(path.join(root, 'services/stocks-global/catalog.mjs')).href);
    const { SimError } = await import(pathToFileURL(path.join(root, 'services/stocks-global/engine.mjs')).href);
    const instruments = CATALOG.filter(i => [id, 'BYBIT:NVDAXUSDT', 'BINANCE:AAPLBUSDT'].includes(i.id));
    const hub = {
      metrics: {},
      catalogue: async () => instruments.map(i => ({ ...i, domain: null, exists: true, online: true, display: null })),
      quote: async symbol => {
        const instrument = instruments.find(i => i.id === symbol); assert.ok(instrument);
        const at = Date.now();
        return { instrumentId: symbol, provider: instrument.provider, nativeCurrency: 'USDT', timestamp: at, receivedAt: at,
          verified: true, marketOpen: true, capacity: '1.00000000', bid: '100.00000000', ask: '100.10000000', last: '100.05000000',
          eventId: String(at), change24h: 0.5, volume: '25.00000000', delaySeconds: 0, multiplier: null,
          prices: { USDT: { buy: '100.10000000', sell: '100.00000000' } }, fx: {} };
      },
      history: async (symbol, interval) => {
        assert.ok(instruments.some(i => i.id === symbol));
        const step = { '15m': 900, '1h': 3600 }[interval] || 900, end = Math.floor(Date.now() / 1000 / step) * step;
        return { instrumentId: symbol, interval, currency: 'USDT', provider: 'bybit', delaySeconds: 0, receivedAt: Date.now(),
          candles: Array.from({ length: 90 }, (_, n) => ({ time: end - (90 - n) * step, open: 100 + n / 100, high: 102 + n / 100, low: 99 + n / 100, close: 101 + n / 100, volume: 25 })) };
      },
    };
    app = await createServer({ port: 0, accountsPath: path.join(scratch, 'accounts.sqlite'), dist, hub, autoPoll: false,
      authenticate: async request => {
        const token = request.headers.authorization?.replace(/^Bearer /, '');
        if (!/^fixture-overload-(1440|390|matrix-(ru|en|zh|es|hi|ja|ko))$/.test(token || '')) throw new SimError('AUTH_REQUIRED');
        return { issuer: 'stocks-overload-browser-fixture', subject: token };
      },
    });
    const origin = `http://127.0.0.1:${app.port}`;
    const local = async (width, route, body, csrf) => {
      const response = await fetch(origin + prefix + route, { method: body ? 'POST' : 'GET', headers: {
        Authorization: `Bearer fixture-overload-${width}`, ...(body ? { 'Content-Type': 'application/json', 'X-Stocks-Token': csrf } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, 200, 'local fixture setup/read must succeed');
      return response.json();
    };
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM ? { executablePath: process.env.QA_CHROMIUM } : {}) });
    for (const width of [1440, 390]) {
      const initial = await local(width, `state?id=${encodeURIComponent(id)}`);
      await local(width, 'catalogue'); await local(width, 'refresh', { id }, initial.token);
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: 'block', locale: 'ru-RU' });
      await context.addInitScript(token => { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', 'ru'); }, `fixture-overload-${width}`);
      const faults = { history: null, rejectNextOrder: false, priorStateErrors: 0, priorResponseGate: null };
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) {
          report.externalBlocked.push({ width, method: request.method(), origin: url.origin, path: url.pathname });
          return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"FIXTURE_EXTERNAL_NETWORK_DENIED"}' });
        }
        if (url.pathname.startsWith(prefix)) {
          const name = url.pathname.slice(prefix.length), entry = { width, method: request.method(), route: name, query: url.search };
          if (request.method() === 'POST') { const body = request.postDataJSON(); entry.orderId = name === 'orders' ? body.id : undefined; }
          report.requests.push(entry);
          if (name === 'history' && faults.history) { entry.fault = faults.history; return route.fulfill({ status: 422, contentType: 'application/json', headers: { 'Retry-After': '60' }, body: JSON.stringify({ error: faults.history, retryAfterMs: 60000 }) }); }
          if (name === 'orders' && faults.rejectNextOrder) { faults.rejectNextOrder = false; entry.fault = 'ACCOUNT_BUSY'; return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Retry-After': '3' }, body: '{"error":"ACCOUNT_BUSY","retryAfterMs":3000}' }); }
          if (name === 'state' && faults.priorStateErrors > 0) {
            faults.priorStateErrors--; entry.fault = 'prior-ACCOUNT_BUSY'; const response = await route.fetch(); const body = await response.json(); body.errors = { ...body.errors, [id]: 'ACCOUNT_BUSY' };
            await faults.priorResponseGate;
            return route.fulfill({ response, contentType: 'application/json', body: JSON.stringify(body) });
          }
          return route.continue();
        }
        if (!['GET', 'HEAD'].includes(request.method())) { report.unexpectedWrites.push({ width, method: request.method(), path: url.pathname }); return route.fulfill({ status: 403, body: 'Fixture denies non-Stocks writes' }); }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"FIXTURE_REAL_API_DISABLED"}' });
        return route.continue();
      });
      if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => { report.externalBlocked.push({ width, type: 'websocket' }); socket.close(); });
      const page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push({ width, message: error.message }));
      await page.clock.install({ time: new Date() }); await page.clock.pauseAt(new Date(Date.now() + 1000));
      await page.goto(origin + '/stocks/' + encodeURIComponent(id));
      await page.locator('.vxg-market-head').waitFor();
      await until(async () => (await page.locator('.vxg-active-asset').innerText()).includes('AAPLX'), 'Stocks catalogue did not render; check enabled build flags');
      await page.locator('.vxg-chart-section canvas').first().waitFor();
      await until(async () => !(await page.locator('.vxg-ohlc').innerText()).includes('Свечи не получены'), 'fixture candles did not reach the actual chart');
      await page.clock.runFor(50); // Flush chart animation frames, not a market-data retry.
      await page.evaluate(() => {
        // Observe timer admission only. The application callback, delay, return
        // handle and Playwright clock implementation are forwarded unchanged.
        // Recovering UI/request start precede async body parsing, so they cannot
        // establish when the circuit's3.5s followup delay actually begins.
        window.__stocksRecoveryTimerArms = [];
        const original = window.setTimeout;
        window.setTimeout = function (callback, delay, ...args) {
          if (delay === 3500) window.__stocksRecoveryTimerArms.push(Date.now());
          return original.call(window, callback, delay, ...args);
        };
      });
      const alert = page.locator('.vxg-center > [role="alert"]').filter({ hasText: 'Автообновление приостановлено' });
      const retry = alert.getByRole('button', { name: 'Повторить загрузку', exact: true });
      const screenshot = async name => { const file = `fixture-${width}-${name}.png`; await page.screenshot({ path: path.join(out, file), fullPage: true }); report.views.push({ width, state: name, screenshot: file, fixtureOnly: true }); };
      await screenshot('before-overload');
      const lastOhlc = await page.locator('.vxg-ohlc').innerText();
      faults.history = 'RATE_LIMIT'; await page.clock.runFor(15000);
      await alert.waitFor(); check((await alert.innerText()).includes('Достигнут лимит запросов источника'), `${width}: readable rate-limit explanation`);
      check(await page.locator('.vxg-ohlc').innerText() === lastOhlc, `${width}: failed refresh preserves last received candle data`);
      check(await retry.isDisabled(), `${width}: rate cooldown initially disables manual retry`);
      await screenshot('rate-limit');
      const rateReads = countReads(), rateWrites = writeRequests().length;
      await page.clock.runFor(59000); check(countReads() === rateReads, `${width}: no state/history polling during rate cooldown`);
      check(await retry.isDisabled(), `${width}: rate retry stays disabled before60s`);
      await page.clock.runFor(2000); check(!await retry.isDisabled(), `${width}: rate retry available after cooldown`);
      check(countReads() === rateReads, `${width}: cooldown expiry does not retry automatically`);
      await retry.click(); await until(async () => await retry.count() > 0 && await retry.isDisabled(), 'persistent rate-limit probe did not relatch');
      check(countReads() === rateReads + 2, `${width}: manual failure probes exactly one state and one history GET`);
      check(writeRequests().length === rateWrites, `${width}: rate recovery sends no POST`);
      await page.clock.runFor(121000); check(countReads() === rateReads + 2, `${width}: persistent rate-limit has no infinite retry loop`);
      faults.history = null; await retry.click(); await alert.waitFor({ state: 'hidden' });
      check(countReads() === rateReads + 4, `${width}: successful manual recovery remains two GETs`);
      check(writeRequests().length === rateWrites, `${width}: successful read recovery does not submit an order`);
      await screenshot('rate-recovered');

      if (width === 390) await page.locator('.vxg-mobile-tabs').getByRole('button', { name: 'Торговля', exact: true }).click();
      const ticket = page.locator('.vxg-ticket');
      await ticket.getByRole('button', { name: 'Limit', exact: true }).click();
      await ticket.getByLabel('Цена', { exact: true }).fill('90'); await ticket.getByLabel('Количество', { exact: true }).fill('1');
      faults.rejectNextOrder = true;
      const ordersBefore = orderRequests().length;
      await ticket.locator('.vxg-submit').click(); await alert.waitFor();
      check((await alert.innerText()).includes('Тестовый счёт занят'), `${width}: readable account-busy explanation`);
      check(orderRequests().length === ordersBefore + 1, `${width}: one explicit order attempt reaches fixture rejection`);
      check(await ticket.locator('.vxg-submit').isDisabled(), `${width}: paused account cannot resubmit automatically`);
      await screenshot('account-busy');
      const busyReads = countReads(), busyWrites = writeRequests().length;
      await page.clock.runFor(7000); check(countReads() === busyReads, `${width}: account cooldown and expiry do not poll`);
      check(writeRequests().length === busyWrites, `${width}: account cooldown does not replay pending mutation`);
      const timerArmsBefore = await page.evaluate(() => window.__stocksRecoveryTimerArms.length);
      let releasePriorResponse;
      faults.priorResponseGate = new Promise(resolve => { releasePriorResponse = resolve; });
      faults.priorStateErrors = 1;
      try {
        await retry.click();
        await until(() => countReads() === busyReads + 2, 'manual account recovery did not issue initial reads');
        await until(async () => (await alert.innerText()).includes('Проверяем доступность'), 'bounded prior-error probe is not pending');
        await page.clock.runFor(3501);
        check(countReads() === busyReads + 2, `${width}: delayed response cannot trigger a premature followup`);
        check(await page.evaluate(() => window.__stocksRecoveryTimerArms.length) === timerArmsBefore, `${width}: followup timer is not armed before the initial body arrives`);
      } finally { releasePriorResponse(); faults.priorResponseGate = null; }
      await until(async () => await page.evaluate(() => window.__stocksRecoveryTimerArms.length) === timerArmsBefore + 1, 'prior-error followup timer was not armed after read completion');
      const armedAt = await page.evaluate(() => window.__stocksRecoveryTimerArms.at(-1));
      report.recoveryTimers.push({ width, delayMs: 3500, armedAt, initialResponseHeldForVirtualMs: 3501 });
      await page.clock.runFor(3499); check(countReads() === busyReads + 2, `${width}: prior-error followup waits for server tick`);
      await page.clock.runFor(2); await alert.waitFor({ state: 'hidden' });
      check(countReads() === busyReads + 3, `${width}: prior state error permits exactly one delayed GETstate`);
      check(writeRequests().length === busyWrites, `${width}: prior-error recovery never replays order`);
      const failedId = orderRequests().at(-1).orderId;
      await ticket.locator('.vxg-submit').click(); await ticket.getByRole('status').waitFor();
      check(orderRequests().length === ordersBefore + 2, `${width}: only second explicit click sends second order request`);
      check(orderRequests().at(-1).orderId === failedId, `${width}: unchanged pending order reuses its idempotency id`);
      const final = await local(width, `state?id=${encodeURIComponent(id)}`);
      check(final.orders.length === 1 && final.orders[0].id === failedId && final.orders[0].status === 'OPEN', `${width}: one isolated limit order survives retry`);
      check(final.fills.length === 0 && final.wallets.USDT.cash === '10000.00000000' && final.wallets.USDT.reserved === '90.00000000', `${width}: rejected attempt creates no duplicate fill or reservation`);
      await screenshot('manual-order-recovered');
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      check(dimensions.document <= dimensions.viewport + 1, `${width}: no horizontal page overflow`);
      await context.close();
    }
    await require('./qa-stocks-global-matrix.cjs')({browser,origin,id,prefix,local,out,report,check,until});
    check(report.unexpectedWrites.length === 0, 'no non-Stocks financial or application writes');
    check(report.pageErrors.length === 0, 'no uncaught browser errors');
    report.pass = true;
    report.notes = ['Screenshots contain synthetic market fixtures for UI regression, not real market prices.', 'Real local Stocks account worker, engine and SQLite are used; all accounts are disposable fixture identities.', 'Injected503 rejects the first order before dispatch. One user retry reuses the same id and creates one pending limit order.', 'Virtual browser clock tests60s cooldowns; no production capacity inference is made.'];
  } catch (error) { report.pass = false; report.failure = error.stack || String(error); process.exitCode = 1; }
  finally {
    if (browser) await browser.close(); if (app) await app.close();
    // mkdtemp creates this task's disposable ledger; never recurse outside that
    // verified direct child of the OS temp directory, and never touch preview DBs.
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(scratch).startsWith('voltex-stocks-overload-'));
    fs.rmSync(scratch, { recursive: true, force: true }); report.disposableDatabaseRemoved = true;
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ pass: report.pass, assertions: report.assertions.length, screenshots: report.views.length, externalApiCalls: 0, error: report.failure || null, report: path.join(out, 'report.json'), fixtureDirectory: scratch }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
