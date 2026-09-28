import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { assertReviewOrigin, tradingAllowed, reviewWrite } from '../policy';
import { mockTelegramLaunch } from '../telegram';
import { reviewDeployment } from '../deployment';
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('mobile review safety boundary', () => {
  test('hosting configuration is local, portable and independent of production env files', () => {
    expect(reviewDeployment({})).toMatchObject({ apiBase: '/api/v1', frontendOrigin: 'http://127.0.0.1:4178' });
    expect(reviewDeployment({ MOBILE_FRONTEND_ORIGIN: 'http://localhost:9000', MOBILE_TELEGRAM_ORIGIN: 'http://localhost:9001', MOBILE_API_BASE: 'http://localhost:9002/api/v1' }).telegramOrigin).toBe('http://localhost:9001');
    for (const key of ['MOBILE_API_BASE','MOBILE_FRONTEND_ORIGIN','MOBILE_TELEGRAM_ORIGIN']) expect(()=>reviewDeployment({[key]:'https://production.example/api/v1'})).toThrow();
  });
  test('production and lookalike origins fail closed', () => {
    for (const hostname of ['voltextech.net', 'localhost.evil.test', '127.0.0.1.evil.test', '0.0.0.0']) expect(() => assertReviewOrigin({ hostname, pathname: '/pwa' })).toThrow();
    expect(() => assertReviewOrigin({ hostname: '127.0.0.1', pathname: '/pwa' })).not.toThrow();
    expect(() => assertReviewOrigin({ hostname: 'localhost', pathname: '/' })).toThrow();
    expect(reviewWrite).toThrow();
  });
  test('trading requires active online authoritative non-review state', () => {
    for (const online of [true, false]) for (const active of [true, false]) for (const authoritative of [true, false]) {
      expect(tradingAllowed({ online, active, authoritative, review: true })).toBe(false);
    }
    expect(tradingAllowed({ online: false, active: true, authoritative: true, review: false })).toBe(false);
  });
  test('mock launch confers no identity or account and invalid data rejects', async () => {
    expect(await mockTelegramLaunch('local-fixture-unverified')).toEqual({ status: 'review-only', verifiedIdentity: null, account: null });
    await expect(mockTelegramLaunch('forged')).rejects.toThrow();
  });
  test('installable metadata and branded icon sizes', () => {
    const manifest = JSON.parse(read('frontend/mobile-review/public/mobile/manifest.webmanifest'));
    expect(manifest).toMatchObject({ name: 'VOLTEX', short_name: 'VOLTEX', display: 'standalone', start_url: '/pwa' });
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['192x192', '512x512', '512x512']);
    const html = read('frontend/mobile-review.html');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('apple-mobile-web-app-capable');
    for (const file of ['frontend/index.html', 'frontend/src/main.tsx', 'frontend/vite.config.ts']) expect(read(file)).not.toContain('mobile-review');
  });
  test('worker never intercepts financial responses, writes or arbitrary static-looking paths', async () => {
    const handlers: Record<string, (event: any) => void> = {};
    const matched: string[] = [];
    const cached: string[][] = [];
    const self = { location: { hostname: 'localhost', origin: 'http://localhost' }, addEventListener: (name: string, fn: any) => { handlers[name] = fn; } };
    const caches = { open: async () => ({ addAll: async (items: string[]) => { cached.push(items); } }), match: async (key: string) => { matched.push(key); return 'static'; } };
    const source = read('frontend/mobile-review/sw.template.js').replace('__BUILD_VERSION__', 'test').replace('__STATIC_ASSETS__', '["/assets/app-hash.js"]');
    vm.runInNewContext(source, { self, caches, URL, fetch: async () => { throw new Error('offline'); } });
    let install: Promise<unknown> | undefined;
    handlers.install({ waitUntil: (promise: Promise<unknown>) => { install = promise; } }); await install;
    expect(cached[0].every(url => url.startsWith('/assets/') || url.startsWith('/mobile/'))).toBe(true);
    for (const path of ['/api/balances', '/api/positions', '/api/orders', '/api/pnl', '/api/margin', '/api/liquidation', '/wallet', '/private-trading', '/copy-trading', '/assets/account.json', '/assets/app-hash.js?account=1']) {
      const respondWith = jest.fn(); handlers.fetch({ request: { url: `http://localhost${path}`, method: 'GET', mode: 'cors' }, respondWith }); expect(respondWith).not.toHaveBeenCalled();
    }
    for (const method of ['POST', 'PUT', 'DELETE']) { const respondWith = jest.fn(); handlers.fetch({ request: { url: 'http://localhost/assets/app-hash.js', method }, respondWith }); expect(respondWith).not.toHaveBeenCalled(); }
    let response: Promise<unknown> | undefined;
    handlers.fetch({ request: { url: 'http://localhost/pwa', method: 'GET', mode: 'navigate' }, respondWith: (value: Promise<unknown>) => { response = value; } }); await response;
    expect(matched).toEqual(['/mobile/offline.html']);
    expect(handlers.message).toBeUndefined();
    expect(source).not.toMatch(/self\.skipWaiting\s*\(|clients\.claim\s*\(/);
    const addEventListener = jest.fn(); vm.runInNewContext(source, { self: { location: { hostname: 'voltextech.net' }, addEventListener } }); expect(addEventListener).not.toHaveBeenCalled();
  });
});
