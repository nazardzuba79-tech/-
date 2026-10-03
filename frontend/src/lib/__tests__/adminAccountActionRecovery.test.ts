import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { act } = React, { JSDOM } = req('jsdom');
const flush = () => new Promise<void>(done => setImmediate(done));
let dom: any, root: any, host: HTMLElement, token: string | null;
let modules: Map<string, any>, listeners: Set<() => void>, browserFetch: jest.Mock, clearToken: jest.Mock;
let demoTopUp: jest.Mock, blockUser: jest.Mock, unblockUser: jest.Mock, changed: jest.Mock;
const profile = { id: 'fixture-user', email: 'client@example.invalid', isBlocked: false, balances: [] };
function load(file: string): any {
  for (const suffix of ['', '.ts', '.tsx']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('/api')) return { API_BASE: '/api/v1', getToken: () => token, clearToken: () => clearToken(), onSessionChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }, api: { demoTopUp: (...args: any[]) => demoTopUp(...args), blockUser: (...args: any[]) => blockUser(...args), unblockUser: (...args: any[]) => unblockUser(...args) } };
    if (name.endsWith('/browserActivity')) return { browserFetch: (...args: any[]) => browserFetch(...args) };
    if (name.endsWith('/adminReadApi')) return { adminRead: jest.fn() };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  host = document.getElementById('root')!; root = req('react-dom/client').createRoot(host);
  modules = new Map(); listeners = new Set(); token = 'fixture-admin'; changed = jest.fn();
  browserFetch = jest.fn(); clearToken = jest.fn(() => { token = null; listeners.forEach(fn => fn()); });
  demoTopUp = jest.fn(async () => ({})); blockUser = jest.fn(async () => ({})); unblockUser = jest.fn(async () => ({}));
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); });
async function render(next = profile) {
  const Component = load(resolve(frontend, 'src/pages/admin/AdminAccountActions.tsx')).AdminAccountActions;
  await act(async () => { root.render(React.createElement(Component, { profile: next, onChanged: changed })); await flush(); });
}
function button(text: string) {
  const found = Array.from(host.querySelectorAll('button')).find(b => b.textContent === text);
  if (!found) throw new Error(`Missing button ${text}: ${host.textContent}`);
  return found;
}
async function click(text: string) { await act(async () => { button(text).click(); await flush(); }); }
async function fill(index: number, value: string) {
  const field = host.querySelectorAll('input,textarea')[index] as HTMLInputElement;
  await act(async () => { const proto = field.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value); field.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await flush(); });
}
async function prepareDemo() { await render(); await click('Тестовое начисление'); await fill(1, '25'); await fill(2, 'Synthetic reconciliation'); await click('Проверить действие'); }

