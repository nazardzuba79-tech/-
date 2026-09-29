import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * Admin → Пользователи as a work queue: new registrations and deposit
 * PACKAGES (one user, one asset, one network) on one page. Only a package
 * that reached the minimum offers «Проверить и зачислить», which opens the
 * package confirmation (preview → confirm, one idempotency key, no amount
 * sent). One compact activity read on a visible-only cadence. The real page
 * renders in JSDOM; only `api` and `fetch` are stand-ins.
 */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const flush = () => new Promise<void>(done => setImmediate(done));
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let dom: any, root: any, host: HTMLElement, api: any, fetchMock: jest.Mock, visibility: 'visible' | 'hidden', activity: any, users: any[], confirmGate: Promise<void> | null;
const modules = new Map<string, any>();
class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/adminReadApi')) return {
      getAdminGateMe: (signal?: AbortSignal) => api.getMe?.(signal),
      getAdminUsersAbortable: (signal?: AbortSignal) => api.getAdminUsers(undefined, signal),
    };
    if (name.endsWith('/lib/api') || name === './api') return { api, getToken: () => 'test-only', onSessionChange: () => () => {}, ApiError, API_BASE: '/api/v1' };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}

const user = (id: string, email: string, createdMsAgo: number, extra: any = {}) => ({
  id, email, role: 'USER', isAdmin: false, kycStatus: 'NOT_STARTED', createdAt: iso(createdMsAgo), registrationIp: null,
  lastLoginAt: null, isBlocked: false, blockedAt: null, blockedReason: null, balances: [], ...extra,
});
const pkg = (userId: string, total: string, state: string, msAgo: number, extra: any = {}) => ({
  key: `${userId}|tron|USDT`, userId, chain: 'tron', asset: 'USDT', state, total, transferCount: 1, unconfirmedTotal: '0', unconfirmedCount: 0,
  remaining: state === 'READY' ? '0' : String(300 - Number(total)), remainingUsd: null, minimumReached: state === 'READY', latestAt: iso(msAgo), ...extra,
});
const preview = (userId: string, total: string, available: string, ready = true) => ({
  ...pkg(userId, total, ready ? 'READY' : 'AWAITING_TOPUP', 0), userEmail: `${userId}@example.invalid`, minDepositUsd: 300, usdValue: total,
  usdPolicy: 'USD_PEGGED_POLICY', priceUsd: '1', pricedAt: null, reviewReason: null, token: 'a'.repeat(64),
  transfers: [{ id: `${userId}-t1`, txHash: 'f'.repeat(64), amount: total, confirmations: 30, minConfirmations: 19, finalized: true, state: ready ? 'READY' : 'AWAITING_TOPUP' }],
  balanceAvailable: available, balanceAfter: String(Number(available) + Number(total)),
});
const json = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(body) });

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin/users' });
  visibility = 'visible';
  confirmGate = null;
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => visibility === 'hidden' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  host = document.getElementById('root')!;
  root = req('react-dom/client').createRoot(host);
  users = [
    user('old', 'old@example.invalid', 30 * 24 * HOUR, { balances: [{ asset: 'USDT', available: '10', locked: '0' }] }),
    user('fresh', 'fresh@example.invalid', 2 * HOUR, { password: 'FixturePassword123' }),
    user('payer', 'payer@example.invalid', 40 * 24 * HOUR, { balances: [{ asset: 'USDT', available: '100.5', locked: '0' }] }),
    user('both', 'both@example.invalid', 1 * HOUR),
    user('kyc', 'kyc@example.invalid', 50 * 24 * HOUR, { kycStatus: 'PENDING' }),
  ];
  activity = {
    asOf: new Date().toISOString(), totalUsers: 5, newUsers24h: 2, pendingKyc: 1, minDepositUsd: 300,
    counts: { UNATTRIBUTED: 3, AWAITING_CONFIRMATIONS: 0, AWAITING_TOPUP: 1, READY: 1, NEEDS_REVIEW: 0 },
    packages: [pkg('payer', '2500', 'READY', 3 * HOUR), pkg('both', '35', 'AWAITING_TOPUP', 0.5 * HOUR)],
    awaitingConfirmationsByUser: {},
  };
  fetchMock = jest.fn(async (url: string, init: any = {}) => {
    const path = String(url);
    if (path.endsWith('/admin/user-activity')) return json(activity);
    if (path.includes('/admin/deposit-packages/preview')) return json(preview('payer', '2500', '100.5'));
    if (path.endsWith('/admin/deposit-packages/confirm')) {
      if (confirmGate) await confirmGate;
      activity.packages = activity.packages.filter((p: any) => p.userId !== 'payer');
      return json({ status: 'CREDITED', batchId: 'b1', totalAmount: '2500', asset: 'USDT', depositIds: ['payer-t1'], replayed: false });
    }
    return json({ error: `unexpected ${path} ${init.method ?? 'GET'}` }, 404);
  });
  (globalThis as any).fetch = fetchMock;
  api = {
    getAdminUsers: jest.fn(async () => structuredClone(users)),
    getAdminRecentDepositsByUser: jest.fn(async () => []),
    getAdminDeposits: jest.fn(async () => { throw new Error('the Users page must never read deposit history'); }),
    creditDepositManually: jest.fn(async () => { throw new Error('the closed one-transfer credit must never be called'); }),
    blockUser: jest.fn(), unblockUser: jest.fn(),
  };
  modules.clear();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); dom.window.close(); });

