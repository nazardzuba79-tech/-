/* Admin mobile audit evidence: screenshots + hit tests against the local fixture preview.
 * Usage: node shoot.cjs <origin> <outDir> [label]
 * No external network: every non-origin request is aborted; WebSockets closed. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const [origin, outDir, label = 'before'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const SIZES = [[320, 568], [360, 800], [390, 844], [430, 932], [844, 390], [1440, 900], [1920, 1080]];
const EDGES = [[700, 900], [701, 900], [720, 900], [721, 900], [767, 900], [768, 900], [900, 900], [901, 900]];
const results = [];
const r = (o) => { results.push(o); };
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM || undefined });
  const blocked = [], errors = [];
  const contexts = {};
  const contextFor = async (touch) => {
    const key = touch ? 'touch' : 'desk';
    if (contexts[key]) return contexts[key];
    const context = await browser.newContext({ deviceScaleFactor: 1, locale: 'ru-RU', hasTouch: touch, isMobile: touch, viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => { const u = new URL(route.request().url()); if (u.origin === origin || ['data:', 'blob:'].includes(u.protocol)) return route.continue(); blocked.push(u.href); return route.abort(); });
    if (context.routeWebSocket) await context.routeWebSocket('**/*', s => s.close());
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    contexts[key] = page; return page;
  };
  let page = await contextFor(false);
  const metrics = async (route, w, h, extra = {}) => r({ label, route, w, h, docW: await page.evaluate(() => document.documentElement.scrollWidth), overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), ...extra });
  const go = async (slug) => { await page.goto(`${origin}/admin/${slug}`, { waitUntil: 'networkidle' }); await page.locator('.admin-main').waitFor(); };
  const shot = async (name, full = false) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: full });
  // Grid hit test: 9×3 points inside the element; anything else on top (an overlay, a launcher) is a blocked point.
  const hit = async (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return { found: false };
    const b = el.getBoundingClientRect();
    const pts = []; for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) pts.push([b.left + 3 + (b.width - 6) * i / 8, b.top + 3 + (b.height - 6) * j / 2]);
    const blockedBy = {}; let ok = 0;
    for (const [x, y] of pts) { const t = document.elementFromPoint(x, y); if (t && (t === el || el.contains(t))) ok++; else { const k = t ? `${t.tagName.toLowerCase()}${typeof t.className === 'string' && t.className ? '.' + t.className.split(' ')[0] : ''}` : 'offscreen'; blockedBy[k] = (blockedBy[k] || 0) + 1; } }
    return { found: true, box: { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }, inViewport: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth, okPoints: ok, points: pts.length, blockedBy };
  }, selector);
  for (const [w, h] of SIZES) {
    page = await contextFor(w <= 900);
    await page.setViewportSize({ width: w, height: h });
    const tag = `${w}x${h}`;
    // Users list
    await go('users'); await shot(`users-${tag}`); await metrics('users', w, h);
    // Profile: overview, balances, kyc, audit
    await go('users/qa-user-1'); await shot(`profile-${tag}`); await metrics('profile', w, h, { tabsScrollW: await page.evaluate(() => { const t = document.querySelector('.admin-tabs'); return t ? [t.scrollWidth, t.clientWidth] : null; }) });
    await go('users/qa-user-1?tab=balances'); await page.waitForTimeout(300); await shot(`profile-balances-${tag}`);
    await metrics('profile-balances', w, h, { tables: await page.evaluate(() => [...document.querySelectorAll('.admin-data-table, [data-balance-list]')].map(t => ({ w: Math.round(t.getBoundingClientRect().width), min: getComputedStyle(t).minWidth, scrollParent: t.parentElement ? t.parentElement.scrollWidth : null }))) });
    await go('users/qa-user-1?tab=kyc'); await page.waitForTimeout(300); await shot(`profile-kyc-${tag}`);
    await metrics('profile-kyc', w, h, { activeTabVisible: await page.evaluate(() => { const b = document.querySelector('.admin-tabs [aria-selected=true]'); if (!b) return null; const t = b.closest('.admin-tabs'); const bb = b.getBoundingClientRect(), tb = t.getBoundingClientRect(); return bb.left >= tb.left - 1 && bb.right <= tb.right + 1; }) });
    await go('users/qa-user-1?tab=audit'); await page.waitForTimeout(300); await shot(`profile-audit-${tag}`);
    // Deposits queue + credit drawer
    await go('deposits'); await page.waitForTimeout(300); await shot(`deposits-${tag}`); await shot(`deposits-full-${tag}`, true);
    await metrics('deposits', w, h, { queueTabsTop: await page.evaluate(() => { const t = document.querySelector('[data-deposit-tab="ready"]'); return t ? Math.round(t.getBoundingClientRect().top + scrollY) : null; }), viewSwitchTop: await page.evaluate(() => { const t = document.querySelector('[data-deposit-view="copies"]'); return t ? Math.round(t.getBoundingClientRect().top + scrollY) : null; }) });
    if (await page.locator('[data-watcher-details]').count()) { await page.locator('[data-watcher-details] summary').click(); await page.locator('[data-check-tx-disclosure] summary').click(); await page.waitForTimeout(250); await shot(`deposits-open-details-${tag}`, true); await page.locator('[data-watcher-details] summary').click(); await page.locator('[data-check-tx-disclosure] summary').click(); }
    const open = page.locator('[data-open-package]').first();
    if (await open.count()) {
      await open.scrollIntoViewIfNeeded(); await open.click(); await page.locator('[data-confirm-credit]').waitFor();
      await page.waitForTimeout(400);
      await shot(`credit-drawer-${tag}`);
      await metrics('credit-drawer', w, h, { confirm: await hit('[data-confirm-credit]'), cancel: await hit('[data-cancel-credit]'), launcher: await page.evaluate(() => { const l = document.querySelector('.support-launcher'); if (!l) return null; const b = l.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), z: getComputedStyle(l).zIndex }; }), panel: await page.evaluate(() => { const p = document.querySelector('[data-credit-drawer]'); const b = p.getBoundingClientRect(); return { t: Math.round(b.top), h: Math.round(b.height), inner: innerHeight, bodyScroll: !!p.querySelector('[style*="overflow"]') }; }) });
      await page.locator('[data-cancel-credit]').click(); await page.waitForTimeout(200);
    }
    await go('deposits#copies'); await page.waitForTimeout(400); await shot(`deposit-copies-${tag}`); await shot(`deposit-copies-full-${tag}`, true);
    await metrics('deposit-copies', w, h, { cards: await page.locator('[data-copy-row]').count(), cardMode: await page.locator('[data-copy-card]').count() > 0 });
    if (await page.locator('[data-copy-details] summary').count()) { await page.locator('[data-copy-details] summary').first().click(); await page.waitForTimeout(250); await shot(`deposit-copies-details-${tag}`, true); }
    // KYC
    await go('kyc'); await page.waitForTimeout(300); await shot(`kyc-${tag}`); await shot(`kyc-full-${tag}`, true);
    await metrics('kyc', w, h, { listTop: await page.evaluate(() => { const t = document.querySelector('[data-kyc-client]'); return t ? Math.round(t.getBoundingClientRect().top + scrollY) : null; }), reviewTop: await page.evaluate(() => { const t = document.querySelector('[data-kyc-review]'); return t ? Math.round(t.getBoundingClientRect().top + scrollY) : null; }) });
    if (await page.locator('[data-filter-disclosure]').count()) { await page.locator('[data-filter-disclosure] > summary').first().click(); await page.waitForTimeout(250); await shot(`kyc-filters-open-${tag}`); await metrics('kyc-filters-open', w, h); }
    await go('kyc'); await page.waitForTimeout(300);
    const clients = page.locator('[data-kyc-client]');
    if (await clients.count() >= 3) {
      await clients.nth(1).click(); await page.waitForTimeout(400); await shot(`kyc-emailed-${tag}`, true);
      await metrics('kyc-emailed', w, h, { emailed: await page.locator('[data-kyc-document-emailed]').count(), reviewInView: await page.evaluate(() => { const r = document.querySelector('[data-kyc-review]'); if (!r) return null; const b = r.getBoundingClientRect(); return b.top < innerHeight && b.bottom > 0; }) });
      await clients.nth(2).click(); await page.waitForTimeout(600); await shot(`kyc-pdf-${tag}`, true);
      await metrics('kyc-pdf', w, h, { pdfLink: await page.locator('[data-kyc-document] a', { hasText: 'Открыть PDF' }).count() });
    }
    await go('kyc?status=REJECTED'); await page.waitForTimeout(500); await shot(`kyc-rejected-${tag}`, true);
    await metrics('kyc-rejected', w, h, { reason: await page.evaluate(() => (document.querySelector('[data-kyc-review]')?.textContent || '').includes('нечитаем')) });
    await page.request.post(`${origin}/__qa/state`, { data: { failures: { '/kyc/qa-kyc-1/document': '404' } } });
    await go('kyc'); await page.waitForTimeout(600); await shot(`kyc-missing-${tag}`, true);
    await metrics('kyc-missing', w, h, { reupload: await page.locator('[data-kyc-request-reupload]').count() });
    await page.request.post(`${origin}/__qa/state`, { data: { failures: {} } });
    await go('kyc'); await page.waitForTimeout(300);
    const approve = page.locator('[data-kyc-review] button', { hasText: 'Проверено' }).first();
    if (await approve.count()) { await approve.scrollIntoViewIfNeeded(); await approve.click(); await page.locator('.admin-modal[open]').waitFor(); await page.waitForTimeout(250); await shot(`kyc-confirm-${tag}`); await metrics('kyc-confirm', w, h, { modal: await page.evaluate(() => { const m = document.querySelector('.admin-modal[open]'); const b = m.getBoundingClientRect(); const f = m.querySelector('footer').getBoundingClientRect(); return { t: Math.round(b.top), h: Math.round(b.height), footerBottom: Math.round(f.bottom), inner: innerHeight, bodyScrolls: (() => { const body = m.querySelector('.admin-modal-body'); return body ? body.scrollHeight > body.clientHeight : null; })() }; }), confirm: await hit('.admin-modal[open] footer button:last-child') }); await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    // Withdrawals + reject modal
    await go('withdrawals'); await page.waitForTimeout(300); await shot(`withdrawals-${tag}`);
    await metrics('withdrawals', w, h, { firstRowTop: await page.evaluate(() => { const t = document.querySelector('[data-withdrawal-row]'); return t ? Math.round(t.getBoundingClientRect().top + scrollY) : null; }) });
    if (await page.locator('[data-filter-disclosure]').count()) { await page.locator('[data-filter-disclosure] > summary').first().click(); await page.waitForTimeout(250); await shot(`withdrawals-filters-open-${tag}`); await page.locator('[data-filter-disclosure] > summary').first().click(); }
    const reject = page.locator('[data-withdrawal-row] button', { hasText: 'Отклонить' }).first();
    if (await reject.count()) { await reject.scrollIntoViewIfNeeded(); await reject.click(); await page.locator('.admin-modal[open]').waitFor(); await page.waitForTimeout(200); await shot(`withdrawal-reject-${tag}`); await metrics('withdrawal-reject', w, h, { modal: await page.evaluate(() => { const m = document.querySelector('.admin-modal[open]'); const b = m.getBoundingClientRect(); const f = m.querySelector('footer').getBoundingClientRect(); return { t: Math.round(b.top), h: Math.round(b.height), footerBottom: Math.round(f.bottom), inner: innerHeight }; }) }); await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    // Listings + create form + lab
    await go('listings'); await page.waitForTimeout(300); await shot(`listings-${tag}`);
    const create = page.locator('[data-create-listing]');
    if (await create.count() && await create.isEnabled()) {
      await create.click(); await page.locator('[data-listing-form]').waitFor();
      const enable = page.locator('[data-enable-movement]'); if (await enable.count()) await enable.click();
      await page.waitForTimeout(200); await shot(`listing-form-${tag}`); await shot(`listing-form-full-${tag}`, true);
      await metrics('listing-form', w, h, { formH: await page.evaluate(() => Math.round(document.querySelector('[data-listing-form]').getBoundingClientRect().height)), save: await hit('[data-save-draft]'), nav: await page.locator('[data-listing-sections]').count() });
      const stagesJump = page.locator('[data-listing-section="listing-section-stages"]');
      if (await stagesJump.count()) { await stagesJump.click(); await page.waitForTimeout(700); await shot(`listing-form-stages-${tag}`); await metrics('listing-form-stages', w, h, { stagesOpen: await page.evaluate(() => document.getElementById('listing-section-stages')?.open ?? null), stagesTop: await page.evaluate(() => Math.round(document.getElementById('listing-section-stages').getBoundingClientRect().top)), save: await hit('[data-save-draft]') }); }
      await page.locator('[data-field="name"]').fill('Фикстура'); await page.locator('[data-field="symbol"]').fill('QAX'); await page.locator('[data-field="initialPrice"]').fill('1.25'); await page.waitForTimeout(200);
      await page.locator('[data-field="initialPrice"]').focus(); await page.waitForTimeout(200); await shot(`listing-form-focused-${tag}`);
      await metrics('listing-form-focused', w, h, { focusedVisible: await page.evaluate(() => { const b = document.activeElement.getBoundingClientRect(); const bar = document.querySelector('.listing-buttons')?.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), barTop: bar ? Math.round(bar.top) : null, clear: !bar || b.bottom <= bar.top }; }) });
    }
    // OTC list + detail
    await go('otc'); await page.waitForTimeout(400); await shot(`otc-${tag}`);
    await metrics('otc', w, h, { h1: await page.evaluate(() => [...document.querySelectorAll('.admin-main h1, .admin-main h2')].map(e => e.textContent.trim()).slice(0, 4)) });
    const item = page.locator('.otc-cash-list-item').first();
    if (await item.count()) { await item.click(); await page.locator('[aria-label="Заявка OTC"]').waitFor(); await page.waitForTimeout(400); await shot(`otc-detail-${tag}`); await shot(`otc-detail-full-${tag}`, true); await metrics('otc-detail', w, h, { pageH: await page.evaluate(() => document.documentElement.scrollHeight), composerTop: await page.evaluate(() => { const t = document.querySelector('[aria-label="Заявка OTC"] textarea'); return t ? Math.round(t.getBoundingClientRect().top + scrollY) : null; }), nav: await page.locator('[data-otc-section]').count() });
      const chatJump = page.locator('[data-otc-section="otc-section-chat"]');
      if (await chatJump.count()) { await chatJump.click(); await page.waitForTimeout(700); await shot(`otc-detail-chat-${tag}`); await metrics('otc-detail-chat', w, h, { composerVisible: await page.evaluate(() => { const t = document.querySelector('[aria-label="Заявка OTC"] textarea'); const b = t.getBoundingClientRect(); return b.top >= 0 && b.top < innerHeight; }) }); } }
    // Audit log
    await go('audit-log'); await page.waitForTimeout(300); await shot(`audit-${tag}`);
    await metrics('audit-log', w, h, { firstEntryTop: await page.evaluate(() => { const t = document.querySelector('.admin-audit-list article'); return t ? Math.round(t.getBoundingClientRect().top + scrollY) : null; }) });
    if (await page.locator('[data-filter-disclosure]').count()) { await page.locator('[data-filter-disclosure] > summary').first().click(); await page.waitForTimeout(250); await shot(`audit-filters-open-${tag}`); await page.locator('[data-filter-disclosure] > summary').first().click(); }
    await go('audit-log?action=KYC_APPROVED&from=2026-10-01'); await page.waitForTimeout(500); await shot(`audit-filtered-${tag}`);
    await metrics('audit-filtered', w, h, { count: await page.locator('[data-filter-count]').textContent().catch(() => null), hint: await page.locator('[data-filter-hint]').textContent().catch(() => null), entries: await page.locator('.admin-audit-list article').count() });
    // Wallets
    await go('wallets'); await page.waitForTimeout(300); await shot(`wallets-${tag}`); await metrics('wallets', w, h);
    // Sidebar open
    if (w < 901) { await go('users'); const btn = page.locator('.admin-mobile-menu-btn'); if (await btn.isVisible()) { await btn.click(); await page.waitForTimeout(300); await shot(`sidebar-${tag}`); const focusedInMenu = await page.evaluate(() => !!document.activeElement?.closest('.admin-mobile-sidebar')); await page.keyboard.press('Escape'); await page.waitForTimeout(350); const closedByEscape = await page.evaluate(() => !document.querySelector('.admin-mobile-sidebar.mobile-open')); const focusBack = await page.evaluate(() => document.activeElement?.classList.contains('admin-mobile-menu-btn')); if (!closedByEscape) { await page.locator('.admin-mobile-close').click({ force: true }).catch(() => {}); await page.waitForTimeout(300); } await btn.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(300); await metrics('sidebar', w, h, { focusedInMenu, closedByEscape, focusBack, support: await page.locator('[data-admin-support]').count(), launcherOverMenu: await page.evaluate(() => { const l = document.querySelector('.support-launcher'); const s = document.querySelector('.admin-mobile-sidebar'); if (!l || !s) return null; const lb = l.getBoundingClientRect(), sb = s.getBoundingClientRect(); const overlaps = lb.left < sb.right && lb.right > sb.left && lb.top < sb.bottom && lb.bottom > sb.top; const top = document.elementFromPoint(lb.left + lb.width / 2, lb.top + lb.height / 2); return { overlaps, topIsLauncher: top === l || l.contains(top), zLauncher: getComputedStyle(l).zIndex, zSidebar: getComputedStyle(s).zIndex }; }) }); } }
  }
  // Support from the admin sidebar opens the same panel without a floating launcher (390 only).
  page = await contextFor(true); await page.setViewportSize({ width: 390, height: 844 }); await go('users');
  await page.locator('.admin-mobile-menu-btn').click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(300);
  if (await page.locator('[data-admin-support]').count()) { await page.locator('[data-admin-support]').click(); await page.waitForTimeout(500); await shot('support-from-sidebar-390x844'); await metrics('support-from-sidebar', 390, 844, { panel: await page.locator('.support-panel').count(), launcherVisible: await page.locator('.support-launcher').isVisible().catch(() => false), menuClosed: await page.evaluate(() => !document.querySelector('.admin-mobile-sidebar.mobile-open')) }); }
  page = await contextFor(false);
  for (const [w, h] of EDGES) {
    await page.setViewportSize({ width: w, height: h });
    for (const slug of ['users', 'users/qa-user-1?tab=balances', 'deposits', 'kyc', 'withdrawals', 'audit-log', 'listings', 'otc']) { await go(slug); await page.waitForTimeout(200); await metrics(`edge:${slug}`, w, h); }
    await go('users/qa-user-1?tab=balances'); await shot(`edge-balances-${w}`);
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ label, origin, errors, blocked: [...new Set(blocked)], results }, null, 2));
  console.log(JSON.stringify({ label, shots: fs.readdirSync(outDir).filter(f => f.endsWith('.png')).length, errors, blocked: [...new Set(blocked)], overflows: results.filter(x => x.overflow).map(x => `${x.route}@${x.w}`) }));
}
main().catch(e => { console.error(e); process.exit(1); });
