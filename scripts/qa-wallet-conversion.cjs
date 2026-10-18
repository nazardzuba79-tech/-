/* Production-built React + REAL conversion/activity routes + disposable PostgreSQL.
 * Only unrelated read endpoints are fixtures. Outbound network denied. No production. */
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), { createRequire } = require('module');
const BigNumber = require('bignumber.js');
exports.run = async ({ origin, token, prisma, user, out }) => {
  const qa = createRequire(path.resolve(__dirname, '..', process.env.WALLET_QA_DEPS || 'output/wallet-qa-deps/package.json'));
  const { chromium } = process.env.WALLET_PLAYWRIGHT_PATH ? require(process.env.WALLET_PLAYWRIGHT_PATH) : qa('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(), errors = [], unexpected = [], requests = [], checks = [], screenshots = [];
  page.on('pageerror', error => errors.push(String(error)));
  await context.addInitScript(({ token }) => { localStorage.setItem('exchange_token', token); localStorage.setItem('exchange_lang', 'ru'); }, { token });
  let dropConfirm = false, activityFailed = false, assetsFailed = false;
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const endpoint = url.pathname.replace('/api/v1', ''); requests.push({ method: req.method(), endpoint });
    if (endpoint.startsWith('/wallet/conversion') || endpoint === '/wallet/activity') {
      if ((activityFailed && endpoint === '/wallet/activity') || (assetsFailed && endpoint === '/wallet/conversion/assets')) return route.fulfill({ status: 503, json: { code: 'FIXTURE_OUTAGE' } });
      if (dropConfirm && endpoint === '/wallet/conversion/confirm') {
        dropConfirm = false; await route.fetch(); return route.abort('failed'); // real DB commit, deliberately lost delivery
      }
      return route.continue();
    }
    if (req.method() !== 'GET' && endpoint !== '/wallet/portfolio-snapshot') { unexpected.push(req.method() + ' ' + endpoint); return route.fulfill({ status: 403, json: { code: 'FIXTURE_WRITE_DENIED' } }); }
    let result;
    const marks = { USD: 1, EUR: 1.25, BTC: 60000, USDT: 0.998 };
    if (endpoint === '/me') result = { id: user, email: 'wallet@example.invalid', role: 'USER', kycStatus: 'APPROVED', displayName: 'Fixture Wallet', twoFactorEnabled: false };
    else if (['/wallet/overview', '/balances'].includes(endpoint)) {
      const spot = (await prisma.balance.findMany({ where: { userId: user } })).map(r => ({ asset: r.asset, available: r.available.toString(), locked: r.locked.toString(), priceUsd: marks[r.asset] ?? null, valueUsd: marks[r.asset] ? new BigNumber(r.available.toString()).plus(r.locked.toString()).times(marks[r.asset]).toNumber() : null }));
      const total = spot.reduce((sum, r) => sum + (r.valueUsd ?? 0), 0);
      result = endpoint === '/balances' ? spot : { real: { spot, futures: [], spotValueUsd: total, futuresValueUsd: 0, totalValueUsd: total }, presentation: null, displaySpotUsd: total, displayFuturesUsd: 0, displayTotalUsd: total, btcPriceUsd: 60000 };
    }
    else if (endpoint === '/wallet/performance') result = { ageDays: 0, startedOn: null, periods: Object.fromEntries(['7d', '30d', '90d', '1y', 'all'].map(period => [period, { period, available: false, points: [] }])) };
    else if (endpoint === '/wallet/portfolio-history') result = { points: [] };
    else if (endpoint === '/wallet/portfolio-snapshot') result = { recorded: false };
    else if (endpoint === '/deposits/me') result = [{ id: 'fixture-credited', asset: 'USDT', amount: '500', chain: 'tron', txHash: null, confirmations: 20, status: 'CREDITED', createdAt: new Date().toISOString() }, { id: 'fixture-pending', asset: 'USDT', amount: '10', chain: 'tron', txHash: null, confirmations: 0, status: 'PENDING', createdAt: new Date().toISOString() }];
    else if (['/withdrawals/me', '/trades/me', '/futures/balances', '/products', '/purchases/me'].includes(endpoint)) result = [];
    else if (endpoint === '/market/external/rankings') result = { source: 'FIXTURE', rankings: Object.entries(marks).map(([symbol, price]) => ({ symbol, name: symbol, price, changePercent24h: 0 })) };
    else if (endpoint === '/market/assets/icons') result = { icons: {} };
    else if (endpoint === '/support/conversations/mine') result = { conversation: null, messages: [] };
    else if (endpoint.startsWith('/private-trading/')) return route.fulfill({ status: 403, json: { code: 'NOT_ALLOWED' } });
    else { unexpected.push(req.method() + ' ' + endpoint); return route.fulfill({ status: 503, json: { code: 'UNEXPECTED_FIXTURE_ROUTE' } }); }
    return route.fulfill({ json: result });
  });
  const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS browser ' + name); };
  const open = async (pending = false) => { await page.getByRole('button', { name: 'Конвертация', exact: true }).first().click(); await page.locator(pending ? '[role="dialog"]' : '#conversion-from').waitFor(); };
  const select = async (id, symbol) => { await page.locator('#' + id).click(); await page.getByRole('option', { name: new RegExp('^' + symbol + ' ·') }).click(); };
  const snapshot = async () => JSON.stringify(await prisma.balance.findMany({ where: { userId: user }, orderBy: { asset: 'asc' } }));
  try {
    await page.goto(origin + '/wallet'); await page.getByRole('button', { name: 'Конвертация', exact: true }).first().waitFor();
    await check('preview and invalid amount never mutate; zero-fee fiat confirmation reaches real PostgreSQL', async () => {
      await open(); await select('conversion-from', 'USD'); await select('conversion-to', 'EUR');
      await page.locator('#conversion-amount').fill('-1'); assert(await page.getByRole('button', { name: 'Рассчитать', exact: true }).isDisabled());
      const before = await snapshot(); await page.locator('#conversion-amount').fill('2.5'); await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
      await page.locator('[data-conversion-quote]').waitFor(); assert.equal(await snapshot(), before); assert((await page.locator('[data-conversion-quote]').innerText()).includes('0%'));
      const file = path.join(out, 'conversion-preview-1440.png'); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file);
      await page.getByRole('dialog').getByRole('button', { name: 'Конвертация', exact: true }).click();
      await page.getByText('Конвертация выполнена', { exact: true }).waitFor(); assert.notEqual(await snapshot(), before);
      await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).last().click();
    });
    await check('fiat to crypto, ambiguous delivery and page reload recover receipt without a second debit', async () => {
      await open(); await select('conversion-from', 'EUR'); await select('conversion-to', 'BTC'); await page.locator('#conversion-amount').fill('1');
      await page.getByRole('button', { name: 'Рассчитать', exact: true }).click(); await page.locator('[data-conversion-quote]').waitFor();
      dropConfirm = true; await page.getByRole('dialog').getByRole('button', { name: 'Конвертация', exact: true }).click(); await page.getByRole('button', { name: 'Проверить результат' }).waitFor();
      await page.locator('[role="dialog"] p.text-neg').waitFor(); // wait for delivery failure AFTER the commit
      const before = await snapshot(); await page.reload(); await open(true);
      assert.equal(await page.locator('#conversion-amount').count(), 0);
      await page.getByRole('button', { name: 'Проверить результат' }).click(); await page.getByText('Конвертация выполнена', { exact: true }).waitFor(); assert.equal(await snapshot(), before);
      await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).last().click();
    });
    await check('responsive modal is usable at all widths; no page horizontal overflow', async () => {
      for (const [width, height] of [[1920,1080],[1440,900],[1366,768],[430,900],[390,844],[360,800],[320,740]]) {
        await page.setViewportSize({ width, height }); await open(); await select('conversion-from', 'USD'); await select('conversion-to', 'EUR'); await page.locator('#conversion-amount').fill('0.5');
        await page.getByRole('button', { name: 'Рассчитать', exact: true }).click(); await page.locator('[data-conversion-quote]').waitFor();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const button = page.getByRole('dialog').getByRole('button', { name: 'Конвертация', exact: true }); await button.scrollIntoViewIfNeeded(); assert(await button.isVisible());
        const file = path.join(out, `conversion-${width}.png`); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file);
        await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
      }
    });
    await check('real audit history, confirmed deposit fixture, hidden amounts and partial outage', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('button', { name: 'Orders', exact: true }).click();
      await page.getByRole('heading', { name: 'История операций', exact: true }).waitFor();
      assert((await page.locator('tbody').last().innerText()).includes('USDT'));
      assert(!(await page.locator('tbody').last().innerText()).includes('private fixture reason'));
      const file = path.join(out, 'history-1440.png'); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file);
      await page.evaluate(() => localStorage.setItem('exchange_hide_balance', '1')); await page.reload();
      await page.getByRole('button', { name: 'Orders', exact: true }).click(); await page.locator('tbody').last().waitFor();
      assert(!(await page.locator('tbody').last().innerText()).includes('500'));
      await page.evaluate(() => localStorage.setItem('exchange_hide_balance', '0'));
      activityFailed = true; await page.reload(); await page.getByRole('button', { name: 'Orders', exact: true }).click();
      await page.getByText('Часть истории недоступна. Показаны только загруженные операции', { exact: true }).waitFor();
      assert((await page.locator('tbody').last().innerText()).includes('USDT')); activityFailed = false;
    });
    await check('quote feed failure cannot cause financial request', async () => {
      await page.getByRole('button', { name: 'Обзор', exact: true }).click(); assetsFailed = true;
      const count = requests.filter(r => r.endpoint === '/wallet/conversion/confirm').length;
      await open(); await page.getByText('Котировка недоступна. Попробуйте позже', { exact: true }).waitFor();
      assert.equal(requests.filter(r => r.endpoint === '/wallet/conversion/confirm').length, count);
    });
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    const report = { build: 'production React bundle', conversionAndHistory: 'real routes / disposable PostgreSQL', unrelatedReads: 'fixtures', outboundNetwork: 'denied', checks, screenshots, errors, unexpected, requests, productionTouched: false };
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(report, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(out, 'browser-failure.png'), fullPage: true });
    fs.writeFileSync(path.join(out, 'browser-failure.json'), JSON.stringify({ error: String(error), errors, unexpected, requests, text: await page.locator('body').innerText() }, null, 2));
    throw error;
  } finally { await browser.close(); }
};
