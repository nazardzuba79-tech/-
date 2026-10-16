/**
 * Admin console on phones and tablets (audit 2026-10-16, scripts/qa-admin-mobile-audit.cjs).
 *
 * Four defects reproduced in Chromium on current main and fixed minimally:
 *  1. Users → card → «Балансы»: the three-column balance table inherited the
 *     950px floor of wide admin tables, so the page was 992px wide at 320–430px.
 *  2. The site-wide floating support launcher (z-index 998) sat above the admin
 *     drawer (51) and its overlay (50): it covered part of «Подтвердить
 *     зачисление» at every width and stayed clickable over modal overlays.
 *  3. At the end of a page the same launcher covered the last button
 *     («Проверить и зачислить …», «Отклонить», «Изменить»): there was no room to
 *     scroll it clear.
 *  4. The phone menu did not close with Escape; a tab opened from a link
 *     (?tab=kyc) stayed outside the visible part of the tab strip.
 * The browser script asserts the behaviour; these checks pin the causes.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { styles } from '../../pages/admin/adminStyles';

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8');

/** The launcher's z-index as SupportWidget.tsx sets it. */
function launcherZ(): number {
  const source = read('src/components/SupportWidget.tsx');
  const style = source.slice(source.indexOf('const launcherStyle'), source.indexOf('};', source.indexOf('const launcherStyle')));
  const match = style.match(/zIndex:\s*(\d+)/);
  if (!match) throw new Error('launcher z-index not found');
  return Number(match[1]);
}

describe('admin modal surfaces sit above the site-wide support launcher', () => {
  it('drawer overlay and panel are above the launcher and its panel', () => {
    const launcher = launcherZ();
    const overlay = Number(styles.drawerOverlay.zIndex), panel = Number(styles.drawerPanel.zIndex);
    expect(launcher).toBe(998);
    expect(overlay).toBeGreaterThan(launcher + 1); // the support panel is 999
    expect(panel).toBeGreaterThan(overlay);
  });

  it('the ignore-transfer modal stays above its overlay', () => {
    const source = read('src/pages/admin/AdminDepositsPage.tsx');
    const modal = source.slice(source.indexOf('data-ignore-modal'), source.indexOf('data-ignore-modal') + 600);
    expect(Number(modal.match(/zIndex:\s*(\d+)/)?.[1])).toBeGreaterThan(Number(styles.drawerOverlay.zIndex));
  });
});

describe('room under the last control for the floating launcher', () => {
  it('desktop, 769–900px and phones all keep 88px at the bottom of the admin page', () => {
    expect(styles.main.padding).toBe('16px 24px 88px');
    const css = read('src/pages/admin/adminConsole.css');
    expect(css).toMatch(/@media \(max-width: 900px\) \{\s*\.admin-page-grid \.admin-main \{ padding-bottom: 88px !important; \}/);
    expect(css).toMatch(/\.admin-page-grid \.admin-main \{ padding: 12px 12px 88px !important; \}/);
    // index.css still sets 20px on the shell at ≤900px; the admin rule above must out-rank it.
    expect(read('src/index.css')).toMatch(/\.admin-main \{\s*padding: 20px !important;/);
  });
});

describe('user card balances fit a phone', () => {
  it('the balance table opts out of the wide-table floor and the grid track may shrink', () => {
    expect(read('src/pages/admin/AdminUserDetailPage.tsx')).toContain('className="admin-data-table admin-balance-table"');
    const css = read('src/pages/admin/adminConsole.css');
    expect(css).toContain('.admin-data-table { min-width: 950px; }');
    expect(css).toContain('.admin-data-table.admin-balance-table { min-width: 0; }');
    expect(read('src/pages/admin/adminPracticality.css')).toContain('.admin-detail-overview { grid-template-columns: minmax(0,1fr); }');
  });
});

describe('phone navigation', () => {
  it('the menu closes on Escape and gives focus back to its button', () => {
    const layout = read('src/pages/admin/AdminLayout.tsx');
    expect(layout).toMatch(/event\.key !== 'Escape'[\s\S]{0,80}setMobileOpen\(false\);\s*menuButton\.current\?\.focus\(\);/);
    expect(layout).toMatch(/ref=\{menuButton\}\s*onClick=\{\(\) => setMobileOpen\(true\)\}/);
  });

  it('the selected user-card tab is scrolled into the strip, never the page', () => {
    const page = read('src/pages/admin/AdminUserDetailPage.tsx');
    expect(page).toContain('<div ref={tabStrip} className="admin-tabs" role="tablist"');
    expect(page).toMatch(/strip\.scrollLeft [-+]=/);
    expect(page).not.toMatch(/selected\.scrollIntoView/);
  });
});
