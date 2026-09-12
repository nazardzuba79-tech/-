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
    if (name.endsWith('/useAdminAlerts')) return { isAdminAlertSoundEnabled: () => false, setAdminAlertSoundEnabled: jest.fn() };
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
  expect(host.textContent).toContain('По умолчанию');
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
