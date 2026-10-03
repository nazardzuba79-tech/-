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
    if (name.endsWith('/adminPagedApi')) return {
      getAdminClientsPage: (query: string, signal: AbortSignal) => api.getAdminClientsPage(query, signal),
      getAdminWithdrawalsPage: (query: string, signal: AbortSignal) => api.getAdminWithdrawalsPage(query, signal),
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
  Object.assign(globalThis, { requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window) });
  dom.window.scrollTo = jest.fn();
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
    getAdminClientsPage: jest.fn(async (_query: string, signal: AbortSignal) => {
      const items = await api.getAllClients(signal);
      return { items, total: items.length, page: 1, pageSize: 20, totalPages: items.length ? 1 : 0, asOf: new Date().toISOString() };
    }),
    getAdminWithdrawalsPage: jest.fn(async (_query: string, signal: AbortSignal) => {
      const items = await api.getAdminWithdrawals(signal);
      return { items, total: items.length, page: 1, pageSize: 20, totalPages: items.length ? 1 : 0, asOf: new Date().toISOString() };
    }),
  };
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); });
async function mount(name: 'AdminWithdrawalsPage' | 'AdminKycPage', entry = name === 'AdminKycPage' ? '/admin/kyc' : '/admin/withdrawals') {
  const Component = load(resolve(frontend, 'src/pages/admin', name))[name];
  const { MemoryRouter, useLocation } = req('react-router-dom');
  const LocationProbe = () => { const loc = useLocation(); return React.createElement('output', { 'data-location': true }, loc.pathname + loc.search); };
  await act(async () => { root.render(React.createElement(MemoryRouter, { initialEntries: [entry] }, React.createElement(Component), React.createElement(LocationProbe))); await flush(); });
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
  expect(host.textContent).toContain('Загрузка');
  expect(host.textContent).not.toContain('Заявок нет');
});