async function mount() {
  const { AdminUsersPage } = load(resolve(frontend, 'src/pages/admin/AdminUsersPage'));
  const { MemoryRouter } = req('react-router-dom');
  await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(AdminUsersPage))); await flush(); await flush(); });
}
const rows = () => Array.from(host.querySelectorAll('[data-user-row]')).map(r => r.getAttribute('data-user-row'));
const events = (id: string) => Array.from(host.querySelectorAll(`[data-user-card="${id}"] [data-event]`)).map(e => e.getAttribute('data-event'));
async function click(el: Element | null) { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); await flush(); await flush(); }); }
const calls = (suffix: string) => fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes(suffix));
const activityCalls = () => calls('/admin/user-activity').length;

test('1. a package ready for review comes first, then one awaiting a top-up, then new registrations, then everyone else', async () => {
  await mount();
  expect(rows()).toEqual(['payer', 'both', 'fresh', 'old', 'kyc']);
});

test('2–3. badges distinguish «готов к проверке» from «ожидает доплаты»; new registrations keep НОВЫЙ', async () => {
  await mount();
  expect(events('fresh')).toEqual(['new']);
  expect(events('both')).toEqual(['new', 'deposit']);
  expect(events('payer')).toEqual(['deposit']);
  expect(events('old')).toEqual([]);
  const payer = host.querySelector('[data-user-card="payer"] [data-event="deposit"]')!;
  expect(payer.getAttribute('data-package-state')).toBe('READY');
  expect(payer.textContent).toContain('ГОТОВ К ПРОВЕРКЕ');
  expect(payer.textContent).toContain('2500 USDT');
  const both = host.querySelector('[data-user-card="both"] [data-event="deposit"]')!;
  expect(both.getAttribute('data-package-state')).toBe('AWAITING_TOPUP');
  expect(both.textContent).toContain('ОЖИДАЕТ ДОПЛАТЫ');
  expect(both.textContent).toContain('35 / 300 USDT');
  expect(host.querySelector('[data-user-row="both"]')!.getAttribute('data-row-tint')).toBe('deposit');
  expect(host.querySelector('[data-user-row="fresh"]')!.getAttribute('data-row-tint')).toBe('new');
  // Desktop replaces Событие with the password; mobile badges and deposit actions remain.
  expect(host.querySelector('[data-user-row="fresh"] .admin-user-email [data-event="new"]')!.textContent).toBe('НОВЫЙ');
  expect(host.querySelector('[data-user-row="fresh"] [data-user-password]')!.textContent).toBe('FixturePassword123');
  expect(host.querySelector('[data-user-row="old"] [data-user-password]')!.textContent).toBe('—');
  expect(host.querySelector('[data-user-row="both"] [data-event="deposit"]')).toBeNull();
  expect(host.textContent).toContain('Пароль');
});

test('the page has no «Обновить» button (the browser reload does it)', async () => {
  await mount();
  expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Обновить')).toBe(false);
});

test('4. only a READY package offers the action; tabs keep counts; cards show ready totals and unattributed count', async () => {
  await mount();
  expect(host.querySelector('[data-credit-user="payer"]')!.textContent).toBe('Проверить и зачислить');
  expect(host.querySelector('[data-credit-user="both"]')).toBeNull();
  const tab = (k: string) => host.querySelector(`[data-user-tab="${k}"]`)!;
  expect(tab('new').textContent).toBe('Новые2');
  expect(tab('deposits').textContent).toBe('Пополнения2');
  expect(tab('kyc').textContent).toBe('KYC1');
  await click(tab('deposits'));
  expect(rows()).toEqual(['payer', 'both']);
  expect(host.textContent).toContain('Готовы к проверке');
  expect(host.textContent).toContain('2500 USDT');
  expect(host.textContent).toContain('непривязанных: 3');
  expect(host.querySelector('[data-unattributed-link]')!.textContent).toContain('3');
});

