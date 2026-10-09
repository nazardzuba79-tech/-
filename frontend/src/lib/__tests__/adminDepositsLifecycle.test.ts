import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { JSDOM } = req('jsdom');
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
const row = (id = 'transfer-a', userId: string | null = null) => ({ id, userId, userEmail: userId ? `${userId}@example.invalid` : null,
  txHash: id, state: 'UNATTRIBUTED', chain: 'tron', asset: 'USDT', amount: '100', usdValue: '100', confirmations: 20,
  minConfirmations: 20, blockTimestamp: '2026-10-03T10:00:00Z', createdAt: '2026-10-03T10:00:00Z', claims: [], batchId: null });
const queue = (rows: any[] = []) => ({ rows, packages: [], creditedBatches: [], minDepositUsd: '500', watcher: null,
  counts: { UNATTRIBUTED: rows.length, AWAITING_CONFIRMATIONS: 0, CREDITED: 0, IGNORED: 0, truncated: false }, packageCounts: { READY: 0, AWAITING_TOPUP: 0 } });
let dom: any, root: any, Page: any, deposits: any, api: any, clientsRead: jest.Mock, summary: jest.Mock;
let hidden: boolean, token: string | null, sessionListeners: Set<() => void>, activityListeners: Set<() => void>, location: { hash: string; search: string };
function load(file: string) {
  const output: any = {};
  const code = ts.transpileModule(readFileSync(resolve(frontend, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', code)(output, (name: string) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return req(name);
    if (name === 'react-router-dom') return { useLocation: () => location };
    if (name.endsWith('/api')) return { api, ApiError: Error, getToken: () => token, onSessionChange: (fn: () => void) => { sessionListeners.add(fn); return () => sessionListeners.delete(fn); } };
    if (name.endsWith('/browserActivity')) return { isBrowserInactive: () => hidden, waitUntilActive: async () => {}, addBrowserActivityListener: (fn: () => void) => activityListeners.add(fn), removeBrowserActivityListener: (fn: () => void) => activityListeners.delete(fn) };
    if (name.endsWith('/adminPagedApi')) return { getAdminClientsPage: clientsRead };
    if (name.endsWith('/depositMinimum')) return { DEPOSIT_MINIMUM_USD: 500 };
    if (name.endsWith('/adminStyles')) return { styles: new Proxy({}, { get: () => ({}) }) };
    if (name.endsWith('/AdminPrimitives')) return { CopyValue: ({ value }: any) => React.createElement('span', null, value), RailLabel: () => null };
    if (name.endsWith('/Skeleton')) return { Skeleton: () => React.createElement('span', null, 'loading') };
    if (name.endsWith('/CreditDepositDrawer')) return { CreditDepositDrawer: () => null };
    if (name.endsWith('/DepositCopiesSection')) return { DepositCopiesSection: () => null };
    if (name.endsWith('/adminDepositApi')) return { adminDepositApi: deposits, AdminDepositApiError: Error, STATE_LABEL: {}, IGNORE_REASON_LABEL: {} };
    if (name.endsWith('/adminWorkSummary')) return { refreshAdminSummary: summary };
    if (name.endsWith('/useAdminRead')) return load('src/pages/admin/useAdminRead.ts');
    if (name.endsWith('/adminPageSupport')) return load('src/pages/admin/adminPageSupport.tsx');
    // Phone arrangement only (matchMedia); desktop markup under test.
    if (name.endsWith('/useAdminCompact')) return { useAdminCompact: () => false };
    throw new Error(`Unexpected import ${name}`);
  });
  return output;
}
const mount = () => React.act(async () => { root.render(React.createElement(Page)); await flush(); });
const tick = (ms: number) => React.act(async () => { await jest.advanceTimersByTimeAsync(ms); await flush(); });
const click = (selector: string) => React.act(async () => { const element = document.querySelector(selector); expect(element).not.toBeNull(); element!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await flush(); });
const visibility = (next: boolean) => React.act(async () => { hidden = next; document.dispatchEvent(new dom.window.Event('visibilitychange')); activityListeners.forEach(fn => fn()); await flush(); });
const focus = () => React.act(async () => { window.dispatchEvent(new dom.window.Event('focus')); await flush(); });
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/admin/deposits', pretendToBeVisual: true });
  hidden = false; token = 'fixture-owner'; sessionListeners = new Set(); activityListeners = new Set(); location = { hash: '', search: '' };
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => hidden });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  deposits = { queue: jest.fn().mockResolvedValue(queue()), openTrigger: jest.fn().mockResolvedValue({ ran: false }), attribute: jest.fn().mockResolvedValue({}), restore: jest.fn().mockResolvedValue({}) };
  api = { getAllClients: jest.fn().mockResolvedValue([]), getAdminIncomingDepositFeed: jest.fn() };
  clientsRead = jest.fn().mockResolvedValue({ items: [{ id: 'client-a', email: 'alice@example.invalid' }], total: 1, page: 1, pageSize: 20, totalPages: 1, asOf: new Date().toISOString() });
  summary = jest.fn(); Page = load('src/pages/admin/AdminDepositsPage.tsx').AdminDepositsPage;
  root = req('react-dom/client').createRoot(document.getElementById('root'));
});
afterEach(async () => { await React.act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); delete (globalThis as any).window; delete (globalThis as any).document; delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; });

