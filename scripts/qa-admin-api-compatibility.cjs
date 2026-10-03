/** Actual built browser regression. Used only by the localhost fixture harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');

const viewports = [[1920, 1080], [1440, 900], [1366, 768], [430, 932], [390, 844], [360, 800]];
const pages = ['users', 'users/qa-user-1', 'deposits', 'withdrawals', 'kyc', 'otc', 'wallets', 'audit-log', 'listings'];
const newEndpoint = pathname => /^\/api\/v1\/admin\/(?:users|withdrawals|clients|audit-log)\/page$/.test(pathname)
  || /^\/api\/v1\/admin\/users\/[^/]+\/(?:profile|history)$/.test(pathname) || pathname === '/api/v1/admin/work-summary';
const financialWrites = state => state.writes.filter(request => request.path !== '/admin/deposit-watch/open');

exports.run = async ({ origin, out, state, users, variant }) => {
  const baseline = variant === 'before';
  const report = { variant, fixtureOnly: true, productionAccess: false, layouts: [], checks: [], expectedHttpErrors: [], injectedHttpErrors: [], unexpectedHttpErrors: [], blockedFontStyles: [], errors: [], consoleErrors: [], external: [], failures: [] };
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_BROWSER ? { channel: process.env.QA_BROWSER } : {}) });
  const contexts = [];
  async function check(name, callback) { try { await callback(); report.checks.push(name); } catch (error) { report.failures.push({ name, error: error.stack || String(error) }); } }
  async function makeContext(width, height) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' }); contexts.push(context);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); report.external.push(url.origin + url.pathname); return route.abort(); });
    if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => { report.external.push(socket.url()); socket.close(); });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // Chromium wording varies by platform ("Loading..." vs "Refused to load...").
      // Ignore only the known Google Fonts stylesheet CSP diagnostic; every
      // other console error remains a hard failure below.
      const text = message.text();
      if (/stylesheet/i.test(text) && /https:\/\/fonts\.googleapis\.com\//i.test(text) && /Content Security Policy/i.test(text)) { report.blockedFontStyles.push(text); return; }
      if (state.backend === 'legacy' && /Failed to load resource.*404/.test(message.text())) return;
      if (Object.keys(state.failures).length && /Failed to load resource.*50[03]/.test(message.text())) return;
      report.consoleErrors.push({ text, page: page.url(), location: message.location() });
    });
    page.on('response', response => {
      const url = new URL(response.url()), status = response.status();
      if (status < 400) return;
      const failure = { path: url.pathname, status };
      if (status === 404 && state.backend === 'legacy' && newEndpoint(url.pathname)) { report.expectedHttpErrors.push(failure); return; }
      const injected = state.failures[url.pathname.replace(/^\/api\/v1/, '')];
      if (injected && status === (Number(injected) || 500)) { report.injectedHttpErrors.push(failure); return; }
      report.unexpectedHttpErrors.push(failure);
    });
    return { context, page };
  }
  async function usersLoaded(page, width) {
    const selector = width < 768 ? '[data-user-card]' : '[data-user-row]';
    await page.locator(selector).first().waitFor({ state: 'visible' });
    return page.locator(selector);
  }
  async function capture(page, mode, slug, width, height) {
    await page.locator('.admin-main').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(out, `${mode}-${slug.replaceAll('/', '-')}-${width}.png`), fullPage: false });
    const layout = await page.evaluate(({ mode, slug, width, height }) => ({ mode, route: slug, width, height,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      rows: document.querySelectorAll('[data-user-row], [data-user-card], tbody tr, .otc-cash-list-item').length,
      visibleUserRows: [...document.querySelectorAll('[data-user-row], [data-user-card]')].filter(el => el.getClientRects().length > 0).length,
      heading: document.querySelector('.admin-main h1')?.textContent || null,
      alerts: [...document.querySelectorAll('.admin-main [role="alert"]')].map(el => el.textContent),
    }), { mode, slug, width, height });
    report.layouts.push(layout);
    if (!baseline) assert.equal(layout.overflow, false, `${mode} ${slug} ${width}px horizontal overflow`);
  }
  async function interactions(page, mode, width) {
    const selector = width < 768 ? '[data-user-card]' : '[data-user-row]';
    const rendered = () => page.locator(selector);
    const waitRows = count => page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count });
    await page.goto(`${origin}/admin/users`, { waitUntil: 'networkidle' });
    await usersLoaded(page, width);
    assert.equal(await rendered().count(), 20, 'Initial page is bounded to20 users');
    const first = rendered().first();
    assert.match(await first.innerText(), /USDT/, 'List contains fixture asset balances');
    assert.match(await first.innerText(), /USDT\s+1[\s\u00a0\u202f]500\.25/, 'List shows the exact first fixture balance');
    assert.doesNotMatch(await first.innerText(), /Активен/, 'No account status column: an active account carries no mark');
    assert.match(await first.innerText(), /На проверке|Проверяется|PENDING/i, 'Fixture KYC status is displayed');
    if (width >= 768) assert.equal((await first.locator('[data-user-password]').innerText()).trim(), '—', 'Missing password stays a dash');
    else assert.equal((await first.locator('dt').filter({ hasText: /^Пароль$/ }).evaluate(el => el.nextElementSibling.textContent)).trim(), '—');

    await page.getByRole('textbox', { name: 'Поиск пользователей' }).fill('client.0');
    await waitRows(9);
    // No account-status filters (owner, 2026-10-03); the KYC filter exercises the same server filter path.
    await page.getByRole('combobox', { name: 'Фильтр пользователей' }).selectOption('kyc-pending');
    await waitRows(4);
    assert.match(await rendered().first().innerText(), /На проверке/, 'KYC filter keeps the authoritative KYC state');
    assert.doesNotMatch(await rendered().first().innerText(), /Заблокирован/, 'No blocked mark in the list');
    await page.getByRole('combobox', { name: 'Фильтр пользователей' }).selectOption('all');
    await waitRows(9);
    await page.getByRole('textbox', { name: 'Поиск пользователей' }).fill('client.');
    await waitRows(20);
    // Both pages hold 20 rows, so wait for page two's own first row rather than a row count.
    const rowAttribute = width < 768 ? 'data-user-card' : 'data-user-row';
    const pageOneFirst = await rendered().first().getAttribute(rowAttribute);
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('page') === '2');
    await page.waitForFunction(({ attribute, first }) => {
      const rows = document.querySelectorAll(`[${attribute}]`);
      return rows.length === 20 && rows[0].getAttribute(attribute) !== first;
    }, { attribute: rowAttribute, first: pageOneFirst });
    const returnUrl = page.url(), userId = await rendered().first().getAttribute(width < 768 ? 'data-user-card' : 'data-user-row');
    const fixture = users.find(user => user.id === userId);
    const beforeProfile = state.calls.length;
    await rendered().first().getByRole('link', { name: 'Открыть', exact: true }).click();
    await page.getByRole('heading', { name: fixture.email, exact: true }).waitFor();
    assert.equal(state.calls.slice(beforeProfile).filter(call => call.path.endsWith('/history')).length, 0, 'No eager history read');
    if (mode === 'legacy') assert.equal(state.calls.slice(beforeProfile).filter(call => call.path === `/admin/users/${userId}`).length, 0, 'Legacy first-open avoids aggregate history endpoint');

    await page.getByRole('tab', { name: 'Балансы', exact: true }).click();
    await page.getByRole('heading', { name: 'Спотовый счёт', exact: true }).waitFor();
    await page.getByText(fixture.balances[0].available, { exact: true }).waitFor();
    await page.getByText('1200.00000000', { exact: true }).waitFor();
    for (const [label, kind] of [['Пополнения', 'deposits'], ['Выводы', 'withdrawals'], ['Ордера', 'orders'], ['Проверка личности', 'kyc'], ['История действий', 'audit']]) {
      const from = state.calls.length;
      await page.getByRole('tab', { name: label, exact: true }).click();
      const panel = page.getByRole('tabpanel', { name: label, exact: true });
      await panel.waitFor();
      // networkidle has already fired for this SPA page, so it does not wait for the tab's read.
      // Wait for the tab's own result instead: its request has then been received and answered.
      await panel.locator('.admin-read-status [role="status"]').filter({ hasText: /^Обновлено:/ }).waitFor();
      assert.equal(state.calls.slice(from).filter(call => call.path.endsWith('/history') && call.query.kind !== kind).length, 0, 'Only the selected history kind is requested');
      if (mode === 'modern') assert(state.calls.slice(from).some(call => call.path.endsWith('/history') && call.query.kind === kind), 'Selected modern history is loaded');
    }
    await page.getByRole('tab', { name: 'Ордера', exact: true }).click();
    for (const kind of ['futuresOrders', 'futuresPositions', 'cfdPositions', 'purchases']) {
      await page.locator('.admin-history-kind select').selectOption(kind);
      await page.waitForLoadState('networkidle');
      if (mode === 'legacy' && kind !== 'purchases') {
        assert.match(await page.getByRole('tabpanel').innerText(), /недоступ|не поддерж|обновлен|обновлён/i, 'Unsupported legacy history is explicit, not fabricated empty data');
      }
    }
    await page.getByRole('link', { name: /Все пользователи/ }).click();
    await page.waitForURL(returnUrl);
    await waitRows(20);
    assert.equal(await page.getByRole('textbox', { name: 'Поиск пользователей' }).inputValue(), 'client.');
    assert.equal(await page.getByRole('combobox', { name: 'Фильтр пользователей' }).inputValue(), 'all');
    assert.equal(page.url(), returnUrl, 'Back preserves exact search/filter/page URL');

    const beforeCancel = financialWrites(state).length;
    const row = rendered().first();
    await row.getByRole('button', { name: 'Удалить аккаунт', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await row.getByRole('button', { name: 'Удалить аккаунт', exact: true }).click();
    await dialog.waitFor({ state: 'visible' }); await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(financialWrites(state).length, beforeCancel, 'Cancel and Escape cause zero mutation requests');

    for (const slug of pages.filter(slug => !slug.includes('/'))) {
      if (width < 768) await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
      const link = page.locator(`.admin-mobile-sidebar a[href="/admin/${slug}"]`);
      await link.click(); await page.waitForURL(url => url.pathname === `/admin/${slug}`);
      if (width < 768) assert.equal(await page.locator('.admin-mobile-sidebar').evaluate(el => el.classList.contains('mobile-open')), false, 'Mobile menu closes after navigation');
      await page.waitForLoadState('networkidle');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Sidebar destination has no horizontal overflow');
    }
  }
  try {
    for (const mode of ['modern', 'legacy']) {
      state.backend = mode;
      for (const [width, height] of viewports) {
        const { context, page } = await makeContext(width, height);
        for (const slug of pages) {
          await check(`${mode}: ${slug} ${width}x${height}`, async () => {
            await page.goto(`${origin}/admin/${slug}`, { waitUntil: 'networkidle' });
            if (!baseline && slug === 'users') await usersLoaded(page, width);
            if (!baseline && slug === 'users/qa-user-1') await page.getByRole('heading', { name: users[0].email, exact: true }).waitFor();
            await capture(page, mode, slug, width, height);
            if (!baseline) assert.equal(await page.getByText(/Запись не найдена|Не удалось загрузить пользователей/).count(), 0, 'Supported legacy page must remain usable');
            if (!baseline) assert.equal(await page.locator('.admin-main [role="alert"]').count(), 0, 'Supported page has no blocking read error');
          });
        }
        if (!baseline) await check(`${mode}: search/filter/paging/Back/lazy-history/cancel/sidebar ${width}px`, () => interactions(page, mode, width));
        await context.close();
      }
    }
    if (!baseline) {
      state.backend = 'modern';
      const { context, page } = await makeContext(390, 844);
      await check('500 is not capability404: no legacy fallback, explicit retry recovers', async () => {
        state.failures['/admin/users/page'] = 500;
        const start = state.calls.length;
        await page.goto(`${origin}/admin/users`, { waitUntil: 'networkidle' });
        await page.locator('.admin-users-workspace [role="alert"]').waitFor({ state: 'visible' });
        assert.equal(state.calls.slice(start).filter(call => call.path === '/admin/users').length, 0, '500 must not fall back to an unbounded read');
        assert.equal(await page.locator('[data-user-card]').count(), 0, 'Unavailable data must not fabricate users');
        delete state.failures['/admin/users/page'];
        await page.getByRole('button', { name: 'Повторить', exact: true }).click();
        await usersLoaded(page, 390);
      });
      state.failures = {}; await context.close();
    }
    assert.equal(financialWrites(state).length, 0, 'Read-only matrix must not send financial writes');
    assert.equal(state.unexpected.length, 0, 'Every API request must have an explicit fixture');
    assert.equal(report.external.length, 0, 'No external network request is allowed');
    assert.equal(report.errors.length, 0, 'No uncaught browser error is allowed');
    assert.equal(report.consoleErrors.length, 0, 'No unexpected browser console error is allowed');
    assert.equal(report.unexpectedHttpErrors.length, 0, 'Only exact legacy capability404 or explicitly injected failure paths may return HTTP errors');
  } finally {
    await Promise.allSettled(contexts.map(context => context.close())); await browser.close();
    report.calls = state.calls; report.writes = state.writes; report.unexpected = state.unexpected;
    fs.writeFileSync(path.join(out, 'compatibility-results.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ variant, screenshots: report.layouts.length, passed: report.checks.length, failures: report.failures,
    pageErrors: report.errors, consoleErrors: report.consoleErrors, external: report.external, financialWrites: financialWrites(state).length,
    unexpectedHttpErrors: report.unexpectedHttpErrors, expectedLegacy404: report.expectedHttpErrors.length, evidence: out }, null, 2));
  assert.equal(report.failures.length, 0, 'Compatibility browser scenarios failed');
};