test('5–6. hourly activity: no hidden timers or fresh-return reads', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  await mount();
  expect(activityCalls()).toBe(1);
  await act(async () => { jest.advanceTimersByTime(HOUR); await flush(); await flush(); });
  expect(activityCalls()).toBe(2);
  visibility = 'hidden';
  await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); await flush(); });
  await act(async () => { jest.advanceTimersByTime(10 * 60_000); await flush(); });
  expect(activityCalls()).toBe(2);
  expect(jest.getTimerCount()).toBe(0);
  visibility = 'visible';
  await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); await flush(); await flush(); });
  expect(activityCalls()).toBe(2);
  expect(api.getAdminUsers).toHaveBeenCalledTimes(1);
  expect(api.getAdminDeposits).not.toHaveBeenCalled();
});

test('7. «Проверить и зачислить» opens the package preview from the server; Cancel sends nothing', async () => {
  await mount();
  await click(host.querySelector('[data-credit-user="payer"]'));
  const drawer = host.querySelector('[data-credit-drawer="payer|tron|USDT"]')!;
  expect(drawer).not.toBeNull();
  for (const text of ['payer@example.invalid', 'USDT / TRC20', '2500 USDT', 'Минимум достигнут', '100.5', '2600.5']) expect(drawer.textContent).toContain(text);
  expect(calls('/confirm')).toHaveLength(0);
  await click(host.querySelector('[data-cancel-credit]'));
  expect(host.querySelector('[data-credit-drawer]')).toBeNull();
  expect(calls('/confirm')).toHaveLength(0);
  expect(api.creditDepositManually).not.toHaveBeenCalled();
});

test('8. confirm sends the reviewed package once — ids, fingerprint, idempotency key, no amount — and the package leaves the queue', async () => {
  let release!: () => void;
  confirmGate = new Promise<void>(r => { release = r; });
  await mount();
  await click(host.querySelector('[data-credit-user="payer"]'));
  const confirm = host.querySelector('[data-confirm-credit]') as HTMLButtonElement;
  await act(async () => { confirm.click(); confirm.click(); await flush(); });
  expect(calls('/confirm')).toHaveLength(1);
  const body = JSON.parse(calls('/confirm')[0][1].body);
  expect(Object.keys(body).sort()).toEqual(['asset', 'chain', 'depositIds', 'idempotencyKey', 'token', 'userId']);
  expect(body).toMatchObject({ userId: 'payer', chain: 'tron', asset: 'USDT', depositIds: ['payer-t1'], token: 'a'.repeat(64) });
  expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await act(async () => { release(); await flush(); await flush(); await flush(); });
  expect(host.querySelector('[data-credit-drawer]')).toBeNull();
  expect(events('payer')).toEqual([]);
  expect(host.querySelector('[data-user-tab="deposits"]')!.textContent).toBe('Пополнения1');
  expect(activityCalls()).toBe(2);
  expect(api.getAdminUsers).toHaveBeenCalledTimes(2);
});

test('8b. below the minimum the confirmation button is disabled and nothing can be sent', async () => {
  fetchMock.mockImplementation(async (url: string) => String(url).endsWith('/admin/user-activity') ? json(activity)
    : String(url).includes('/preview') ? json(preview('payer', '299.999999', '0', false)) : json({ error: 'refused', code: 'BELOW_MINIMUM' }, 409));
  await mount();
  await click(host.querySelector('[data-credit-user="payer"]'));
  const confirm = host.querySelector('[data-confirm-credit]') as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(host.querySelector('[data-package-minimum]')!.getAttribute('data-package-minimum')).toBe('no');
  await act(async () => { confirm.click(); await flush(); });
  expect(calls('/confirm')).toHaveLength(0);
});