test('KYC failed first read is an error with retry, never an empty queue', async () => {
  api.getAllClients = jest.fn(async () => { throw new Error('fixture read failure'); });
  await mount('AdminKycPage');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить заявки');
  expect(host.textContent).not.toContain('Заявок нет');
  api.getAllClients.mockResolvedValue([]);
  await click(button('Повторить'));
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
  expect(button('Повторить').disabled).toBe(false);
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

function page(items: unknown[], total = items.length, current = 1) {
  return { items, total, page: current, pageSize: 20, totalPages: Math.ceil(total / 20), asOf: '2026-10-03T07:00:00.000Z' };
}
function latestQuery(method: jest.Mock) { return new URLSearchParams(method.mock.calls[method.mock.calls.length - 1][0]); }

test('KYC applies URL search/status/page on the server and retains them across refresh and paging', async () => {
  api.getAdminClientsPage.mockImplementation(async (query: string) => page([{ ...client, latestKyc: { ...client.latestKyc, status: 'REJECTED' } }], 81, Number(new URLSearchParams(query).get('page'))));
  await mount('AdminKycPage', '/admin/kyc?status=REJECTED&search=alice&page=2');
  expect(Object.fromEntries(latestQuery(api.getAdminClientsPage))).toEqual({ page: '2', pageSize: '20', status: 'REJECTED', search: 'alice' });
  expect(api.getAllClients).not.toHaveBeenCalled();
  expect(host.querySelectorAll('[data-kyc-client]')).toHaveLength(1);
  expect(host.textContent).toContain('Пользователи: 21–21 из 81');
  await click(button('Далее'));
  expect(latestQuery(api.getAdminClientsPage).get('page')).toBe('3');
  await click(button('Обновить'));
  expect(Object.fromEntries(latestQuery(api.getAdminClientsPage))).toEqual({ page: '3', pageSize: '20', status: 'REJECTED', search: 'alice' });
  expect(host.querySelector('[data-location]')?.textContent).toContain('page=3');
  expect(host.querySelector('a')?.getAttribute('href')).toContain(encodeURIComponent('/admin/kyc?status=REJECTED&search=alice&page=3'));
});

test('KYC search typing performs no request until submit, then resets only the page', async () => {
  api.getAdminClientsPage.mockResolvedValue(page([client], 60, 3));
  await mount('AdminKycPage', '/admin/kyc?status=APPROVED&page=3');
  await inputValue(host.querySelector('[aria-label="Поиск заявок KYC"]')!, ' user-42 ');
  expect(api.getAdminClientsPage).toHaveBeenCalledTimes(1);
  await click(button('Найти'));
  expect(Object.fromEntries(latestQuery(api.getAdminClientsPage))).toEqual({ page: '1', pageSize: '20', status: 'APPROVED', search: 'user-42' });
});

test('KYC latest-submission calendar filters are sent as Kyiv bounds and survive refresh', async () => {
  await mount('AdminKycPage', '/admin/kyc?status=all&fromDate=2026-10-25&toDate=2026-10-25');
  expect(latestQuery(api.getAdminClientsPage).get('from')).toBe('2026-10-24T21:00:00.000Z');
  expect(latestQuery(api.getAdminClientsPage).get('to')).toBe('2026-10-25T21:59:59.999Z');
  expect((host.querySelector('[aria-label="Дата заявки с"]') as HTMLInputElement).value).toBe('2026-10-25');
  await click(button('Обновить'));
  expect(latestQuery(api.getAdminClientsPage).get('from')).toBe('2026-10-24T21:00:00.000Z');
  await click(button('Сбросить'));
  expect(latestQuery(api.getAdminClientsPage).has('from')).toBe(false);
  expect(latestQuery(api.getAdminClientsPage).has('to')).toBe(false);
});

test('KYC user deep link searches the supplied ID without incorrectly forcing pending', async () => {
  api.getAdminClientsPage.mockResolvedValue(page([{ ...client, latestKyc: null, kycStatus: 'NOT_STARTED' }]));
  await mount('AdminKycPage', '/admin/kyc?user=user-1');
  expect(latestQuery(api.getAdminClientsPage).get('search')).toBe('user-1');
  expect(latestQuery(api.getAdminClientsPage).get('status')).toBe('all');
  expect(host.textContent).toContain('Заявка не подана');
  expect(host.textContent).toContain('У пользователя ещё нет заявки');
  expect(host.querySelector('[data-review]')).toBeNull();
});

test('delayed KYC page A cannot overwrite current page B', async () => {
  let resolveA!: (data: unknown) => void;
  api.getAdminClientsPage.mockImplementationOnce(() => new Promise(done => { resolveA = done; }));
  await mount('AdminKycPage');
  const signalA = api.getAdminClientsPage.mock.calls[0][1];
  api.getAdminClientsPage.mockResolvedValue(page([{ ...client, email: 'current-b@example.invalid' }]));
  const select = host.querySelector('[aria-label="Статус KYC"]') as HTMLSelectElement;
  await act(async () => { select.value = 'APPROVED'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await flush(); });
  await act(async () => { resolveA(page([{ ...client, email: 'stale-a@example.invalid' }])); await flush(); });
  expect(signalA.aborted).toBe(true);
  expect(host.textContent).toContain('current-b@example.invalid');
  expect(host.textContent).not.toContain('stale-a@example.invalid');
});

test('withdrawals read the full server-filtered working queue, not the legacy 200-row endpoint', async () => {
  api.getAdminWithdrawalsPage.mockResolvedValue(page([withdrawal({ status: 'APPROVED' })], 1250, 2));
  await mount('AdminWithdrawalsPage', '/admin/withdrawals?status=APPROVED&search=USDT&page=2');
  expect(Object.fromEntries(latestQuery(api.getAdminWithdrawalsPage))).toEqual({ page: '2', pageSize: '20', status: 'APPROVED', search: 'USDT' });
  expect(api.getAdminWithdrawals).not.toHaveBeenCalled();
  expect(host.querySelectorAll('[data-withdrawal-row]')).toHaveLength(1);
  expect(host.textContent).toContain('Заявки: 21–21 из 1250');
  expect(host.textContent).toContain('500.12345678 USDT');
  expect(host.textContent).toContain('TFixtureAddress1234567890');
  await click(button('Далее'));
  expect(latestQuery(api.getAdminWithdrawalsPage).get('page')).toBe('3');
  await click(button('Ожидают проверки'));
  expect(Object.fromEntries(latestQuery(api.getAdminWithdrawalsPage))).toEqual({ page: '1', pageSize: '20', status: 'PENDING', search: 'USDT' });
});

test('processed withdrawals show complete recorded TXID and preserve legacy completed rows without action buttons', async () => {
  const txHash = 'f'.repeat(64);
  api.getAdminWithdrawalsPage.mockResolvedValue(page([withdrawal({ status: 'COMPLETED', txHash })]));
  await mount('AdminWithdrawalsPage', '/admin/withdrawals?status=processed');
  expect(host.textContent).toContain(txHash);
  expect(host.textContent).toContain('Отмечено отправленным');
  expect(Array.from(host.querySelectorAll('[data-withdrawal-row] button')).some(el => ['Одобрить', 'Отклонить', 'Отправлено'].includes(el.textContent ?? ''))).toBe(false);
  expectNoWrites();
});

test('an uncertain withdrawal omitted from its queue is looked up independently and never assumed uncommitted', async () => {
  api.getAdminWithdrawalsPage.mockImplementation(async (query: string) => new URLSearchParams(query).has('search') ? page([]) : page([withdrawal()]));
  api.rejectWithdrawal.mockRejectedValue(new Error('lost response'));
  await mount('AdminWithdrawalsPage', '/admin/withdrawals?status=PENDING');
  await click(button('Отклонить'));
  await click(button('Подтвердить отклонение'));
  expect(latestQuery(api.getAdminWithdrawalsPage).get('search')).toBe('withdrawal-1');
  expect(latestQuery(api.getAdminWithdrawalsPage).get('status')).toBe('all');
  expect(host.querySelector('dialog')?.textContent).not.toContain('Подтверждённый статус заявки');
  expect(host.querySelector('dialog')?.textContent).toContain('Результат действия неизвестен');
  expect(api.rejectWithdrawal).toHaveBeenCalledTimes(1);
  await click(button('Проверить заявку'));
  expect(api.rejectWithdrawal).toHaveBeenCalledTimes(1);
});
