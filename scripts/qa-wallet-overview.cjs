/**
 * Browser QA for the Wallet Overview and Funding sections, against the real
 * production bundle served by scripts/serve-wallet-review.cjs.
 *
 * Desktop 1440x1000 and mobile 390x844, for both kinds of account. What is
 * checked is the approved design's contract, not its pixels:
 *
 *   - the Wallet opens on the Overview, in the Wallet's own navigation, with
 *     the VoLtex Card tile linking to /card and no disabled item;
 *   - the headline total is the SAME figure the Unified Trading section
 *     prints, never a sum of the two accounts;
 *   - Super VIP is on the owner's Cross account and on nobody else's;
 *   - profit by period comes from the real series, dash where it cannot;
 *   - the ordinary account gets the same layout with its own (small) real
 *     figures — and the empty-activity list is an empty state, not samples;
 *   - Funding lists the real spot ledger with the server's valuation.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('node:fs');

const BASE = process.env.WALLET_REVIEW_URL || 'http://127.0.0.1:4179';
const OUT = process.env.QA_OUT || '/tmp/qa-wallet-overview';
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
const money = (s) => Number(String(s).replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'));

async function setMode(mode, query = '') {
  return (await fetch(`${BASE}/__mode/${mode}${query}`)).json();
}
async function openSection(page, label) {
  await page.locator('.wallet-side-nav button', { hasText: label }).first().click();
  await page.waitForTimeout(250);
}

function readOverview() {
  const q = (s) => document.querySelector(s);
  const text = (s) => q(s)?.textContent?.trim() ?? null;
  return {
    present: Boolean(q('.wallet-overview')),
    total: text('.wallet-overview-total .num'),
    badge: text('.wallet-tier-badge'),
    btc: text('.wallet-overview-btc'),
    pnl: text('.wallet-overview-pnl-pill'),
    pnlAvailable: q('.wallet-overview-pnl-pill')?.getAttribute('data-available'),
    accounts: [...document.querySelectorAll('.wallet-account-row')].map((r) => ({
      name: r.querySelector('.wallet-account-row-name span:last-child').textContent.trim(),
      value: r.querySelector('.wallet-account-row-value p').textContent.trim(),
      actions: r.querySelectorAll('button').length,
    })),
    note: Boolean(q('.wallet-accounts-note')),
    allocation: Boolean(q('.wallet-allocation')),
    allocationRows: document.querySelectorAll('.wallet-allocation li').length,
    chart: Boolean(q('.wallet-equity-chart')),
    chartLine: Boolean(q('.wallet-equity-chart path[fill="none"]')),
    periods: [...document.querySelectorAll('.wallet-period-row')].map((r) => ({
      p: r.dataset.period, ok: r.dataset.available, usd: r.querySelector('.wallet-period-row-usd').textContent.trim(), pct: r.querySelector('.wallet-period-row-pct').textContent.trim(),
    })),
    activity: Boolean(q('.wallet-recent-activity')),
    activityRows: document.querySelectorAll('.wallet-recent-row').length,
    activityText: text('.wallet-recent-activity'),
    nav: [...document.querySelectorAll('.wallet-side-nav button')].map((b) => ({ label: b.textContent.trim(), active: b.getAttribute('aria-current') === 'page', disabled: b.disabled })),
    cardLink: q('.wallet-card-link')?.getAttribute('href') ?? null,
    brand: text('.wallet-brand-name'),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}

async function run() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const vp of VIEWPORTS) {
      for (const mode of ['owner', 'ordinary']) {
        await setMode(mode, mode === 'owner' ? '?opened=1&history=45' : '?history=45');
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wallet-overview', { timeout: 15000 });
        await page.waitForTimeout(600);
        const tag = `${mode}-${vp.label}`;
        const ov = await page.evaluate(readOverview);

        check(`${tag}: opens on the Overview`, ov.present && ov.nav.find((n) => n.active)?.label === 'Обзор', JSON.stringify(ov.nav.map((n) => n.label + (n.active ? '*' : ''))));
        check(`${tag}: five live sections, none disabled`, ov.nav.length === 5 && ov.nav.every((n) => !n.disabled), ov.nav.map((n) => n.label).join(' | '));
        check(`${tag}: sections named as asked`, ov.nav.map((n) => n.label).join('|') === 'Обзор|Финансирование|Unified Trading|P&L Analysis|Orders', ov.nav.map((n) => n.label).join('|'));
        check(`${tag}: VoLtex Card tile links to the card page`, ov.cardLink === '/card', String(ov.cardLink));
        if (!vp.touch) check(`${tag}: brand block reads VOLTEX`, ov.brand === 'VOLTEX', String(ov.brand));
        check(`${tag}: the headline total is a formatted USD amount`, /^\$[\d\s  .,]+$/.test(ov.total ?? ''), String(ov.total));
        check(`${tag}: the BTC equivalent is stated`, /≈ [\d\s  .,]+ BTC/.test(ov.btc ?? ''), String(ov.btc));
        check(`${tag}: the 7D P&L pill carries USD and percent`, ov.pnlAvailable === 'true' && /\$.*·.*%/.test(ov.pnl ?? ''), String(ov.pnl));
        check(`${tag}: two accounts are listed, with actions`, ov.accounts.length === 2 && ov.accounts.every((a) => a.actions >= 3), JSON.stringify(ov.accounts));
        check(`${tag}: the distribution ring is on the Overview`, ov.allocation && ov.allocationRows > 0, String(ov.allocationRows));
        check(`${tag}: the equity curve is drawn on real days`, ov.chart && ov.chartLine);
        check(`${tag}: five period rows, the covered ones with USD + %`, ov.periods.length === 5 && ov.periods.filter((p) => p.ok === 'true').every((p) => /^[+-]\$/.test(p.usd) && /%$/.test(p.pct)), JSON.stringify(ov.periods));
        check(`${tag}: uncovered periods are dashes, never zeros`, ov.periods.filter((p) => p.ok === 'false').every((p) => p.usd === '—' && p.pct === '—'), JSON.stringify(ov.periods.filter((p) => p.ok === 'false')));
        check(`${tag}: recent activity is an empty state, not sample rows`, ov.activity && ov.activityRows === 0 && /пока нет/.test(ov.activityText ?? ''), String(ov.activityRows));
        check(`${tag}: no horizontal page overflow`, !ov.overflow);
        check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '));

        if (mode === 'owner') {
          check(`${tag}: Super VIP is on the owner's Cross account`, ov.badge === 'Super VIP', String(ov.badge));
          check(`${tag}: the funding row is marked as counted in Unified Trading`, ov.note);
          const unified = ov.accounts.find((a) => a.name === 'Unified Trading');
          check(`${tag}: the headline IS the unified equity, not a sum`, unified && unified.value === ov.total, `${unified?.value} vs ${ov.total}`);
        } else {
          check(`${tag}: no tier badge on an ordinary account`, ov.badge === null, String(ov.badge));
          check(`${tag}: no Cross note on a plain ledger`, !ov.note);
          const funding = ov.accounts.find((a) => a.name === 'Финансирование');
          const unified = ov.accounts.find((a) => a.name === 'Unified Trading');
          check(`${tag}: ordinary total = spot + futures, both server subtotals`, funding && unified && Math.abs(money(funding.value) + money(unified.value) - money(ov.total)) < 0.005, `${funding?.value} + ${unified?.value} = ${ov.total}`);
        }
        await page.screenshot({ path: `${OUT}/overview-${tag}.png`, fullPage: true });

        // The same figure in the Unified Trading section.
        await openSection(page, 'Unified Trading');
        await page.waitForSelector('.wallet-account-panel', { timeout: 15000 });
        const unifiedFigures = await page.$$eval('.wallet-account-metric', (els) => els.map((el) => el.querySelectorAll('p')[0].textContent.trim() + '=' + el.querySelectorAll('p')[1].textContent.trim()));
        const same = mode === 'owner' ? unifiedFigures[1]?.split('=')[1] : unifiedFigures[0]?.split('=')[1];
        check(`${tag}: Overview total equals the Unified Trading figure`, same === ov.total, `${same} vs ${ov.total}`);

        // Funding: the real spot ledger.
        await openSection(page, 'Финансирование');
        await page.waitForSelector('.wallet-funding', { timeout: 15000 });
        const funding = await page.evaluate(() => ({
          total: document.querySelector('.wallet-funding-total')?.textContent?.trim(),
          rows: [...document.querySelectorAll('.wallet-funding-row')].map((r) => r.dataset.asset + ':' + r.querySelectorAll('td')[4].textContent.trim()),
          note: Boolean(document.querySelector('.wallet-funding-head p.max-w-\\[560px\\]')),
          empty: Boolean(document.querySelector('.wallet-funding-table svg')),
        }));
        check(`${tag}/funding: the ledger total is stated`, /^\$/.test(funding.total ?? ''), String(funding.total));
        check(`${tag}/funding: rows are the real spot balances with a valuation`, funding.rows.length >= 3 && funding.rows.every((r) => /:\$/.test(r)), funding.rows.join(' | '));
        check(`${tag}/funding: the Cross note is ${mode === 'owner' ? 'shown' : 'absent'}`, funding.note === (mode === 'owner'));
        await page.screenshot({ path: `${OUT}/funding-${tag}.png`, fullPage: true });

        // Card link routes to the Crypto Card page.
        await page.locator('.wallet-card-link').first().click();
        await page.waitForTimeout(400);
        check(`${tag}: the card tile navigates to /card`, page.url().endsWith('/card'), page.url());
        await context.close();
      }
    }

    // The empty-history account: the Overview keeps every card, all dashes.
    {
      await setMode('ordinary', '?history=0');
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wallet-overview', { timeout: 15000 });
      await page.waitForTimeout(600);
      const ov = await page.evaluate(readOverview);
      check('no-history: every period row is a dash', ov.periods.length === 5 && ov.periods.every((p) => p.ok === 'false' && p.usd === '—'), JSON.stringify(ov.periods));
      check('no-history: the P&L pill is a dash', ov.pnlAvailable === 'false' && ov.pnl === '—', String(ov.pnl));
      check('no-history: the chart card stays, empty', ov.chart && !ov.chartLine);
      await page.screenshot({ path: `${OUT}/overview-no-history-1440.png`, fullPage: true });
      await context.close();
      await setMode('ordinary', '?history=45');
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
