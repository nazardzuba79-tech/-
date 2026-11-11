const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ORIGINAL_REGIMES, ORIGINAL_MODEL_VERSION } = require('../../src/shared/originalSimulationRegimes');

module.exports = async function verify({ newPage, api, origin, output, check, restart, edge }) {
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z';
  const records = [], screenshots = [];
  for (const [i, regime] of ORIGINAL_REGIMES.entries()) {
    const config = { name: 'Original simulation ' + regime.id, symbol: 'OG' + String(i + 1).padStart(2, '0'),
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
  assert.equal((await api('/admin/listings/' + records[0].id + '/countdown', {
    method: 'POST', body: { action: 'start' },
  })).status, 200);
  await restart();
  const counting = await (await edge('/market/listings')).json();
  assert.equal(counting.assets[0].state.phase, 'pre-listing');
  assert.equal(counting.assets[0].isTradable, false);
  assert.equal(counting.assets[0].provenance.origin, 'ORIGINAL_GENERATIVE');
  assert.deepEqual((await (await edge('/market/test-assets/OG01-USDT/candles')).json()).candles, []);
  const liveAt = Date.parse(date) + 48 * 3600000;
  await restart(liveAt);
  const pub = await (await edge('/market/test-assets/OG01-USDT/candles?interval=1h')).json();
  assert(pub.candles.length > 20);
  const preview = await api('/admin/listings/' + records[0].id + '/preview?interval=1h&at=' + new Date(liveAt).toISOString());
  const overlap = new Map(preview.body.candles.map(candle => [candle.time, candle]));
  for (const candle of pub.candles) assert.deepEqual(candle, overlap.get(candle.time));
  check('Real Worker staged/start/future-clock lifecycle; public candles equal saved preview; explicit original provenance');
  for (const width of [1440, 390]) {
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
        assert((await page.locator('[data-original-panel]').innerText()).includes('Исторические котировки не используются'));
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
      check('Normal browser save persists the chosen original mode and automatic seed; saved selection is immutable');
    }
    await context.close();
    check(width + 'px: 20 modes × 6 intervals, disclosures, disabled execution/inventory, no overflow');
  }
  let financialAttempts = 0;
  for (const width of [1440, 390]) {
    const { page, context } = await newPage(width, width === 390 ? 844 : 1000);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
        financialAttempts++;
        return route.abort();
      }
      const marker = url.pathname.indexOf('/market/');
      if (marker >= 0 && (url.pathname.endsWith('/market/listings') || url.pathname.includes('OG01-USDT'))) {
        const response = await edge(url.pathname.slice(marker) + url.search);
        return route.fulfill({ status: response.status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: await response.text() });
      }
      return route.fallback();
    });
    await page.goto(origin + '/trade?pair=OG01%2FUSDT');
    await page.locator('[data-private-provenance]').first().waitFor();
    assert.match(await page.locator('[data-private-provenance]').first().innerText(), /SIMULATED.*NO REAL TRADING/);
    await page.locator('.managed-demo-chart canvas').first().waitFor();
    await page.screenshot({ path: path.join(output, 'public-original-' + width + '.png'), animations: 'disabled' });
    await page.reload();
    await page.locator('.managed-demo-chart canvas').first().waitFor();
    assert.match(await page.locator('[data-private-provenance]').first().innerText(), /SIMULATED/);
    assert(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1);
    await context.close();
  }
  assert.equal(financialAttempts, 0);
  check('Public terminal 1440/390 + reload: real Worker candles and visible SIMULATED disclosure; zero financial requests');
  fs.writeFileSync(path.join(output, 'original-results.json'), JSON.stringify({ records: records.map(r => ({ id: r.id, regime: r.draft.originalRegime })), screenshots,
    savedPreviewHash: require('node:crypto').createHash('sha256').update(JSON.stringify(savedPreview.body)).digest('hex') }, null, 2));
};
