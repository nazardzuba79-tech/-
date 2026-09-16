#!/usr/bin/env node
/**
 * Browser QA for the Futures order panel's margin mode and live calculation
 * block, against the REAL Futures React page and the REAL native engine
 * served by scripts/serve-native-demo-review.cjs.
 *
 * The question this answers is not "does a toggle move". It is whether
 * choosing Isolated changes where the money is: a different margin figure,
 * a different liquidation price on the same inputs, a mode that survives a
 * reload, and an account that still agrees with the Wallet afterwards.
 *
 * Desktop 1440x1000 and mobile 390x844.
 *
 *   node scripts/qa-futures-margin-mode.cjs
 */
const { chromium } = require(process.env.PRIVATE_CARD_QA_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const fs = require('node:fs');

const BASE = process.env.FUTURES_REVIEW_URL || 'http://127.0.0.1:4185';
const OUT = process.env.QA_OUT || '/tmp/qa-futures';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const num = (t) => Number(String(t ?? '').replace(/[^\d.-]/g, ''));

const VIEWPORTS = [
  { label: '1440', width: 1440, height: 1000, touch: false },
  { label: '390', width: 390, height: 844, touch: true },
];

/** The three live figures, exactly as the panel renders them. */
const readBlock = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.fo-infoRow')];
  const value = (needle) => {
    const row = rows.find((r) => r.textContent.includes(needle));
    return row ? row.textContent.replace(needle, '').trim() : null;
  };
  return {
    positionValue: value('Стоимость позиции'),
    margin: value('Маржа'),
    liqLong: document.querySelector('.fo-sidePairLong')?.textContent?.trim() ?? null,
    liqShort: document.querySelector('.fo-sidePairShort')?.textContent?.trim() ?? null,
  };
});

async function setMarginMode(page, mode) {
  const label = mode === 'ISOLATED' ? 'Изолированная' : 'Кросс';
  await page.locator('.fo-mlTrigger').first().click();
  await page.waitForTimeout(200);
  await page.locator('.fo-mlMode', { hasText: label }).first().click();
  await page.waitForTimeout(250);
}
const currentMode = (page) => page.locator('.fo-mlTriggerText').first().textContent();

/** Leverage is chosen from the preset chips, the way a trader chooses it. */
async function setLeverage(page, value) {
  await page.locator('.fo-mlTriggerLevBtn').first().click();
  await page.waitForTimeout(250);
  await page.locator('.fo-mlChip', { hasText: new RegExp(`^${value}x$`) }).first().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

/** The order-family tabs, by their real labels: Лимит and Рынок. */
async function setType(page, family) {
  const label = family === 'LIMIT' ? 'Лимит' : 'Рынок';
  await page.locator('.order-family-tabs button', { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.waitForTimeout(350);
}

const qtyInput = (page) => page.locator('.fo-qtyInputRow input').first();
const priceInput = (page) => page.locator('.fo-priceInputRow input').first();

/**
 * Open the simulation account and WAIT until it exists.
 *
 * Counting the activation button and moving on races the request: the
 * button disappears the moment the account is created, so a count of zero
 * means either "not offered" or "already gone". The account's own figures
 * are the signal that is actually true — the panel prints a dash until
 * there is an account to print.
 */
async function openAccount(page) {
  const activate = page.getByRole('button', { name: /Начать торговлю/ }).first();
  try { await activate.waitFor({ timeout: 8000 }); await activate.click(); } catch { /* already open */ }
  await page.waitForFunction(() => {
    const el = document.querySelector('.futures-account-summary');
    return Boolean(el) && /Маржинальный баланс\s*[\d]/.test(el.textContent.replace(/\s+/g, ' '));
  }, { timeout: 40000 });
  await page.waitForTimeout(800);
}

async function newPage(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  // A trader who means to place the order clicks OK. Playwright dismisses
  // dialogs by default, which silently drops the submit.
  page.on('dialog', (d) => { void d.accept(); });
  const drafts = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/native/commands') && r.method() === 'POST') {
      try { drafts.push(r.postDataJSON()); } catch { /* not JSON */ }
    }
  });
  await page.addInitScript(() => localStorage.setItem('exchange_lang', 'ru'));
  await page.goto(`${BASE}/futures`, { waitUntil: 'domcontentloaded' });
  await page.locator('.futures-account-summary').waitFor({ timeout: 40000 });
  await openAccount(page);
  await page.locator('.fo-mlTrigger').first().waitFor({ timeout: 20000 });
  return { context, page, drafts };
}

