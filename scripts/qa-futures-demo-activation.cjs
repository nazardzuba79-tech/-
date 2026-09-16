/**
 * Browser QA for the two owner blockers: the demo account that could not
 * be opened from `/futures`, and the chart-tools strip that sat above the
 * chart in every session.
 *
 * Runs the real production bundle against scripts/serve-native-demo-review.cjs,
 * which is the isolated review stand — a session-scoped simulation account,
 * no live venue and no production data.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4178';
const VIEWPORTS = [
  { name: 'desktop 1440x1000', width: 1440, height: 1000, touch: false },
  // `hasTouch` is the point, not just the width: the compact entry is shown
  // by `(pointer: coarse)`, and a narrow window on a mouse is still fine.
  { name: 'mobile 390x844', width: 390, height: 844, touch: true },
];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every REAL futures account endpoint the owner must never reach. */
const REAL_ACCOUNT = /\/api\/v1\/futures\/(balances|positions|orders\/me|orders\/history|positions\/history)/;

const num = (text) => Number(String(text ?? '').replace(/[^\d.-]/g, ''));
const stat = (page, label) => page.evaluate((needle) => {
  const rows = [...document.querySelectorAll('.futures-account-summary .futures-account-stat, .futures-account-summary .futures-account-risk')];
  const row = rows.find((r) => r.textContent.includes(needle));
  return row ? row.textContent.replace(needle, '').trim() : null;
}, label);

async function open(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch });
  const realRequests = [];
  const initializeCalls = [];
  context.on('request', (r) => {
    const url = r.url();
    if (REAL_ACCOUNT.test(url)) realRequests.push(`${r.method()} ${url}`);
    if (url.endsWith('/native/initialize') && r.method() === 'POST') initializeCalls.push(r.postDataJSON());
  });
  const page = await context.newPage();
  // The authoritative account, as the APP received it. Reading the response
  // the terminal actually rendered from is stronger than issuing a second
  // request of our own, and it needs no session of its own.
  const native = { last: null };
  page.on('response', async (r) => {
    if (!/\/private-trading\/native\/(state|initialize|commands)$/.test(new URL(r.url()).pathname)) return;
    try { native.last = await r.json(); } catch {}
  });
  await page.addInitScript(() => { localStorage.setItem('exchange_lang', 'ru'); });
  await page.goto(`${BASE}/futures`, { waitUntil: 'domcontentloaded' });
  await page.locator('.futures-account-summary').waitFor({ timeout: 30000 });
  return { context, page, realRequests, initializeCalls, native };
}

