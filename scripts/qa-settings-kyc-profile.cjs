#!/usr/bin/env node
/**
 * Settings: the verification form, the Profile verification action and the
 * VOLTEX Card shortcut, at desktop and phone widths, in all four KYC states.
 *
 * LOCAL PRESENTATION QA ONLY. One fixture account, reads only; every other
 * API call 404s and the KYC edge is never called — no file leaves the
 * browser. Submission itself is covered end to end by scripts/qa-kyc-edge.cjs.
 *
 *   node scripts/qa-settings-kyc-profile.cjs [--dist path] [--label after] [--port 4373]
 *
 * QA_MEASURE_ONLY=1 records without asserting (the "before" run).
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', path.join(ROOT, 'frontend', 'dist')));
const PORT = Number(arg('--port', '4373'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'output', 'settings-kyc-profile')));
const LABEL = arg('--label', 'after');
const MEASURE_ONLY = process.env.QA_MEASURE_ONLY === '1';
const WIDTHS = arg('--widths', '1440,430,390,360,320').split(',').map(Number);
const STATUSES = ['NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED'];
const LONG_NAME = 'Паспорт_гражданина_скан_разворот_страницы_с_фотографией_2026-10-04_финальная_версия.png';

const express = require('express');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');

const state = { kyc: 'NOT_STARTED' };
const created = '2026-09-04T10:00:00.000Z';

function start() {
  const app = express();
  app.use((_q, r, n) => { r.setHeader('Cache-Control', 'no-store'); n(); });
  app.get('/api/v1/me', (_q, r) => r.json({
    id: 'a2184cdc-qa00-4000-8000-000000000001', email: 'qa.user@example.invalid', displayName: 'qa.user', phone: null,
    country: 'UA', avatarUrl: null, isAdmin: false, kycStatus: state.kyc, twoFactorEnabled: false, createdAt: created,
  }));
  app.get('/api/v1/kyc/me', (_q, r) => r.json({
    kycStatus: state.kyc,
    latestSubmission: state.kyc === 'NOT_STARTED' ? null : {
      id: 'qa-sub-1', country: 'UA', fullName: 'Synthetic Person', documentType: 'PASSPORT', status: state.kyc,
      rejectionReason: state.kyc === 'REJECTED' ? 'Фото размыто — данные документа не читаются.' : null, createdAt: created,
    },
  }));
  app.get('/api/v1/account/security-log', (_q, r) => r.json([0, 1, 2].map((i) => ({
    id: `log-${i}`, action: 'LOGIN', createdAt: new Date(Date.UTC(2026, 9, 3 - i, 9, 30)).toISOString(), metadata: { ip: null, userAgent: null },
  }))));
  app.all('/api/*', (q, r) => r.status(404).json({ error: 'Outside QA scope', path: q.path }));
  app.use(express.static(DIST, { index: false, redirect: false }));
  app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
  return app.listen(PORT, '127.0.0.1');
}

const waitForServer = () => new Promise((resolve, reject) => {
  const deadline = Date.now() + 20000;
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (r) => { r.resume(); resolve(); });
    req.on('error', () => (Date.now() > deadline ? reject(new Error('no harness')) : setTimeout(attempt, 150)));
  };
  attempt();
});

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** Full-page shots from the top, so the sticky header is drawn once, where it belongs. */
const fullShot = async (page, file) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
};