test('9. the page never uses the closed one-transfer credit or builds an amount', () => {
  const code = (f: string) => readFileSync(resolve(frontend, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const page = code('src/pages/admin/AdminUsersPage.tsx');
  const drawer = code('src/pages/admin/CreditDepositDrawer.tsx');
  const client = code('src/pages/admin/adminUserActivity.ts');
  expect(drawer).toContain('adminDepositApi.confirm({');
  for (const source of [page, drawer, client]) {
    expect(source).not.toMatch(/adjustUserBalance|manual-credit|creditDepositManually/);
    expect(source).not.toContain('getAdminDeposits(');
  }
  // The confirmation request names the package; it never carries an amount.
  expect(drawer).not.toMatch(/amount:\s/);
  expect(page).toContain('getAdminRecentDepositsByUser()');
  expect(page + client).not.toContain('setInterval');
  expect(client).toContain('/admin/user-activity');
});

test('10. last-login sorting, search and KYC work with tabs; never-logged-in users stay last', async () => {
  users[0].isBlocked = true;
  users[0].lastLoginAt = iso(HOUR);
  users[2].lastLoginAt = iso(3 * HOUR);
  users[4].lastLoginAt = iso(2 * HOUR);
  await mount();
  const input = host.querySelector('input[aria-label="Поиск пользователей"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setValue.call(input, 'pay'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush(); });
  expect(rows()).toEqual(['payer']);
  await act(async () => { setValue.call(input, ''); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush(); });
  const select = host.querySelector('select[aria-label="Фильтр пользователей"]') as HTMLSelectElement;
  const setSelect = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!;
  expect(select.querySelector('option[value="blocked"]')).toBeNull();
  await act(async () => { setSelect.call(select, 'lastLogin'); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await flush(); });
  expect(rows()).toEqual(['old', 'kyc', 'payer', 'fresh', 'both']);
  await click(host.querySelector('[data-user-tab="new"]'));
  expect(rows()).toEqual(['fresh', 'both']);
  await click(host.querySelector('[data-user-tab="all"]'));
  await act(async () => { setSelect.call(select, 'PENDING'); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await flush(); });
  expect(rows()).toEqual(['kyc']);
});

test('11. admin accounts and their packages never render as customers, even in a stale response', async () => {
  users.push(user('service', 'service@example.invalid', HOUR, { role: 'ADMIN', isAdmin: true, kycStatus: 'PENDING', lastLoginAt: iso(0) }));
  users.push(user('legacy-service', 'legacy@example.invalid', HOUR, { isAdmin: true }));
  activity.packages.push(pkg('service', '9999', 'READY', 0));
  await mount();
  expect(rows()).not.toContain('service');
  expect(rows()).not.toContain('legacy-service');
  expect(host.textContent).not.toContain('service@example.invalid');
  expect(host.textContent).not.toContain('9999');
  expect(host.querySelector('[data-user-tab="new"]')!.textContent).toBe('Новые2');
  expect(host.querySelector('[data-user-tab="kyc"]')!.textContent).toBe('KYC1');
  await click(host.querySelector('[data-user-tab="deposits"]'));
  expect(rows()).toEqual(['payer', 'both']);
  await click(host.querySelector('[data-user-tab="kyc"]'));
  expect(rows()).toEqual(['kyc']);
  await click(host.querySelector('[data-user-tab="all"]'));
  const input = host.querySelector('input[aria-label="Поиск пользователей"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setValue.call(input, 'service'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush(); });
  expect(rows()).toEqual([]);
});

test('12. customer-only pagination and last-login sorting span pages without an admin slot', async () => {
  users = Array.from({ length: 21 }, (_, i) => user(`customer-${i}`, `customer-${i}@example.invalid`, 30 * 24 * HOUR, { lastLoginAt: iso(i * HOUR) }));
  users.unshift(user('service', 'service@example.invalid', HOUR, { role: 'ADMIN', isAdmin: true, lastLoginAt: iso(0) }));
  activity.packages = [];
  await mount();
  const select = host.querySelector('select[aria-label="Фильтр пользователей"]') as HTMLSelectElement;
  const setSelect = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => { setSelect.call(select, 'lastLogin'); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await flush(); });
  expect(rows()).toEqual(Array.from({ length: 20 }, (_, i) => `customer-${i}`));
  expect(host.textContent).toContain('1–20 из 21');
  await click(Array.from(host.querySelectorAll('.admin-pagination-top button')).find((button) => button.textContent === '2') ?? null);
  expect(rows()).toEqual(['customer-20']);
  expect(host.textContent).toContain('21–21 из 21');
});

/* Failure states of the activity read. Unknown deposit numbers are shown as
   unknown («—», «…», «Не удалось загрузить»), never as 0 or «нет пополнений»,
   and a failure after a good read keeps that read on screen. */
const activityCalls2 = () => fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes('/admin/user-activity')).length;

test('13. first activity read fails (503): «Загрузка…» ends, numbers stay unknown, retry recovers with one request', async () => {
  const good = activity;
  activity = null;
  fetchMock.mockImplementation(async (url: string) => String(url).endsWith('/admin/user-activity') && !activity ? json({ error: 'unavailable' }, 503) : json(good));
  await mount();
  const alert = host.querySelector('[data-activity-error]')!;
  expect(alert.getAttribute('data-activity-error')).toBe('empty');
  expect(host.textContent).not.toContain('Загрузка…');
  expect(host.textContent).toContain('Не удалось загрузить');
  expect(host.textContent).not.toContain('Нет пополнений в очереди');
  expect(host.querySelector('[data-user-tab="deposits"]')!.textContent).toBe('Пополнения');
  expect(host.querySelector('[data-user-card="payer"] [data-event-unknown]')).not.toBeNull();
  expect(host.textContent).toMatch(/Готовы к проверке\s*—/);
  activity = good;
  const before = activityCalls2();
  await click(host.querySelector('[data-activity-retry]'));
  expect(activityCalls2()).toBe(before + 1);
  expect(host.querySelector('[data-activity-error]')).toBeNull();
  expect(host.querySelector('[data-user-card="payer"] [data-event="deposit"]')).not.toBeNull();
});

test('14. network error and an incomplete answer are failures too, never zeros', async () => {
  fetchMock.mockImplementation(async (url: string) => { if (String(url).endsWith('/admin/user-activity')) throw new TypeError('Failed to fetch'); return json({}); });
  await mount();
  expect(host.querySelector('[data-activity-error="empty"]')).not.toBeNull();
  await act(async () => root.unmount());
  root = req('react-dom/client').createRoot(host);
  modules.clear();
  fetchMock.mockImplementation(async (url: string) => String(url).endsWith('/admin/user-activity') ? json({ asOf: new Date().toISOString(), packages: [] }) : json({}));
  await mount();
  expect(host.querySelector('[data-activity-error="empty"]')).not.toBeNull();
  expect(host.textContent).not.toContain('Нет пополнений в очереди');
});

test('15. a failure after a good read keeps the data and says the update failed', async () => {
  await mount();
  expect(host.querySelector('[data-user-card="payer"] [data-event="deposit"]')).not.toBeNull();
  fetchMock.mockImplementation(async (url: string) => String(url).endsWith('/admin/user-activity') ? json({ error: 'unavailable' }, 503) : json({}));
  // The next read comes from the normal visible-tab cadence: an hour later the tab is shown again.
  visibility = 'hidden'; dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
  visibility = 'visible';
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'] });
  jest.setSystemTime(Date.now() + 2 * HOUR);
  await act(async () => { dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange')); await flush(); await flush(); });
  jest.useRealTimers();
  const alert = host.querySelector('[data-activity-error]')!;
  expect(alert.getAttribute('data-activity-error')).toBe('stale');
  expect(alert.textContent).toContain('Не удалось обновить данные о пополнениях');
  expect(host.querySelector('[data-user-card="payer"] [data-event="deposit"]')).not.toBeNull();
  expect(host.textContent).not.toMatch(/Готовы к проверке\s*—/);
});

test('16. a hung activity read is aborted after the timeout and reported, not left «Загрузка…»', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask', 'nextTick'] });
  let signal: AbortSignal | undefined;
  fetchMock.mockImplementation((url: string, init: any = {}) => {
    if (!String(url).endsWith('/admin/user-activity')) return Promise.resolve(json({}));
    signal = init.signal;
    return new Promise((_, fail) => init.signal.addEventListener('abort', () => fail(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  });
  await mount();
  expect(host.textContent).toContain('Загрузка…');
  await act(async () => { jest.advanceTimersByTime(20_000); await flush(); await flush(); });
  expect(signal!.aborted).toBe(true);
  expect(host.textContent).not.toContain('Загрузка…');
  expect(host.querySelector('[data-activity-error="empty"]')).not.toBeNull();
});

test('17. users list failure offers a retry; a retry while one is running is not doubled', async () => {
  api.getAdminUsers.mockRejectedValueOnce(Object.assign(new Error('Request failed (503)'), { status: 503 }));
  await mount();
  expect(host.querySelector('[data-users-error="empty"]')).not.toBeNull();
  let answer!: (v: any) => void;
  api.getAdminUsers.mockImplementation(() => new Promise(done => { answer = done; }));
  const retry = host.querySelector('[data-users-retry]') as HTMLButtonElement;
  await act(async () => { retry.click(); retry.click(); await flush(); });
  expect(api.getAdminUsers).toHaveBeenCalledTimes(2);
  await act(async () => { answer(structuredClone(users)); await flush(); });
  expect(host.querySelector('[data-users-error]')).toBeNull();
  expect(rows().length).toBe(5);
});
