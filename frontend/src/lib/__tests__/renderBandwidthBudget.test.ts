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

  test('admin notification polling is bounded and sleeps with a hidden tab', () => {
    const source = read('frontend/src/lib/useAdminAlerts.ts');
    expect(source).toContain('const POLL_MS = 60_000');
    expect(source).toContain('getAdminAlertSummary()');
    expect(source).not.toContain('getAdminDeposits()');
    expect(source).not.toContain('getAdminWithdrawals()');
    expect(source).not.toContain('getAllClients()');
    const client = read('frontend/src/lib/adminAlertApi.ts');
    expect(client).toContain('/admin/alerts-summary');
    expect(client).not.toContain('/admin/deposits');
    expect(client).not.toContain('/admin/withdrawals');
    expect(client).not.toContain('/admin/clients');
    expect(source).toContain('document.hidden');
    expect(source).toContain("document.addEventListener('visibilitychange', onVisibility)");
    expect(source).toContain("document.removeEventListener('visibilitychange', onVisibility)");
  });

  test('the server keeps an explicit hard stop for the unused legacy SSE route', () => {
    const source = read('src/api/routes/marketLive.ts');
    expect(source).toContain("process.env.MARKET_LIVE_SSE_ENABLED === '0'");
    expect(source).toContain("status(204)");
  });
});
