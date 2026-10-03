import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const flush = () => new Promise<void>(done => setImmediate(done));
let dom: any, root: any, host: HTMLElement, id: string, token: string | null, read: jest.Mock;
let sessions: Set<() => void>, modules: Map<string, any>, historyRead: jest.Mock, balancesRead: jest.Mock;
let params: URLSearchParams, paramWrites: jest.Mock;
const detail = (value: string) => ({ id: value, email: `${value}@example.invalid`, role: 'USER', isAdmin: false,
  createdAt: '2026-10-01T12:00:00Z', kycStatus: 'NOT_STARTED', balances: [], demoBalances: [],
  deposits: [], withdrawals: [], orders: [], purchases: [], kycSubmissions: [], isBlocked: false });
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name === 'react-router-dom') return { useParams: () => ({ id }), useSearchParams: () => {
      const [, change] = React.useState(0);
      return [params, (next: URLSearchParams, options?: unknown) => {
        params = new URLSearchParams(next); paramWrites(params.toString(), options); change((value: number) => value + 1);
      }];
    }, useNavigate: () => jest.fn(), Link: (p: any) => React.createElement('a', { href: p.to, className: p.className }, p.children) };
    if (name.endsWith('/adminPagedApi')) return { getAdminProfile: (...args: any[]) => read(...args), getAdminHistory: (...args: any[]) => historyRead(...args), getAdminProfileBalances: (...args: any[]) => balancesRead(...args) };
    if (name.endsWith('/adminWorkSummary')) return { refreshAdminSummary: jest.fn() };
    if (name.endsWith('/AdminBalanceAdjustment')) return { AdminBalanceAdjustment: () => null };
    if (name.endsWith('/adminReadApi')) return { getAdminUserDetailAbortable: (...args: any[]) => read(...args) };
    if (name.endsWith('/lib/api')) return { api: { getAdminUserDetail: (...args: any[]) => read(...args) },
      getToken: () => token, onSessionChange: (fn: () => void) => { sessions.add(fn); return () => sessions.delete(fn); }, ApiError: Error };
    if (name.endsWith('/DeleteUserDialog')) return { canDeleteUser: () => false, DeleteUserDialog: () => null };
    if (name.endsWith('/KycSubmissionReview')) return { KycSubmissionReview: () => null };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}
async function render() { const Page = load(resolve(frontend, 'src/pages/admin/AdminUserDetailPage.tsx')).AdminUserDetailPage; await act(async () => { root.render(React.createElement(Page)); await flush(); }); }
async function click(label: RegExp) { const button = Array.from(host.querySelectorAll('button')).find(x => label.test(x.textContent || '')); expect(button).toBeTruthy(); await act(async () => { button!.click(); await flush(); }); }
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/admin/users/a' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  host = document.getElementById('root')!; root = req('react-dom/client').createRoot(host);
  id = 'a'; token = 'fixture-session'; sessions = new Set(); modules = new Map(); read = jest.fn(); historyRead = jest.fn().mockResolvedValue({items: [], total: 0, page: 1, pageSize: 20, totalPages: 0});
  params = new URLSearchParams(); paramWrites = jest.fn();
  balancesRead = jest.fn().mockResolvedValue({ balances: [], demoBalances: [] });
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); });
test.each([500, undefined])('%s / offline errors end loading and expose retry without an empty profile', async (status) => {
  read.mockRejectedValueOnce(Object.assign(new Error('failed'), { status })); await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/загрузить/i);
  read.mockResolvedValue(detail('a')); await click(/Повторить/); expect(host.textContent).toContain('a@example.invalid');
});
test.each([401, 403, 404])('%s response is an explicit error, never an endless skeleton or an empty account', async status => {
  read.mockRejectedValueOnce(Object.assign(new Error('failed'), { status })); await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('Баланс пуст');
});
test('changing accounts aborts the previous transport', async () => {
  read.mockReturnValue(new Promise(() => {})); await render(); const signal = read.mock.calls[0][1];
  id = 'b'; await render(); expect(signal.aborted).toBe(true);
});
test('route B clears A immediately and a late A response cannot overwrite B', async () => {
  const a = deferred(), b = deferred(); read.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  await render(); id = 'b'; await render(); await act(async () => { b.resolve(detail('b')); await flush(); });
  await act(async () => { a.resolve(detail('a')); await flush(); });
  expect(host.textContent).toContain('b@example.invalid'); expect(host.textContent).not.toContain('a@example.invalid');
});
test('loaded A is not displayed while route B is pending', async () => {
  read.mockResolvedValueOnce(detail('a')).mockReturnValueOnce(new Promise(() => {})); await render(); id = 'b'; await render();
  expect(host.textContent).not.toContain('a@example.invalid');
});
test('hanging request times out even if transport never settles', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] }); read.mockReturnValue(new Promise(() => {})); await render();
  await act(async () => { jest.advanceTimersByTime(15_001); await flush(); });
  expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/время/i);
});
test('logout discards loaded profile and late responses without a new authenticated read', async () => {
  read.mockResolvedValueOnce(detail('a')); await render(); await act(async () => { token = null; sessions.forEach(fn => fn()); await flush(); });
  expect(host.textContent).not.toContain('a@example.invalid'); expect(read).toHaveBeenCalledTimes(1);
});
test('background failure keeps last confirmed profile with an explicit stale warning', async () => {
  read.mockResolvedValueOnce(detail('a')).mockRejectedValueOnce(Object.assign(new Error('failed'), { status: 500 })); await render(); await click(/^Обновить$/);
  expect(host.textContent).toContain('a@example.invalid'); expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/устареть/i);
});
test('403 during refresh removes private data instead of retaining it as stale', async () => {
  read.mockResolvedValueOnce(detail('a')).mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 })); await render(); await click(/^Обновить$/);
  expect(host.textContent).not.toContain('a@example.invalid'); expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/доступ/i);
});

