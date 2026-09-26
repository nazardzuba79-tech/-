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
    user('fresh', 'fresh@example.invalid', 2 * HOUR),
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
const events = (id: string) => Array.from(host.querySelectorAll(`[data-user-row="${id}"] [data-event]`)).map(e => e.getAttribute('data-event'));
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
  const payer = host.querySelector('[data-user-row="payer"] [data-event="deposit"]')!;
  expect(payer.getAttribute('data-package-state')).toBe('READY');
  expect(payer.textContent).toContain('ГОТОВ К ПРОВЕРКЕ');
  expect(payer.textContent).toContain('2500 USDT');
  const both = host.querySelector('[data-user-row="both"] [data-event="deposit"]')!;
  expect(both.getAttribute('data-package-state')).toBe('AWAITING_TOPUP');
  expect(both.textContent).toContain('ОЖИДАЕТ ДОПЛАТЫ');
  expect(both.textContent).toContain('35 / 300 USDT');
  expect(host.querySelector('[data-user-row="both"]')!.getAttribute('data-row-tint')).toBe('deposit');
  expect(host.querySelector('[data-user-row="fresh"]')!.getAttribute('data-row-tint')).toBe('new');
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

test('10. search by email and the existing KYC / blocked filter still work together with the tabs', async () => {
  users[0].isBlocked = true;
  await mount();
  const input = host.querySelector('input[aria-label="Поиск пользователей"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setValue.call(input, 'pay'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush(); });
  expect(rows()).toEqual(['payer']);
  await act(async () => { setValue.call(input, ''); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush(); });
  const select = host.querySelector('select[aria-label="Фильтр пользователей"]') as HTMLSelectElement;
  const setSelect = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => { setSelect.call(select, 'blocked'); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await flush(); });
  expect(rows()).toEqual(['old']);
  await act(async () => { setSelect.call(select, 'PENDING'); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await flush(); });
  expect(rows()).toEqual(['kyc']);
});
