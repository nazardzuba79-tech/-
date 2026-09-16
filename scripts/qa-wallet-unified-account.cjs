/**
 * Browser QA for the Unified Trading Account, against the real production
 * bundle served by scripts/serve-wallet-review.cjs.
 *
 * Desktop 1440x1000 and mobile 390x844, for both kinds of account, with the
 * unpriced-asset case exercised rather than described.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.env.WALLET_REVIEW_URL || 'http://127.0.0.1:4179';
const OUT = process.env.QA_OUT || '/tmp/qa-wallet';
const fs = require('node:fs');
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const VIEWPORTS = [
  { label: '1440', width: 1440, height: 1000, touch: false },
  { label: '390', width: 390, height: 844, touch: true },
];

async function setMode(mode, query = '') {
  const res = await fetch(`${BASE}/__mode/${mode}${query}`);
  return res.json();
}

async function run() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const vp of VIEWPORTS) {
      for (const mode of ['owner', 'ordinary']) {
        // The owner's margin account has to exist for the header to be one:
        // before initialization there is no Cross account, and the page
        // correctly falls back to the ordinary ledger (checked separately).
        await setMode(mode, mode === 'owner' ? '?opened=1&history=45' : '?history=45');
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          hasTouch: vp.touch,
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        const requests = [];
        page.on('request', (r) => { if (r.url().includes('/api/v1/')) requests.push(r.url().split('/api/v1/')[1].split('?')[0]); });

        await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wallet-account-panel', { timeout: 15000 });
        const tag = `${mode}-${vp.label}`;

        // ── The page is dark, not the old light sheet ──────────────────
        const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.vx-wallet')).backgroundColor);
        const dark = /rgb\((\d+), (\d+), (\d+)\)/.exec(bg);
        const luminance = dark ? (Number(dark[1]) + Number(dark[2]) + Number(dark[3])) / 3 : 255;
        check(`${tag}: workspace renders on a dark surface`, luminance < 40, bg);

        // ── The total is real, formatted, and not a fabricated constant ─
        const total = (await page.textContent('.wallet-total-value')).trim();
        check(`${tag}: total is a formatted USD figure`, /^\$[\d   ,.]+$/.test(total), total);
        check(`${tag}: total is not the old hardcoded observation`, !/58[   ,]?454[   ,]?972/.test(total), total);

        // ── Account mode + the metrics that belong to it ────────────────
        const modeChip = (await page.textContent('.wallet-account-mode')).trim();
        const metrics = await page.$$eval('.wallet-account-metric', (els) =>
          els.map((el) => el.querySelectorAll('p')[0].textContent.trim() + '=' + el.querySelectorAll('p')[1].textContent.trim()));
        if (mode === 'owner') {
          check(`${tag}: header reports a Cross margin account`, modeChip === 'Кросс-маржа', modeChip);
          check(`${tag}: margin metrics are present`, metrics.length === 4 && metrics.some((m) => m.startsWith('Начальная маржа')), metrics.join(' | '));
          check(`${tag}: no metric is a bare dash`, !metrics.some((m) => m.endsWith('=—')), metrics.join(' | '));
        } else {
          check(`${tag}: header reports a spot account`, modeChip === 'Спотовый счёт', modeChip);
          check(`${tag}: no invented margin metrics`, !metrics.some((m) => /маржа/i.test(m)), metrics.join(' | '));
        }

        // ── The equity curve is present and drawn from real history ────
        const chart = await page.locator('.wallet-equity-chart').count();
        check(`${tag}: the equity chart section is present`, chart === 1, String(chart));
        const curve = await page.evaluate(() => {
          const el = document.querySelector('.wallet-equity-chart');
          if (!el) return null;
          const line = el.querySelector('path[fill="none"]');
          const box = el.getBoundingClientRect();
          return {
            vertices: line ? line.getAttribute('d').split(' L').length : 0,
            height: Math.round(box.height),
            empty: Boolean(el.querySelector('.wallet-equity-empty')),
            periods: [...el.querySelectorAll('.wallet-equity-periods button')].map((b) => ({
              label: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), disabled: b.disabled,
            })),
            axis: el.querySelector('.wallet-equity-axis')?.textContent?.trim() ?? null,
            age: el.querySelector('.wallet-equity-age')?.textContent?.trim() ?? null,
          };
        });
        check(`${tag}: the curve is drawn from many real daily points`, curve.vertices > 10, String(curve.vertices));
        check(`${tag}: the chart is a real section, not a strip`, curve.height > 220, `${curve.height}px`);
        check(`${tag}: no empty state over a real series`, curve.empty === false);
        check(`${tag}: windows the history cannot cover are disabled`, curve.periods.some((p) => p.disabled), JSON.stringify(curve.periods.map((p) => p.label + (p.disabled ? '(off)' : ''))));
        check(`${tag}: the chart states how much real history it has`, /\d/.test(curve.age ?? ''), curve.age ?? '');
        check(`${tag}: the axis carries real dates`, /\d{4}-\d{2}-\d{2}/.test(curve.axis ?? ''), curve.axis ?? '');

        // ── The asset table ────────────────────────────────────────────
        if (vp.label === '1440') {
          const heads = await page.$$eval('.wallet-ledger-desktop th', (els) => els.map((e) => e.textContent.trim()));
          check(`${tag}: ledger has the seven Bybit-like columns`, heads.length === 7 && heads[3] === 'В использовании', heads.join(' | '));
          const rowCount = await page.$$eval('.wallet-ledger-desktop tbody tr', (els) => els.length);
          check(`${tag}: ledger renders rows`, rowCount > 0, String(rowCount));
          const tabular = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.wallet-ledger-quantity')).fontVariantNumeric);
          check(`${tag}: financial figures use tabular numerals`, tabular.includes('tabular-nums'), tabular);
        } else {
          const mobileRows = await page.$$eval('.wallet-ledger-mobile > li', (els) => els.length);
          check(`${tag}: mobile ledger renders rows`, mobileRows > 0, String(mobileRows));
        }

        // ── Search + hide-zero are real controls ────────────────────────
        const before = await page.$$eval('.wallet-asset-ledger [class*="wallet-ledger-"] , .wallet-ledger-mobile > li', () => 0);
        void before;
        await page.fill('.wallet-asset-ledger input[type="search"]', 'btc');
        await page.waitForTimeout(150);
        const searchText = await page.textContent('.wallet-asset-ledger');
        check(`${tag}: search narrows the ledger to the query`, /BTC/i.test(searchText) && !/Tether/i.test(searchText));
        await page.fill('.wallet-asset-ledger input[type="search"]', '');
        await page.waitForTimeout(150);

        const hideZero = page.locator('.wallet-asset-ledger button[aria-pressed]').first();
        const pressedBefore = await hideZero.getAttribute('aria-pressed');
        await hideZero.click();
        await page.waitForTimeout(120);
        const pressedAfter = await hideZero.getAttribute('aria-pressed');
        check(`${tag}: hide-zero toggles`, pressedBefore !== pressedAfter, `${pressedBefore} -> ${pressedAfter}`);
        await hideZero.click();

        // ── No horizontal page scroll at either width ───────────────────
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(`${tag}: no horizontal page overflow`, overflow <= 0, `${overflow}px`);

        // ── Deposit navigates to the real flow ──────────────────────────
        const depositVisible = await page.locator('.wallet-account-panel button', { hasText: 'Пополнить' }).first().isVisible();
        check(`${tag}: deposit action is reachable`, depositVisible);

        // ── Convert is offered as unavailable, never as a fake success ──
        const convertDisabled = await page.locator('.wallet-action-convert').first().isDisabled();
        check(`${tag}: convert is disabled rather than faked`, convertDisabled);

        // ── Request census: nothing is fetched per row ──────────────────
        const nativeWallet = requests.filter((u) => u === 'private-trading/native/wallet').length;
        const overviewCalls = requests.filter((u) => u === 'wallet/overview').length;
        check(`${tag}: at most one authoritative account request on load`, nativeWallet <= 1, String(nativeWallet));
        check(`${tag}: at most one wallet overview request on load`, overviewCalls <= 1, String(overviewCalls));

        await page.screenshot({ path: `${OUT}/wallet-${tag}.png`, fullPage: true });
        await context.close();
      }
    }

    // ── A brand-new account: the chart KEEPS its card ──────────────────
    for (const vp of VIEWPORTS) {
      await setMode('ordinary', '?history=0');
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });
      const page = await context.newPage();
      await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wallet-equity-chart', { timeout: 15000 });
      const tag = `no-history-${vp.label}`;

      const shape = await page.evaluate(() => {
        const el = document.querySelector('.wallet-equity-chart');
        return {
          present: Boolean(el),
          height: Math.round(el.getBoundingClientRect().height),
          plot: Boolean(el.querySelector('.wallet-equity-plot')),
          empty: Boolean(el.querySelector('.wallet-equity-empty')),
          periods: el.querySelectorAll('.wallet-equity-periods button').length,
          line: Boolean(el.querySelector('path[fill="none"]')),
          text: el.querySelector('.wallet-equity-empty')?.textContent?.trim() ?? '',
        };
      });
      // This is the regression under guard: the feature is explained, not deleted.
      check(`${tag}: the chart card is still on the page`, shape.present && shape.height > 220, `${shape.height}px`);
      check(`${tag}: the plot frame is kept`, shape.plot);
      check(`${tag}: the period tabs are kept`, shape.periods === 5, String(shape.periods));
      check(`${tag}: the empty state is INSIDE the plot`, shape.empty, shape.text);
      check(`${tag}: nothing is drawn through points that do not exist`, shape.line === false);

      await page.screenshot({ path: `${OUT}/wallet-${tag}.png`, fullPage: true });
      await context.close();
    }
    await setMode('ordinary', '?history=45');

    // ── The owner BEFORE the margin account exists ─────────────────────
    {
      await setMode('owner', '?opened=0');
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wallet-account-panel', { timeout: 15000 });
      const chip = (await page.textContent('.wallet-account-mode')).trim();
      // There is no Cross account yet, so the page must not claim one — and
      // must not print zeros for margin figures that do not exist.
      check('owner-unopened: falls back to the ordinary ledger, not a fake margin account', chip === 'Спотовый счёт', chip);
      const metrics = await page.$$eval('.wallet-account-metric', (els) => els.map((e) => e.textContent.trim()));
      check('owner-unopened: no margin metrics are invented', !metrics.some((m) => /маржа/i.test(m)), metrics.join(' | '));
      await page.screenshot({ path: `${OUT}/wallet-owner-unopened.png`, fullPage: true });
      await context.close();
      await setMode('owner', '?opened=1');
    }

    // ── The unpriced-asset case, at desktop, for both account kinds ─────
    for (const mode of ['owner', 'ordinary']) {
      await setMode(mode, mode === 'owner' ? '?unpriced=1&opened=1' : '?unpriced=1');
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wallet-account-panel', { timeout: 15000 });
      const tag = `${mode}-unpriced`;

      const note = await page.locator('.wallet-valuation-note').first();
      const hasNote = await note.count() > 0;
      check(`${tag}: an incomplete valuation is stated, not hidden`, hasNote);
      if (hasNote) {
        const text = (await note.textContent()).trim();
        check(`${tag}: the note names the unpriced asset`, /XRP|EUR/.test(text), text);
        check(`${tag}: the note says the total is a lower bound`, /нижняя граница/.test(text), text);
      }

      const zeroValued = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.wallet-ledger-value')];
        const unpriced = cells.filter((c) => c.querySelector('.wallet-ledger-unpriced'));
        return { unpriced: unpriced.length, zeros: unpriced.filter((c) => /\$0[,.]00/.test(c.textContent)).length };
      });
      check(`${tag}: the unpriced row is labelled`, zeroValued.unpriced >= 1, JSON.stringify(zeroValued));
      check(`${tag}: no unpriced row is valued at zero`, zeroValued.zeros === 0, JSON.stringify(zeroValued));

      await page.screenshot({ path: `${OUT}/wallet-${tag}.png`, fullPage: true });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
