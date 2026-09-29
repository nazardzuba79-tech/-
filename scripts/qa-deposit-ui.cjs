/** Mounted Header + Wallet deposit QA with local synthetic fixtures only.
 * Run Vite with VITE_MANUAL_DEPOSIT_CATALOGUE=true, then node this file.
 * QR is decoded independently with jsQR, not by reading component props. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const jsQR = require(process.env.QA_JSQR_MODULE || 'jsqr');
const { PNG } = require(process.env.QA_PNGJS_MODULE || 'pngjs');
const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:4262';
const out = path.resolve(process.env.QA_OUT || 'docs/qa/deposit-ui');
fs.mkdirSync(out, { recursive: true });
const report = { fixtureOnly: true, checks: [], errors: [], requests: {}, layouts: [], idleMs: 60100 };
const check = (label, condition = true) => { assert.ok(condition, label); report.checks.push(label); };
const exact = name => ({ name, exact: true });
const evm = '0x' + '1'.repeat(40), tron = 'T' + 'A'.repeat(33);
let browser;
async function setup(width = 1440, height = 1000, touch = false) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (report.errors.push('External request: ' + route.request().url()), route.abort()));
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__copies = []; window.__copyMode = 'success';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => {
      window.__copies.push(text);
      return window.__copyMode === 'failure' ? Promise.reject(new Error('Denied')) : window.__copyMode === 'pending' ? new Promise(resolve => { window.__resolveCopy = resolve; }) : Promise.resolve();
    } } });
  });
  await page.goto(origin + '/qa/deposit-preview.html');
  return { context, page };
}
const requests = page => page.evaluate(() => window.__depositFixture.requests.length);
// The «Актив» field (a select-like button labelled by «Актив» + the chosen asset).
const assetField = page => page.getByRole('button', { name: /^Актив / });
const pickAsset = async (page, symbol, method = 'click') => {
  await assetField(page).click();
  await page.getByRole('option').filter({ has: page.locator('strong', { hasText: new RegExp('^' + symbol + '$') }) })[method]();
  await page.getByRole('heading', exact('Ваш адрес ' + symbol)).waitFor();
};
const address = page => page.getByTestId('deposit-address').innerText();
/** The minimum is on screen for this destination, ABOVE the address, in two
 *  lines (owner, 2026-09-29): «Минимальное пополнение — 300 USDT» for a
 *  USD-pegged coin, «… — 300 USDT или эквивалент в BTC» for any other, then one
 *  short sentence. «(≈ X BTC)» only from a live, current price. */
