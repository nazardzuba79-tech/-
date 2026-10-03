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
const modules = new Map<string, any>();
let dom: any, root: any, host: HTMLElement, api: any;
let token: string | null;
const sessionListeners = new Set<() => void>();

function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8').replace(/import\.meta\.env/g, '({} as any)'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/api')) return {
      api, getToken: () => token,
      onSessionChange: (listener: () => void) => { sessionListeners.add(listener); return () => sessionListeners.delete(listener); },
      ApiError: class extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } },
    };
    if (name.endsWith('/adminReadApi')) return {
      getAdminWithdrawalsAbortable: (signal: AbortSignal) => api.getAdminWithdrawals(signal),
      getAdminKycDeliveryAbortable: (signal: AbortSignal) => api.getKycDelivery(signal),
    };
    if (name.endsWith('/browserActivity')) return { browserSetInterval: () => 1, browserClearInterval: () => {} };
    if (name.endsWith('/KycSubmissionReview')) return { KycSubmissionReview: ({ email }: any) => React.createElement('p', { 'data-review': true }, email) };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}

const withdrawal = (extra: Record<string, unknown> = {}) => ({
  id: 'withdrawal-1', userId: 'user-1', userEmail: 'queue@example.invalid', asset: 'USDT', network: 'tron',
  toAddress: 'TFixtureAddress1234567890', amount: '500.12345678', status: 'PENDING', txHash: null,
  rejectionReason: null, balanceHeld: true, createdAt: '2026-10-03T07:00:00.000Z', ...extra,
});
const client = { id: 'user-1', email: 'kyc@example.invalid', latestKyc: { id: 'submission-1', status: 'PENDING', createdAt: '2026-10-03T07:00:00.000Z' } };

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/admin/withdrawals' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.prompt = jest.fn(() => null);
  token = 'fixture-admin'; sessionListeners.clear(); modules.clear();
  host = document.getElementById('root')!;
  root = req('react-dom/client').createRoot(host);
  api = {
    getAdminWithdrawals: jest.fn(async () => [withdrawal()]),
    approveWithdrawal: jest.fn(async () => ({ id: 'withdrawal-1', status: 'APPROVED' })),
    rejectWithdrawal: jest.fn(async () => ({ id: 'withdrawal-1', status: 'REJECTED' })),
    markWithdrawalSent: jest.fn(async () => ({ id: 'withdrawal-1', status: 'SENT' })),
    getAllClients: jest.fn(async () => [client]),
    getKycDelivery: jest.fn(async () => ({ configured: true, recipient: 'review@example.invalid' })),
  };
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); });
async function mount(name: 'AdminWithdrawalsPage' | 'AdminKycPage') {
  const Component = load(resolve(frontend, 'src/pages/admin', name))[name];
  const { MemoryRouter } = req('react-router-dom');
  await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(Component))); await flush(); });
}
function button(text: string, scope: ParentNode = host): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find(el => el.textContent?.trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found as HTMLButtonElement;
}
async function click(el: HTMLElement) { await act(async () => { el.click(); await flush(); }); }
function expectNoWrites() {
  expect(api.rejectWithdrawal).not.toHaveBeenCalled();
  expect(api.approveWithdrawal).not.toHaveBeenCalled();
  expect(api.markWithdrawalSent).not.toHaveBeenCalled();
}

test.each(['cancel', 'escape', 'close'])('withdrawal rejection %s makes zero financial requests', async method => {
  await mount('AdminWithdrawalsPage');
  await click(button('Отклонить'));
  const dialog = host.querySelector('dialog');
  if (dialog) {
    if (method === 'cancel') await click(button('Отмена', dialog));
    if (method === 'close') await click(dialog.querySelector('[aria-label="Закрыть"]') as HTMLElement);
    if (method === 'escape') await act(async () => { dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true, bubbles: true })); await flush(); });
  }
  // On the previous native prompt all three dismissals return null; that was incorrectly submitted.
  expectNoWrites();
  expect(host.querySelector('dialog')).toBeNull();
});

test('KYC pending first read never claims the queue is empty', async () => {
  api.getAllClients = jest.fn(() => new Promise(() => {}));
  await mount('AdminKycPage');
  expect(host.textContent).toContain('Загрузка заявок');
  expect(host.textContent).not.toContain('Заявок нет');
});

test('KYC failed first read is an error with retry, never an empty queue', async () => {
  api.getAllClients = jest.fn(async () => { throw new Error('fixture read failure'); });
  await mount('AdminKycPage');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить заявки');
  expect(host.textContent).not.toContain('Заявок нет');
  api.getAllClients.mockResolvedValue([]);
  await click(button('Обновить'));
  expect(host.textContent).toContain('Заявок нет');
});

test.each(['approve', 'sent'])('withdrawal %s is never sent before explicit confirmation', async kind => {
  api.getAdminWithdrawals.mockResolvedValue([withdrawal({ status: kind === 'sent' ? 'APPROVED' : 'PENDING', balanceHeld: false })]);
  await mount('AdminWithdrawalsPage');
  await click(button(kind === 'sent' ? 'Отправлено' : 'Одобрить'));
  const dialog = host.querySelector('dialog')!;
  expect(dialog.textContent).toContain('queue@example.invalid');
  expect(dialog.textContent).toContain('user-1');
  expect(dialog.textContent).toContain('500.12345678 USDT');
  expect(dialog.textContent).toContain('TFixtureAddress1234567890');
  expectNoWrites();
  await click(button('Отмена', dialog));
  expectNoWrites();
});

