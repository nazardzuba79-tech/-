// Runs inside the existing isolated Admin Listings harness: real router, workerd,
// persisted SQLite and built UI. Every account/economic table is a local fixture.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async ({ root, render, connected, registry, prisma, newPage, origin, shot, noOverflow, report, check }) => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config/test-markets/aith.draft.json'), 'utf8'));
  // Keep the test runnable after the real AITH launch, without altering the repository fixture.
  if (Date.parse(cfg.listingAt) < Date.now() + 3600000) cfg.listingAt = new Date(Math.ceil((Date.now() + 4 * 86400000) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  let result = await render('/admin/listings', { method: 'POST', body: { config: { ...cfg, initialPrice: '0.80' } } });
  assert.equal(result.status, 201);
  const id = result.body.id;
  result = await render(`/admin/listings/${id}/publish`, { method: 'POST', body: { draftRevision: result.body.draftRevision, publishKey: 'aith-qa-original-0001' } });
  assert.equal(result.status, 200);
  const before = (await connected.list()).listings.find(l => l.id === id);
  const next = { ...before.active, initialPrice: '2.00', simulationProfile: 'COMPRESSION_BREAKOUT' };
  const browser = await newPage('user', 1440, 'aith-old-tab');
  await browser.goto(`${origin}/trade?pair=AITH%2FUSDT`);
  await browser.locator('.vta-prelisting-facts').filter({ hasText: '0.800000 USDT' }).waitFor();
  const action = body => render(`/admin/listings/${id}/replace-prelisting`, { method: 'POST', body });
  const prepare = { phase: 'prepare', operationKey: 'aith-qa-replacement-0001', expectedVersion: 1, draftRevision: before.draftRevision, config: next };
  // A real economic footprint blocks replacement, without issuing a storage mutation.
  prisma.order.count = async () => 1;
  assert.equal((await action(prepare)).status, 422);
  prisma.order.count = async () => 0;
  assert.equal((await connected.list()).listings.find(l => l.id === id).activeVersion, 1);
  const cancelled = { ...prepare, operationKey: 'aith-qa-cancelled-0001' };
  assert.equal((await action(cancelled)).body.phase, 'PREPARED');
  assert.equal((await action({ phase: 'cancel', operationKey: cancelled.operationKey })).body.phase, 'CANCELLED');
  assert.equal((await connected.list()).listings.find(l => l.id === id).activeVersion, 1);
  result = await action(prepare);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const pending = result.body;
  assert.equal((await action({ phase: 'commit', operationKey: prepare.operationKey })).status, 409);
  // Exercise real browser timers and real lease drain, not a sleep-shortening production flag.
  await browser.waitForFunction(() => !document.querySelector('.vta-prelisting-facts')?.textContent.includes('0.800000'), { timeout: 55000 });
  await new Promise(resolve => setTimeout(resolve, Math.max(0, pending.notBefore - Date.now() + 50)));
  result = await action({ phase: 'commit', operationKey: prepare.operationKey });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.version, 2);
  const after = (await connected.list()).listings.find(l => l.id === id);
  assert.deepEqual(after.active, next);
  assert.deepEqual(after.versions.find(v => v.version === 1), before.versions[0]);
  assert.equal(after.versions.length, 2);
  const authoritative = await registry.authoritative();
  assert.equal(authoritative.find(x => x.id === id).config.initialPrice, '2.00');
  await browser.locator('.vta-prelisting-facts').filter({ hasText: '2.000000 USDT' }).waitFor({ timeout: 25000 });
  await browser.context().close();
  check('real API + DO replacement: economic activity rejected; cancellation safe; old tab loses v1 before commit and discovers v2; immutable v1 retained');

  for (const width of [1920, 1440, 1366, 430, 390, 360, 320]) {
    const page = await newPage('user', width, 'aith');
    await page.goto(`${origin}/trade?pair=AITH%2FUSDT`);
    const card = page.locator('.vta-prelisting');
    await card.locator('.vta-prelisting-facts').filter({ hasText: '2.000000 USDT' }).waitFor();
    const text = await page.locator('body').innerText();
    assert.doesNotMatch(text, /TEST|DEMO|NOT TRADABLE|0\.800000|14\.60|74\.776/);
    assert.match(await card.innerText(), /Aitheron AI/);
    assert.equal(await card.locator('[role="timer"]').count(), 1);
    await noOverflow(page, `aith-spot-${width}`);
    await shot(page, `aith-spot-${width}.png`);
    await page.goto(`${origin}/markets`);
    const search = page.locator('input[type="search"], input[placeholder*="Поиск"]').first();
    await search.waitFor();
    await search.fill('AITH');
    await page.getByText('Aitheron AI', { exact: true }).first().waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /TEST|DEMO|NOT TRADABLE|0\.800000|14\.60|74\.776/);
    await page.getByText('Aitheron AI', { exact: true }).first().scrollIntoViewIfNeeded();
    await shot(page, `aith-markets-${width}.png`);
    await noOverflow(page, `aith-markets-${width}`);
    await page.context().close();
  }
  const admin = await newPage('admin', 1440, 'aith-admin');
  await admin.goto(`${origin}/admin/listings`);
  await admin.locator('[data-edit-listing="AITH"]').click();
  assert.equal(await admin.locator('[data-field="initialPrice"]').inputValue(), '2.00');
  await admin.context().close();
  assert.equal(report.outbound, 0);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  check('AITH 7 viewport Spot/Markets/search layouts: real 2.000000 price, countdown, no labels or old values, admin active configuration agrees, zero page errors');
};