async function minimumShown(page, entry, symbol, priced = false) {
  const box = page.getByTestId('deposit-minimum');
  const text = await box.innerText();
  const minY = (await box.boundingBox()).y, addressY = (await page.getByTestId('deposit-address').boundingBox()).y;
  const equivalent = await page.getByTestId('deposit-minimum-equivalent').count();
  const pegged = symbol === 'USDT' || symbol === 'USDC';
  const line = pegged ? `Минимальное пополнение — 300 ${symbol}` : `Минимальное пополнение — 300 USDT или эквивалент в ${symbol}`;
  check(`${entry}: ${symbol} minimum in two lines before the address`, text.startsWith(line)
    && text.includes('Несколько переводов в одном активе и сети суммируются.') && text.split('\n').filter(Boolean).length === 2 && minY < addressY);
  check(`${entry}: ${symbol} ${priced ? 'shows' : 'has no'} ≈ estimate`, equivalent === (priced && !pegged ? 1 : 0));
}
// Wait for a committed parent render so a negative assertion cannot pass
// before the component has had a chance to observe the injected quote.
async function setPagePrices(page, prices, ageMs = 0, stale = false) {
  const previousRender = await page.getByTestId('rerender').innerText();
  await page.evaluate(({ prices, ageMs, stale }) => {
    window.__depositFixture.setPrices(prices, Date.now() - ageMs, stale);
    dispatchEvent(new Event('qa-parent-render'));
  }, { prices, ageMs, stale });
  await page.waitForFunction(previous => document.querySelector('[data-testid="rerender"]').textContent !== previous, previousRender);
}
const open = async (page, entry) => { await page.getByRole('button', exact(entry + ' Deposit')).click(); await page.getByTestId('deposit-address').waitFor(); };
const close = page => page.getByRole('button', exact('Закрыть')).click();
async function screenshot(page, name) {
  const layout = await page.evaluate(() => {
    const dialog = document.querySelector('.dc-dialog'), content = document.querySelector('.dc-content');
    const r = dialog.getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, dialogWidth: r.width, left: r.left, right: r.right, top: r.top, bottom: r.bottom, contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth };
  });
  check(name + ': fits viewport', layout.documentWidth <= layout.width && layout.left >= 0 && layout.right <= layout.width && layout.top >= 0 && layout.bottom <= layout.height && layout.contentScrollWidth <= layout.contentWidth);
  report.layouts.push({ name, ...layout });
  await page.screenshot({ path: path.join(out, name + '.png') });
}
async function decode(page) {
  const png = PNG.sync.read(await page.locator('.dc-qr').screenshot());
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(decoded, 'QR must decode'); return decoded.data;
}
async function entryChecks(entry) {
  const { context, page } = await setup();
  try {
    await open(page, entry); check(entry + ': one catalogue GET on open', await requests(page) === 1);
    // USDT on TRC-20 first (owner): the window opens on it, it heads the list, TRC-20 heads its networks.
    check(entry + ': opens on USDT · TRC-20', await page.getByRole('heading', exact('Ваш адрес USDT')).count() === 1 && await address(page) === tron
      && (await page.getByRole('radio', { checked: true }).innerText()).includes('TRC-20') && (await page.getByRole('radio').first().innerText()).includes('TRC-20'));
    await screenshot(page, entry.toLowerCase() + '-default-usdt-trc20');
    // The «Актив» field and its menu: a second press, a press outside and Esc
    // each close the menu; none of them closes the window.
    await assetField(page).click();
    check(entry + ': field opens the asset menu', await page.locator('.dc-menu').count() === 1 && await assetField(page).getAttribute('aria-expanded') === 'true');
    await screenshot(page, entry.toLowerCase() + '-asset-menu');
    await assetField(page).click(); check(entry + ': second press on the field closes the menu', await page.locator('.dc-menu').count() === 0);
    await assetField(page).click(); await page.locator('.dc-identity h3').click();
    check(entry + ': press outside closes the menu, window stays', await page.locator('.dc-menu').count() === 0 && await page.getByTestId('deposit-address').count() === 1);
    await assetField(page).click(); await page.keyboard.press('Escape');
    check(entry + ': Esc closes only the menu and returns focus to the field', await page.locator('.dc-menu').count() === 0
      && await page.getByTestId('deposit-address').count() === 1 && await assetField(page).evaluate(el => document.activeElement === el));
    await assetField(page).click();
    check(entry + ': USDT heads the asset list', (await page.getByRole('option').first().locator('strong').innerText()) === 'USDT');
    await page.keyboard.press('Escape');
    // «(≈ X)» for a non-pegged coin comes only from a LIVE price the page
    // already holds, no older than the server's 2-minute bound (the #339
    // review's stale-flag and render-only-age gaps are both closed).
    await pickAsset(page, 'BTC'); await minimumShown(page, entry, 'BTC');
    await screenshot(page, entry.toLowerCase() + '-btc-no-price');
    await setPagePrices(page, { BTC: '100000', ETH: '2500' });
    await minimumShown(page, entry, 'BTC', true);
    check(entry + ': live BTC price gives (≈ 0,003 BTC)', (await page.getByTestId('deposit-minimum-equivalent').innerText()).trim() === '(≈ 0,003 BTC)');
    await screenshot(page, entry.toLowerCase() + '-btc-estimate');
    await pickAsset(page, 'ETH'); await minimumShown(page, entry, 'ETH', true);
    await pickAsset(page, 'BTC');
    await setPagePrices(page, { BTC: '100000' }, 10_000, true);
    await minimumShown(page, entry, 'BTC');
    check(entry + ': recent but stale-served quote cannot add an estimate', await page.getByTestId('deposit-minimum-equivalent').count() === 0);
    await setPagePrices(page, { BTC: '100000' }, 3 * 60_000);
    await minimumShown(page, entry, 'BTC');
    check(entry + ': expired quote cannot add an estimate', await page.getByTestId('deposit-minimum-equivalent').count() === 0);
    // An estimate already on screen leaves when its price ages out, with no
    // re-render from the page.
    await setPagePrices(page, { BTC: '100000' }, 120_000 - 1_500);
    check(entry + ': near-expiry estimate is shown', await page.getByTestId('deposit-minimum-equivalent').count() === 1);
    await page.waitForTimeout(2_000);
    check(entry + ': estimate removed on expiry without a page re-render', await page.getByTestId('deposit-minimum-equivalent').count() === 0);
    await setPagePrices(page, null);
    await assetField(page).click();
    const initialUsdt = page.getByRole('option').filter({ hasText: 'Tether' });
    await initialUsdt.focus(); await page.evaluate(() => dispatchEvent(new Event('qa-parent-render'))); await page.waitForTimeout(80);
    await page.keyboard.press('Enter'); await page.getByRole('heading', exact('Ваш адрес USDT')).waitFor();
    check(entry + ': BTC→USDT keyboard selection survives parent render');
    await pickAsset(page, 'BTC');
    await pickAsset(page, 'USDT'); check(entry + ': single BTC→USDT click lands on USDT · TRC-20', await address(page) === tron);
    await assetField(page).click();
    const selected = page.getByRole('option', { selected: true });
    check(entry + ': USDT selected, BTC unselected', (await selected.innerText()).includes('USDT') && await page.getByRole('option').filter({ hasText: 'Bitcoin' }).getAttribute('aria-selected') === 'false');
    check(entry + ': selected checkmark', await selected.locator('svg.lucide-check').count() === 1);
    const usdtIcon = await page.getByRole('option').filter({ hasText: 'Tether' }).locator('img').getAttribute('src');
    const usdcIcon = await page.getByRole('option').filter({ hasText: 'USD Coin' }).locator('img').getAttribute('src');
    check(entry + ': distinct local USDT/USDC icons', usdtIcon.startsWith('data:') && usdcIcon.startsWith('data:') && usdtIcon !== usdcIcon);
    await screenshot(page, entry.toLowerCase() + '-assets-usdt-selected');
    const option = page.getByRole('option').filter({ hasText: 'Tether' });
    await option.focus(); await page.evaluate(() => dispatchEvent(new Event('qa-parent-render')));
    await page.waitForTimeout(80); check(entry + ': render preserves focused option', await option.evaluate(el => document.activeElement === el));
    await page.keyboard.press('Enter'); check(entry + ': Enter after rerender retains USDT', await address(page) === tron);
    // Both USDT networks are on screen at once, as radios under «Сеть».
    check(entry + ': USDT offers ERC-20 and TRC-20 side by side', await page.getByRole('radio').count() === 2
      && (await page.getByRole('radio', { name: /Ethereum/ }).innerText()).includes('ERC-20') && (await page.getByRole('radio', { name: /TRON/ }).innerText()).includes('TRC-20'));
    await screenshot(page, entry.toLowerCase() + '-networks');
    await page.getByRole('radio', { name: /TRON/ }).click();
    check(entry + ': network/address/warning atomic TRC-20', await address(page) === tron && (await page.getByRole('radio', { checked: true }).innerText()).includes('TRC-20') && (await page.locator('.dc-warning').innerText()).includes('USDT в сети TRON · TRC-20'));
    await page.getByRole('button', exact('Копировать адрес')).click();
    await page.getByRole('button', exact('Адрес скопирован')).waitFor();
    check(entry + ': exact clipboard address', await page.evaluate(() => window.__copies.at(-1)) === tron);
    await screenshot(page, entry.toLowerCase() + '-address-copy');
    await page.getByRole('button', exact('Показать QR-код')).click(); check(entry + ': TRON QR independently decoded', await decode(page) === tron);
    await page.getByRole('radio', { name: /Ethereum/ }).click(); check(entry + ': Ethereum QR updates in place', await decode(page) === evm);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__copyMode = 'failure'; });
    await page.getByRole('button', exact('Копировать адрес')).click(); await page.getByRole('alert').waitFor();
    check(entry + ': clipboard failure no false success', await page.getByRole('button', exact('Адрес скопирован')).count() === 0 && await page.getByTestId('deposit-address').evaluate(el => getComputedStyle(el).userSelect) === 'text');
    await page.evaluate(() => { window.__copyMode = 'pending'; });
    await page.getByRole('button', exact('Копировать адрес')).click(); await pickAsset(page, 'USDC');
    await page.evaluate(() => window.__resolveCopy()); await page.waitForTimeout(50);
    check(entry + ': old clipboard completion cannot mark new address', await page.getByRole('button', exact('Адрес скопирован')).count() === 0);
    for (const symbol of ['SOL', 'TON', 'POL', 'ETH', 'BNB', 'USDT', 'USDC', 'BTC']) {
      await pickAsset(page, symbol); check(entry + ': switch ' + symbol, await page.getByRole('heading', exact('Ваш адрес ' + symbol)).count() === 1);
      await minimumShown(page, entry, symbol);
      if (symbol === 'TON') { check(entry + ': empty TON memo absent', await page.locator('.dc-memo').count() === 0); await screenshot(page, entry.toLowerCase() + '-ton'); }
      if (symbol === 'POL') check(entry + ': POL is Polygon', (await page.locator('.dc-network').innerText()).includes('Polygon') && !(await page.locator('.dc-network').innerText()).includes('Ethereum'));
    }
    await assetField(page).click();
    await page.getByRole('textbox').fill('tether'); check(entry + ': local search by name', await page.getByRole('option').count() === 1);
    await page.getByRole('textbox').fill('USDC'); check(entry + ': local search by ticker', await page.getByRole('option').count() === 1);
    await page.getByRole('option').focus(); await page.keyboard.press('Space'); await page.getByRole('heading', exact('Ваш адрес USDC')).waitFor();
    check(entry + ': Space selection');
    check(entry + ': all selection/search/copy/QR actions add zero requests', await requests(page) === 1);
    await close(page); check(entry + ': focus returns to opener', await page.getByRole('button', exact(entry + ' Deposit')).evaluate(el => document.activeElement === el));
    await page.evaluate(() => {
      const f = window.__depositFixture;
      f.entries.find(e => e.asset === 'BTC').address = 'bc1q' + 'b'.repeat(38);
      f.entries.find(e => e.asset === 'SOL').enabled = false;
      f.entries.find(e => e.asset === 'USDC').address = '';
      f.entries.find(e => e.asset === 'TON').memo = '123456';
      f.entries.push({ ...f.entries[0], assetId: 'test', asset: 'TEST', networkId: 'test', networkName: 'Fixture network', address: 'fixture-test-address' });
      window.__copyMode = 'success';
    });
    await open(page, entry); await pickAsset(page, 'BTC'); check(entry + ': reopen revalidates changed address', await address(page) === 'bc1q' + 'b'.repeat(38));
    await assetField(page).click();
    const options = await page.getByRole('option').allTextContents();
    check(entry + ': disabled/unconfigured excluded', !options.some(x => x.includes('Solana') || x.includes('USD Coin')));
    check(entry + ': unknown ticker fallback', (await page.locator('.dc-fallback').innerText()) === 'TEST');
    await page.getByRole('option').filter({ hasText: 'Toncoin' }).click(); await page.getByRole('button', exact('Копировать memo')).click();
    check(entry + ': future memo separate exact clipboard', await page.evaluate(() => window.__copies.at(-1)) === '123456');
    await close(page); await page.evaluate(() => { window.__depositFixture.fail = true; });
    await page.getByRole('button', exact(entry + ' Deposit')).click(); await page.getByRole('alert').waitFor();
    check(entry + ': failure hides address', await page.getByTestId('deposit-address').count() === 0);
    const beforeRetry = await requests(page); await page.evaluate(() => { window.__depositFixture.fail = false; window.__depositFixture.delayMs = 400; });
    await page.getByRole('button', exact('Повторить')).click(); await page.getByRole('status').waitFor();
    check(entry + ': loading never shows old address', await page.getByTestId('deposit-address').count() === 0);
    await page.getByTestId('deposit-address').waitFor(); check(entry + ': manual retry exactly one GET', await requests(page) === beforeRetry + 1);
    await close(page); await page.evaluate(() => { window.__depositFixture.entries = []; window.__depositFixture.delayMs = 0; });
    await page.getByRole('button', exact(entry + ' Deposit')).click(); await page.locator('.dc-state').waitFor();
    await page.waitForTimeout(100); check(entry + ': empty catalogue no fabricated address', await page.getByTestId('deposit-address').count() === 0 && await page.locator('.dc-primary').count() === 0);
    report.requests[entry] = { initialOpen: 1, interactions: 0, retry: 1 };
  } catch (e) { await page.screenshot({ path: path.join(out, 'failure-' + entry + '.png') }); throw e; }
  finally { await context.close(); }
}
async function responsive(entry, width, height) {
  const { context, page } = await setup(width, height, width < 500);
  try {
    await open(page, entry); await pickAsset(page, 'USDT', width < 500 ? 'tap' : 'click');
    await screenshot(page, `${entry.toLowerCase()}-${width}x${height}`);
    check(`${entry} ${width}: copy target 48px`, (await page.locator('.dc-primary').boundingBox()).height >= 48);
    await assetField(page).click(); await page.getByRole('option').filter({ hasText: 'Toncoin' }).scrollIntoViewIfNeeded();
    await screenshot(page, `${entry.toLowerCase()}-list-${width}x${height}`);
    // Phone: a bottom sheet with its own close; wide screen: a popover under the field.
    const sheet = width <= 600;
    const menuBox = await page.locator('.dc-menu').boundingBox();
    check(`${entry} ${width}: asset list is a ${sheet ? 'bottom sheet' : 'popover under the field'}`, sheet
      ? Math.abs(menuBox.y + menuBox.height - height) <= 1 && menuBox.x === 0 && Math.abs(menuBox.width - width) <= 1
      : menuBox.y > (await assetField(page).boundingBox()).y);
    check(`${entry} ${width}: a close control stays visible`, sheet ? await page.locator('.dc-menu-close').isVisible() : await page.locator('.dc-close').isVisible());
    if (sheet) check(`${entry} ${width}: rows are large tap targets`, (await page.getByRole('option').first().boundingBox()).height >= 56);
    await page.keyboard.press('Escape'); check(`${entry} ${width}: Escape closes the list only`, await page.locator('.dc-menu').count() === 0 && await page.getByRole('heading', exact('Ваш адрес USDT')).count() === 1);
    // A press on the dimmed area around the window with the list open closes the list, not the window.
    await assetField(page).click();
    if (sheet) await page.locator('.dc-menu-backdrop').click({ position: { x: 4, y: 4 } }); else await page.mouse.click(4, 4);
    check(`${entry} ${width}: press around the window closes the list only`, await page.locator('.dc-menu').count() === 0 && await page.getByTestId('deposit-address').count() === 1);
    await page.keyboard.press('Tab'); const first = await page.evaluate(() => document.activeElement.outerHTML);
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    check(`${entry} ${width}: focus trap wraps`, await page.evaluate(() => document.activeElement.outerHTML) === first);
    await page.keyboard.press('Escape'); check(`${entry} ${width}: Escape closes`, await page.getByRole('dialog').count() === 0);
  } finally { await context.close(); }
}
async function idle() {
  const runs = await Promise.all(['Header','Wallet'].map(async entry => {
    const {context,page} = await setup(); await open(page,entry); return {entry,context,page,before:await requests(page)};
  }));
  await new Promise(resolve => setTimeout(resolve, report.idleMs));
  for (const {entry,context,page,before} of runs) { const delta = await requests(page) - before; report.requests[entry].idle60s = delta; check(entry + ': 60 seconds idle zero requests', delta === 0); await context.close(); }
}
(async () => {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? {channel:'msedge'} : {}) });
  try {
    for (const entry of ['Header','Wallet']) await entryChecks(entry);
    for (const entry of ['Header','Wallet']) for (const [w,h] of [[1920,1080],[1440,1000],[430,932],[390,844],[360,800],[320,568],[1440,480]]) await responsive(entry,w,h);
    console.log('Interaction + responsive checks passed; measuring 60 seconds idle.');
    await idle(); check('No console/page errors or external requests', report.errors.length === 0); report.result = 'PASS';
  } catch (e) { report.result = 'FAIL'; report.failure = e.stack; throw e; }
  finally { fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(report,null,2)); await browser.close(); console.log(JSON.stringify({result:report.result,checks:report.checks.length,errors:report.errors,requests:report.requests})); }
})().catch(e => { console.error(e); process.exitCode=1; });
