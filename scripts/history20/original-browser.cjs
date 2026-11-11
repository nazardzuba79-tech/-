const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ORIGINAL_REGIMES, ORIGINAL_MODEL_VERSION } = require('../../src/shared/originalSimulationRegimes');

module.exports = async function verify({ newPage, api, origin, output, check, restart, edge }) {
  const ticketsOnly = process.env.QA_ORIGINAL_TICKETS === '1';
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z';
  const records = [], screenshots = [];
  for (const [i, regime] of ORIGINAL_REGIMES.entries()) {
    const config = { name: 'Режим ' + regime.id, symbol: 'OG' + String(i + 1).padStart(2, '0'),
      logo: null, initialPrice: '2', listingAt: date, displayTimeZone: 'UTC', ownerAllocation: '0',
      seedMode: 'manual', seed: 'original-browser-706', tradable: false,
      originalRegime: { id: 'AUTO', version: ORIGINAL_MODEL_VERSION, disclosure: 'SIMULATED_ORIGINAL_MODEL' } };
    const saved = await api('/admin/listings', { method: 'POST', body: { config } });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.equal(saved.body.draft.originalRegime.id, regime.id);
    const receipt = saved.body;
    const published = await api('/admin/listings/' + receipt.id + '/publish', { method: 'POST',
      body: { draftRevision: receipt.draftRevision, publishKey: 'original-candidate-' + regime.id, countdown: 'staged' } });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    records.push(receipt);
  }
  check('20 original models assigned by real API/SQLite store; isolated publication succeeds with trading disabled');
  const denied = await fetch(origin + '/api/v1/admin/listings/original-regimes/G01');
  assert.equal(denied.status, 401);
  const mismatch = await api('/admin/listings/original-regimes/G02?draft=' + records[0].id);
  assert.equal(mismatch.status, 409);
  const invalid = await api('/admin/listings/original-regimes/G01?interval=bogus');
  assert.equal(invalid.status, 400);
  check('Preview rejects unauthenticated users, mismatched saved regime and unsupported interval');
  const savedPreview = await api('/admin/listings/original-regimes/G01?draft=' + records[0].id);
  await restart();
  assert.deepEqual(await api('/admin/listings/original-regimes/G01?draft=' + records[0].id), savedPreview);
  check('Durable Object restart preserves model, seed and exact saved preview candles');
  const hidden = await (await edge('/market/listings')).json();
  assert.deepEqual(hidden.assets, []);
  for (const record of records) assert.equal((await api('/admin/listings/' + record.id + '/countdown', {
    method: 'POST', body: { action: 'start' },
  })).status, 200);
  await restart();
  const counting = await (await edge('/market/listings')).json();
  assert.equal(counting.assets[0].state.phase, 'pre-listing');
  assert.equal(counting.assets[0].isTradable, false);
  assert.equal(counting.assets[0].provenance.origin, 'ORIGINAL_GENERATIVE');
  assert.deepEqual((await (await edge('/market/test-assets/OG01-USDT/candles')).json()).candles, []);
  let financialAttempts = 0;
  const forbidden = /\bDEMO\b|SIMULAT|NO REAL TRADING|симуляц|модел(?:ьн|ируются)|реальная торговля недоступна|test\s*[·-]\s*not tradable|учебный рынок|s[ií]mulaci[oó]n|シミュレーション|시뮬레이션|模拟|सिमुलेशन/i;
  async function noNotice(page) {
    const content = await page.locator('body').innerText();
    assert.doesNotMatch(content, forbidden);
    const labels = await page.locator('[title], [aria-label]').evaluateAll(elements => elements
      .filter(el => el.getClientRects().length).map(el => (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '')).join('\n'));
    assert.doesNotMatch(labels, forbidden);
    assert.equal(await page.locator('[data-private-provenance], [data-demo-provenance]').count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
  }
  async function terminalChecks(phase) {
    for (const width of [1440, 390]) {
      const { page, context } = await newPage(width, width === 390 ? 844 : 1000);
      await context.route('**/*', async route => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
          financialAttempts++;
          return route.abort();
        }
        const url = new URL(route.request().url());
        const marker = url.pathname.indexOf('/market/');
        if (marker >= 0 && (url.pathname.endsWith('/market/listings') || /OG\d{2}-USDT/i.test(url.pathname))) {
          const response = await edge(url.pathname.slice(marker) + url.search);
          return route.fulfill({ status: response.status, headers: { 'content-type': 'application/json',
            'access-control-allow-origin': '*' }, body: await response.text() });
        }
        return route.fallback();
      });
      for (const [index, regime] of ORIGINAL_REGIMES.entries()) {
        const symbol = 'OG' + String(index + 1).padStart(2, '0');
        await page.goto(origin + '/trade?pair=' + symbol + '%2FUSDT');
        const ready = phase === 'countdown' ? '.vta-countdown' : '.managed-demo-chart canvas';
        await page.locator(ready).first().waitFor();
        await noNotice(page);
        if (phase === 'live') for (const interval of ['1h', '5m']) {
          const loaded = page.waitForResponse(response => response.url().includes(symbol + '-USDT/candles?')
            && new URL(response.url()).searchParams.get('interval') === interval);
          const selected = page.locator('[data-cw-tf="' + interval + '"]');
          if (await selected.count()) await selected.first().click();
          else {
            await page.locator('[data-cw-feature="timeframes"]').first().click();
            await page.locator('[data-cw-tf-option="' + interval + '"]').click();
          }
          const response = await loaded;
          assert.equal(response.status(), 200);
          assert.equal((await response.json()).provenance.origin, 'ORIGINAL_GENERATIVE');
          await noNotice(page);
        }
        await page.reload();
        await page.locator(ready).first().waitFor();
        await noNotice(page);
        const filename = 'terminal-' + regime.id + '-' + phase + '-' + width + '.png';
        await page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
        screenshots.push(filename);
      }
      await context.close();
      check(width + 'px: all 20 ' + phase + ' terminals have no warning copy, including reload/timeframes');
    }
  }
  if (!ticketsOnly) await terminalChecks('countdown');
  const liveAt = Date.parse(date) + 48 * 3600000;
  await restart(liveAt);
  const pub = await (await edge('/market/test-assets/OG01-USDT/candles?interval=1h')).json();
  assert(pub.candles.length > 20);
  const preview = await api('/admin/listings/' + records[0].id + '/preview?interval=1h&at=' + new Date(liveAt).toISOString());
  const overlap = new Map(preview.body.candles.map(candle => [candle.time, candle]));
  for (const candle of pub.candles) assert.deepEqual(candle, overlap.get(candle.time));
  check('Real Worker staged/start/future-clock lifecycle; public candles equal saved preview; explicit original provenance');
  for (const width of ticketsOnly ? [] : [1440, 390]) {
    const { page, context } = await newPage(width, width === 390 ? 844 : 1000);
    await page.goto(origin + '/admin/listings');
    await page.locator('[data-create-listing]').click();
    await page.fill('[data-field="initialPrice"]', '2');
    for (const regime of ORIGINAL_REGIMES) {
      await page.selectOption('[data-original-choice]', regime.id);
      for (const interval of ['1m', '5m', '15m', '1h', '4h', '1d']) {
        await page.selectOption('[data-original-interval]', interval);
        const graph = page.locator('[data-original-result="' + regime.id + '"][data-interval="' + interval + '"]');
        await graph.waitFor();
        const count = await graph.locator('[data-server-candle]').count();
        assert(count > 0 && count <= 160);
        assert.doesNotMatch(await page.locator('[data-original-panel]').innerText(), forbidden);
        assert(await page.locator('[data-field="tradable"]').isDisabled());
        assert(await page.locator('[data-field="ownerAllocation"]').isDisabled());
        assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
        const filename = regime.id + '-' + width + '-' + interval + '.png';
        await page.locator('[data-original-panel]').screenshot({ path: path.join(output, filename), animations: 'disabled' });
        screenshots.push(filename);
      }
    }
    if (width === 1440) {
      await page.fill('[data-field="name"]', 'Original UI saved');
      await page.fill('[data-field="symbol"]', 'OGUI');
      await page.selectOption('[data-field="timeZone"]', 'UTC');
      await page.fill('[data-field="wallTime"]', date.slice(0, 16));
      const saving = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/admin/listings'));
      await page.locator('[data-save-draft]').click();
      const response = await saving;
      assert.equal(response.status(), 201, await response.text());
      const saved = await response.json();
      assert.equal(saved.draft.originalRegime.id, 'G20');
      assert.equal(saved.draft.tradable, false);
      assert.equal(saved.draft.ownerAllocation, '0');
      await page.locator('[data-original-choice]:disabled').waitFor();
      const exact = await api('/admin/listings/original-regimes/G20?draft=' + saved.id + '&interval=1d');
      assert.equal(exact.body.seed, saved.draft.seed);
      assert(exact.body.candles.length > 0);
      await page.locator('[data-preview]').click();
      const savedPreviewPanel = page.locator('[data-listing-preview]');
      await savedPreviewPanel.waitFor();
      assert.doesNotMatch(await savedPreviewPanel.innerText(), forbidden);
      assert.equal(await savedPreviewPanel.getAttribute('aria-label'), 'Предпросмотр');
      await savedPreviewPanel.screenshot({ path: path.join(output, 'saved-preview-1440.png') });
      screenshots.push('saved-preview-1440.png');
      check('Normal browser save persists the chosen original mode and automatic seed; saved selection is immutable');
    }
    await context.close();
    check(width + 'px: 20 modes × 6 intervals, neutral controls, disabled execution/inventory, no overflow');
  }
  if (ticketsOnly) {
    const ticketReport = await require('./original-ticket-browser.cjs')({ newPage, origin, edge, output, noNotice });
    financialAttempts += ticketReport.mutations;
    screenshots.push(...ticketReport.screenshots);
    check('20 live regimes × 1440/390 × guest/ordinary/two admitted identities × Buy/Sell × seven order variants: interactive drafts and silent submit');
  } else await terminalChecks('live');
  assert.equal(financialAttempts, 0);
  check('All presentation terminal states: provenance retained, public reads available, zero financial requests');
  fs.writeFileSync(path.join(output, 'original-results.json'), JSON.stringify({ records: records.map(r => ({ id: r.id, regime: r.draft.originalRegime })), screenshots,
    savedPreviewHash: require('node:crypto').createHash('sha256').update(JSON.stringify(savedPreview.body)).digest('hex') }, null, 2));
};
