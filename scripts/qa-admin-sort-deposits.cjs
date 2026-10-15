/** Admin → Users header sorting and the restructured Пополнения page, on the built bundle with the
 * synthetic localhost host of qa-admin-practicality.cjs (QA_PREVIEW). No production access; every
 * user is client.NN@example.invalid with no password.
 * Usage: node scripts/qa-admin-sort-deposits.cjs [--dist frontend/dist] [--out output/admin-sort-deposits] [--port 4410]
 * QA_PLAYWRIGHT_MODULE picks Playwright; QA_CHROMIUM_PATH an installed Chromium (else Playwright's own).
 */
const { spawn } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const root = path.resolve(__dirname, '..');
const dist = path.resolve(root, arg('dist', 'frontend/dist')), out = path.resolve(root, arg('out', 'output/admin-sort-deposits')), port = arg('port', '4410');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const host = spawn(process.execPath, [path.join(__dirname, 'qa-admin-practicality.cjs')], { env: { ...process.env, QA_PREVIEW: '1', QA_PORT: port, QA_FRONTEND_DIST: dist, QA_OUT: path.join(out, '_host') }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok, bad) => { host.stdout.on('data', d => { if (String(d).includes('Synthetic admin preview')) ok(); }); host.on('exit', c => bad(new Error(`host exit ${c}`))); });
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {}) });
  const report = [];
  try {
    for (const [w, h] of [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [390, 844], [320, 640]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, locale: 'ru-RU', timezoneId: 'Europe/Kyiv' });
      await ctx.route(url => !String(url).startsWith(origin), r => r.abort());
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${origin}/admin/deposits`); await page.locator('[data-deposit-section]').first().waitFor(); await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const box = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), h: Math.round(b.height), w: Math.round(b.width) }; };
        const groups = Array.from(document.querySelectorAll('.dep-tab-group')).map(g => Math.round(g.getBoundingClientRect().top));
        return { overflowX: document.documentElement.scrollWidth > innerWidth + 1, pageH: document.documentElement.scrollHeight, tools: box('.dep-tools'), tabs: box('.dep-tabs'), tabRows: new Set(groups).size, groups: groups.length,
          card: box('[data-package]'), selected: document.querySelector('[data-deposit-tab][aria-selected="true"]')?.getAttribute('data-deposit-tab'), manualOpen: document.querySelector('.dep-manual')?.hasAttribute('open') ?? null,
          oldHint: document.body.textContent.includes('Пакет становится доступным для проверки') };
      });
      report.push({ page: 'deposits', w, ...m, errors });
      check(`deposits ${w}: no sideways scroll, no page error`, !m.overflowX && !errors.length, { overflowX: m.overflowX, errors });
      check(`deposits ${w}: one tools card, three tab groups, old paragraph gone`, m.tools && m.groups === 3 && !m.oldHint);
      check(`deposits ${w}: manual checks open on desktop, folded on a phone`, m.manualOpen === (w > 760));
      await page.screenshot({ path: path.join(out, `deposits-${w}.png`), fullPage: true });
      if (w === 1440) {
        check('deposits 1440: queue tabs fit one row', m.tabRows === 1, m.tabRows);
        await page.locator('[data-deposit-tab="topup"]').click(); await page.locator('[data-package-remaining]').first().waitFor();
        await page.screenshot({ path: path.join(out, `deposits-topup-${w}.png`), fullPage: true });
        await page.locator('.dep-schedule summary').click(); await page.locator('[data-watcher-schedule]').waitFor();
        await page.locator('.dep-tools').screenshot({ path: path.join(out, `deposits-tools-schedule-${w}.png`) });
      }
      if (w === 390) {
        await page.locator('.dep-manual > summary').click(); await page.locator('[data-check-tx]').waitFor();
        await page.locator('.dep-tools').screenshot({ path: path.join(out, `deposits-tools-open-${w}.png`) });
      }
      if (w === 1440 || w === 390) {
        const desktop = w > 767, rowSel = desktop ? '[data-user-row]' : '[data-user-card]';
        await page.goto(`${origin}/admin/users`); await page.locator(rowSel).first().waitFor(); await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, `users-${w}.png`) });
        const first = () => page.evaluate(([sel, attr]) => Array.from(document.querySelectorAll(sel)).slice(0, 3).map(e => e.getAttribute(attr)), [rowSel, desktop ? 'data-user-row' : 'data-user-card']);
        const settle = async (sort, direction) => { await page.waitForURL(u => (u.searchParams.get('sort') ?? 'createdAt') === sort && u.searchParams.get('direction') === direction); await page.waitForTimeout(400); };
        const newest = await first();
        if (desktop) {
          await page.locator('[data-sort-column="createdAt"]').click(); await settle('createdAt', 'asc');
          const oldest = await first(); await page.screenshot({ path: path.join(out, `users-registration-oldest-${w}.png`) });
          await page.locator('[data-sort-column="lastLoginAt"]').click(); await settle('lastLoginAt', null);
          const recent = await first();
          await page.locator('[data-sort-column="lastLoginAt"]').click(); await settle('lastLoginAt', 'asc');
          const longAgo = await first(); await page.screenshot({ path: path.join(out, `users-login-oldest-${w}.png`) });
          const aria = await page.evaluate(() => Array.from(document.querySelectorAll('.admin-users-table th[aria-sort]')).map(th => th.getAttribute('aria-sort')));
          report.push({ page: 'users-sort', w, newest, oldest, recent, longAgo, aria });
          check('users 1440: «Регистрация» flips newest → oldest', newest[0] !== oldest[0], { newest, oldest });
          check('users 1440: «Последний вход» sorts recent first, a second click long ago first', recent[0] !== longAgo[0], { recent, longAgo });
          check('users 1440: aria-sort follows the active header', aria.join() === 'none,ascending', aria);
        } else {
          await page.getByRole('combobox', { name: 'Сортировка пользователей' }).selectOption('createdAt:asc'); await settle('createdAt', 'asc');
          const oldest = await first(); await page.screenshot({ path: path.join(out, `users-registration-oldest-${w}.png`) });
          report.push({ page: 'users-sort', w, newest, oldest });
          check('users 390: the select orders oldest registrations first', newest[0] !== oldest[0], { newest, oldest });
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close(); host.kill();
    fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify({ checks, report }, null, 1));
  }
  const failed = checks.filter(c => !c.ok);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  assert.equal(failed.length, 0, `${failed.length} checks failed`);
})().catch(e => { console.error(e); process.exit(1); });
