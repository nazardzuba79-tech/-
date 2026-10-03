/** Built Admin interaction checks, entirely synthetic and localhost-only. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
exports.run = async ({ origin, out, state }) => {
  const browser = await chromium.launch({ channel: process.env.QA_BROWSER || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const checks = [], errors = [];
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const check = (name, condition) => { assert(condition, name); checks.push(name); console.log('PASS', name); };
  const users = async (query = '') => { await page.goto(`${origin}/admin/users${query}`); await page.locator('[data-user-row]').first().waitFor(); };
  try {
    await users('?page=2&search=client.');
    const original = page.url(); await page.locator('[data-user-row] .admin-open-button').first().click();
    await page.locator('.admin-main h1').filter({ hasText: '@example.invalid' }).waitFor();
    await page.locator('.admin-back').click();
    await page.waitForURL(original); check('Back preserves list page and search', page.url() === original);
    await users('?sort=email&direction=asc');
    const table = page.locator('.admin-table-desktop');
    await table.evaluate(el => { el.scrollTop = 500; });
    const tablePosition = await table.evaluate(el => el.scrollTop);
    const visibleUser = await page.locator('[data-user-row]').evaluateAll(rows => {
      const bounds = rows[0].closest('.admin-table-desktop').getBoundingClientRect();
      return rows.find(row => { const r = row.getBoundingClientRect(); return r.top > bounds.top && r.bottom < bounds.bottom; })?.getAttribute('data-user-row');
    });
    assert(tablePosition > 0 && visibleUser, 'fixture has a genuinely scrolled table');
    await page.locator(`[data-user-row="${visibleUser}"] .admin-open-button`).click();
    await page.locator('.admin-back').click();
    await page.waitForFunction(top => document.querySelector('.admin-table-desktop')?.scrollTop === top, tablePosition);
    check('Profile return restores nested desktop table position', await table.evaluate(el => el.scrollTop) === tablePosition);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/admin/users?sort=email&direction=asc`);
    const mobileOpen = page.locator('[data-user-card] .admin-open-button').nth(6);
    await mobileOpen.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobilePosition = await page.evaluate(() => window.scrollY);
    assert(mobilePosition > 0, 'fixture has a genuinely scrolled mobile list');
    await mobileOpen.click(); await page.locator('.admin-back').click();
    await page.waitForFunction(top => Math.abs(window.scrollY - top) <= 1, mobilePosition);
    check('Profile return restores mobile window after data renders', Math.abs(await page.evaluate(() => window.scrollY) - mobilePosition) <= 1);
    await page.setViewportSize({ width: 1440, height: 900 });
    await users();
    const count = state.calls.length;
    await page.getByRole('textbox', { name: 'Поиск пользователей' }).fill('client.01');
    await page.waitForTimeout(450); await page.locator('[data-user-row="qa-user-1"]').waitFor();
    check('One debounced search request', state.calls.slice(count).filter(call => call.path === '/admin/users/page').length === 1);
    check('Search renders exact matching user', await page.locator('[data-user-row]').count() === 1);
    await page.locator('[data-user-row] .admin-open-button').click();
    await page.locator('.admin-main h1').filter({ hasText: 'client.01' }).waitFor();
    check('Profile does not fetch hidden histories', !state.calls.slice(count).some(call => /\/history$/.test(call.path)));
    await page.getByRole('tab', { name: 'Выводы', exact: true }).click();
    await page.waitForTimeout(200);
    check('Selected history fetches one bounded page', state.calls.slice(count).filter(call => /\/history$/.test(call.path)).length === 1 && state.calls.at(-1).query.pageSize === '20');
    await users();
    check('Users list has no refresh line, result count or raw ID under the email', await page.locator('.admin-users-workspace .admin-read-status').count() === 0
      && await page.locator('.admin-users-workspace .admin-result-count').count() === 0
      && !(await page.locator('[data-user-row="qa-user-1"]').innerText()).includes('qa-user-1'));
    // Manual refresh stays on the other Admin pages: a failed refresh keeps the last records and marks them stale.
    await page.goto(`${origin}/admin/audit-log`); await page.locator('.admin-audit-list article').first().waitFor();
    const auditRows = await page.locator('.admin-audit-list article').count();
    state.failures['/admin/audit-log/page'] = 500;
    await page.locator('.admin-read-status').last().getByRole('button').click();
    await page.locator('.admin-read-status').last().getByRole('alert').waitFor();
    check('500 retains last records, marks stale instead of false empty', await page.locator('.admin-audit-list article').count() === auditRows && await page.getByText('Данные могли устареть.', { exact: false }).count() > 0);
    delete state.failures['/admin/audit-log/page'];
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.locator('.admin-read-status').last().getByRole('alert').waitFor({ state: 'hidden' });
    check('Retry recovers records', await page.locator('.admin-audit-list article').count() === auditRows);
    // Users: a failed read still shows the error and «Повторить», never an invented empty list.
    state.failures['/admin/users/page'] = 500;
    await page.goto(`${origin}/admin/users`); await page.locator('.admin-users-workspace [role="alert"]').waitFor();
    check('Failed users read shows the error, not a false empty list', await page.locator('[data-user-row]').count() === 0 && await page.getByText('Никого не найдено', { exact: false }).count() === 0);
    delete state.failures['/admin/users/page'];
    await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await page.locator('[data-user-row]').first().waitFor();
    check('Retry recovers users', await page.locator('[data-user-row]').count() === 20 && await page.locator('.admin-users-workspace .admin-read-status').count() === 0);
    await context.setOffline(true); await page.getByRole('combobox', { name: 'Сортировка пользователей' }).selectOption('lastLoginAt');
    await page.locator('.admin-users-workspace [role="alert"]').waitFor();
    check('Offline users read shows the error with a retry', await page.getByRole('button', { name: 'Повторить', exact: true }).count() === 1);
    await context.setOffline(false); await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.locator('[data-user-row]').first().waitFor();
    check('Retry after reconnect recovers users', await page.locator('[data-user-row]').count() === 20);
    await page.keyboard.press('Tab');
    check('Keyboard focus remains on an interactive element', await page.evaluate(() => ['A', 'BUTTON', 'INPUT', 'SELECT', 'SUMMARY'].includes(document.activeElement?.tagName)));
    await page.goto(`${origin}/admin/users/absent`); await page.getByRole('alert').first().waitFor();
    check('404 stays explicit, not empty user details', /не найден/i.test(await page.locator('.admin-main').innerText()));
    check('Read-only navigation has zero financial writes', state.writes.length === 0);
    await page.goto(`${origin}/admin/users/qa-user-1`);
    await page.locator('.admin-main h1').filter({ hasText: 'client.01' }).waitFor();
    const openAdjustment = async () => { await page.getByText('Дополнительные действия', { exact: true }).click(); await page.getByRole('button', { name: 'Корректировка баланса', exact: true }).click(); };
    await openAdjustment(); await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    check('Cancel adjustment writes nothing', state.writes.length === 0);
    // The details menu stays open after closing its dialog.
    await page.getByRole('button', { name: 'Корректировка баланса', exact: true }).click();
    await page.getByLabel('Сумма со знаком + / −', { exact: true }).fill('10');
    await page.getByLabel('Причина', { exact: true }).fill('Synthetic browser recovery');
    await page.getByRole('button', { name: 'Проверить корректировку', exact: true }).click();
    check('Review step still has zero writes', state.writes.length === 0);
    state.lostAdjustmentReply = true;
    await page.getByRole('button', { name: 'Подтвердить корректировку', exact: true }).click();
    await page.getByRole('button', { name: 'Проверить результат', exact: true }).waitFor();
    check('Lost commit response is unknown, never success', await page.getByText('Корректировка подтверждена', { exact: true }).count() === 0);
    await page.getByRole('button', { name: 'Проверить результат', exact: true }).click();
    await page.getByText('Корректировка подтверждена', { exact: true }).waitFor();
    check('Recovery reads receipt without a second financial POST', state.writes.filter(write => /\/balance-adjustments$/.test(write.path)).length === 1);
    check('No browser exceptions or unhandled fixture endpoints', !errors.length && !state.unexpected.length);
  } finally {
    fs.writeFileSync(path.join(out, 'workflow-interactions.json'), JSON.stringify({ checks, errors, calls: state.calls, writes: state.writes }, null, 2));
    await context.close(); await browser.close();
  }
};