test('profile opens without eager histories; only the selected history is fetched and aborts on exit', async () => {
  read.mockResolvedValue(detail('a')); await render(); expect(historyRead).not.toHaveBeenCalled();
  await click(/^Пополнения$/); expect(historyRead).toHaveBeenCalledWith('a', 'deposits', 1, expect.any(AbortSignal));
  const signal = historyRead.mock.calls[0][3]; await click(/^Общее$/); expect(signal.aborted).toBe(true);
  expect(historyRead).toHaveBeenCalledTimes(1);
});
test('manual balance adjustment is an additional action, never a default profile form', async () => {
  read.mockResolvedValue(detail('a')); await render(); expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).toContain('Дополнительные действия');
});

test.each(['/admin/users', '/admin/audit-log?userId=a&page=3', '/admin/kyc?status=PENDING', '/admin/deposits?userId=a', '/admin/withdrawals?status=active'])('return link preserves whitelisted read list %s', async value => {
  const { adminReturnPath } = load(resolve(frontend, 'src/pages/admin/AdminUserDetailPage.tsx'));
  expect(adminReturnPath(value)).toBe(value);
  params = new URLSearchParams({ returnTo: value }); read.mockResolvedValue(detail('a')); await render();
  expect(host.querySelector('a.admin-back')?.getAttribute('href')).toBe(value);
});

test.each([null, 'https://example.invalid/admin/users', '//example.invalid', '/admin/settings', '/admin/users/a', '/admin/users#fragment', '/admin/audit-log/other', '/admin/users?x=\nexternal'])('rejects unapproved or malformed return path %s', value => {
  const { adminReturnPath } = load(resolve(frontend, 'src/pages/admin/AdminUserDetailPage.tsx'));
  expect(adminReturnPath(value)).toBe('/admin/users');
});

test.each([['deposits', 'Пополнения'], ['withdrawals', 'Выводы'], ['orders', 'Ордера'], ['kyc', 'Проверка личности'], ['audit', 'История действий']])('deep link %s opens only the selected bounded history', async (key, label) => {
  params = new URLSearchParams({ tab: key }); read.mockResolvedValue(detail('a')); await render();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(label);
  expect(historyRead).toHaveBeenCalledTimes(1);
  expect(historyRead).toHaveBeenCalledWith('a', key, 1, expect.any(AbortSignal));
});

test.each(['balances', 'overview', 'unknown', '__proto__', 'constructor', 'https://example.invalid'])('non-history or invalid tab %s never starts a hidden history', async key => {
  params = new URLSearchParams({ tab: key }); read.mockResolvedValue(detail('a')); await render();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(key === 'balances' ? 'Балансы' : 'Общее');
  expect(historyRead).not.toHaveBeenCalled();
});

test('tab switches preserve return filters in URL, browser navigation updates selection and aborts old history', async () => {
  const back = '/admin/audit-log?action=USER_BLOCK&page=2'; params = new URLSearchParams({ returnTo: back });
  read.mockResolvedValue(detail('a')); await render(); await click(/^Пополнения$/);
  expect(params.get('tab')).toBe('deposits'); expect(params.get('returnTo')).toBe(back); expect(paramWrites).toHaveBeenCalled();
  const signal = historyRead.mock.calls[0][3];
  params = new URLSearchParams({ returnTo: back, tab: 'withdrawals' }); await render();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Выводы');
  expect(signal.aborted).toBe(true); expect(historyRead.mock.calls.map(call => call[1])).toEqual(['deposits', 'withdrawals']);
  await click(/^Общее$/); expect(params.has('tab')).toBe(false); expect(params.get('returnTo')).toBe(back);
});