describe('balance adjustment response session ownership', () => {
  test('old 401 JSON body resolving after session change cannot clear the new session', async () => {
    let finish!: (value: unknown) => void;
    const json = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    browserFetch.mockResolvedValue({ ok: false, status: 401, json });
    const { postAdminAdjustment } = load(resolve(frontend, 'src/lib/adminBalanceApi.ts'));
    const result = postAdminAdjustment(profile.id, { asset: 'USDT', amount: '1', reason: 'Fixture', idempotencyKey: 'fixture-key' }, new AbortController().signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await flush(); expect(json).toHaveBeenCalledTimes(1);
    token = 'different-authenticated-admin'; listeners.forEach(fn => fn());
    finish({ error: 'Expired old session' }); await rejected;
    expect(clearToken).not.toHaveBeenCalled(); expect(token).toBe('different-authenticated-admin');
  });
  test('current session authoritative 401 still expires that session', async () => {
    browserFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Expired' }) });
    const { postAdminAdjustment } = load(resolve(frontend, 'src/lib/adminBalanceApi.ts'));
    await expect(postAdminAdjustment(profile.id, { asset: 'USDT', amount: '1', reason: 'Fixture', idempotencyKey: 'fixture-key' }, new AbortController().signal)).rejects.toMatchObject({ status: 401 });
    expect(clearToken).toHaveBeenCalledTimes(1); expect(token).toBeNull();
  });
});

describe('non-idempotent account actions', () => {
  test('review identifies user, test account, amount and reason; cancel never writes', async () => {
    await prepareDemo(); expect(host.textContent).toContain(profile.email); expect(host.textContent).toContain(profile.id); expect(host.textContent).toContain('25 USDT'); expect(host.textContent).toContain('Synthetic reconciliation');
    expect(demoTopUp).not.toHaveBeenCalled(); await click('Отмена'); expect(demoTopUp).not.toHaveBeenCalled(); expect(host.querySelector('dialog')).toBeNull();
  });
  test('rapid double click only submits once and confirmed success refreshes once', async () => {
    let finish!: () => void; demoTopUp.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await prepareDemo(); await act(async () => { const confirm = button('Подтвердить'); confirm.click(); confirm.click(); await flush(); });
    expect(demoTopUp).toHaveBeenCalledTimes(1); expect(demoTopUp).toHaveBeenCalledWith(profile.id, 'USDT', '25', 'Synthetic reconciliation');
    await act(async () => { finish(); await flush(); }); expect(changed).toHaveBeenCalledTimes(1);
  });
  test('lost response remains blocked after tab unmount/remount', async () => {
    demoTopUp.mockRejectedValue(new Error('Lost response')); await prepareDemo(); await click('Подтвердить');
    expect(host.textContent).toContain('Результат не определён');
    await act(async () => root.render(null)); await render(); await click('Тестовое начисление');
    expect(host.textContent).toContain('Повтор заблокирован'); expect(host.querySelector('form')).toBeNull(); expect(demoTopUp).toHaveBeenCalledTimes(1);
  });
  test('unmount while request hangs preserves unresolved operation before its response', async () => {
    demoTopUp.mockReturnValue(new Promise(() => {})); await prepareDemo(); await click('Подтвердить');
    await act(async () => root.render(null)); await render(); await click('Тестовое начисление');
    expect(host.querySelector('form')).toBeNull(); expect(host.textContent).toContain('Повтор заблокирован'); expect(demoTopUp).toHaveBeenCalledTimes(1);
  });
  test('15-second timeout stays unknown across remount without retry', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] }); demoTopUp.mockReturnValue(new Promise(() => {}));
    await prepareDemo(); await click('Подтвердить'); await act(async () => { jest.advanceTimersByTime(15_001); await flush(); });
    expect(host.textContent).toContain('Результат не определён'); expect(changed).not.toHaveBeenCalled();
    await act(async () => root.render(null)); await render(); await click('Тестовое начисление'); expect(host.querySelector('form')).toBeNull(); expect(demoTopUp).toHaveBeenCalledTimes(1);
  });
  test('logout clears in-memory private intent and a new session starts without its warning', async () => {
    demoTopUp.mockRejectedValue(new Error('Lost response')); await prepareDemo(); await click('Подтвердить');
    await act(async () => { token = null; listeners.forEach(fn => fn()); root.render(null); await flush(); });
    token = 'new-admin-session'; await render(); await click('Тестовое начисление'); expect(host.querySelector('form')).not.toBeNull(); expect(host.textContent).not.toContain('Результат не определён'); expect(demoTopUp).toHaveBeenCalledTimes(1);
  });
  test('server validation refusal does not create an unresolved operation on return', async () => {
    demoTopUp.mockRejectedValue(Object.assign(new Error('Invalid'), { status: 400 })); await prepareDemo(); await click('Подтвердить');
    await act(async () => root.render(null)); await render(); await click('Тестовое начисление'); expect(host.querySelector('form')).not.toBeNull(); expect(demoTopUp).toHaveBeenCalledTimes(1);
  });
  test('an active account offers no block action (owner, 2026-10-03); nothing is sent', async () => {
    await render();
    expect(Array.from(host.querySelectorAll('button')).some(button => /Заблокировать/.test(button.textContent || ''))).toBe(false);
    expect(Array.from(host.querySelectorAll('button')).some(button => /Разблокировать/.test(button.textContent || ''))).toBe(false);
    expect(blockUser).not.toHaveBeenCalled(); expect(unblockUser).not.toHaveBeenCalled();
  });
  test('unblock asks only for explicit target confirmation, not a reason the legacy endpoint cannot record', async () => {
    await render({ ...profile, isBlocked: true }); await click('Разблокировать');
    expect(host.querySelector('textarea')).toBeNull(); expect(host.textContent).not.toContain('Причина');
    expect(host.textContent).toContain(profile.email); expect(host.textContent).toContain(profile.id);
    await click('Проверить действие'); expect(unblockUser).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Доступ пользователя будет восстановлен.');
    await click('Отмена'); expect(unblockUser).not.toHaveBeenCalled();
    await click('Разблокировать'); await click('Проверить действие'); await click('Подтвердить');
    expect(unblockUser).toHaveBeenCalledTimes(1); expect(unblockUser).toHaveBeenCalledWith(profile.id);
    expect(blockUser).not.toHaveBeenCalled(); expect(demoTopUp).not.toHaveBeenCalled();
  });
});
