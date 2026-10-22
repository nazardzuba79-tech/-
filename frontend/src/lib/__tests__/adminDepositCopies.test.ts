import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * Admin → Пополнения → «Копировали адрес»: read only when opened, refreshed
 * only by hand, never on a timer, never in place of the deposit queue, and a
 * failed read keeps what is on screen.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const flush = () => new Promise<void>((done) => setImmediate(done));
const modules = new Map<string, any>();
let dom: any, root: any, host: HTMLElement;
let copyCalls: string[];
let otherCalls: string[];
let copyResponse: (url: string) => Promise<any>;

function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8').replace(/import\.meta\.env/g, '({} as any)'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/depositCatalogue')) return { MANUAL_DEPOSIT_CATALOGUE: false };
    if (name.endsWith('/api')) return { API_BASE: '/api/v1', api: { getAllClients: async () => [] }, getToken: () => 'admin-token', onSessionChange: () => () => {}, ApiError: class extends Error {} };
    if (name.endsWith('/CryptoIcon')) return { CryptoIcon: () => null };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}

const queue = {
  asOf: new Date().toISOString(), minDepositUsd: 300,
  counts: { UNATTRIBUTED: 0, AWAITING_CONFIRMATIONS: 0, AWAITING_TOPUP: 0, READY: 0, NEEDS_REVIEW: 0, CREDITED: 0, IGNORED: 0, uncreditedTotal: 0, truncated: false },
  packageCounts: { AWAITING_TOPUP: 0, READY: 0, NEEDS_REVIEW: 0 }, packages: [], rows: [], creditedBatches: [],
  watcher: { chain: 'tron', enabled: false, running: false, lastRunStartedAt: null, lastRunFinishedAt: null, lastSuccessAt: null, lastRunOk: null, lastRunTrigger: null,
    lastScheduledRunAt: null, lastAdminOpenRunAt: null, nextScheduledRunAt: null, adminOpenDueToday: false, lastRunSummary: null, providerStatus: null, unverifiedOrUnfinalized: 0, cursors: [],
    policy: { timeZone: 'Europe/Kyiv', slots: ['12:00', '16:00', '20:00'], dayStart: '07:00', nightStart: '22:00', dedupeMinutes: 45, pageSize: 200, maxPagesPerRun: 10, overlapMinutes: 10, initialBackfillDays: 7 } },
};
const copyRow = (n: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, userId: '11111111-1111-4111-8111-111111111111',
  email: 'client@example.invalid', displayName: '<img src=x onerror=alert(1)>', asset: 'USDT', network: 'tron', networkName: 'TRON', standard: 'TRC-20',
  destinationId: 'tether:tron', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', memo: null, source: 'wallet',
  receivedAt: '2026-10-01T07:24:18.000Z', clientCopiedAt: null, ...over,
});
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, json: async () => body });

beforeEach(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/admin/deposits' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  copyCalls = []; otherCalls = [];
  copyResponse = () => json({ asOf: new Date().toISOString(), items: [copyRow(1)], nextCursor: null });
  (globalThis as any).fetch = jest.fn((url: string) => {
    if (url.includes('/admin/deposit-address-copies')) { copyCalls.push(url); return copyResponse(url); }
    otherCalls.push(url);
    if (url.includes('/admin/deposit-queue')) return json(queue);
    if (url.includes('/admin/deposit-watch/open')) return json({ ran: false });
    return json({});
  });
  modules.clear();
  host = document.getElementById('root')!;
  root = req('react-dom/client').createRoot(host);
  const { AdminDepositsPage } = load(resolve(frontend, 'src/pages/admin/AdminDepositsPage'));
  const { MemoryRouter } = req('react-router-dom');
  await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(AdminDepositsPage))); await flush(); });
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); });

const click = async (selector: string) => { await act(async () => { (host.querySelector(selector) as HTMLElement).click(); await flush(); await flush(); }); };

