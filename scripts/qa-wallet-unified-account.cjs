/**
 * Browser QA for the Unified Trading Account, against the real production
 * bundle served by scripts/serve-wallet-review.cjs.
 *
 * Desktop 1440x1000 and mobile 390x844, for both kinds of account, with the
 * unpriced-asset case exercised rather than described.
 *
 * The structural target is the owner's Bybit reference: a light workspace, a
 * flat account header (identity, IM/MM, three headline figures, a horizontal
 * action row), and the asset table starting immediately below it — dense
 * enough that the first viewport carries all of it plus real asset rows. The
 * equity curve is a section of its own reached from the Wallet's own
 * navigation, so this file checks BOTH that it is absent from the main
 * section and that it is still there, on real history, under `P&L Analysis`.
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

/** Click a Wallet section in the Wallet's OWN navigation. */
async function openSection(page, label) {
  await page.locator('.wallet-side-nav button', { hasText: label }).first().click();
  await page.waitForTimeout(200);
}

/** Everything the equity card can say about itself, in one evaluate. */
function readCurve() {
  const el = document.querySelector('.wallet-equity-chart');
  if (!el) return null;
  const line = el.querySelector('path[fill="none"]');
  const box = el.getBoundingClientRect();
  return {
    vertices: line ? line.getAttribute('d').split(' L').length : 0,
    height: Math.round(box.height),
    empty: Boolean(el.querySelector('.wallet-equity-empty')),
    line: Boolean(line),
    plot: Boolean(el.querySelector('.wallet-equity-plot')),
    periods: [...el.querySelectorAll('.wallet-equity-periods button')].map((b) => ({
      label: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), disabled: b.disabled,
    })),
    axis: el.querySelector('.wallet-equity-axis')?.textContent?.trim() ?? null,
    age: el.querySelector('.wallet-equity-age')?.textContent?.trim() ?? null,
    text: el.querySelector('.wallet-equity-empty')?.textContent?.trim() ?? '',
  };
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
        // The Wallet opens on the Overview now; the Unified Trading section
        // under review here is one click away in the Wallet's own nav.
        await page.waitForSelector('.wallet-overview', { timeout: 15000 });
        const landing = await page.evaluate(() =>
          [...document.querySelectorAll('.wallet-side-nav button')].filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.textContent.trim()));
        await openSection(page, 'Unified Trading');
        await page.waitForSelector('.wallet-account-panel', { timeout: 15000 });
        const tag = `${mode}-${vp.label}`;
        check(`${tag}: the Wallet opens on the Overview`, landing.join() === 'Обзор', landing.join() || '(none)');

        // ── A light financial workspace, not a dark terminal ────────────
        const surfaces = await page.evaluate(() => {
          const lum = (el) => {
            const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(getComputedStyle(el).backgroundColor);
            return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : null;
          };
          return {
            page: lum(document.querySelector('.vx-wallet')),
            panel: lum(document.querySelector('.wallet-allocation')),
            ink: getComputedStyle(document.querySelector('.wallet-account-panel h2')).color,
          };
        });
        check(`${tag}: the workspace is a light surface`, surfaces.page !== null && surfaces.page > 220, String(surfaces.page));
        check(`${tag}: panels are white against it`, surfaces.panel !== null && surfaces.panel > 245, String(surfaces.panel));
        check(`${tag}: text on it is dark`, /rgb\((\d+)/.test(surfaces.ink) && Number(/rgb\((\d+)/.exec(surfaces.ink)[1]) < 90, surfaces.ink);

        // ── The Wallet's own navigation, beside the global one ──────────
        const nav = await page.evaluate(() => {
          const items = [...document.querySelectorAll('.wallet-side-nav button')];
          return {
            labels: items.map((b) => b.textContent.trim()),
            active: items.filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.textContent.trim()),
            disabled: items.filter((b) => b.disabled).map((b) => b.textContent.trim()),
            globalNavs: document.querySelectorAll('header nav, nav[aria-label]').length,
          };
        });
        check(`${tag}: the Wallet carries its own five sections`, nav.labels.length === 5, nav.labels.join(' | '));
        check(`${tag}: the unified account is the section in view`, nav.active.join() === 'Unified Trading', nav.active.join() || '(none)');
        check(`${tag}: every section has something behind it — nothing is disabled`, nav.disabled.length === 0, nav.disabled.join(' | '));

        // ── Account identity + the metrics that belong to it ────────────
        const modeChip = (await page.textContent('.wallet-account-mode')).trim();
        const metrics = await page.$$eval('.wallet-account-metric', (els) =>
          els.map((el) => el.querySelectorAll('p')[0].textContent.trim() + '=' + el.querySelectorAll('p')[1].textContent.trim()));
        check(`${tag}: the header reports exactly three headline figures`, metrics.length === 3, metrics.join(' | '));
        check(`${tag}: the leading figure is a formatted USD amount`, /^Активы=\$[\d\s\u00a0\u202f.,]+$/.test(metrics[0] ?? ''), metrics[0] ?? '');
        check(`${tag}: no figure is the old hardcoded observation`, !/58[   ,]?454[   ,]?972/.test(metrics.join(' ')), metrics.join(' | '));

        if (mode === 'owner') {
          check(`${tag}: header reports a Cross margin account`, modeChip === 'Кросс-маржа', modeChip);
          check(`${tag}: the reference's three figures are the ones shown`,
            metrics[0].startsWith('Активы') && metrics[1].startsWith('Баланс маржи') && metrics[2].startsWith('Нереализованный PnL'),
            metrics.join(' | '));
          check(`${tag}: no metric is a bare dash`, !metrics.some((m) => m.endsWith('=—')), metrics.join(' | '));

          // ── IM / MM, compact, above the figures, from the server ──────
          const margin = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.wallet-margin-usage > div')];
            return rows.map((r) => {
              const spans = [...r.querySelectorAll('span')];
              const bar = r.querySelector('.wallet-im-bar span');
              return {
                label: spans[0].textContent.trim(),
                percent: r.querySelector('.wallet-im-bar + span').textContent.trim(),
                value: spans[spans.length - 1].textContent.trim(),
                width: bar ? bar.style.width : null,
              };
            });
          });
          check(`${tag}: IM and MM are both stated`, margin.length === 2 && margin[0].label === 'IM' && margin[1].label === 'MM', JSON.stringify(margin));
          check(`${tag}: both ratios are real percentages, not dashes`, margin.every((m) => /%$/.test(m.percent)), margin.map((m) => m.label + ' ' + m.percent).join(' | '));
          check(`${tag}: both requirements are stated in USD`, margin.every((m) => /^\$/.test(m.value)), margin.map((m) => m.label + ' ' + m.value).join(' | '));
        } else {
          check(`${tag}: header reports a spot account`, modeChip === 'Спотовый счёт', modeChip);
          check(`${tag}: no invented margin metrics`, !metrics.some((m) => /маржа/i.test(m)), metrics.join(' | '));
          const marginRows = await page.locator('.wallet-margin-usage').count();
          check(`${tag}: no margin usage bars on an account without margin`, marginRows === 0, String(marginRows));
        }

        // ── The pink-circled P&L glance stays in the header ─────────────
        const glance = await page.evaluate(() => {
          const el = document.querySelector('.wallet-pnl-glance');
          if (!el) return null;
          return {
            value: el.querySelectorAll('p')[2].textContent.trim(),
            periods: [...el.querySelectorAll('button')].map((b) => b.textContent.trim()),
          };
        });
        check(`${tag}: the compact P&L readout is kept in the header`, glance !== null && glance.periods.length === 5, JSON.stringify(glance));

        // ── The equity curve is NOT between the summary and the table ───
        const chartInMain = await page.locator('.wallet-equity-chart').count();
        check(`${tag}: the big equity chart is out of the main section`, chartInMain === 0, String(chartInMain));

        // ── The asset table starts immediately below the summary ────────
        const gap = await page.evaluate(() => {
          const panel = document.querySelector('.wallet-account-panel').getBoundingClientRect();
          const ledger = document.querySelector('.wallet-asset-ledger').getBoundingClientRect();
          return Math.round(ledger.top - panel.bottom);
        });
        check(`${tag}: nothing sits between the summary and the table`, gap >= 0 && gap <= 40, `${gap}px`);

        if (vp.label === '1440') {
          const heads = await page.$$eval('.wallet-ledger-desktop th', (els) => els.map((e) => e.textContent.trim()));
          check(`${tag}: ledger has the seven reference columns`, heads.length === 7 && heads[3] === 'В использовании', heads.join(' | '));
          const rowCount = await page.$$eval('.wallet-ledger-desktop tbody tr', (els) => els.length);
          check(`${tag}: ledger renders rows`, rowCount > 0, String(rowCount));
          const tabular = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.wallet-ledger-quantity')).fontVariantNumeric);
          check(`${tag}: financial figures use tabular numerals`, tabular.includes('tabular-nums'), tabular);

          // ── DENSITY: the whole account fits the first viewport ────────
          const fold = await page.evaluate(() => {
            const bottom = (sel) => {
              const el = document.querySelector(sel);
              return el ? Math.round(el.getBoundingClientRect().bottom) : null;
            };
            const rows = [...document.querySelectorAll('.wallet-ledger-desktop tbody tr')];
            return {
              viewport: window.innerHeight,
              title: bottom('.wallet-workspace h1'),
              header: bottom('.wallet-account-panel .wallet-account-mode'),
              margin: bottom('.wallet-margin-usage'),
              metrics: bottom('.wallet-account-metrics'),
              actions: bottom('.wallet-account-actions'),
              filters: bottom('.wallet-asset-ledger input[type="search"]'),
              rows: rows.length,
              rowsInFold: rows.filter((r) => r.getBoundingClientRect().bottom <= window.innerHeight).length,
              rowHeight: rows.length ? Math.round(rows[0].getBoundingClientRect().height) : null,
            };
          });
          const summaryInFold = [fold.title, fold.header, fold.metrics, fold.actions, fold.filters]
            .every((v) => v !== null && v <= fold.viewport);
          check(`${tag}: title, account header, figures, actions and filters are all above the fold`, summaryInFold, JSON.stringify(fold));
          check(`${tag}: at least three asset rows are above the fold too`,
            fold.rows >= 3 && fold.rowsInFold >= 3, `${fold.rowsInFold}/${fold.rows} rows`);
          check(`${tag}: no rendered row is pushed below the fold`, fold.rowsInFold === fold.rows, `${fold.rowsInFold}/${fold.rows} rows`);
          check(`${tag}: the table is dense, not a spaced-out list`, fold.rowHeight !== null && fold.rowHeight <= 60, `${fold.rowHeight}px rows`);
          if (mode === 'owner') check(`${tag}: IM/MM are above the fold`, fold.margin !== null && fold.margin <= fold.viewport, String(fold.margin));

          // ── The actions are ONE horizontal row, not a vertical stack ──
          const actions = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('.wallet-account-actions button')];
            const tops = new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top)));
            return { labels: btns.map((b) => b.textContent.trim()), lines: tops.size };
          });
          check(`${tag}: all five actions sit on one line`, actions.lines === 1 && actions.labels.length === 5, JSON.stringify(actions));
          check(`${tag}: the actions are in the reference's order`,
            /Пополнить.*Конверт.*Перевести.*Вывести/.test(actions.labels.join(' ')), actions.labels.join(' | '));
        } else {
          const mobileRows = await page.$$eval('.wallet-ledger-mobile > li', (els) => els.length);
          check(`${tag}: mobile ledger renders rows`, mobileRows > 0, String(mobileRows));
          // On a phone the Wallet's navigation is a horizontal strip, not a column.
          const navShape = await page.evaluate(() => {
            const el = document.querySelector('.wallet-side-nav');
            const box = el.getBoundingClientRect();
            return { height: Math.round(box.height), width: Math.round(box.width), viewport: window.innerWidth };
          });
          check(`${tag}: the Wallet navigation collapses to a strip`, navShape.height <= 70, JSON.stringify(navShape));
        }

        // ── The pink-circled distribution panel stays ───────────────────
        const allocation = await page.locator('.wallet-allocation').count();
        check(`${tag}: the portfolio distribution panel is kept`, allocation === 1, String(allocation));

        // ── Search + hide-zero are real controls ────────────────────────
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

        await page.screenshot({ path: `${OUT}/wallet-${tag}.png`, fullPage: true });

        // ── `Анализ P&L`: the curve, still on this account's real days ──
        // Counted BEFORE the switch: the curve reads the series the page
        // already has, so moving between sections must cost nothing.
        const perfBeforeSwitch = requests.filter((u) => u === 'wallet/performance').length;
        await openSection(page, 'P&L Analysis');
        await page.waitForSelector('.wallet-equity-chart', { timeout: 15000 });
        const curve = await page.evaluate(readCurve);
        check(`${tag}/pnl: the equity chart lives in its own section`, curve !== null);
        check(`${tag}/pnl: the curve is drawn from many real daily points`, curve.vertices > 10, String(curve.vertices));
        check(`${tag}/pnl: the chart is a real section, not a strip`, curve.height > 220, `${curve.height}px`);
        check(`${tag}/pnl: no empty state over a real series`, curve.empty === false);
        check(`${tag}/pnl: windows the history cannot cover are disabled`, curve.periods.some((p) => p.disabled), JSON.stringify(curve.periods.map((p) => p.label + (p.disabled ? '(off)' : ''))));
        check(`${tag}/pnl: the chart states how much real history it has`, /\d/.test(curve.age ?? ''), curve.age ?? '');
        check(`${tag}/pnl: the axis carries real dates`, /\d{4}-\d{2}-\d{2}/.test(curve.axis ?? ''), curve.axis ?? '');
        const pnlOnly = await page.evaluate(() => ({
          ledger: document.querySelectorAll('.wallet-asset-ledger').length,
          panel: document.querySelectorAll('.wallet-account-panel').length,
        }));
        check(`${tag}/pnl: the section shows the curve, not a second copy of the account`, pnlOnly.ledger === 0 && pnlOnly.panel === 0, JSON.stringify(pnlOnly));
        await page.screenshot({ path: `${OUT}/wallet-${tag}-pnl.png`, fullPage: true });

        // ── Request census: nothing is fetched per row or per section ───
        const nativeWallet = requests.filter((u) => u === 'private-trading/native/wallet').length;
        const overviewCalls = requests.filter((u) => u === 'wallet/overview').length;
        const perfCalls = requests.filter((u) => u === 'wallet/performance').length;
        check(`${tag}: at most one authoritative account request on load`, nativeWallet <= 1, String(nativeWallet));
        check(`${tag}: at most one wallet overview request on load`, overviewCalls <= 1, String(overviewCalls));
        // Two per load, both pre-existing and both explained: the series on
        // arrival, then once more after today's snapshot is recorded so the
        // curve includes today. Neither is per-asset and neither is polled.
        check(`${tag}: history is fetched at most twice per load`, perfCalls <= 2, String(perfCalls));
        check(`${tag}: opening the P&L section fetches no further history`,
          perfCalls === perfBeforeSwitch, `${perfBeforeSwitch} -> ${perfCalls}`);

        await context.close();
      }
    }

    // ── A brand-new account: the chart KEEPS its card ──────────────────
    for (const vp of VIEWPORTS) {
      await setMode('ordinary', '?history=0');
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });
      const page = await context.newPage();
      await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wallet-overview', { timeout: 15000 });
      await openSection(page, 'P&L Analysis');
      await page.waitForSelector('.wallet-equity-chart', { timeout: 15000 });
      const tag = `no-history-${vp.label}`;

      const shape = await page.evaluate(readCurve);
      // This is the regression under guard: the feature is explained, not deleted.
      check(`${tag}: the chart card is still on the page`, shape !== null && shape.height > 220, `${shape?.height}px`);
      check(`${tag}: the plot frame is kept`, shape.plot);
      check(`${tag}: the period tabs are kept`, shape.periods.length === 5, String(shape.periods.length));
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
      await page.waitForSelector('.wallet-overview', { timeout: 15000 });
      await openSection(page, 'Unified Trading');
      await page.waitForSelector('.wallet-account-panel', { timeout: 15000 });
      const chip = (await page.textContent('.wallet-account-mode')).trim();
      // There is no Cross account yet, so the page must not claim one — and
      // must not print zeros for margin figures that do not exist.
      check('owner-unopened: falls back to the ordinary ledger, not a fake margin account', chip === 'Спотовый счёт', chip);
      const metrics = await page.$$eval('.wallet-account-metric', (els) => els.map((e) => e.textContent.trim()));
      check('owner-unopened: no margin metrics are invented', !metrics.some((m) => /маржа/i.test(m)), metrics.join(' | '));
      const bars = await page.locator('.wallet-im-bar').count();
      check('owner-unopened: no IM/MM bars are drawn for margin that does not exist', bars === 0, String(bars));
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
      await page.waitForSelector('.wallet-overview', { timeout: 15000 });
      await openSection(page, 'Unified Trading');
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
