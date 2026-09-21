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
async function mountDeposits() {
  const { AdminDepositsPage } = load(resolve(frontend, 'src/pages/admin/AdminDepositsPage'));
  const { MemoryRouter } = req('react-router-dom');
  await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(AdminDepositsPage))); await flush(); });
}

test.each([['BELOW_MINIMUM', '299'], ['PENDING', '350.123456'], ['PENDING', '10000']])('%s history shows exact %s and credits only on admin action without sending amount', async (status, amount) => {
  const deposit = { id: 'local-deposit', userId: 'local-user', userEmail: 'owner@example.invalid', asset: 'USDT', chain: 'tron',
    txHash: 'a'.repeat(64), amount, confirmations: 25, status, createdAt: new Date().toISOString() };
  Object.assign(api, {
    getAdminIncomingDepositFeed: jest.fn(async () => ({ transfers: [], failedChains: [] })),
    getAdminDeposits: jest.fn(async () => [{ ...deposit }]), getAllClients: jest.fn(async () => []),
    creditDepositManually: jest.fn(async () => { deposit.status = 'CREDITED'; return { status: 'CREDITED', amount, confirmations: 25 }; }),
  });
  await mountDeposits();
  expect(host.textContent).toContain(status); expect(host.textContent).toContain(amount);
  expect(api.creditDepositManually).not.toHaveBeenCalled();
  await click('Зачислить вручную');
  expect(api.creditDepositManually).toHaveBeenCalledTimes(1);
  expect(api.creditDepositManually).toHaveBeenCalledWith({ userId: 'local-user', chain: 'tron', txHash: deposit.txHash, asset: 'USDT' });
  expect(host.querySelector('[role="status"]')!.textContent).toBe('Депозит зачислен.');
  expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent === 'Зачислить вручную')).toBe(false);
});

test('deposit discovery is on demand, coalesces overlapping clicks and never polls', async () => {
  let release: (value: any) => void = () => {};
  Object.assign(api, {
    getAdminIncomingDepositFeed: jest.fn(() => new Promise(resolve => { release = resolve; })),
    getAdminDeposits: jest.fn(async () => []), getAllClients: jest.fn(async () => []),
  });
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  try {
    await mountDeposits();
    await click('Обновить входящие'); await click('Обновить входящие');
    expect(api.getAdminIncomingDepositFeed).toHaveBeenCalledTimes(1);
    await act(async () => { release({ transfers: [], failedChains: [] }); await flush(); });
    await act(async () => { jest.advanceTimersByTime(60 * 60_000); await flush(); });
    expect(api.getAdminIncomingDepositFeed).toHaveBeenCalledTimes(1);
    await click('Обновить входящие');
    expect(api.getAdminIncomingDepositFeed).toHaveBeenCalledTimes(2);
    await act(async () => { release({ transfers: [], failedChains: [] }); await flush(); });
  } finally { jest.useRealTimers(); }
});

test('provider partial failure cannot render the empty incoming success message', async () => {
  Object.assign(api, {
    getAdminIncomingDepositFeed: jest.fn(async () => ({ transfers: [], failedChains: ['tron'] })),
    getAdminDeposits: jest.fn(async () => []), getAllClients: jest.fn(async () => []),
  });
  await mountDeposits();
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('загружены не полностью');
  expect(host.textContent).not.toContain('В доступной ленте нет непривязанных переводов.');
});
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
  expect(host.querySelector('thead')!.textContent).not.toContain('Источник');
  expect(host.querySelector('tbody')!.textContent).toContain(wallets[0].address);
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
  expect(host.querySelector('tbody')!.textContent).toContain(wallets[0].defaultAddress);
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

/* The console has no overview page any more: /admin opens Пользователи
   directly, and AdminOverviewPage.tsx is deleted. The tests that drove it
   went with it — the data it showed (newest users, incoming deposits,
   pending KYC) is covered on the pages that own it. */

