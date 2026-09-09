import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

/**
 * Route-level code splitting, locked.
 *
 * Every page used to ship in one JavaScript file: opening the wallet
 * downloaded the futures terminal, the charting library, the Copy Trading
 * marketplace and all eight admin screens. Measured on the production
 * build, the signed-out homepage went from 1728 KB of JS to 763 KB and
 * from 329 KB of CSS to 48 KB once the routes were split.
 *
 * That is one static `import` away from being undone, silently, by anyone
 * adding a page — which is exactly why it is asserted rather than trusted.
 */

const frontend = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\r\n/g, '\n');
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const app = code(read('src/App.tsx'));

/** The two pages that stay eager, and why. */
const EAGER = ['./pages/home/HomePage', './pages/AuthPage'];

describe('route code splitting', () => {
  it('keeps only the signed-out entry points eager', () => {
    // HomePage is the first paint for a signed-out visitor: lazy-loading it
    // would put a second round trip in front of the first pixel. AuthPage
    // is one click from it and small.
    for (const path of EAGER) {
      expect(app).toContain(`from '${path}'`);
    }
  });

  it('loads every other page lazily', () => {
    const pages = [
      'RegisterPage', 'TradePage', 'FuturesPage', 'MarketsPage', 'SettingsPage', 'CardPage',
      'OtcPage', 'WalletPage', 'CopyTradingPage', 'ArbitragePage', 'AnalyticsPage', 'LegalPage',
      'ReferralRedirectPage', 'AdminLayout', 'AdminWalletsPage', 'AdminUsersPage',
      'AdminUserDetailPage', 'AdminKycPage', 'AdminWithdrawalsPage', 'AdminDepositsPage',
      'AdminProductsPage', 'AdminAuditLogPage',
    ];
    const notLazy = pages.filter((page) => !new RegExp(`const ${page} = lazy\\(`).test(app));
    expect(notLazy).toEqual([]);
  });

  it('has no static page import that would pull a route back into the first bundle', () => {
    // A single `import { WalletPage } from './pages/WalletPage'` re-merges
    // that page — and everything it imports — into the entry chunk.
    const staticPageImports = [...app.matchAll(/^import\s+\{[^}]*\}\s+from\s+'(\.\/pages\/[^']+)';$/gm)]
      .map((m) => m[1])
      .filter((path) => !EAGER.includes(path));
    expect(staticPageImports).toEqual([]);
  });

  it('renders a stable shell rather than a blank screen while a chunk loads', () => {
    expect(app).toContain('<Suspense fallback={<RouteShell />}>');
    const shell = code(read('src/RouteShell.tsx'));
    // The app's own ground colour at full height: the background never
    // flashes and the scrollbar does not appear and disappear. Measured in
    // a browser: body background stays rgb(10,12,16) across every
    // navigation, with a shell hold of 0–25 ms.
    expect(shell).toContain("background: 'var(--bg)'");
    expect(shell).toContain("minHeight: '100vh'");
    // Not a spinner, and not fabricated rows shaped like data.
    expect(shell).not.toMatch(/spinner|skeleton-row|placeholder/i);
  });

  it('warms the likely next chunk on idle, so the first navigation is not slower', () => {
    // Splitting without this trades one big download for a stall on the
    // first click. The prefetch is idle-only and failure-tolerant so it
    // cannot compete with the current page's own requests.
    expect(app).toContain('usePrefetchLikelyRoutes');
    expect(app).toContain('requestIdleCallback');
    expect(app).toContain("import('./pages/FuturesPage')");
    expect(app).toContain("import('./pages/WalletPage')");
    // Signed-out visitors are never made to prefetch a page behind auth.
    expect(app).toContain('if (!getToken()) return;');
  });
});

describe('pages are not re-merged through a shared barrel', () => {
  it('has no index barrel under src/pages that would import every page', () => {
    const entries = readdirSync(resolve(frontend, 'src/pages'));
    expect(entries.filter((e) => e === 'index.ts' || e === 'index.tsx')).toEqual([]);
  });

  it('keeps main.tsx free of page imports', () => {
    const main = code(read('src/main.tsx'));
    expect(main).not.toMatch(/from '\.\/pages\//);
  });
});

describe('nothing outside App.tsx statically imports a heavy page', () => {
  it('finds no cross-page static import of a lazily-loaded route', () => {
    // A page importing another page statically defeats the split for both.
    const heavy = ['CopyTradingPage', 'CardPage', 'AnalyticsPage', 'FuturesPage', 'TradePage', 'WalletPage'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(resolve(frontend, dir), { withFileTypes: true })) {
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(rel);
        } else if (/\.tsx?$/.test(entry.name) && rel !== join('src', 'App.tsx')) {
          const text = code(read(rel));
          for (const page of heavy) {
            if (new RegExp(`import\\s+\\{[^}]*\\b${page}\\b[^}]*\\}\\s+from`).test(text)) {
              offenders.push(`${rel} -> ${page}`);
            }
          }
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
