const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../../src/shared/history20Regimes.json');

module.exports = async function verify({ newPage, api, origin, output, check }) {
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z';
  const saved = [];
  // Real admin HTTP + store transaction. A duplicate/failed insert must not consume a slot.
  for (let i = 0; i < 20; i++) {
    const config = {
      name: 'History20 QA',
      symbol: 'RH' + String(i + 1).padStart(2, '0'),
      logo: null,
      initialPrice: '2',
      listingAt: date,
      displayTimeZone: 'UTC',
      ownerAllocation: '0',
      seedMode: 'manual',
      seed: 'regime-test-705',
      tradable: false,
    };
    const receipt = await api('/admin/listings', { method: 'POST', body: { config } });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.body));
    assert.equal(receipt.body.draft.history20Regime.id, catalog.records[i].id);
    saved.push(receipt.body);
  }
  const deny = await api('/admin/listings/' + saved[0].id + '/publish', {
    method: 'POST',
    body: { draftRevision: 1, publishKey: 'regime-private-check-705', countdown: 'staged' },
  });
  assert.equal(deny.body.error, 'HISTORICAL_RIGHTS_UNVERIFIED');
  const direct = await api(
    '/admin/listings/' +
      saved[0].id +
      '/preview?interval=1d&at=' +
      encodeURIComponent(new Date(Date.parse(date) + 86400000).toISOString()),
  );
  assert.equal(direct.status, 200);
  assert.equal(direct.body.candles.length, 2);
  assert.equal(direct.body.book.available, false);
  check('20 persisted AUTO choices; rights gate refused publication; saved draft preview has no book');
  const frames = ['1m', '5m', '15m', '1h', '4h', '1d'],
    phases = ['start', 'middle', 'end'];
  const files = [];
  for (const width of [1440, 390]) {
    const { page, context } = await newPage(width, width === 390 ? 844 : 960);
    await page.goto(origin + '/admin/listings');
    await page.locator('[data-create-listing]').click();
    assert.equal(await page.locator('[data-regime-choice]').inputValue(), 'AUTO');
    for (const [i, r] of catalog.records.entries()) {
      await page.selectOption('[data-regime-choice]', r.id);
      for (const [j, interval] of frames.entries()) {
        const phase = phases[(i + j) % 3];
        await page.selectOption('[data-regime-interval]', interval);
        await page.selectOption('[data-regime-phase]', phase);
        const graph = page.locator(
          '[data-regime-result="' + r.id + '"][data-interval="' + interval + '"][data-phase="' + phase + '"]',
        );
        await graph.waitFor();
        const bars = await graph.locator('[data-server-candle]').count();
        assert(bars > 0 && bars <= 160);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 1, 'horizontal overflow ' + width + ' ' + r.id + ' ' + overflow);
        const name = r.id + '-' + width + '-' + interval + '-' + phase + '.png';
        await page
          .locator('[data-regime-panel]')
          .screenshot({ path: path.join(output, name), animations: 'disabled' });
        files.push(name);
      }
    }
    if (width === 1440) {
      await page.fill('[data-field="name"]', 'Manual private regime');
      await page.fill('[data-field="symbol"]', 'RHM');
      await page.fill('[data-field="initialPrice"]', '2');
      await page.fill('[data-field="wallTime"]', date.slice(0, 16));
      const saving = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/admin/listings'),
      );
      await page.locator('[data-save-draft]').click();
      const response = await saving;
      assert.equal(response.status(), 201);
      const manual = (await response.json()).draft.history20Regime;
      assert.equal(manual.id, 'R20');
      assert.equal(manual.sha256, catalog.records[19].sha256);
    }
    await page.goto(origin + '/admin/listings');
    await page.locator('[data-edit-listing="RH01"]').click();
    assert(await page.locator('[data-regime-choice]').isDisabled());
    await page.locator('[data-regime-result="R01"]').waitFor();
    assert(await page.locator('[data-publish]').isDisabled());
    await page.screenshot({ path: path.join(output, 'admin-' + width + '.png'), fullPage: true });
    await context.close();
    check(width + 'px: all 20 regimes × 6 timeframes; all 3 sections sampled; saved immutable selection');
  }
  fs.writeFileSync(path.join(output, 'screenshots.json'), JSON.stringify(files, null, 2));
};
