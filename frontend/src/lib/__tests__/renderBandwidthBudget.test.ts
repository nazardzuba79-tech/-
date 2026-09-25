import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Render free-tier bandwidth guardrails', () => {
  test('public market paint does not reopen the legacy Render SSE stream', () => {
    const source = read('frontend/src/lib/useLiveMarket.ts');
    expect(source).toContain('new SampledMarketSource');
    expect(source).not.toMatch(/new\s+EventSource/);
  });

  test('Futures display candles stay on the public market edge, including native-bound accounts', () => {
    const terminal = read('frontend/src/components/TerminalChart.tsx');
    const page = read('frontend/src/pages/FuturesPage.tsx');
    expect(terminal).toContain('getFuturesCandles');
    expect(page).not.toContain('candleLoader={nativeExecution?native.loader:undefined}');
    expect(page).not.toContain('candleLoader={nativeExecution ? native.loader : undefined}');
  });

  test('admin pages do not run global alert polling, and Users never downloads full deposit history', () => {
    const nav = read('frontend/src/components/Nav.tsx');
    const layout = read('frontend/src/pages/admin/AdminLayout.tsx');
    const users = read('frontend/src/pages/admin/AdminUsersPage.tsx');
    const deposits = read('frontend/src/pages/admin/AdminDepositsPage.tsx');

    expect(nav).not.toContain('useAdminAlertSound');
    expect(layout).not.toContain('setAdminAlertSoundEnabled');
    expect(users).toContain('getAdminRecentDepositsByUser()');
    expect(users).not.toContain('getAdminDeposits()');

    // The deposit page loads history once on mount; incoming refreshes do
    // not silently pull the history payload a second time.
    expect((deposits.match(/api\.getAdminDeposits\(\)/g) ?? []).length).toBe(2);
    expect(deposits).not.toMatch(/getAdminIncomingDepositFeed\(\)[\s\S]*?\.then\(\(res\)[\s\S]*?getAdminDeposits\(\)/);
  });

  test('production CFD display stays on Cloudflare and never falls back to Render', () => {
    const tickers = read('frontend/src/lib/useCfdTickers.ts');
    const chart = read('frontend/src/components/CfdChart.tsx');
    expect(tickers).toContain('MARKET_EDGE_BASE');
    expect(tickers).not.toContain('fallbackEndpoint');
    expect(tickers).not.toContain('fillMissingQuotes');
    expect(chart).toContain('MARKET_EDGE_BASE');
    expect(chart).not.toContain('fallbackUrl');
    expect(chart).not.toContain('bounded Render');
  });

  test('the server keeps an explicit hard stop for the unused legacy SSE route', () => {
    const source = read('src/api/routes/marketLive.ts');
    expect(source).toContain("process.env.MARKET_LIVE_SSE_ENABLED === '0'");
    expect(source).toContain("status(204)");
  });
});