test('opening deposits does not fetch the whole client directory or start a queue poll', async () => {
  await mount(); expect(api.getAllClients).not.toHaveBeenCalled(); expect(clientsRead).not.toHaveBeenCalled();
  expect(deposits.openTrigger).toHaveBeenCalledTimes(1); expect(deposits.queue).toHaveBeenCalledTimes(1);
  await tick(180_000); expect(deposits.queue).toHaveBeenCalledTimes(1);
});
test('unknown counts are dashes until a successful response', async () => {
  deposits.queue.mockReturnValue(new Promise(() => {})); await mount();
  expect(Array.from(document.querySelectorAll('.admin-user-tab-count')).map(x => x.textContent)).toEqual(Array(7).fill('—'));
});
test('summary links select the requested queue and user instead of silently opening READY', async () => {
  location.search = '?state=UNATTRIBUTED&userId=user-a';
  deposits.queue.mockResolvedValue(queue([row('match', 'user-a'), row('other', 'user-b')])); await mount();
  expect(document.querySelector('[data-deposit-tab="unattributed"]')?.getAttribute('aria-selected')).toBe('true');
  expect(document.querySelector('[data-deposit-row="match"]')).not.toBeNull();
  expect(document.querySelector('[data-deposit-row="other"]')).toBeNull();
});
test('hidden page aborts a pending queue read and ignores its late response', async () => {
  const pending = deferred(); deposits.queue.mockReturnValueOnce(pending.promise); await mount();
  const signal = deposits.queue.mock.calls[0][0]; await visibility(true); expect(signal.aborted).toBe(true);
  await React.act(async () => { pending.resolve(queue([row('late')])); await flush(); });
  expect(document.querySelector('[data-deposit-row="late"]')).toBeNull();
  await visibility(false); expect(deposits.queue).toHaveBeenCalledTimes(2);
});
test('explicit refresh is available and a hung transport settles after fifteen seconds', async () => {
  deposits.queue.mockReturnValueOnce(new Promise(() => {})); await mount(); await tick(15_000);
  expect(document.body.textContent).toContain('время ожидания');
  await click('[data-deposit-refresh]'); expect(deposits.queue).toHaveBeenCalledTimes(2);
});
test('attribution clients load only after opening the picker, with bounded pagination', async () => {
  location.search = '?state=UNATTRIBUTED'; deposits.queue.mockResolvedValue(queue([row()])); await mount();
  expect(clientsRead).not.toHaveBeenCalled(); await click('[data-client-picker]');
  expect(clientsRead).toHaveBeenCalledTimes(1);
  expect(new URLSearchParams(clientsRead.mock.calls[0][0]).get('pageSize')).toBe('20');
  expect(document.body.textContent).toContain('alice@example.invalid');
});
test('quick focus keeps fresh data; stale focus makes one read without restarting a schedule', async () => {
  await mount(); await tick(20_000); await focus(); await focus(); expect(deposits.queue).toHaveBeenCalledTimes(1);
  await tick(10_000); await focus(); await focus(); expect(deposits.queue).toHaveBeenCalledTimes(2);
  await tick(300_000); expect(deposits.queue).toHaveBeenCalledTimes(2); expect(deposits.openTrigger).toHaveBeenCalledTimes(1);
});
test('unmount aborts pending work and prevents later reads', async () => {
  deposits.queue.mockReturnValue(new Promise(() => {})); await mount(); const signal = deposits.queue.mock.calls[0][0];
  await React.act(async () => root.render(null)); expect(signal.aborted).toBe(true);
  await tick(300_000); await focus(); expect(deposits.queue).toHaveBeenCalledTimes(1);
});
test('session replacement clears private queue and ignores a response from the previous session', async () => {
  location.search = '?state=UNATTRIBUTED'; const pending = deferred(); deposits.queue.mockReturnValueOnce(pending.promise); await mount();
  const oldSignal = deposits.queue.mock.calls[0][0]; deposits.queue.mockResolvedValueOnce(queue([row('new-owner')]));
  await React.act(async () => { token = 'second-owner'; sessionListeners.forEach(fn => fn()); await flush(); });
  expect(oldSignal.aborted).toBe(true); expect(document.querySelector('[data-deposit-row="new-owner"]')).not.toBeNull();
  await React.act(async () => { pending.resolve(queue([row('old-owner')])); await flush(); });
  expect(document.querySelector('[data-deposit-row="old-owner"]')).toBeNull();
  await React.act(async () => { token = null; sessionListeners.forEach(fn => fn()); await flush(); });
  expect(document.querySelector('[data-deposit-row]')).toBeNull(); await tick(90_000); await focus(); expect(deposits.queue).toHaveBeenCalledTimes(2);
});
test.each([401, 403])('permission failure %s erases retained queue instead of presenting stale private data', async status => {
  location.search = '?state=UNATTRIBUTED'; deposits.queue.mockResolvedValueOnce(queue([row()])); await mount();
  deposits.queue.mockRejectedValueOnce(Object.assign(new Error('fixture denied'), { status })); await click('[data-deposit-refresh]');
  expect(document.querySelector('[data-deposit-row]')).toBeNull(); expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(document.querySelector('.admin-user-tab-count')?.textContent).toBe('—');
});
test('failed refresh retains last successful data with a stale notice and explicit retry recovers', async () => {
  location.search = '?state=UNATTRIBUTED'; deposits.queue.mockResolvedValueOnce(queue([row()])); await mount();
  deposits.queue.mockRejectedValueOnce(new Error('fixture offline')); await click('[data-deposit-refresh]');
  expect(document.querySelector('[data-deposit-row]')).not.toBeNull(); expect(document.body.textContent).toContain('устаревшими');
  deposits.queue.mockResolvedValueOnce(queue()); await click('[data-deposit-refresh]');
  expect(document.querySelector('[data-deposit-row]')).toBeNull(); expect(document.querySelector('[role="alert"]')).toBeNull();
});
test('truncated queue does not publish exact zero counts or a complete empty-state claim', async () => {
  deposits.queue.mockResolvedValue({ ...queue(), counts: { ...queue().counts, truncated: true, uncreditedTotal: 2500 } }); await mount();
  expect(Array.from(document.querySelectorAll('.admin-user-tab-count')).map(x => x.textContent)).toEqual(Array(7).fill('—'));
  expect(document.body.textContent).toContain('В загруженной части'); expect(document.body.textContent).not.toContain('Нет пакетов, готовых');
});
test('opening copies aborts a pending client lookup without refetching the whole queue', async () => {
  location.search = '?state=UNATTRIBUTED'; deposits.queue.mockResolvedValue(queue([row()])); clientsRead.mockReturnValue(new Promise(() => {}));
  await mount(); await click('[data-client-picker]'); const signal = clientsRead.mock.calls[0][1];
  await click('[data-deposit-view="copies"]'); expect(signal.aborted).toBe(true);
  await tick(180_000); expect(deposits.queue).toHaveBeenCalledTimes(1); expect(clientsRead).toHaveBeenCalledTimes(1);
});
test('attribution refreshes the queue and shared summary once after the existing action succeeds', async () => {
  location.search = '?state=UNATTRIBUTED'; deposits.queue.mockResolvedValue(queue([row()])); await mount();
  await click('[data-client-picker]'); await click('[data-client-choice="client-a"]'); await click('[data-attribute="transfer-a"]');
  expect(deposits.attribute).toHaveBeenCalledTimes(1); expect(deposits.attribute).toHaveBeenCalledWith('transfer-a', 'client-a', false);
  expect(deposits.queue).toHaveBeenCalledTimes(2); expect(summary).toHaveBeenCalledTimes(1);
});
test('paged client search remains bounded and cancellation on a hidden tab aborts its request', async () => {
  location.search = '?state=UNATTRIBUTED'; deposits.queue.mockResolvedValue(queue([row()]));
  clientsRead.mockResolvedValueOnce({ items: [{ id: 'a', email: 'a@example.invalid' }], total: 40, page: 1, pageSize: 20, totalPages: 2 });
  await mount(); await click('[data-client-picker]'); clientsRead.mockReturnValueOnce(new Promise(() => {}));
  await click('[aria-label="Следующая страница пользователей"]');
  const query = new URLSearchParams(clientsRead.mock.calls[1][0]); expect(query.get('page')).toBe('2'); expect(query.get('pageSize')).toBe('20');
  const signal = clientsRead.mock.calls[1][1]; await visibility(true); expect(signal.aborted).toBe(true);
});
test('typing an attribution email makes no request until explicit search submission', async () => {
  location.search = '?state=UNATTRIBUTED'; deposits.queue.mockResolvedValue(queue([row()])); await mount(); await click('[data-client-picker]');
  const input = document.querySelector('[aria-label="Поиск пользователя"]') as HTMLInputElement;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'alice@example.invalid');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await flush();
  });
  expect(clientsRead).toHaveBeenCalledTimes(1);
  await React.act(async () => { input.closest('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await flush(); });
  expect(clientsRead).toHaveBeenCalledTimes(2); expect(new URLSearchParams(clientsRead.mock.calls[1][0]).get('search')).toBe('alice@example.invalid');
});