test('opening Пополнения does not read the journal; the first open of the section reads one page', async () => {
  expect(copyCalls).toHaveLength(0);
  expect(host.querySelector('[data-deposit-copies]')).toBeNull();
  await click('[data-deposit-view="copies"]');
  expect(copyCalls).toEqual(['/api/v1/admin/deposit-address-copies']);
  expect(host.textContent).toContain('Копирование адреса не подтверждает оплату. Сверяйте поступление перед зачислением.');
  expect(host.textContent).toContain('Время — Киев');
  // Kyiv is UTC+3 on 1 October (summer time): 07:24:18Z → 10:24:18.
  expect(host.querySelector('[data-copy-received]')!.textContent).toBe('01.10.2026, 10:24:18');
  expect(host.querySelector('[data-copy-window]')!.textContent).toBe('Окно сверки: 10:24–11:24');
  expect(host.querySelector('[data-copy-network]')!.textContent).toBe('TRON · TRC-20');
  expect(host.querySelector('[data-copy-address]')!.textContent).toBe('TR7NHq…gjLj6t');
  // Account text is printed, never interpreted.
  expect(host.querySelector('img')).toBeNull();
  expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(host.querySelector('a[href="/admin/users/11111111-1111-4111-8111-111111111111"]')!.textContent).toBe('Открыть пользователя');
});

test('back and forth between the sections reads nothing more; «Обновить» reads once', async () => {
  await click('[data-deposit-view="copies"]');
  await click('[data-deposit-view="queue"]');
  await click('[data-deposit-view="copies"]');
  expect(copyCalls).toHaveLength(1);
  expect(host.querySelector('[data-copies-meta]')!.textContent).toMatch(/Загружено в \d\d:\d\d:\d\d/);
  await click('[data-copies-refresh]');
  expect(copyCalls).toHaveLength(2);
});

test('the open journal schedules no reads of its own', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  await click('[data-deposit-view="copies"]');
  await act(async () => { jest.advanceTimersByTime(12 * 60 * 60_000); await flush(); });
  expect(copyCalls).toHaveLength(1);
});

test('a failed refresh keeps the list and says so', async () => {
  await click('[data-deposit-view="copies"]');
  copyResponse = () => json({ error: 'down' }, 503);
  await click('[data-copies-refresh]');
  expect(host.querySelectorAll('[data-copy-row]')).toHaveLength(1);
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('Показан последний загруженный список');
  expect(host.querySelector('[data-copies-empty]')).toBeNull();
});

test('filters and pages go to the server; a delayed note says its window is approximate', async () => {
  copyResponse = (url) => json({
    asOf: new Date().toISOString(),
    items: url.includes('before=') ? [copyRow(2)] : [copyRow(1, { clientCopiedAt: '2026-10-01T07:10:00.000Z' })],
    nextCursor: url.includes('before=') ? null : 'Y3Vyc29y',
  });
  await click('[data-deposit-view="copies"]');
  expect(host.querySelector('[data-copy-delayed]')!.textContent).toContain('Доставлено с задержкой');
  expect(host.querySelector('[data-copy-window]')!.textContent).toBe('Окно сверки (примерно): 10:24–11:24');
  expect(host.textContent).toContain('Копирование по времени устройства: 01.10.2026, 10:10:00');
  await click('[data-copies-older]');
  expect(copyCalls[1]).toBe('/api/v1/admin/deposit-address-copies?before=Y3Vyc29y');
  await click('[data-copies-newer]');
  expect(copyCalls[2]).toBe('/api/v1/admin/deposit-address-copies');

  const input = (name: string, value: string) => {
    const el = host.querySelector(`[data-copies-filter="${name}"]`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  await act(async () => { input('user', 'client@'); input('asset', 'usdt'); await flush(); });
  await act(async () => { (host.querySelector('.deposit-copies-filters') as HTMLFormElement).requestSubmit(); await flush(); await flush(); });
  expect(copyCalls[3]).toBe('/api/v1/admin/deposit-address-copies?user=client%40&asset=USDT');
});

test('«Очередь поступлений» returns to the existing queue without any credit call', async () => {
  await click('[data-deposit-view="copies"]');
  const before = otherCalls.length;
  await act(async () => { (Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Очередь поступлений') as HTMLElement).click(); await flush(); });
  expect(host.querySelector('[data-deposit-view="queue"]')!.getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('[data-deposit-tab="unattributed"]')!.getAttribute('aria-selected')).toBe('true');
  expect(otherCalls.slice(before).filter((u) => /confirm|attribute|credit/.test(u))).toEqual([]);
});
