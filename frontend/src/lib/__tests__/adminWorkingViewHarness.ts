import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

export const frontend = resolve(__dirname, '../../..');
export const req = createRequire(resolve(frontend, 'package.json'));
export const React = req('react'), act = React.act;
export const flush = async () => { for (let i = 0; i < 18; i++) await Promise.resolve(); };
export const json = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(body) });
export const page = (items: any[], total = items.length, current = 1) => ({ items, total, page: current, pageSize: 20, totalPages: Math.ceil(total / 20), asOf: '2026-10-03T09:00:00Z' });
export const user = (id: string, extra: any = {}) => ({ id, email: `${id}@example.invalid`, role: 'USER', isAdmin: false, kycStatus: 'NOT_STARTED', createdAt: '2026-10-03T09:00:00Z', lastLoginAt: null, balances: [], ...extra });
export function workSummary(overrides: any = {}) {
  const spec: Record<string, [number, string, string]> = {
    readyPackages: [1, 'packages', '/admin/deposits?state=READY'], pendingPackages: [2, 'packages', '/admin/deposits?state=AWAITING_TOPUP'],
    unlinkedTransfers: [3, 'transfers', '/admin/deposits?state=UNATTRIBUTED'], activeWithdrawals: [4, 'withdrawals', '/admin/withdrawals?status=active'],
    pendingKyc: [5, 'users', '/admin/kyc?status=PENDING'], openOtc: [6, 'requests', '/admin/otc?status=NEW'],
    totalUsers: [1000, 'users', '/admin/users'], newUsers24h: [7, 'users', '/admin/users?status=new'],
  };
  return { asOf: '2026-10-03T09:00:00Z', widgets: Object.fromEntries(Object.entries(spec).map(([key, [value, unit, href]]) => [key, { value, unit, href, status: 'ready', asOf: '2026-10-03T09:00:00Z', ...overrides[key] }])) };
}
class FixtureApiError extends Error { constructor(message: string, public status = 400) { super(message); } }

export function createAdminWorkingFixture() {
  const dom = new (req('jsdom').JSDOM)('<div id="root"></div>', { url: 'https://example.invalid/admin/users', pretendToBeVisual: true });
  let hidden = false, token: string | null = 'fixture-admin';
  const sessions = new Set<() => void>(), modules = new Map<string, any>();
  const originalFetch = globalThis.fetch;
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.scrollTo = jest.fn();
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const host = document.getElementById('root')!, root = req('react-dom/client').createRoot(host);
  const api: any = { getAdminUsersPage: jest.fn().mockResolvedValue(page([user('payer')])), getAdminAuditPage: jest.fn().mockResolvedValue(page([])),
    getAdminUsers: jest.fn(() => { throw new Error('Unbounded users forbidden'); }), getAdminDeposits: jest.fn(() => { throw new Error('Deposit history forbidden'); }),
    creditDepositManually: jest.fn(() => { throw new Error('Closed manual credit forbidden'); }), adjustUserBalance: jest.fn(() => { throw new Error('Balance write forbidden'); }),
  };
  const fetcher = jest.fn(async (url: string, _init: any = {}) => String(url).endsWith('/admin/work-summary') ? json(workSummary()) : json({ error: `Unexpected fixture request: ${url}` }, 404));
  globalThis.fetch = fetcher as any;
  function load(file: string): any {
    for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
    if (modules.has(file)) return modules.get(file);
    const out: any = {}; modules.set(file, out);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('exports', 'require', code)(out, (name: string) => {
      if (name.endsWith('.css')) return {};
      if (name.endsWith('/adminPagedApi')) return { getAdminUsersPage: (query: string, signal?: AbortSignal) => api.getAdminUsersPage(query, signal), getAdminAuditPage: (query: string, signal?: AbortSignal) => api.getAdminAuditPage(query, signal) };
      if (name.endsWith('/adminReadApi')) return { adminRead: async (path: string, signal?: AbortSignal) => {
        const own = token, response = await fetcher('/api/v1' + path, { signal, cache: 'no-store' });
        if (!response.ok) throw new FixtureApiError('Request failed', response.status);
        const data = await response.json(); if (own !== token) throw new Error('Session changed'); return data;
      } };
      if (name.endsWith('/api')) return { api, getToken: () => token, onSessionChange: (fn: () => void) => { sessions.add(fn); return () => sessions.delete(fn); }, ApiError: FixtureApiError, API_BASE: '/api/v1' };
      return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
    });
    return out;
  }
  async function mount(name = 'AdminUsersPage', entry = '/admin/users', props: any = {}) {
    const component = load(resolve(frontend, 'src/pages/admin/' + name))[name];
    const { MemoryRouter, useLocation } = req('react-router-dom');
    function Location() { const location = useLocation(); return React.createElement('output', { 'data-location': true }, location.pathname + location.search); }
    await act(async () => { root.render(React.createElement(MemoryRouter, { initialEntries: [entry] }, React.createElement(component, props), React.createElement(Location))); await flush(); });
  }
  async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => { (element as HTMLElement).click(); await flush(); }); }
  async function setValue(element: Element, value: string) {
    await act(async () => { const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await flush(); });
  }
  async function setHidden(value: boolean) { await act(async () => { hidden = value; document.dispatchEvent(new dom.window.Event('visibilitychange')); await flush(); }); }
  async function dispose() { await act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT']) delete (globalThis as any)[key]; }
  return { dom, root, host, api, fetcher, load, mount, click, setValue, setHidden, dispose,
    setToken(next: string | null, notify = true) { token = next; if (notify) sessions.forEach(fn => fn()); },
    rows: () => Array.from(host.querySelectorAll('[data-user-row]')).map(el => el.getAttribute('data-user-row')),
    calls: (part: string) => fetcher.mock.calls.filter((c: any[]) => String(c[0]).includes(part)),
    button: (text: string) => Array.from(host.querySelectorAll('button')).find(el => el.textContent?.trim() === text) ?? null,
  };
}
