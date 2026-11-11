const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const identities = ['guest', 'ordinary', 'admitted-a', 'admitted-b'];
const variants = [
  { family: 'LIMIT' }, { family: 'MARKET' },
  { family: 'STOP', execution: 'LIMIT' }, { family: 'STOP', execution: 'MARKET' },
  { family: 'TAKE_PROFIT', execution: 'LIMIT' }, { family: 'TAKE_PROFIT', execution: 'MARKET' },
  { family: 'OCO' },
];
const families = ['LIMIT', 'MARKET', 'STOP', 'TAKE_PROFIT', 'OCO'];

async function draft(page) {
  return page.evaluate(() => {
    const form = document.querySelector('form[data-original-ticket]');
    return {
      values: Array.from(form.querySelectorAll('input,select')).map(el => [el.getAttribute('aria-label'), el.value]),
      pressed: Array.from(document.querySelectorAll('.order-form-area [aria-pressed]')).map(el => el.getAttribute('aria-pressed')),
      balance: form.querySelector('.order-summary').textContent,
      messages: Array.from(document.querySelectorAll('[role="alert"], [role="status"], .toast')).map(el => el.textContent),
      orders: document.querySelector('.bottom-panel')?.textContent,
      local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage), url: location.href,
    };
  });
}

async function edit(input, value) {
  assert(await input.isEnabled());
  assert(!(await input.getAttribute('readonly')));
  // Use native select-and-type as one edit, without a separate intermediate
  // empty-value edit of the linked quantity/total fields.
  await input.press('ControlOrMeta+A');
  await input.pressSequentially(value);
  assert.equal(await input.inputValue(), value, await input.getAttribute('aria-label'));
  assert.equal(await input.evaluate(el => el.selectionStart), value.length);
}

