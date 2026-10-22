/* Phone walkthrough of the candidate admin build on local fixtures only (390×844, touch):
 * Users → profile/balances → deposits/copies → credit drawer and cancel → KYC → listings/stages → OTC → audit log.
 * Records a WebM; the caller converts it to MP4. No request leaves the local origin. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const [origin, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'ru-RU', recordVideo: { dir: outDir, size: { width: 390, height: 844 } } });
  await context.route('**/*', route => { const u = new URL(route.request().url()); if (u.origin === origin || ['data:', 'blob:'].includes(u.protocol)) return route.continue(); return route.abort(); });
  if (context.routeWebSocket) await context.routeWebSocket('**/*', s => s.close());
  const page = await context.newPage();
  const pause = (ms) => page.waitForTimeout(ms);
  const scrollBy = async (y, steps = 6) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, y / steps); await pause(120); } };
  const go = async (slug) => { await page.goto(`${origin}/admin/${slug}`, { waitUntil: 'networkidle' }); await page.locator('.admin-main').waitFor(); await pause(900); };
  // Users
  await go('users'); await scrollBy(500); await pause(500);
  await page.locator('[data-user-card] .admin-open-button').first().click(); await page.locator('.admin-tabs').waitFor(); await pause(900);
  // Profile → balances → kyc (tab strip scrolls the selected tab into view)
  await page.locator('[role="tab"]', { hasText: 'Балансы' }).click(); await pause(1000); await scrollBy(300); await pause(500);
  await page.locator('.admin-tabs').evaluate(el => el.scrollBy({ left: 400, behavior: 'smooth' })); await pause(600);
  await page.locator('[role="tab"]', { hasText: 'Проверка личности' }).click(); await pause(1200);
  // Deposits: status line, details, TXID on demand, queue, copies
  await go('deposits'); await page.locator('[data-watcher-details] summary').click(); await pause(900); await page.locator('[data-watcher-details] summary').click(); await pause(300);
  await page.locator('[data-check-tx-disclosure] summary').click(); await pause(900); await page.locator('[data-check-tx-disclosure] summary').click(); await pause(300);
  await page.locator('[data-deposit-view="copies"]').click(); await pause(1000); await page.locator('[data-copy-details] summary').first().click(); await pause(1200); await scrollBy(400); await pause(500);
  await page.locator('[data-deposit-view="queue"]').click(); await pause(800);
  // Credit drawer and cancel
  const open = page.locator('[data-open-package]').first(); await open.scrollIntoViewIfNeeded(); await pause(300); await open.click(); await page.locator('[data-confirm-credit]').waitFor(); await pause(1200);
  await page.locator('.admin-drawer-body').evaluate(el => el.scrollBy({ top: 400, behavior: 'smooth' })); await pause(900);
  await page.locator('[data-cancel-credit]').click(); await pause(800);
  // KYC: filters disclosure, pick a client, review card
  await go('kyc'); await page.locator('[data-filter-disclosure] > summary').click(); await pause(900); await page.locator('[data-filter-disclosure] > summary').click(); await pause(300);
  await page.locator('[data-kyc-client]').nth(1).click(); await pause(1500); await scrollBy(500); await pause(600);
  // Listings: form, section jumps, sticky actions
  await go('listings'); await page.locator('[data-create-listing]').click(); await page.locator('[data-listing-form]').waitFor(); await pause(600);
  // A new listing already carries the movement editor (emptyForm sets simulationProgram); nothing to enable.
  await page.locator('[data-movement-editor]').waitFor(); await pause(300);
  await page.locator('[data-listing-section="listing-section-stages"]').click(); await pause(1200);
  await page.locator('[data-listing-section="listing-section-advanced"]').click(); await pause(1200);
  await page.locator('[data-listing-section="listing-section-main"]').click(); await pause(1000);
  // OTC: list → request → section jumps
  await go('otc'); await page.locator('.otc-cash-list-item').first().click(); await page.locator('[data-otc-section]').first().waitFor(); await pause(900);
  await page.locator('[data-otc-section="otc-section-terms"]').click(); await pause(1000);
  await page.locator('[data-otc-section="otc-section-chat"]').click(); await pause(1200);
  await page.locator('[data-otc-section="otc-section-request"]').click(); await pause(800);
  // Audit log: filters
  await go('audit-log'); await page.locator('[data-filter-disclosure] > summary').click(); await pause(900);
  await page.locator('.admin-filter-fields select').selectOption('KYC_APPROVED'); await pause(1200); await page.locator('[data-filter-disclosure] > summary').click(); await pause(800); await scrollBy(400); await pause(800);
  // Menu: Escape closes, support entry
  await page.locator('.admin-mobile-menu-btn').click(); await pause(900); await page.keyboard.press('Escape'); await pause(700);
  const video = page.video();
  await page.close(); const saved = video ? await video.path() : null; await context.close(); await browser.close();
  console.log(JSON.stringify({ video: saved, bytes: saved ? fs.statSync(saved).size : 0 }));
})().catch(e => { console.error(e); process.exit(1); });