/** Heights of the four form controls and the submit, the native file input's box and the progress text. */
const formMetrics = (page) => page.evaluate(() => {
  const form = [...document.querySelectorAll('form')].find((f) => f.querySelector('input[type="file"]'));
  if (!form) return null;
  const h = (el) => (el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : null);
  const file = form.querySelector('input[type="file"]').getBoundingClientRect();
  const panel = form.closest('section');
  return {
    country: h(form.querySelector('button[aria-expanded]')),
    text: h(form.querySelector('input[type="text"]')),
    date: h(form.querySelector('input[type="date"]')),
    select: h(form.querySelector('select')),
    submit: h(form.querySelector('button[type="submit"]')),
    fileInputBox: { width: Math.round(file.width), height: Math.round(file.height) },
    percent: /\b\d{1,3}\s?%/.test(panel ? panel.innerText : ''),
    formOverflow: form.scrollWidth - form.clientWidth,
  };
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = start();
  const report = { label: LABEL, dist: DIST, widths: {} };
  let browser, failed = false;
  const check = (ok, message) => { if (!MEASURE_ONLY) assert.ok(ok, message); else if (!ok) console.log(`  (before) ${message}`); };
  try {
    await waitForServer();
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    // A real PNG for the picker, drawn by the browser.
    const gen = await browser.newPage({ viewport: { width: 400, height: 260 } });
    await gen.setContent('<div style="width:400px;height:260px;background:linear-gradient(135deg,#dfe6f0,#9fb0c8);font:28px sans-serif;padding:40px">SYNTHETIC ID</div>');
    const png = await gen.screenshot({ type: 'png' });
    await gen.close();

    for (const width of WIDTHS) {
      const view = report.widths[width] = {};
      for (const status of STATUSES) {
        state.kyc = status;
        const context = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, locale: 'ru-RU', timezoneId: 'Europe/Kyiv' });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        await page.addInitScript(() => {
          localStorage.setItem('exchange_token', 'qa-token');
          localStorage.setItem('exchange_lang', 'ru');
        });
        const row = view[status] = { pageErrors };

        // ── Profile: the verification row and its action ──
        await page.goto(`http://127.0.0.1:${PORT}/settings`, { waitUntil: 'domcontentloaded' });
        await page.getByText('Информация об аккаунте').first().waitFor({ timeout: 20000 });
        await page.waitForTimeout(300);
        row.profileOverflow = await overflow(page);
        const action = page.locator('[data-profile-verification-action]');
        row.profileAction = (await action.count()) ? (await action.first().innerText()).trim() : null;
        const rowBox = page.locator('[data-profile-verification]');
        if (await rowBox.count()) {
          await rowBox.first().scrollIntoViewIfNeeded();
          await rowBox.first().screenshot({ path: path.join(OUT, `${LABEL}-${width}-${status}-profile-row.png`) });
        }
        if (status === 'NOT_STARTED' && (width === 1440 || width === 390)) {
          await fullShot(page, `${LABEL}-${width}-profile.png`);
        }
        const expectedAction = { NOT_STARTED: 'Пройти верификацию', REJECTED: 'Исправить и отправить снова', PENDING: 'Открыть статус', APPROVED: null }[status];
        check(row.profileAction === expectedAction, `${width} ${status}: Profile action is ${JSON.stringify(expectedAction)} (got ${JSON.stringify(row.profileAction)})`);
        check(row.profileOverflow <= 1, `${width} ${status}: Profile has no sideways scroll (${row.profileOverflow}px)`);

        // ── The VOLTEX Card shortcut: one visible link to /card, not a tab ──
        const cards = page.locator('[data-settings-card-link]');
        const visibleCards = [];
        for (let i = 0; i < await cards.count(); i += 1) if (await cards.nth(i).isVisible()) visibleCards.push(cards.nth(i));
        row.cardLinks = visibleCards.length;
        if (visibleCards.length) {
          const card = visibleCards[0];
          row.cardHref = await card.getAttribute('href');
          row.cardHeight = Math.round((await card.boundingBox()).height);
          row.cardInTabs = await card.evaluate((el) => !!el.closest('[aria-label="Profile sections"] ul, .overflow-x-auto'));
          if (status === 'NOT_STARTED') await card.screenshot({ path: path.join(OUT, `${LABEL}-${width}-card-link.png`) });
        }
        check(row.cardLinks === 1 && row.cardHref === '/card' && !row.cardInTabs, `${width}: one VOLTEX Card link to /card outside the tab list`);

        // ── Profile action opens the Verification tab (by tab state, no URL change) ──
        if (row.profileAction) {
          await action.first().click();
          await page.locator('[data-kyc-state]').first().waitFor({ timeout: 10000 }).catch(() => {});
          row.actionOpensVerification = await page.locator('[data-kyc-state]').count() > 0
            && await page.locator('button[aria-current="page"]', { hasText: 'Верификация' }).count() > 0;
          check(row.actionOpensVerification, `${width} ${status}: the Profile action opens the Verification tab`);
        }

        // ── Verification tab ──
        await page.goto(`http://127.0.0.1:${PORT}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
        await page.getByText(status === 'APPROVED' ? 'Верифицировано' : status === 'PENDING' ? 'На рассмотрении' : status === 'REJECTED' ? 'Отклонено' : 'Не начато').first().waitFor({ timeout: 20000 });
        await page.waitForTimeout(300);
        const fileInputs = await page.locator('input[type="file"]').count();
        row.fileInputs = fileInputs;
        row.steps = await page.locator('[data-kyc-steps] > li').evaluateAll((items) => items.map((li) => li.getAttribute('data-state')));
        check(fileInputs === ((status === 'NOT_STARTED' || status === 'REJECTED') ? 1 : 0), `${width} ${status}: upload offered only when a submission is possible`);
        if (status === 'REJECTED') {
          row.reasonShown = await page.getByText('Фото размыто — данные документа не читаются.').count() > 0;
          check(row.reasonShown, `${width}: the rejection reason is shown`);
        }
        if (fileInputs) {
          row.pristine = await formMetrics(page);
          const m = row.pristine;
          const controls = [m.country, m.text, m.date, m.select];
          row.controlsEqual = controls.every((v) => v !== null && Math.abs(v - controls[0]) <= 0.5);
          check(row.controlsEqual, `${width} ${status}: country/name/date/type controls share one height (${controls.join('/')})`);
          check(controls[0] >= 44 && controls[0] <= 50 && m.submit >= 44 && m.submit <= 50, `${width} ${status}: controls 44–50px (${controls[0]}), submit ${m.submit}`);
          check(m.fileInputBox.width <= 1 && m.fileInputBox.height <= 1, `${width} ${status}: the browser's own file button is not the visible control (${JSON.stringify(m.fileInputBox)})`);
          check(!m.percent, `${width} ${status}: no percentage pretending to measure progress`);
          await page.locator('form').first().screenshot({ path: path.join(OUT, `${LABEL}-${width}-${status}-form.png`) });

          // A long file name must not widen anything.
          await page.locator('input[type="file"]').setInputFiles({ name: LONG_NAME, mimeType: 'image/png', buffer: png });
          await page.locator('[data-kyc-file-size]').filter({ hasText: 'Файл готов' }).waitFor({ timeout: 10000 });
          await page.waitForTimeout(200);
          row.selected = { overflow: await overflow(page), ...(await formMetrics(page)) };
          row.selectedCard = await page.locator('[data-kyc-file]').count() > 0;
          check(row.selected.overflow <= 1 && row.selected.formOverflow <= 1, `${width} ${status}: a long file name causes no overflow (${row.selected.overflow}/${row.selected.formOverflow})`);
          check(row.selectedCard, `${width} ${status}: the selected file shows as a card`);
          await page.locator('form').first().screenshot({ path: path.join(OUT, `${LABEL}-${width}-${status}-form-selected.png`) });
        }
        row.verificationOverflow = await overflow(page);
        check(row.verificationOverflow <= 1, `${width} ${status}: Verification has no sideways scroll (${row.verificationOverflow}px)`);
        if (width === 1440 || width === 390) await fullShot(page, `${LABEL}-${width}-${status}-verification.png`);
        check(pageErrors.length === 0, `${width} ${status}: no page errors (${pageErrors.join(' | ')})`);
        await context.close();
      }
      const v = report.widths[width];
      console.log(`${LABEL} ${width}: ` + STATUSES.map((s) => `${s} action=${JSON.stringify(v[s].profileAction)} file=${v[s].fileInputs}`
        + (v[s].pristine ? ` h=${[v[s].pristine.country, v[s].pristine.text, v[s].pristine.date, v[s].pristine.select].join('/')} submit=${v[s].pristine.submit} %=${v[s].pristine.percent}` : '')
        + ` ovf=${v[s].profileOverflow}/${v[s].verificationOverflow}`).join(' | ') + ` card=${v.NOT_STARTED.cardLinks}`);
    }

    // ── Keyboard: the upload button and the card link show a focus ring ──
    {
      state.kyc = 'NOT_STARTED';
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
      const page = await context.newPage();
      await page.addInitScript(() => { localStorage.setItem('exchange_token', 'qa-token'); localStorage.setItem('exchange_lang', 'ru'); });
      await page.goto(`http://127.0.0.1:${PORT}/settings?tab=verification`, { waitUntil: 'domcontentloaded' });
      await page.locator('form').first().waitFor({ timeout: 20000 });
      const ring = async (locator) => {
        if (!(await locator.count())) return null;
        await locator.first().focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        return locator.first().evaluate((el) => {
          const s = getComputedStyle(el);
          return (s.boxShadow && s.boxShadow !== 'none') || (s.outlineStyle !== 'none' && s.outlineWidth !== '0px');
        });
      };
      report.focus = {
        chooseFile: await ring(page.getByRole('button', { name: 'Выбрать файл' })),
        cardLink: await ring(page.locator('[data-settings-card-link]:visible')),
      };
      check(report.focus.chooseFile && report.focus.cardLink, `keyboard focus is visible: ${JSON.stringify(report.focus)}`);
      await context.close();
    }
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
    await browser?.close();
    server.close();
    if (failed) process.exitCode = 1;
  }
})();