module.exports = async function verify({ newPage, origin, edge, output, noNotice }) {
  const selected = process.env.QA_TICKET_IDENTITY;
  if (selected && !identities.includes(selected)) throw Error('Unknown ticket identity');
  const testedIdentities = selected ? [selected] : identities;
  const report = { cases: [], screenshots: [], mutations: 0, socketWrites: 0, dialogs: 0,
    guestScope: 'Existing /trade authentication is retained. Guest interactions use an open ticket after its session token is removed.' };
  async function runIdentity({ width, identity }) {
    const { page, context } = await newPage(width, width === 390 ? 844 : 1000);
    page.on('console', message => { if (message.type() === 'error') console.log('Ticket browser console:', message.text()); });
    page.on('requestfailed', request => console.log('Ticket fixture read failed:', request.url()));
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    page.on('dialog', dialog => { report.dialogs++; void dialog.dismiss(); });
    page.on('websocket', socket => socket.on('framesent', () => { report.socketWrites++; }));
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
        report.mutations++;
        return route.abort();
      }
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      if (url.hostname === 'cdn.jsdelivr.net' && /\/og\d{2}\.png$/i.test(url.pathname)) return route.fulfill({
        status: 200, contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#f0b90b"/><text x="16" y="22" text-anchor="middle" font-size="18">O</text></svg>',
      });
      const reply = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.endsWith('/orders/access')) return reply({ allowed: identity.startsWith('admitted') });
      if (url.pathname === '/api/v1/me') return reply({ id: 'fixture-' + identity, role: 'USER', isAdmin: false,
        email: identity + '@example.invalid', kycStatus: 'NONE', createdAt: '2026-01-01T00:00:00Z' });
      if (url.pathname.endsWith('/balances')) return reply([
        { asset: 'USDT', available: '100', locked: '0' },
        ...Array.from({ length: 20 }, (_, i) => ({ asset: 'OG' + String(i + 1).padStart(2, '0'), available: '50', locked: '0' })),
      ]);
      const marker = url.pathname.indexOf('/market/');
      if (marker >= 0 && (url.pathname.endsWith('/market/listings') || /OG\d{2}-USDT/i.test(url.pathname))) {
        const response = await edge(url.pathname.slice(marker) + url.search);
        return route.fulfill({ status: response.status, headers: { 'content-type': 'application/json',
          'access-control-allow-origin': '*' }, body: await response.text() });
      }
      return route.fallback();
    });
    for (let i = 1; i <= 20; i++) {
      const id = 'G' + String(i).padStart(2, '0'), symbol = 'OG' + String(i).padStart(2, '0');
      // The original route guard still requires a session to enter. Then remove
      // it for the guest case; the actual submit handler must remain inert.
      await page.goto(origin + '/trade?pair=' + symbol + '%2FUSDT');
      try { await page.locator('.managed-demo-chart canvas').first().waitFor(); }
      catch (error) {
        await page.screenshot({ path: path.join(output, 'ticket-load-failed.png'), fullPage: true });
        console.log('Ticket load failure:', page.url(), (await page.locator('body').innerText()).slice(0, 1800));
        throw error;
      }
      if (width === 390) await page.locator('#mobile-trade-trade').click();
      const form = page.locator('form[data-original-ticket]');
      await form.waitFor({ state: 'visible' });
      if (identity === 'guest') {
        await page.evaluate(() => localStorage.removeItem('exchange_token'));
        assert.equal(await page.evaluate(() => localStorage.getItem('exchange_token')), null);
      }
      for (const side of ['BUY', 'SELL']) {
        await page.locator('.order-form-tabs .' + side.toLowerCase()).click();
        for (const variant of variants) {
          if (width === 390) await page.locator('.order-type-select select').selectOption(variant.family);
          else await page.locator('.order-form-area > .order-type-tabs button').nth(families.indexOf(variant.family)).click();
          if (variant.execution) await form.locator('.order-type-tabs button').nth(variant.execution === 'LIMIT' ? 0 : 1).click();
          const fields = await form.locator('input[type="text"]:not([readonly])').all();
          for (const field of fields) await edit(field, '12,50');
          const quantity = form.locator('input[type="text"][aria-label="Количество"]');
          await edit(quantity, '12');
          await edit(quantity, '3.75');
          const range = form.locator('input[type="range"]');
          assert(await range.isEnabled());
          await range.focus();
          await range.press('Home');
          await range.press('ArrowRight');
          assert.equal(await range.inputValue(), '25');
          const steps = variant.family === 'LIMIT' ? [0, 25, 50, 75, 100] : [75];
          for (const step of steps) {
            const key = width === 390
              ? form.locator('.slider-labels button').filter({ hasText: new RegExp('^' + step + '%$') })
              : form.locator('.slider-track button[aria-label="' + step + '%"]');
            await key.click();
            assert.equal(await range.inputValue(), String(step));
            assert.equal(await key.getAttribute('aria-pressed'), 'true');
          }
          await edit(quantity, '7,25');
          await edit(form.locator('input[aria-label="Итого"]'), '24.50');
          const before = await draft(page), navBefore = navigations;
          const socketsBefore = report.socketWrites, dialogsBefore = report.dialogs;
          const button = form.locator('button[type="submit"]');
          assert(await button.isEnabled());
          await button.click();
          assert.deepEqual(await draft(page), before, id + '/' + identity + '/' + variant.family + ': click changed state');
          await quantity.press('Enter');
          assert.deepEqual(await draft(page), before, id + '/' + identity + '/' + variant.family + ': Enter changed state');
          assert.equal(navigations, navBefore);
          assert.equal(report.socketWrites, socketsBefore);
          assert.equal(report.dialogs, dialogsBefore);
          assert.equal(report.mutations, 0);
          report.cases.push({ id, width, identity, side, ...variant });
        }
      }
      await noNotice(page);
      const filename = 'ticket-' + id + '-' + identity + '-' + width + '.png';
      await page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
      report.screenshots.push(filename);
      fs.writeFileSync(path.join(output, 'ticket-progress.json'), JSON.stringify({ completed: report.cases.length }));
    }
    await context.close();
    console.log('PASS interactive tickets ' + width + ' / ' + identity + ': 20 regimes, both sides, seven variants');
  }
  const jobs = [1440, 390].flatMap(width => testedIdentities.map(identity => ({ width, identity })));
  for (let i = 0; i < jobs.length; i += 4) {
    const results = await Promise.allSettled(jobs.slice(i, i + 4).map(runIdentity));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  const expected = 20 * 2 * testedIdentities.length * 2 * variants.length;
  assert.equal(report.cases.length, expected);
  assert.equal(new Set(report.cases.map(row => [row.id, row.width, row.identity, row.side, row.family, row.execution].join('/'))).size, expected);
  assert.equal(report.mutations, 0);
  assert.equal(report.dialogs, 0);
  fs.writeFileSync(path.join(output, 'ticket-results.json'), JSON.stringify(report, null, 2));
  return report;
};
