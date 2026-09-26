import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * Admin → Пользователи as a work queue (owner, 2026-09-26): new registrations
 * and deposits waiting for an admin on one page, «Зачислить» through the
 * EXISTING Пополнения credit flow behind a confirmation, and one compact
 * activity read on a visible-only cadence. The real page renders in JSDOM;
 * only `api` and `fetch` are stand-ins.
 */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const flush = () => new Promise<void>(done => setImmediate(done));
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let dom: any, root: any, host: HTMLElement, api: any, fetchMock: jest.Mock, visibility: 'visible' | 'hidden', activity: any, users: any[];
const modules = new Map<string, any>();
class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/lib/api')) return { api, getToken: () => 'test-only', ApiError, API_BASE: '/api/v1' };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}

const user = (id: string, email: string, createdMsAgo: number, extra: any = {}) => ({
  id, email, role: 'USER', isAdmin: false, kycStatus: 'NOT_STARTED', createdAt: iso(createdMsAgo), registrationIp: null,
  lastLoginAt: null, isBlocked: false, blockedAt: null, blockedReason: null, balances: [], ...extra,
});
const deposit = (id: string, userId: string, amount: string, createdMsAgo: number, extra: any = {}) => ({
  id, userId, asset: 'USDT', chain: 'tron', txHash: id.padEnd(64, 'f'), amount, confirmations: 30, status: 'PENDING', createdAt: iso(createdMsAgo), ...extra,
});

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/admin/users' });
  visibility = 'visible';
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, get: () => visibility });
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
    asOf: new Date().toISOString(), totalUsers: 5, newUsers24h: 2, pendingKyc: 1,
    pendingDeposits: [deposit('dep-payer', 'payer', '2500', 3 * HOUR), deposit('dep-both', 'both', '75.25', 0.5 * HOUR)],
  };
  fetchMock = jest.fn(async () => ({ ok: true, json: async () => structuredClone(activity) }));
  (globalThis as any).fetch = fetchMock;
  api = {
    getAdminUsers: jest.fn(async () => structuredClone(users)),
    getAdminRecentDepositsByUser: jest.fn(async () => []),
    getAdminDeposits: jest.fn(async () => { throw new Error('the Users page must never read deposit history'); }),
    creditDepositManually: jest.fn(async (params: any) => {
      activity.pendingDeposits = activity.pendingDeposits.filter((d: any) => d.txHash !== params.txHash);
      return { status: 'CREDITED', amount: '2500', confirmations: 30 };
    }),
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
const activityCalls = () => fetchMock.mock.calls.filter((c: any[]) => String(c[0]).endsWith('/admin/user-activity')).length;

test('1. users with a deposit waiting for an admin come first, then new registrations, then everyone else', async () => {
  await mount();
  // both (pending 0.5h ago) · payer (pending 3h ago) · fresh (new) · old · kyc (older)
  expect(rows()).toEqual(['both', 'payer', 'fresh', 'old', 'kyc']);
});

test('2–3. a new registration gets НОВЫЙ; new + pending deposit shows both badges and the pending tint wins', async () => {
  await mount();
  expect(events('fresh')).toEqual(['new']);
  expect(events('both')).toEqual(['new', 'deposit']);
  expect(events('payer')).toEqual(['deposit']);
  expect(events('old')).toEqual([]);
  expect(host.querySelector('[data-user-row="payer"] [data-event="deposit"]')!.textContent).toContain('+2500 USDT');
  expect(host.querySelector('[data-user-row="both"]')!.getAttribute('data-row-tint')).toBe('deposit');
  expect(host.querySelector('[data-user-row="fresh"]')!.getAttribute('data-row-tint')).toBe('new');
  expect(host.querySelector('[data-user-row="old"]')!.getAttribute('data-row-tint')).toBeNull();
});

test('4. «Пополнения» shows only users with a pending deposit; tabs carry their counts; cards show the queue per asset', async () => {
  await mount();
  const tab = (k: string) => host.querySelector(`[data-user-tab="${k}"]`)!;
  expect(tab('new').textContent).toBe('Новые2');
  expect(tab('deposits').textContent).toBe('Пополнения2');
  expect(tab('kyc').textContent).toBe('KYC1');
  await click(tab('deposits'));
  expect(rows()).toEqual(['both', 'payer']);
  await click(tab('new'));
  expect(rows()).toEqual(['both', 'fresh']);
  await click(tab('kyc'));
  expect(rows()).toEqual(['kyc']);
  expect(host.textContent).toContain('Ожидают зачисления');
  expect(host.textContent).toContain('2575.25 USDT');
});

test('5–6. the only timer is the activity read: none while hidden, an immediate read on return, 25 s cadence while visible', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  await mount();
  expect(activityCalls()).toBe(1);
  await act(async () => { jest.advanceTimersByTime(25_000); await flush(); await flush(); });
  expect(activityCalls()).toBe(2);
  visibility = 'hidden';
  await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); await flush(); });
  await act(async () => { jest.advanceTimersByTime(10 * 60_000); await flush(); });
  expect(activityCalls()).toBe(2);
  expect(jest.getTimerCount()).toBe(0);
  visibility = 'visible';
  await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); await flush(); await flush(); });
  expect(activityCalls()).toBe(3);
  // The user list is not on a timer: still the single mount read.
  expect(api.getAdminUsers).toHaveBeenCalledTimes(1);
  expect(api.getAdminDeposits).not.toHaveBeenCalled();
});

