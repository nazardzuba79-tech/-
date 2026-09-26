import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
let dom: any, root: any, host: HTMLElement, api: any, wallets: any[], token: string | null;
const flush = () => new Promise<void>(done => setImmediate(done));
const modules = new Map<string, any>();
function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/api')) return { api, getToken: () => token, ApiError: class extends Error {} };
    if (name.endsWith('/useAdminAlerts')) return { useAdminAlertSound: () => {}, isAdminAlertSoundEnabled: () => false, setAdminAlertSoundEnabled: jest.fn() };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  host = document.getElementById('root')!;
  root = req('react-dom/client').createRoot(host);
  wallets = [{ chain: 'ethereum', nativeAsset: 'ETH', nativeDepositsSupported: true, tokens: ['USDT'], address: '0x' + 'a'.repeat(40), defaultAddress: '0x' + 'b'.repeat(40), isOverridden: true, envConfigured: true, updatedAt: null, updatedByAdminId: 'admin-1' }];
  token = 'test-only';
  api = { getAdminWallets: jest.fn(async () => wallets), setAdminWalletAddress: jest.fn(async (chain, address) => { wallets = wallets.map(w => w.chain === chain ? { ...w, address } : w); }), resetAdminWallet: jest.fn(async chain => { wallets = wallets.map(w => w.chain === chain ? { ...w, address: w.defaultAddress, isOverridden: false } : w); }), getMe: jest.fn(async () => ({ isAdmin: true, email: 'qa@example.invalid' })) };
  modules.clear();
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); });
async function mountWallets() { const { AdminWalletsPage } = load(resolve(frontend, 'src/pages/admin/AdminWalletsPage')); await act(async () => { root.render(React.createElement(AdminWalletsPage)); await flush(); }); }
async function mountDeposits() {
  const { AdminDepositsPage } = load(resolve(frontend, 'src/pages/admin/AdminDepositsPage'));
  const { MemoryRouter } = req('react-router-dom');
  await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(AdminDepositsPage))); await flush(); });
}

const row = (id: string, amount: string, state: string, extra: any = {}) => ({ id, userId: 'u1', userEmail: 'user@example.invalid', chain: 'tron', asset: 'USDT',
  txHash: id.padEnd(64, 'f'), amount, confirmations: 25, minConfirmations: 19, finalized: true, verified: true, networkConfirmed: true, verifyError: null,
  recipientAddress: 'T', blockTimestamp: null, firstDetectedAt: new Date().toISOString(), creditedAt: null, batchId: null, revision: 1, source: 'watcher', state, claims: [], ...extra });
const pkgView = (userId: string, parts: string[], total: string, state: string, remaining: string | null) => ({
  key: `${userId}|tron|USDT`, userId, userEmail: `${userId}@example.invalid`, chain: 'tron', asset: 'USDT', transfers: parts.map((a, i) => row(`${userId}-${i}`, a, state, { userId })),
  total, unconfirmedTotal: '0', unconfirmedCount: 0, minDepositUsd: 300, usdValue: total, usdPolicy: 'USD_PEGGED_POLICY', priceUsd: '1', pricedAt: null,
  minimumReached: state === 'READY', remaining, remainingUsd: remaining, state, reviewReason: null, token: 'b'.repeat(64) });
function queue(watcher: any = {}) {
  return {
    asOf: new Date().toISOString(), minDepositUsd: 300,
    counts: { UNATTRIBUTED: 1, AWAITING_CONFIRMATIONS: 0, AWAITING_TOPUP: 2, READY: 2, NEEDS_REVIEW: 0, CREDITED: 0, uncreditedTotal: 5, truncated: false },
    packages: [pkgView('topup', ['15', '20'], '35', 'AWAITING_TOPUP', '265'), pkgView('ready', ['15', '285'], '300', 'READY', '0')],
    rows: [row('free', '400', 'UNATTRIBUTED', { userId: null, userEmail: null, claims: [{ userId: 'c1', email: 'claimer@example.invalid', at: new Date().toISOString() }] })],
    watcher: { chain: 'tron', enabled: false, running: false, lastRunStartedAt: null, lastRunFinishedAt: null, lastSuccessAt: null, lastRunOk: null, lastRunTrigger: null,
      lastScheduledRunAt: null, lastAdminOpenRunAt: null, nextScheduledRunAt: null, adminOpenDueToday: false, lastRunSummary: null, providerStatus: null, unverifiedOrUnfinalized: 0, cursors: [],
      policy: { timeZone: 'Europe/Kyiv', slots: ['12:00', '16:00', '20:00'], dayStart: '07:00', nightStart: '22:00', dedupeMinutes: 45, pageSize: 200, maxPagesPerRun: 10, overlapMinutes: 10, initialBackfillDays: 7 }, ...watcher },
  };
}
let fetchMock: jest.Mock;
function mockDepositApi(q: any) {
  fetchMock = jest.fn(async (url: string, init: any = {}) => {
    const path = String(url);
    const ok = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(body) });
    if (path.endsWith('/admin/deposit-queue')) return ok(q);
    if (path.includes('/admin/deposit-packages/preview')) return ok({ ...q.packages[1], balanceAvailable: '0', balanceAfter: '300' });
    if (path.endsWith('/admin/deposit-packages/confirm')) return ok({ status: 'CREDITED', batchId: 'b', totalAmount: '300', asset: 'USDT', depositIds: [], replayed: false });
    if (path.endsWith('/admin/deposit-watch/open')) return ok({ ran: false, ok: true, skipped: 'NOT_DUE', notDueReason: 'ALREADY_TODAY', newTransfers: 0, error: null });
    return ok({ error: `unexpected ${path} ${init.method}` }, 404);
  });
  (globalThis as any).fetch = fetchMock;
  Object.assign(api, {
    getAllClients: jest.fn(async () => [{ id: 'u1', email: 'user@example.invalid' }]),
    getAdminDeposits: jest.fn(async () => { throw new Error('the page must not download deposit history'); }),
    creditDepositManually: jest.fn(async () => { throw new Error('the closed one-transfer credit must never be called'); }),
    getAdminIncomingDepositFeed: jest.fn(async () => ({ transfers: [], failedChains: [], configuredChains: [] })),
  });
}
const fetched = (suffix: string) => fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes(suffix));