test('deep-linked history aborts across users and ignores the previous user late response', async () => {
  const a = deferred(), b = deferred(); params = new URLSearchParams({ tab: 'deposits' });
  read.mockImplementation((value: string) => Promise.resolve(detail(value))); historyRead.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  await render(); const signal = historyRead.mock.calls[0]?.[3]; expect(signal).toBeDefined();
  id = 'b'; await render(); expect(signal.aborted).toBe(true);
  await act(async () => { b.resolve({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }); await flush(); });
  await act(async () => { a.resolve({ items: [{ id: 'private-a-history', asset: 'BTC', amount: '123' }], total: 1, page: 1, pageSize: 20, totalPages: 1 }); await flush(); });
  expect(host.textContent).toContain('b@example.invalid'); expect(host.textContent).not.toContain('private-a-history');
  expect(historyRead.mock.calls.map(call => call[0])).toEqual(['a', 'b']);
});

const legacy = { mode: 'legacy', complete: true, notice: 'Используется совместимый API.' };
test('legacy profile keeps aggregate balances lazy and aborts the selected read on exit', async () => {
  const pending = deferred(); balancesRead.mockReturnValue(pending.promise);
  read.mockResolvedValue({ ...detail('a'), demoBalances: null, compatibility: legacy });
  await render(); expect(balancesRead).not.toHaveBeenCalled(); expect(historyRead).not.toHaveBeenCalled();
  await click(/^Балансы$/); expect(balancesRead).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain('Записей баланса нет.');
  const signal = balancesRead.mock.calls[0][1]; await click(/^Общее$/); expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve({ balances: [{ asset: 'USDT', available: '987.654321', locked: '1' }], demoBalances: [] }); await flush(); });
  expect(host.textContent).not.toContain('987.654321');
});

test('legacy balances read shows exact real and demo amounts separately after explicit selection', async () => {
  read.mockResolvedValue({ ...detail('a'), balances: null, demoBalances: null, compatibility: legacy });
  balancesRead.mockResolvedValue({ balances: [{ asset: 'USDT', available: '123.456789', locked: '2' }], demoBalances: [{ asset: 'USDT', available: '9876', locked: '0' }], compatibility: legacy });
  await render(); await click(/^Балансы$/);
  expect(host.textContent).toContain('123.456789'); expect(host.textContent).toContain('9876');
  expect(host.textContent).toContain('Тестовый счёт — отдельно'); expect(balancesRead).toHaveBeenCalledTimes(1);
});

test('legacy profiles cannot offer an incompatible balance adjustment write', async () => {
  read.mockResolvedValue({ ...detail('a'), demoBalances: null, compatibility: legacy }); await render();
  const adjustment = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Корректировка баланса');
  expect(adjustment?.disabled).toBe(true); expect(host.textContent).toMatch(/Корректировка.*недоступна.*версии сервера/);
});

test('unknown legacy account state is not active and cannot expose account-state actions', async () => {
  read.mockResolvedValue({ ...detail('a'), isBlocked: null, balances: null, demoBalances: null, compatibility: legacy }); await render();
  expect(host.textContent).toContain('Статус недоступен'); expect(host.textContent).not.toMatch(/Активен|Активна/);
  expect(Array.from(host.querySelectorAll('button')).some(button => /^(Заблокировать|Разблокировать)/.test(button.textContent || ''))).toBe(false);
});

test('capped history never claims a complete total or definitive empty history', async () => {
  read.mockResolvedValue(detail('a'));
  historyRead.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0, compatibility: { ...legacy, complete: false, limit: 100, notice: 'Сервер вернул только последние 100 записей.' } });
  await render(); await click(/^Пополнения$/);
  expect(host.textContent).toContain('Загружено по условиям: 0');
  expect(host.textContent).toContain('Полная история недоступна.');
  expect(host.textContent).not.toContain('Найдено: 0'); expect(host.textContent).not.toContain('Записей нет.');
});

test('unsupported history remains unavailable rather than an empty or missing account', async () => {
  read.mockResolvedValue(detail('a')); historyRead.mockRejectedValue(Object.assign(new Error('unsupported'), { status: 404, code: 'ENDPOINT_NOT_AVAILABLE' }));
  await render(); await click(/^Ордера$/);
  expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/недоступ/i);
  expect(host.textContent).not.toMatch(/Записей нет|Пользователь не найден/);
});