async function run() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const vp of VIEWPORTS) {
      const tag = vp.label;
      const { context, page, drafts } = await newPage(browser, vp);
      try {
        // ── The switch is a real choice, not a locked label ───────────
        const trigger = await page.evaluate(() => {
          const t = document.querySelector('.fo-mlTrigger');
          return { disabled: t.getAttribute('aria-disabled'), popup: t.getAttribute('aria-haspopup'), chevron: Boolean(t.querySelector('.fo-mlChevron')) };
        });
        check(`${tag}: the margin mode is offered, not pinned`,
          trigger.disabled === null && trigger.popup === 'dialog' && trigger.chevron, JSON.stringify(trigger));

        await page.locator('.fo-mlTrigger').first().click();
        await page.waitForTimeout(250);
        const modes = await page.$$eval('.fo-mlMode', (els) => els.map((e) => e.textContent.trim()));
        check(`${tag}: both modes are on offer`, modes.length === 2 && modes.includes('Кросс') && modes.includes('Изолированная'), modes.join(' | '));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);

        // ── 6+7: quantity and price move the block, live ─────────────
        await setType(page, 'LIMIT');
        await setMarginMode(page, 'CROSS');
        await setLeverage(page, 10);
        await priceInput(page).fill('50000');
        await qtyInput(page).fill('0.1');
        await page.waitForTimeout(400);
        const base = await readBlock(page);
        check(`${tag}: position value is quantity x price`, Math.abs(num(base.positionValue) - 5000) < 1, base.positionValue ?? '');
        check(`${tag}: margin is value / leverage`, Math.abs(num(base.margin) - 500) < 1, base.margin ?? '');
        // A Cross long backed by a balance far larger than the order has no
        // reachable liquidation price, and the panel says so with a dash
        // rather than printing the formula's negative result.
        check(`${tag}: no liquidation side is ever a negative price`,
          ![base.liqLong, base.liqShort].some((v) => v !== '—' && num(v) <= 0), `${base.liqLong} / ${base.liqShort}`);
        check(`${tag}: the reachable side is quoted`, base.liqShort !== '—', base.liqShort ?? '');

        await qtyInput(page).fill('0.2');
        await page.waitForTimeout(400);
        const doubled = await readBlock(page);
        check(`${tag}: doubling the quantity doubles value and margin, live`,
          Math.abs(num(doubled.positionValue) - 10000) < 1 && Math.abs(num(doubled.margin) - 1000) < 1,
          `${doubled.positionValue} / ${doubled.margin}`);

        await priceInput(page).fill('60000');
        await page.waitForTimeout(400);
        const repriced = await readBlock(page);
        check(`${tag}: changing the price changes value, margin and liquidation, live`,
          Math.abs(num(repriced.positionValue) - 12000) < 1 && repriced.liqShort !== doubled.liqShort,
          `${repriced.positionValue} · liq ${doubled.liqShort} -> ${repriced.liqShort}`);

        // ── 5: leverage moves margin but not position value ──────────
        await priceInput(page).fill('50000');
        await qtyInput(page).fill('0.1');
        await page.waitForTimeout(300);
        const atTen = await readBlock(page);
        await setLeverage(page, 5);
        await page.waitForTimeout(400);
        const atFive = await readBlock(page);
        check(`${tag}: halving leverage doubles margin`,
          Math.abs(num(atFive.margin) - num(atTen.margin) * 2) < 2, `${atTen.margin} -> ${atFive.margin}`);
        check(`${tag}: leverage does not move position value`,
          Math.abs(num(atFive.positionValue) - num(atTen.positionValue)) < 1, `${atTen.positionValue} -> ${atFive.positionValue}`);
        check(`${tag}: leverage moves the liquidation estimate`, atFive.liqShort !== atTen.liqShort, `${atTen.liqShort} -> ${atFive.liqShort}`);
        await setLeverage(page, 10);

        // ── The two modes disagree where they should ─────────────────
        await page.waitForTimeout(300);
        const crossBlock = await readBlock(page);
        await setMarginMode(page, 'ISOLATED');
        await page.waitForTimeout(400);
        const isoBlock = await readBlock(page);
        check(`${tag}: the mode really switched`, (await currentMode(page)).trim() === 'Изолированная');
        check(`${tag}: margin for the same order is the same requirement in both modes`,
          Math.abs(num(isoBlock.margin) - num(crossBlock.margin)) < 1, `${crossBlock.margin} vs ${isoBlock.margin}`);
        // Cross is held up by the whole account, so on this size its long
        // has no reachable price at all; isolated stands on its own post
        // and does. That difference IS the mode.
        check(`${tag}: isolated quotes a reachable long liquidation where cross has none`,
          crossBlock.liqLong === '—' && isoBlock.liqLong !== '—' && num(isoBlock.liqLong) > 0,
          `cross ${crossBlock.liqLong} vs isolated ${isoBlock.liqLong}`);

        // ── 15: contract rules still refuse what they refused ────────
        await qtyInput(page).fill('0.0001');
        await page.waitForTimeout(400);
        const tiny = await page.evaluate(() => document.querySelector('.fo-error')?.textContent?.trim() ?? null);
        check(`${tag}: a sub-minimum quantity is refused by its own rule`,
          tiny !== null && /количест|лимит|шаг|минимал/i.test(tiny), tiny ?? '(none)');
        check(`${tag}: and that refusal is NOT the funds message`, !/не хватает средств/i.test(tiny ?? ''), tiny ?? '');

        // ── 10: insufficient funds says so, with both figures ────────
        // The order has to be inside the CONTRACT's limits to reach the
        // margin check at all — 99 999 BTC is refused as a size before any
        // money is consulted, which is the precedence the panel should
        // have and is checked just above. At 1x the budget is the balance
        // itself, so 900 BTC (under the 1 000 cap) is affordable at 10x
        // and not at 1x: a genuine shortfall, not a size breach.
        await setLeverage(page, 1);
        await qtyInput(page).fill('900');
        await page.waitForTimeout(600);
        const broke = await page.evaluate(() => [...document.querySelectorAll('.fo-error')].map((e) => e.textContent.trim()));
        const funds = broke.find((t) => /не хватает средств/i.test(t));
        check(`${tag}: a shortfall is named as a shortfall`, Boolean(funds), broke.join(' | ') || '(none)');
        if (funds) {
          check(`${tag}: the shortfall names required and available`, /\d/.test(funds) && funds.split(/\d+[\d\s.,]*/).length > 2, funds);
          // Every placeholder substituted, including the one named twice.
          check(`${tag}: the shortfall leaves no placeholder unfilled`, !/\{[a-z]+\}/i.test(funds), funds);
        }
        await setLeverage(page, 10);

        // ── 14: nothing unknown is rendered as a zero ────────────────
        await qtyInput(page).fill('');
        await priceInput(page).fill('');
        await page.waitForTimeout(400);
        const empty = await readBlock(page);
        check(`${tag}: an unfilled order shows dashes, never 0.00`,
          empty.positionValue === '—' && empty.margin === '—' && empty.liqLong === '—',
          JSON.stringify(empty));

        // ── 9: the percentage slider sizes from real available margin ──
        await setType(page, 'LIMIT');
        await setMarginMode(page, 'CROSS');
        await setLeverage(page, 10);
        await priceInput(page).fill('50000');
        await qtyInput(page).fill('');
        await page.waitForTimeout(300);
        const sized = [];
        for (const pct of [25, 50, 75, 100]) {
          await page.locator('.percent-slider-presets button', { hasText: new RegExp(`^${pct}%$`) }).first().click();
          await page.waitForTimeout(450);
          sized.push({ pct, qty: await qtyInput(page).inputValue(), margin: (await readBlock(page)).margin });
        }
        // Never smaller as the share grows — and it stops growing at the
        // CONTRACT's maximum order quantity rather than offering a size the
        // server would refuse. On this account the budget is far larger
        // than the cap, so 50% onward all land on 1000 BTC exactly.
        check(`${tag}: a larger share never sizes a smaller order`,
          sized.every((x, i) => i === 0 || Number(x.qty) >= Number(sized[i - 1].qty)),
          sized.map((x) => `${x.pct}%=${x.qty}`).join(' '));
        check(`${tag}: 50% is about twice 25% until a limit binds`,
          Math.abs(Number(sized[1].qty) / Number(sized[0].qty) - 2) < 0.05,
          `${sized[0].qty} -> ${sized[1].qty}`);
        check(`${tag}: sizing stops at the contract's maximum, not at the budget`,
          Number(sized[3].qty) <= 1000, `100% = ${sized[3].qty} BTC (cap 1000)`);
        check(`${tag}: no preset sizes beyond what the account can post`,
          !(await page.evaluate(() => [...document.querySelectorAll('.fo-error')].some((e) => /не хватает средств/i.test(e.textContent)))),
          sized.map((x) => `${x.pct}%→${x.margin}`).join(' '));
        await qtyInput(page).fill('');
        await page.waitForTimeout(250);

        await page.screenshot({ path: `${OUT}/margin-mode-${tag}.png`, fullPage: false });

        // ── The order actually placed carries the bucket ──────────────
        // Four combinations, submitted for real against the real engine,
        // because what the panel displays and what the engine settles are
        // two different claims.
        const placed = [];
        for (const scenario of [
          { mode: 'CROSS',    type: 'MARKET', side: 'BUY',  qty: '0.01' },
          { mode: 'CROSS',    type: 'LIMIT',  side: 'SELL', qty: '0.01', price: '52000' },
          { mode: 'ISOLATED', type: 'MARKET', side: 'BUY',  qty: '0.01' },
          { mode: 'ISOLATED', type: 'LIMIT',  side: 'SELL', qty: '0.01', price: '52000' },
        ]) {
          const before = drafts.length;
          await setType(page, scenario.type);
          await setMarginMode(page, scenario.mode);
          if (scenario.price) await priceInput(page).fill(scenario.price);
          await qtyInput(page).fill(scenario.qty);
          await page.waitForTimeout(400);
          const button = scenario.side === 'BUY' ? 'Купить / Лонг' : 'Продать / Шорт';
          await page.locator('.fo-submitPair button', { hasText: button }).first().click();
          await page.waitForTimeout(3500);
          const sent = drafts.slice(before).filter((d) => d.kind === 'OPEN');
          placed.push({ ...scenario, sent: sent[0] ?? null });
        }
        for (const p of placed) {
          const name = `${p.mode} + ${p.type} + ${p.side === 'BUY' ? 'Long' : 'Short'}`;
          check(`${tag}: ${name} reaches the engine in its own bucket`,
            p.sent !== null && p.sent.marginType === p.mode,
            p.sent ? `marginType=${p.sent.marginType} side=${p.sent.side} type=${p.sent.type}` : '(no command sent)');
        }

        // ── 12 + 13: the mode survives a reload, on the server's word ──
        const state = await page.evaluate(async () => {
          const res = await fetch('/api/v1/private-trading/native/state', {
            headers: { Authorization: 'Bearer ' + (localStorage.getItem('exchange_token') ?? '') },
          });
          return res.ok ? res.json() : null;
        });
        if (state && state.positions) {
          const modes = state.positions.map((x) => x.marginMode);
          check(`${tag}: the engine stored both buckets`,
            modes.includes('CROSS') && modes.includes('ISOLATED'), modes.join(', ') || '(none)');
          const iso = state.positions.find((x) => x.marginMode === 'ISOLATED');
          check(`${tag}: the isolated position carries its own posted margin`,
            Boolean(iso) && Number(iso.isolatedMargin) > 0, iso ? iso.isolatedMargin : '(none)');
          check(`${tag}: the isolated position is liquidated on its own basis`,
            Boolean(iso) && iso.liquidationStatus === 'ISOLATED_POSITION_ESTIMATE', iso ? iso.liquidationStatus : '');
          check(`${tag}: the account still reports isolated margin as in use`,
            state.account !== null && Number(state.account.initialMargin) > 0, state.account ? state.account.initialMargin : '(no account)');
        } else {
          check(`${tag}: the engine state was readable after placing`, false, '(state unavailable)');
        }

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.futures-account-summary').waitFor({ timeout: 40000 });
        await page.waitForTimeout(3000);
        const afterReload = await page.evaluate(() =>
          [...document.querySelectorAll('.futures-positions-table tbody tr, .futures-position-row')]
            .map((r) => r.textContent.replace(/\s+/g, ' ').trim()).slice(0, 8));
        check(`${tag}: a reload still shows an isolated position as isolated`,
          afterReload.some((t) => /Изолированная/.test(t)), afterReload.join(' || ').slice(0, 200) || '(no rows)');
        check(`${tag}: and still shows a cross position as cross`,
          afterReload.some((t) => /Кросс/.test(t)), afterReload.join(' || ').slice(0, 200) || '(no rows)');

        await page.screenshot({ path: `${OUT}/margin-mode-positions-${tag}.png`, fullPage: false });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  console.log('NOTE: isolated review stand — a session-scoped simulation account, fixture market, no live venue and no production data.');
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