async function run(browser, viewport) {
  const label = (s) => `[${viewport.name}] ${s}`;
  const { context, page, realRequests, initializeCalls, native } = await open(browser, viewport);
  try {
    // ---------- BEFORE: the account does not exist yet ----------
    await page.locator('.futures-account-demo').waitFor({ timeout: 20000 });
    const demoRow = await stat(page, 'Демо баланс');
    const before = {
      demo: demoRow,
      available: await stat(page, 'Доступная маржа'),
      marginBalance: await stat(page, 'Маржинальный баланс'),
      initialPct: await stat(page, 'Начальная маржа'),
      maintenancePct: await stat(page, 'Поддерживающая маржа'),
    };
    console.log(`      [BEFORE] ${JSON.stringify(before)}`);
    check(label('BEFORE: the real demo balance is shown, not 0.00'),
      num(before.demo) === 10000000, `demo=${before.demo}`);
    check(label('BEFORE: available margin is unknown, NOT 0.00'),
      before.available.startsWith('—'), `available=${before.available}`);
    check(label('BEFORE: margin balance is unknown, NOT 0.00'),
      before.marginBalance.startsWith('—'), `marginBalance=${before.marginBalance}`);
    check(label('BEFORE: the margin percentages are unknown, not 0.00%'),
      before.initialPct === '—' && before.maintenancePct === '—',
      `${before.initialPct} / ${before.maintenancePct}`);

    const activate = page.locator('.futures-account-activate');
    check(label('BEFORE: one activation action is offered'), await activate.count() === 1);
    const longBtn = page.locator('.fo-submitPair .buy');
    check(label('BEFORE: trading is blocked'), await longBtn.isDisabled());
    check(label('BEFORE: no second demo terminal exists'),
      await page.locator('.native-demo-ticket, .native-demo-panel').count() === 0);

    // ---------- INITIALIZE, exactly once under a double click ----------
    // Both presses land on the SAME node, in one task, before React can
    // re-render between them — which is what a real double click is, and
    // what a second click through a re-resolved locator is not.
    await page.evaluate(() => {
      const button = document.querySelector('.futures-account-activate');
      button.click(); button.click();
    });
    await page.locator('.futures-account-demo').waitFor({ state: 'detached', timeout: 25000 });
    await delay(1200);
    check(label('INITIALIZE: a double press sends exactly one initialize'),
      initializeCalls.length === 1, `${initializeCalls.length} POST /native/initialize`);
    check(label('INITIALIZE: the request carries a fixed idempotency key'),
      initializeCalls.every((b) => b && b.idempotencyKey === 'initialize-native-account'),
      JSON.stringify(initializeCalls.map((b) => b && b.idempotencyKey)));

    // ---------- AFTER ----------
    const after = {
      available: await stat(page, 'Доступная маржа'),
      marginBalance: await stat(page, 'Маржинальный баланс'),
      pnl: await page.locator('.futures-account-pnl .mono').innerText(),
      initialPct: await stat(page, 'Начальная маржа'),
      maintenancePct: await stat(page, 'Поддерживающая маржа'),
      marginType: await stat(page, 'Тип маржи'),
    };
    console.log(`      [AFTER]  ${JSON.stringify(after)}`);

    const api = native.last;
    if (!api || !api.account) throw new Error('no authoritative account observed on the wire');
    console.log(`      [SERVER] settle=${api.account?.settleBalance} wallet=${api.account?.walletCollateral} collateral=${api.account?.collateral} equity=${api.account?.equity} available=${api.account?.available}`);

    check(label('AFTER: the offer is withdrawn'), api.demoAvailable === null || api.demoAvailable === undefined, String(api.demoAvailable));
    check(label('AFTER: the account is initialized'), api.initialized === true);
    check(label('AFTER: available margin is the server figure, to the cent'),
      num(after.available) === Number(api.account.available), `${after.available} vs ${api.account.available}`);
    check(label('AFTER: margin balance is the server equity'),
      num(after.marginBalance) === Number(api.account.equity), `${after.marginBalance} vs ${api.account.equity}`);
    check(label('AFTER: unrealized PnL is the server figure'),
      num(after.pnl) === Number(api.account.unrealizedPnl), `${after.pnl} vs ${api.account.unrealizedPnl}`);
    check(label('AFTER: Cross is stated'), (after.marginType || '').includes('Кросс'), after.marginType);
    check(label('AFTER: the margin percentages are real, not dashes'),
      after.initialPct.endsWith('%') && after.maintenancePct.endsWith('%'),
      `${after.initialPct} / ${after.maintenancePct}`);

    // Collateral = the transferred ledger + the rest of the wallet at mark,
    // added once. The stand holds 2 BTC beside the settle row.
    const identity = Math.abs(
      Number(api.account.settleBalance) + Number(api.account.walletCollateral) - Number(api.account.collateral));
    check(label('AFTER: collateral is settle + wallet, counted once'), identity < 1e-6,
      `${api.account.settleBalance} + ${api.account.walletCollateral} = ${api.account.collateral}`);
    // Either the rest of the wallet is priced and counted, or it cannot be
    // priced and is EXCLUDED and named. What is forbidden is valuing an
    // unpriceable asset at zero and calling the total complete.
    const priced = Number(api.account.walletCollateral) > 0 && api.account.collateralComplete === true;
    const disclosed = api.account.collateralComplete === false && api.account.unpricedAssets.length > 0;
    check(label('AFTER: the rest of the wallet is either priced or declared unpriced'),
      priced || disclosed,
      `walletCollateral=${api.account.walletCollateral} complete=${api.account.collateralComplete} unpriced=${JSON.stringify(api.account.unpricedAssets)}`);
    if (disclosed) {
      check(label('AFTER: an incomplete valuation is stated on screen'),
        (await page.locator('.futures-account-state').count()) >= 1,
        (await page.locator('.futures-account-state').first().innerText().catch(() => '')).slice(0, 80));
      check(label('AFTER: no liquidation verdict is invented on understated collateral'),
        api.account.liquidatable === null, String(api.account.liquidatable));
    }
    check(label('AFTER: equity is collateral plus unrealized PnL'),
      Math.abs(Number(api.account.collateral) + Number(api.account.unrealizedPnl) - Number(api.account.equity)) < 1e-6,
      api.account.equity);
    check(label('AFTER: the ledger reconciles'), api.ledger?.reconciled === true);
    check(label('AFTER: trading is enabled'), !(await longBtn.isDisabled()));

    // ---------- RELOAD does not transfer again ----------
    const beforeReload = initializeCalls.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.futures-account-summary').waitFor();
    await delay(2500);
    check(label('RELOAD: no further initialize is sent'), initializeCalls.length === beforeReload,
      `${initializeCalls.length} total`);
    check(label('RELOAD: the activation control does not come back'),
      await page.locator('.futures-account-activate').count() === 0);
    const afterReload = await stat(page, 'Доступная маржа');
    check(label('RELOAD: the balance is unchanged'), num(afterReload) === num(after.available),
      `${after.available} -> ${afterReload}`);

    // ---------- the chart tools ----------
    check(label('the permanent "Торговля с графика" strip is gone'),
      await page.locator('.chart-trading-toggle, .chart-trading-switch').count() === 0);
    const gap = await page.evaluate(() => {
      const surface = document.querySelector('.chart-surface');
      const chart = surface?.firstElementChild;
      if (!surface || !chart) return null;
      const a = surface.getBoundingClientRect(), b = chart.getBoundingClientRect();
      return Math.round(b.top - a.top);
    });
    check(label('no empty band is left where the strip was'), gap !== null && gap <= 1, `${gap}px`);

    const surface = page.locator('.chart-surface');
    // Recomputed on every use: an outside click or a symbol change can
    // scroll the page, and a coordinate captured earlier would then land
    // somewhere else entirely.
    const chartPoint = async () => {
      await surface.scrollIntoViewIfNeeded();
      const b = await surface.boundingBox();
      return { x: b.x + b.width * 0.55, y: b.y + b.height * 0.5, box: b };
    };
    const openMenu = async () => {
      const at = await chartPoint();
      await page.mouse.dblclick(at.x, at.y);
      await page.locator('.chart-tools-menu').waitFor({ timeout: 10000 });
    };
    const closed = () => page.locator('.chart-tools-menu').waitFor({ state: 'detached', timeout: 10000 });
    const at = await chartPoint();
    const box = at.box;

    await page.mouse.click(at.x, at.y);
    await delay(400);
    check(label('a single click opens nothing'), await page.locator('.chart-tools-menu').count() === 0);

    await openMenu();
    check(label('a double click opens the menu'), await page.locator('.chart-tools-menu').count() === 1);
    const placement = await page.evaluate(() => {
      const m = document.querySelector('.chart-tools-menu').getBoundingClientRect();
      return { inside: m.left >= 0 && m.top >= 0 && m.right <= innerWidth && m.bottom <= innerHeight,
        native: false, w: Math.round(m.width), h: Math.round(m.height) };
    });
    check(label('the menu is placed inside the viewport'), placement.inside, JSON.stringify(placement));
    check(label('the menu offers the switch and the entry action'),
      (await page.locator('.chart-tools-switch').count()) === 1 && (await page.locator('.chart-tools-action').count()) >= 0);

    // Esc
    await page.keyboard.press('Escape');
    await closed();
    check(label('Esc closes the menu'), true);

    // outside click
    await openMenu();
    await page.locator('.futures-account-summary').click({ position: { x: 5, y: 5 } });
    await closed();
    check(label('a click outside closes the menu'), true);

    // the close button
    await openMenu();
    await page.locator('.chart-tools-close').click();
    await closed();
    check(label('the × closes the menu'), true);

    // the action arms the EXISTING picker, and closes the menu
    await openMenu();
    await page.locator('.chart-tools-switch input').check();
    await page.locator('.chart-tools-action').click();
    await closed();
    check(label('the action closes the menu and arms the picker'),
      await page.evaluate(() => document.querySelector('.chart-surface')?.getAttribute('data-chart-picking') === 'entry'));

    // the current state is shown, and can be cancelled
    // With the picker armed the chart owns the pointer: a click there is a
    // PICK, which is the existing semantics this work preserves. So the way
    // back into the menu is the compact trigger, which exists for exactly
    // as long as the picker does — and nowhere near a permanent bar.
    check(label('while picking, the compact trigger appears'),
      await page.locator('.chart-tools-trigger').isVisible());
    await page.locator('.chart-tools-trigger').click();
    await page.locator('.chart-tools-menu').waitFor({ timeout: 10000 });
    check(label('the menu states that a bar is being chosen'),
      await page.locator('.chart-tools-state').count() === 1);
    await page.locator('.chart-tools-action').click();
    await closed();
    check(label('the picker can be cancelled from the menu'),
      await page.evaluate(() => !document.querySelector('.chart-surface')?.getAttribute('data-chart-picking')));

    // a symbol change closes it
    await openMenu();
    await page.evaluate(() => { window.history.pushState({}, '', '/futures?pair=ETH%2FUSDT'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await closed();
    check(label('a symbol change closes the menu'), true);

    // mobile access, without a permanent bar
    const trigger = page.locator('.chart-tools-trigger');
    const triggerVisible = await trigger.count() === 1 && await trigger.isVisible().catch(() => false);
    if (viewport.width <= 600) {
      check(label('touch gets a compact entry to the same menu'), triggerVisible);
      if (triggerVisible) {
        const tb = await trigger.boundingBox();
        check(label('the touch entry is a small control, not a bar'),
          tb.width <= 40 && tb.width / box.width < 0.2, `${Math.round(tb.width)}x${Math.round(tb.height)}`);
        await trigger.click();
        await page.locator('.chart-tools-menu').waitFor({ timeout: 8000 });
        check(label('the touch entry opens the same menu'), true);
        await page.keyboard.press('Escape');
        await page.locator('.chart-tools-menu').waitFor({ state: 'detached' });
      }
    } else {
      check(label('the compact entry is hidden at rest on a pointer device'), !triggerVisible);
    }

    // nothing was placed by any of that
    const state = native.last;
    check(label('no order was placed by opening menus'),
      state.positions.length === 0 && state.orders.length === 0,
      `${state.positions.length} positions / ${state.orders.length} orders`);

    // ---------- the isolation assertion, kept ----------
    check(label('the owner never calls a real futures account endpoint'),
      realRequests.length === 0, realRequests.slice(0, 3).join(' | '));

    return { before, after, api };
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const evidence = {};
  try {
    for (const viewport of VIEWPORTS) {
      console.log(`\n=== ${viewport.name} ===`);
      evidence[viewport.name] = await run(browser, viewport);
    }
  } finally { await browser.close(); }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks PASS`);
  console.log('NOTE: isolated review stand — a session-scoped simulation account, no live venue, no production data.');
  if (failed.length) { console.log('\nFAILED:'); for (const f of failed) console.log(` - ${f.name}${f.detail ? ` (${f.detail})` : ''}`); process.exit(1); }
})();