test('accumulation cards: 15 + 20 awaits a top-up of 265 with crediting unavailable; a 300 package offers «Проверить и зачислить»', async () => {
  mockDepositApi(queue());
  await mountDeposits();
  await click('Ожидают доплаты1');
  const card = host.querySelector('[data-package="topup|tron|USDT"]')!;
  for (const text of ['topup@example.invalid', 'USDT / TRC20', '15 + 20 USDT', '35 USDT', '300 USD', '265 USDT', 'Ожидает доплаты', 'недоступно']) expect(card.textContent).toContain(text);
  expect(card.querySelector('button')).toBeNull();
  await click('Готовы к проверке1');
  const ready = host.querySelector('[data-package="ready|tron|USDT"]')!;
  expect(ready.textContent).toContain('300 USDT');
  expect(ready.textContent).toContain('Готов к проверке');
  await act(async () => { (ready.querySelector('[data-open-package]') as HTMLElement).click(); await flush(); await flush(); });
  expect(host.querySelector('[data-credit-drawer]')).not.toBeNull();
  expect(fetched('/confirm')).toHaveLength(0);
  await act(async () => { (host.querySelector('[data-confirm-credit]') as HTMLElement).click(); await flush(); await flush(); });
  expect(fetched('/confirm')).toHaveLength(1);
  expect(JSON.parse(fetched('/confirm')[0][1].body).amount).toBeUndefined();
  expect(api.creditDepositManually).not.toHaveBeenCalled();
});

