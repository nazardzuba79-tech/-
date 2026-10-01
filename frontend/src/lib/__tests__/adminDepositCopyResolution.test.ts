import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { act } = React;
const { JSDOM } = req('jsdom');
const flush = () => new Promise<void>(done => setImmediate(done));
const modules = new Map<string, any>();
let dom: any, root: any, users: any[], activity: any, api: any, fetchMock: jest.Mock;
let token: string, ignoreFails: boolean, ignoreGate: Promise<void> | null, nextCopy: any;
const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const event = { id: eventId, asset: 'BTC', network: 'bitcoin', receivedAt: '2026-01-01T08:06:00Z', clientCopiedAt: null };
function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const out: any = {}; modules.set(file, out);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(out, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/adminReadApi')) return { getAdminUsersAbortable: (signal?: AbortSignal) => api.getAdminUsers(undefined, signal) };
    if (name.endsWith('/lib/api') || name === './api') return { api, getToken: () => token, onSessionChange: () => () => {}, API_BASE: '/api/v1', ApiError: class extends Error {} };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return out;
}
const json = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(body) });
const row = (id: string, extra: any = {}) => ({ id, email: `${id}@example.invalid`, role: 'USER', isAdmin: false,
  createdAt: '2025-01-01T00:00:00Z', lastLoginAt: null, kycStatus: 'NOT_STARTED', balances: [], ...extra });
const rows = () => Array.from(document.querySelectorAll('[data-user-row]')).map(r => r.getAttribute('data-user-row'));
const copyOwner = () => document.querySelector('[data-user-row="copy-owner"]')!;
const depositsTab = () => document.querySelector('[data-user-tab="deposits"]')!;
const posts = () => fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => { (element as HTMLElement).click(); await flush(); await flush(); });
}
async function mount() {
  const { AdminUsersPage } = load(resolve(frontend, 'src/pages/admin/AdminUsersPage'));
  const { MemoryRouter } = req('react-router-dom');
  await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(AdminUsersPage))); await flush(); await flush(); });
  // This fixture represents an open, visible page. The real activity hook
  // must perform its initial read before assertions about deposit packages.
  expect(fetchMock.mock.calls.filter((c: any[]) => String(c[0]).endsWith('/admin/user-activity'))).toHaveLength(1);
}
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.invalid/admin/users' });
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'visible' });
  // JSDOM defaults to hidden=true; setting visibilityState alone does not
  // change that. Match both browser properties without bypassing idle logic.
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  root = req('react-dom/client').createRoot(document.getElementById('root'));
  token = 'same-admin-token'; ignoreFails = false; ignoreGate = null; nextCopy = null;
  users = Array.from({ length: 35 }, (_, i) => row(`ordinary-${i}`, { createdAt: new Date(Date.now() - i * 1000).toISOString(), lastLoginAt: new Date().toISOString() }));
  users.push(row('copy-owner', { lastDepositCopy: { ...event }, depositCopyLookupFailed: false }));
  activity = { asOf: new Date().toISOString(), totalUsers: 36, newUsers24h: 35, pendingKyc: 0, minDepositUsd: 500,
    counts: { UNATTRIBUTED: 0, AWAITING_CONFIRMATIONS: 0, AWAITING_TOPUP: 0, READY: 0, NEEDS_REVIEW: 0 }, packages: [], awaitingConfirmationsByUser: {} };
  api = { getAdminUsers: jest.fn(async () => structuredClone(users)), getAdminRecentDepositsByUser: jest.fn(async () => []) };
  fetchMock = jest.fn(async (url: string, init: any = {}) => {
    if (String(url).endsWith('/admin/user-activity')) return json(activity);
    if (String(url).endsWith(`/${eventId}/ignore`)) {
      if (ignoreGate) await ignoreGate;
      if (ignoreFails) return json({ error: 'failed' }, 500);
      const owner = users.find(u => u.id === 'copy-owner'); owner.lastDepositCopy = nextCopy;
      return json({ userId: 'copy-owner', ignoredEventId: eventId, lastDepositCopy: nextCopy, depositCopyLookupFailed: false });
    }
    return json({ error: `unexpected ${url} ${init.method}` }, 404);
  });
  (globalThis as any).fetch = fetchMock; modules.clear();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); dom.window.close(); });