test('7. «Зачислить» opens a confirmation with the server record; Cancel sends nothing', async () => {
  await mount();
  await click(host.querySelector('[data-credit-user="payer"]'));
  const drawer = host.querySelector('[data-credit-drawer="dep-payer"]')!;
  expect(drawer).not.toBeNull();
  for (const text of ['payer@example.invalid', 'payer', 'USDT', 'tron', '2500', 'dep-payer', 'PENDING', '100.5', '2600.5']) expect(drawer.textContent).toContain(text);
  expect(api.creditDepositManually).not.toHaveBeenCalled();
  await click(host.querySelector('[data-cancel-credit]'));
  expect(host.querySelector('[data-credit-drawer]')).toBeNull();
  expect(api.creditDepositManually).not.toHaveBeenCalled();
  expect(events('payer')).toEqual(['deposit']);
});

test('8. confirm uses the existing credit call once — no amount sent, a double click cannot credit twice — and the row leaves the queue', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const credit = api.creditDepositManually;
  api.creditDepositManually = jest.fn(async (params: any) => { await gate; return credit(params); });
  await mount();
  await click(host.querySelector('[data-credit-user="payer"]'));
  const confirm = host.querySelector('[data-confirm-credit]') as HTMLButtonElement;
  await act(async () => { confirm.click(); confirm.click(); await flush(); });
  expect(api.creditDepositManually).toHaveBeenCalledTimes(1);
  expect(api.creditDepositManually).toHaveBeenCalledWith({ userId: 'payer', chain: 'tron', txHash: 'dep-payer'.padEnd(64, 'f'), asset: 'USDT' });
  await act(async () => { release(); await flush(); await flush(); await flush(); });
  expect(host.querySelector('[data-credit-drawer]')).toBeNull();
  expect(events('payer')).toEqual([]);
  expect(host.querySelector('[data-user-row="payer"]')!.getAttribute('data-row-tint')).toBeNull();
  expect(host.querySelector('[data-user-tab="deposits"]')!.textContent).toBe('Пополнения1');
  // Refreshed in place: one more activity read, one more users read, no page reload.
  expect(activityCalls()).toBe(2);
  expect(api.getAdminUsers).toHaveBeenCalledTimes(2);
});

test('8b. a deposit the server did not credit (awaiting confirmations) keeps the balance and the queue entry', async () => {
  api.creditDepositManually = jest.fn(async () => ({ status: 'PENDING', amount: '2500', confirmations: 3 }));
  await mount();
  await click(host.querySelector('[data-credit-user="payer"]'));
  await click(host.querySelector('[data-confirm-credit]'));
  expect(host.querySelector('[data-credit-drawer] [role="status"]')!.textContent).toContain('ожидает подтверждений сети (3)');
  expect(host.querySelector('[data-confirm-credit]')).toBeNull();
  expect(events('payer')).toEqual(['deposit']);
});

test('9. the page reuses the Пополнения credit call and never builds its own money request', () => {
  const code = (f: string) => readFileSync(resolve(frontend, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const page = code('src/pages/admin/AdminUsersPage.tsx');
  const drawer = code('src/pages/admin/CreditDepositDrawer.tsx');
  const client = code('src/pages/admin/adminUserActivity.ts');
  expect(drawer).toContain('api.creditDepositManually({ userId: deposit.userId, chain: deposit.chain, txHash: deposit.txHash, asset: deposit.asset })');
  for (const source of [page, drawer, client]) {
    expect(source).not.toMatch(/method:\s*'POST'/);
    expect(source).not.toMatch(/adjustUserBalance|manual-credit/);
    expect(source).not.toContain('getAdminDeposits(');
  }
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