test('opening the page reads the stored queue and asks the server for the day\'s first scan once (server-gated); no manual scan, no history; hidden tab never polls', async () => {
  mockDepositApi(queue());
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  let visibility = 'visible';
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, get: () => visibility });
  try {
    await mountDeposits();
    expect(fetched('/admin/deposit-queue')).toHaveLength(1);
    // One admin-open trigger per page open; the server runs it only once per Kyiv day after 07:00.
    expect(fetched('/deposit-watch/open')).toHaveLength(1);
    expect(fetched('/deposit-watch/open')[0][1].method).toBe('POST');
    expect(api.getAdminIncomingDepositFeed).not.toHaveBeenCalled();
    expect(fetched('/deposit-watch/run')).toHaveLength(0);
    expect(api.getAdminDeposits).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(60_000); await flush(); await flush(); });
    expect(fetched('/admin/deposit-queue')).toHaveLength(2);
    visibility = 'hidden';
    await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); await flush(); });
    await act(async () => { jest.advanceTimersByTime(60 * 60_000); await flush(); });
    expect(fetched('/admin/deposit-queue')).toHaveLength(2);
    expect(fetched('/deposit-watch/run')).toHaveLength(0);
    expect(fetched('/deposit-watch/open')).toHaveLength(1);
    await click('Проверить ленты других сетей');
    expect(api.getAdminIncomingDepositFeed).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('provider trouble is never shown as "no deposits": partial feed and watcher errors are explicit', async () => {
  mockDepositApi(queue({ enabled: true, providerStatus: 'UNAVAILABLE', lastRunSummary: { error: 'TronGrid API responded with HTTP 503' },
    cursors: [{ address: 'T', asset: 'USDT', scannedThrough: new Date(Date.now() - 3 * 3600_000).toISOString(), lagMs: 3 * 3600_000, windowInProgress: true, windowStart: null, windowEnd: null, lastError: 'HTTP 503', lastErrorAt: null }] }));
  api.getAdminIncomingDepositFeed = jest.fn(async () => ({ transfers: [], failedChains: ['ethereum'], configuredChains: ['ethereum'] }));
  await mountDeposits();
  const watcher = host.querySelector('[data-watcher]')!;
  expect(watcher.textContent).toContain('Провайдер недоступен');
  expect(watcher.textContent).toContain('Автоматически: при первом открытии после 07:00, в 12:00, 16:00, 20:00 (Киев)');
  expect(watcher.textContent).toContain('Ночью 22:00–07:00 автоматическая проверка не выполняется');
  expect(watcher.textContent).toContain('есть очередь');
  expect(watcher.querySelector('[role="alert"]')!.textContent).toContain('HTTP 503');
  expect(watcher.textContent).toContain('Проверить новые поступления');
  await click('Проверить ленты других сетей');
  expect(host.textContent).toContain('загружены не полностью');
  expect(host.textContent).toContain('Это не значит, что переводов нет');
  // Unattributed transfers stay visible, with the client's claim as a hint only.
  await click('Непривязанные1');
  expect(host.querySelector('[data-deposit-section="unattributed"]')!.textContent).toContain('claimer@example.invalid');
});
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!;
  expect(button).toBeDefined();
  await act(async () => { button.click(); await flush(); });
}
async function changeAddress(value: string) {
  await act(async () => {
    const input = host.querySelector('dialog input')!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await flush();
  });
}
test('table has both rails sharing an address, editor gives scope, confirmation precedes chain save', async () => {
  await mountWallets();
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.querySelectorAll('tbody input')).toHaveLength(0);
  expect(host.querySelector('thead')!.textContent).not.toContain('Источник');
  expect(host.querySelector('tbody')!.textContent).toContain(wallets[0].address);
  await act(async () => { (host.querySelector('button[aria-label="Изменить USDT · Ethereum (ERC-20)"]') as HTMLButtonElement).click(); });
  expect(host.querySelector('dialog')!.textContent).toContain('ETH · Ethereum (Native)');
  expect(host.querySelector('dialog')!.textContent).toContain('USDT · Ethereum (ERC-20)');
  expect(host.querySelector('dialog')!.textContent).toContain('Network treasury address');
  await changeAddress('0x' + 'c'.repeat(40));
  await click('Сохранить адрес');
  expect(api.setAdminWalletAddress).not.toHaveBeenCalled();
  expect(host.querySelector('dialog')!.textContent).toContain('0x' + 'a'.repeat(40));
  expect(host.querySelector('dialog')!.textContent).toContain('0x' + 'c'.repeat(40));
  await click('Подтвердить');
  expect(api.setAdminWalletAddress).toHaveBeenCalledTimes(1);
  expect(api.setAdminWalletAddress).toHaveBeenCalledWith('ethereum', '0x' + 'c'.repeat(40));
  expect(host.querySelector('dialog')).toBeNull();
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
});
test('reset confirmation shows real default and calls the same network endpoint only after confirmation', async () => {
  await mountWallets(); await click('Изменить'); await click('Сбросить к умолчанию');
  expect(api.resetAdminWallet).not.toHaveBeenCalled();
  expect(host.querySelector('dialog')!.textContent).toContain(wallets[0].defaultAddress);
  await click('Подтвердить');
  expect(api.resetAdminWallet).toHaveBeenCalledWith('ethereum');
  expect(host.querySelector('tbody')!.textContent).toContain(wallets[0].defaultAddress);
});
test('save failure keeps editor and exposes retry, cancelled editing never mutates', async () => {
  api.setAdminWalletAddress.mockRejectedValue(new Error('failed'));
  await mountWallets(); await click('Изменить'); await changeAddress('new-public-address'); await click('Сохранить адрес'); await click('Подтвердить');
  expect(host.querySelector('dialog [role="alert"]')).not.toBeNull();
  await act(async () => { (host.querySelector('button[aria-label="Закрыть"]') as HTMLButtonElement).click(); });
  expect(api.resetAdminWallet).not.toHaveBeenCalled();
});
test.each([false, true])('real AdminLayout gate allows only administrator=%s', async allowed => {
  api.getMe.mockResolvedValue({ isAdmin: allowed, email: 'qa@example.invalid' });
  const { AdminLayout } = load(resolve(frontend, 'src/pages/admin/AdminLayout'));
  const { MemoryRouter, Routes, Route } = req('react-router-dom');
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin'] }, React.createElement(Routes, null,
      React.createElement(Route, { path: '/', element: React.createElement('p', null, 'Public home') }),
      React.createElement(Route, { path: '/admin', element: React.createElement(AdminLayout) }, React.createElement(Route, { index: true, element: React.createElement('p', null, 'Private overview') }))
    ))); await flush();
  });
  expect(host.textContent!.includes('Private overview')).toBe(allowed);
  expect(host.textContent!.includes('Public home')).toBe(!allowed);
  expect(host.querySelector('[href="/admin/products"]')).toBeNull();
});

/* The console has no overview page any more: /admin opens Пользователи
   directly, and AdminOverviewPage.tsx is deleted. The tests that drove it
   went with it — the data it showed (newest users, incoming deposits,
   pending KYC) is covered on the pages that own it. */