test('withdrawal rejection without held funds explains that balance is unchanged', async () => {
  api.getAdminWithdrawals.mockResolvedValue([withdrawal({ balanceHeld: false })]);
  await mount('AdminWithdrawalsPage');
  await click(button('Отклонить'));
  expect(host.querySelector('dialog')?.textContent).toContain('Сумма не была зарезервирована; баланс не изменится');
});

async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flush();
  });
}

test('explicit rejection sends one request on a same-turn double click', async () => {
  api.rejectWithdrawal.mockImplementation(() => new Promise(() => {}));
  await mount('AdminWithdrawalsPage');
  await click(button('Отклонить'));
  expect(host.querySelector('dialog')?.textContent).toContain('зарезервированная сумма вернётся');
  const confirm = button('Подтвердить отклонение');
  await act(async () => { confirm.click(); confirm.click(); await flush(); });
  expect(api.rejectWithdrawal.mock.calls).toEqual([['withdrawal-1', undefined]]);
  expect(api.approveWithdrawal).not.toHaveBeenCalled();
  expect(api.markWithdrawalSent).not.toHaveBeenCalled();
});

test('recording a transfer requires a TXID and explains network confirmation is separate', async () => {
  api.getAdminWithdrawals.mockResolvedValue([withdrawal({ status: 'APPROVED' })]);
  await mount('AdminWithdrawalsPage');
  await click(button('Отправлено'));
  expect(button('Сохранить TXID').disabled).toBe(true);
  expect(host.querySelector('dialog')?.textContent).toContain('не является подтверждением транзакции в сети');
  await inputValue(host.querySelector('dialog input')!, ' fixture-txid ');
  await click(button('Сохранить TXID'));
  expect(api.markWithdrawalSent.mock.calls).toEqual([['withdrawal-1', 'fixture-txid']]);
  expect(dom.window.prompt).not.toHaveBeenCalled();
});

test('lost mutation response permits read recovery, never a second mutation', async () => {
  api.rejectWithdrawal.mockRejectedValue(new Error('connection lost after commit'));
  await mount('AdminWithdrawalsPage');
  await click(button('Отклонить'));
  await click(button('Подтвердить отклонение'));
  expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain('Результат действия неизвестен');
  expect(Array.from(host.querySelectorAll('dialog button')).some(el => el.textContent === 'Подтвердить отклонение')).toBe(false);
  api.getAdminWithdrawals.mockResolvedValue([withdrawal({ status: 'REJECTED' })]);
  await click(button('Проверить заявку'));
  expect(host.querySelector('dialog')?.textContent).toContain('Подтверждённый статус заявки: Отклонено');
  await click(button('Закрыть', host.querySelector('dialog')!));
  expect(api.rejectWithdrawal).toHaveBeenCalledTimes(1);
  expect(host.querySelector('dialog')).toBeNull();
});

test('a confirmed mutation followed by failed refresh is not reported as a failed mutation', async () => {
  await mount('AdminWithdrawalsPage');
  await click(button('Одобрить'));
  api.getAdminWithdrawals.mockRejectedValue(new Error('read failed'));
  await click(button('Подтвердить одобрение'));
  expect(host.querySelector('dialog')).toBeNull();
  expect(host.textContent).toContain('Не удалось загрузить выводы');
  expect(host.textContent).not.toContain('Результат действия неизвестен');
  expect(api.approveWithdrawal).toHaveBeenCalledTimes(1);
});

test('KYC stale failed refresh retains rows and does not show an empty queue', async () => {
  await mount('AdminKycPage');
  api.getAllClients.mockRejectedValue(new Error('offline'));
  await click(button('Обновить'));
  expect(host.textContent).toContain('kyc@example.invalid');
  expect(host.textContent).toContain('Данные устарели');
  expect(host.textContent).toContain('Показан последний загруженный список');
  expect(host.textContent).not.toContain('Заявок нет');
});

test('KYC delivery settings do not claim confirmed delivery; a settings error does not hide the queue', async () => {
  await mount('AdminKycPage');
  expect(host.textContent).toContain('Настройка не подтверждает доставку конкретного письма');
  api.getKycDelivery.mockRejectedValue(new Error('delivery read offline'));
  await click(button('Обновить'));
  expect(host.textContent).toContain('Не удалось проверить настройку доставки');
  expect(host.textContent).toContain('kyc@example.invalid');
});

test('KYC hanging read times out without claiming empty and aborts transport', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  api.getAllClients.mockImplementation(() => new Promise(() => {}));
  await mount('AdminKycPage');
  const signal = api.getAllClients.mock.calls[0][0];
  await act(async () => { jest.advanceTimersByTime(15_001); await flush(); });
  expect(signal.aborted).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить заявки');
  expect(host.textContent).not.toContain('Заявок нет');
  expect(button('Обновить').disabled).toBe(false);
});

test('logout dismisses an open withdrawal confirmation and sends no mutation', async () => {
  await mount('AdminWithdrawalsPage');
  await click(button('Отклонить'));
  await act(async () => { token = null; sessionListeners.forEach(listener => listener()); await flush(); });
  expect(host.querySelector('dialog')).toBeNull();
  expect(host.textContent).not.toContain('queue@example.invalid');
  expectNoWrites();
});

test('KYC a revoked role discards old rows rather than calling the queue empty', async () => {
  await mount('AdminKycPage');
  api.getAllClients.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
  await click(button('Обновить'));
  expect(host.textContent).not.toContain('kyc@example.invalid');
  expect(host.textContent).not.toContain('Заявок нет');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