it('places an old-account/old-copy signal on page one without sorting by recent login', async () => {
  await mount();
  expect(rows()[0]).toBe('copy-owner'); expect(rows()).toHaveLength(20);
  expect(copyOwner().querySelector('[data-deposit-copy-bell]')).not.toBeNull();
  expect(depositsTab().textContent).toBe('Пополнения1');
  expect(depositsTab().querySelector('[data-copy-tab-bell]')).not.toBeNull();
  expect(copyOwner().querySelector('[data-credit-user]')).toBeNull();
});
it('the Deposits tab includes copied addresses and restores work order, without a request or acknowledgement', async () => {
  await mount();
  const select = document.querySelector('[aria-label="Фильтр пользователей"]') as HTMLSelectElement;
  await act(async () => { select.value = 'lastLogin'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  const before = fetchMock.mock.calls.length;
  await click(depositsTab());
  expect(rows()).toEqual(['copy-owner']); expect(select.value).toBe('');
  await click(copyOwner().querySelector('[data-deposit-copy-bell]'));
  expect(fetchMock.mock.calls.length).toBe(before); expect(posts()).toHaveLength(0);
  expect(depositsTab().textContent).toBe('Пополнения1');
});
it('counts the union of users with a package and a copy, not two entries for one person', async () => {
  activity.packages = [{ key: 'copy-owner|bitcoin|BTC', userId: 'copy-owner', chain: 'bitcoin', asset: 'BTC', state: 'READY', total: '1', latestAt: new Date().toISOString(), transferCount: 1, remaining: '0' }];
  await mount(); expect(depositsTab().textContent).toBe('Пополнения1');
  expect(copyOwner().querySelector('[data-credit-user]')).not.toBeNull();
});
it('Ignore removes the bell and filter entry only after server success; double click sends one POST', async () => {
  let finish!: () => void; ignoreGate = new Promise<void>(r => { finish = r; });
  await mount(); await click(depositsTab()); await click(copyOwner().querySelector('[data-deposit-copy-bell]'));
  const button = copyOwner().querySelector('[data-ignore-deposit-copy]') as HTMLButtonElement;
  await act(async () => { button.click(); button.click(); await flush(); });
  expect(posts()).toHaveLength(1); expect(button.disabled).toBe(true);
  expect(rows()).toEqual(['copy-owner']); expect(depositsTab().textContent).toBe('Пополнения1');
  expect(JSON.parse(posts()[0][1].body)).toEqual({});
  await act(async () => { finish(); await flush(); await flush(); });
  expect(rows()).toEqual([]); expect(depositsTab().textContent).toBe('Пополнения0');
  expect(document.querySelector('[data-copy-tab-bell]')).toBeNull();
  expect(document.querySelector('[data-deposit-copy-bell]')).toBeNull();
  expect(api.getAdminUsers).toHaveBeenCalledTimes(1);
});
it('failed Ignore keeps the pending signal and counter, and exposes a retryable error', async () => {
  ignoreFails = true;
  await mount(); await click(depositsTab()); await click(copyOwner().querySelector('[data-deposit-copy-bell]'));
  await click(copyOwner().querySelector('[data-ignore-deposit-copy]'));
  expect(rows()).toEqual(['copy-owner']); expect(depositsTab().textContent).toBe('Пополнения1');
  expect(copyOwner().querySelector('[role="alert"]')).not.toBeNull();
  expect(posts()).toHaveLength(1);
});
it('a newer signal returned by Ignore replaces the old one and stays in Deposits', async () => {
  nextCopy = { ...event, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', asset: 'ETH', network: 'ethereum', receivedAt: new Date().toISOString() };
  await mount(); await click(depositsTab()); await click(copyOwner().querySelector('[data-deposit-copy-bell]'));
  await click(copyOwner().querySelector('[data-ignore-deposit-copy]'));
  expect(rows()).toEqual(['copy-owner']); expect(depositsTab().textContent).toBe('Пополнения1');
  expect(copyOwner().querySelector('[data-deposit-copy-bell]')?.textContent).toContain('ETH');
  expect(copyOwner().querySelector('[role="region"]')).toBeNull();
});
it('ignoring a copy does not remove a real pending deposit or enable/disable credit incorrectly', async () => {
  activity.packages = [{ key: 'copy-owner|tron|USDT', userId: 'copy-owner', chain: 'tron', asset: 'USDT', state: 'READY', total: '500', latestAt: new Date().toISOString(), transferCount: 1, remaining: '0' }];
  await mount(); await click(depositsTab()); await click(copyOwner().querySelector('[data-deposit-copy-bell]'));
  await click(copyOwner().querySelector('[data-ignore-deposit-copy]'));
  expect(rows()).toEqual(['copy-owner']); expect(depositsTab().textContent).toBe('Пополнения1');
  expect(copyOwner().querySelector('[data-deposit-copy-bell]')).toBeNull();
  expect(copyOwner().querySelector('[data-credit-user]')).not.toBeNull();
  expect(posts()).toHaveLength(1);
});
it('an account switch while Ignore waits cannot apply the old session response', async () => {
  let finish!: () => void; ignoreGate = new Promise<void>(r => { finish = r; });
  await mount(); await click(depositsTab()); await click(copyOwner().querySelector('[data-deposit-copy-bell]'));
  await click(copyOwner().querySelector('[data-ignore-deposit-copy]'));
  token = 'different-session';
  await act(async () => { finish(); await flush(); await flush(); });
  expect(copyOwner().querySelector('[data-deposit-copy-bell]')).not.toBeNull();
  expect(copyOwner().querySelector('[role="alert"]')?.textContent).toContain('Сессия изменилась');
});
it('an unavailable pending-copy read does not claim the deposit count is zero', async () => {
  users[35].lastDepositCopy = null; users[35].depositCopyLookupFailed = true;
  await mount(); expect(depositsTab().querySelector('.admin-user-tab-count')).toBeNull();
});
it('the mutation and bell introduce no recurring transport or expiry timer', () => {
  const bell = readFileSync(resolve(frontend, 'src/pages/admin/DepositCopyBell.tsx'), 'utf8');
  const mutation = readFileSync(resolve(frontend, 'src/pages/admin/depositCopyReviewClient.ts'), 'utf8');
  expect(bell + mutation).not.toMatch(/\b(?:setInterval|setTimeout|WebSocket|EventSource)\s*\(/);
  const page = readFileSync(resolve(frontend, 'src/pages/admin/AdminUsersPage.tsx'), 'utf8');
  expect(page).toContain('revision === usersRevision.current');
  expect(page).toContain('row.lastDepositCopy?.id === eventId');
});
