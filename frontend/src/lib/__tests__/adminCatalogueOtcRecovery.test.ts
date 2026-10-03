import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { act } = React;
const { JSDOM } = req('jsdom');
const flush = () => new Promise<void>(done => setImmediate(done));
let dom: any, host: HTMLElement, root: any, token: string;
let getCatalogue: jest.Mock, saveEntry: jest.Mock, cashRequest: jest.Mock;
const modules = new Map<string, any>();
const listeners = new Set<() => void>();
const entry = { assetId: 'bitcoin', asset: 'BTC', networkId: 'bitcoin', networkName: 'Bitcoin', standard: 'Native', address: 'fixture-current-address', memo: '', memoLabel: '', memoAllowed: false, enabled: true, status: 'configured' };
const catalogue = { revision: 'revision-1', rankingAvailable: true, assets: [{ assetId: 'bitcoin', asset: 'BTC', name: 'Bitcoin', rank: 1, top: true }], entries: [entry] };
function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts', '.json']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'));
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/depositCatalogue')) return { getAdminCatalogue: (...args: any[]) => getCatalogue(...args), saveCatalogueEntry: (...args: any[]) => saveEntry(...args) };
    if (name.endsWith('/api')) return { getToken: () => token, onSessionChange: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
    if (name.endsWith('/spendableBalances')) return { invalidateSpendableBalances: jest.fn() };
    if (name.endsWith('/otcConfig')) return { countryName: () => 'Украина' };
    if (name.endsWith('/cashApi')) return {
      CASH_STATUSES: { RESERVED: 'В резерве', OFFERED: 'Предложены условия' },
      dateTime: (value: string) => value, cashError: (error: Error) => error.message,
      cashRequest: (...args: any[]) => cashRequest(...args),
    };
    if (name.endsWith('/AdminPrimitives')) return {
      CopyValue: ({ value }: any) => React.createElement('span', null, value),
      AdminModal: ({ children, onClose }: any) => React.createElement('div', { role: 'dialog' }, React.createElement('button', { onClick: onClose }, 'Закрыть'), children),
    };
    if (name.endsWith('/OtcCashDesk')) {
      const actual = load(resolve(dirname(file), name));
      return { ...actual, CashDetailPanel: ({ onClose }: any) => React.createElement('section', { 'data-fixture-detail': true }, React.createElement('button', { onClick: onClose }, 'Вернуться в очередь')) };
    }
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/admin' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  host = document.getElementById('root')!; root = req('react-dom/client').createRoot(host);
  modules.clear(); listeners.clear(); token = 'fixture-admin-one';
  getCatalogue = jest.fn(async () => structuredClone(catalogue));
  saveEntry = jest.fn(async () => ({ revision: 'revision-2' }));
  cashRequest = jest.fn(async () => ({ hasMore: true, rows: [{ id: 'request-1', number: 'OTC-0001', status: 'OFFERED', country: 'UA', cityId: 'kyiv', quantity: '500', reservedQuantity: '500', asset: 'USDT', fiat: 'USD', createdAt: '2026-10-03T08:00:00.000Z', user: { id: 'fixture-user', email: 'fixture@example.invalid' } }] }));
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); });
function button(text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent === text && !item.closest('[hidden]'));
  if (!result) throw new Error(`Missing button: ${text}; ${host.textContent}`);
  return result;
}
async function click(text: string) { await act(async () => { button(text).click(); await flush(); }); }
async function mount(name: string) { const page = load(resolve(frontend, `src/pages/admin/${name}`))[name]; await act(async () => { root.render(React.createElement(page)); await flush(); }); }

describe('catalogue accepted save followed by failed read', () => {
  test.each(['Сохранить', 'Очистить адрес'])('%s does not turn an accepted mutation into a failed save or discard the last table', async action => {
    await mount('AdminDepositCatalogue'); await click('Изменить');
    getCatalogue.mockRejectedValueOnce(new Error('fixture reread unavailable'));
    await click(action);
    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain(action === 'Сохранить' ? 'Адрес сохранён.' : 'Адрес очищен.');
    expect(host.querySelector('.catalogue-address')?.textContent).toContain('fixture-current-address');
    expect(host.textContent).toContain('Список не обновлён');
    expect(host.textContent).not.toContain('Не удалось сохранить');
    expect(button('Изменить').disabled).toBe(true);
    expect(button('Обновить').disabled).toBe(false);
  });
  test('a confirmed refresh re-enables editing using the latest revision, without replaying the write', async () => {
    await mount('AdminDepositCatalogue'); await click('Изменить');
    getCatalogue.mockRejectedValueOnce(new Error('fixture reread unavailable')); await click('Сохранить');
    getCatalogue.mockResolvedValueOnce({ ...catalogue, revision: 'revision-2' });
    await click('Обновить');
    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(button('Изменить').disabled).toBe(false);
    await click('Изменить'); await click('Сохранить');
    expect(saveEntry.mock.calls[1][1]).toBe('revision-2');
  });
  test('a rejected write stays in the editor and does not show success or reread', async () => {
    await mount('AdminDepositCatalogue'); await click('Изменить');
    saveEntry.mockRejectedValueOnce(new Error('Конфликт версии: обновите каталог.')); await click('Сохранить');
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('Конфликт версии');
    expect(host.textContent).not.toContain('Адрес сохранён.');
    expect(getCatalogue).toHaveBeenCalledTimes(1);
    expect(saveEntry).toHaveBeenCalledTimes(1);
  });
});

async function selectOtcQueue() {
  const select = host.querySelector('select')!;
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!.call(select, 'OFFERED'); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await flush(); });
  await click('Применить'); await click('Далее');
}
describe('OTC queue context', () => {
  test('Back retains filter and page, and refreshes exactly that queue instead of page zero', async () => {
    await mount('AdminOtcCashPage'); await selectOtcQueue();
    await act(async () => { (host.querySelector('.otc-cash-list-item') as HTMLButtonElement).click(); await flush(); });
    const afterOpen = cashRequest.mock.calls.length;
    await act(async () => { await flush(); });
    expect(cashRequest).toHaveBeenCalledTimes(afterOpen);
    await click('Вернуться в очередь');
    expect(host.textContent).toContain('Страница 2');
    expect(host.querySelector('select')?.value).toBe('OFFERED');
    expect(cashRequest.mock.calls.at(-1)[0]).toBe('/admin/otc?page=1&status=OFFERED');
    expect(cashRequest).toHaveBeenCalledTimes(afterOpen + 1);
  });
  test('changing session clears the retained queue and detail', async () => {
    await mount('AdminOtcCashPage'); await selectOtcQueue();
    await act(async () => { (host.querySelector('.otc-cash-list-item') as HTMLButtonElement).click(); await flush(); });
    await act(async () => { token = 'fixture-admin-two'; for (const listener of listeners) listener(); await flush(); });
    expect(host.querySelector('[data-fixture-detail]')).toBeNull();
    expect(host.querySelector('select')?.value).toBe('');
    expect(host.textContent).toContain('Страница 1');
    expect(cashRequest.mock.calls.at(-1)[0]).toBe('/admin/otc?page=0');
  });
});
