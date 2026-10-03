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
let dom: any, root: any, host: HTMLElement, api: any, onReviewed: jest.Mock, token: string | null;
const sessionListeners = new Set<() => void>();
const modules = new Map<string, any>();
function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('/api')) return {
      api, getToken: () => token,
      onSessionChange: (listener: () => void) => { sessionListeners.add(listener); return () => sessionListeners.delete(listener); },
      ApiError: class extends Error {},
    };
    if (name.endsWith('/adminReadApi')) return { getAdminKycDocumentAbortable: (id: string, signal: AbortSignal) => api.getKycDocument(id, signal) };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}
const submission = {
  id: 'submission-1', fullName: 'Тестовый Клиент', country: 'UA', dateOfBirth: '1990-01-01', documentType: 'PASSPORT',
  status: 'PENDING', rejectionReason: null, createdAt: '2026-10-03T07:00:00.000Z', documentDelivery: 'LEGACY_FILE',
};
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/admin/kyc' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  modules.clear(); sessionListeners.clear(); token = 'fixture-admin';
  host = document.getElementById('root')!; root = req('react-dom/client').createRoot(host);
  api = { getKycDocument: jest.fn(() => new Promise(() => {})), reviewKyc: jest.fn(async () => ({ status: 'APPROVED' })) };
  onReviewed = jest.fn();
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); jest.useRealTimers(); jest.restoreAllMocks(); });
async function render(extra: Record<string, unknown> = {}) {
  const { KycSubmissionReview } = load(resolve(frontend, 'src/pages/admin/KycSubmissionReview'));
  await act(async () => { root.render(React.createElement(KycSubmissionReview, { submission: { ...submission, ...extra }, email: 'client@example.invalid', onReviewed })); await flush(); });
}
function button(label: string, scope: ParentNode = host): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find(node => node.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found as HTMLButtonElement;
}
async function click(node: HTMLElement) { await act(async () => { node.click(); await flush(); }); }

test.each(['cancel', 'escape', 'close'])('KYC decision %s sends zero review writes', async method => {
  await render({ documentDelivery: 'EMAIL' });
  await click(button('Проверено'));
  const dialog = host.querySelector('dialog');
  if (dialog) {
    if (method === 'cancel') await click(button('Отмена', dialog));
    if (method === 'close') await click(dialog.querySelector('[aria-label="Закрыть"]') as HTMLElement);
    if (method === 'escape') await act(async () => { dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true, bubbles: true })); await flush(); });
  }
  expect(api.reviewKyc).not.toHaveBeenCalled();
  expect(host.querySelector('dialog')).toBeNull();
});

test('a failed protected document read is an error, not a missing or emailed document', async () => {
  api.getKycDocument.mockRejectedValue(Object.assign(new Error('server failed'), { status: 500 }));
  await render();
  expect(host.querySelector('[data-kyc-document] [role="alert"]')?.textContent).toContain('Не удалось загрузить документ');
  expect(host.textContent).not.toContain('Документ на бирже не хранится');
  expect(host.querySelector('[data-kyc-request-reupload]')).toBeNull();
});

test('document initial pending state is loading and sends no mutation', async () => {
  await render();
  expect(host.querySelector('[data-kyc-document]')?.textContent).toContain('Загрузка документа');
  expect(host.querySelector('[data-kyc-request-reupload]')).toBeNull();
  expect(api.reviewKyc).not.toHaveBeenCalled();
});

test('only a confirmed 404 offers reupload and still requires an explicit decision', async () => {
  api.getKycDocument.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
  await render();
  expect(host.textContent).toContain('Документ не найден в защищённом хранилище (404)');
  await click(button('Запросить документ заново'));
  expect(host.querySelector('dialog')?.textContent).toContain('Тестовый Клиент');
  expect(host.querySelector('dialog')?.textContent).toContain('submission-1');
  expect(host.querySelector('dialog')?.textContent).toContain('client@example.invalid');
  expect(api.reviewKyc).not.toHaveBeenCalled();
  await click(button('Подтвердить решение'));
  expect(api.reviewKyc).toHaveBeenCalledWith('submission-1', false, 'Документ не дошёл до проверки по технической причине. Пожалуйста, загрузите его повторно.');
});

test('an emailed submission never reads the protected document and does not claim mailbox receipt', async () => {
  await render({ documentDelivery: 'EMAIL', emailMessageId: 'fixture-message' });
  expect(api.getKycDocument).not.toHaveBeenCalled();
  expect(host.textContent).toContain('получение письма в почтовом ящике здесь не подтверждается');
});

test('retry after failed document read displays only the returned protected blob', async () => {
  const create = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture-document');
  const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  api.getKycDocument.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 500 }));
  await render();
  api.getKycDocument.mockResolvedValue(new Blob(['fixture'], { type: 'image/png' }));
  await click(button('Повторить загрузку документа'));
  expect(host.querySelector('[data-kyc-document] img')?.getAttribute('src')).toBe('blob:fixture-document');
  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => { root.render(null); await flush(); });
  expect(revoke).toHaveBeenCalledWith('blob:fixture-document');
});

test('late document A cannot replace B and old transport is aborted', async () => {
  const create = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:document-b');
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  let resolveA!: (value: Blob) => void;
  api.getKycDocument.mockImplementationOnce(() => new Promise<Blob>(done => { resolveA = done; }));
  await render();
  const signalA = api.getKycDocument.mock.calls[0][1];
  api.getKycDocument.mockResolvedValue(new Blob(['b'], { type: 'image/png' }));
  await render({ id: 'submission-2' });
  await act(async () => { resolveA(new Blob(['a'], { type: 'image/png' })); await flush(); });
  expect(signalA.aborted).toBe(true);
  expect(create).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-kyc-document] img')?.getAttribute('src')).toBe('blob:document-b');
});

test('document timeout settles without falsely reporting missing and aborts the request', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  await render();
  const signal = api.getKycDocument.mock.calls[0][1];
  await act(async () => { jest.advanceTimersByTime(15_001); await flush(); });
  expect(signal.aborted).toBe(true);
  expect(host.querySelector('[data-kyc-document] [role="alert"]')?.textContent).toContain('Истекло время ожидания');
  expect(host.querySelector('[data-kyc-request-reupload]')).toBeNull();
});

test('same-turn double confirmation submits one decision for the identified submission', async () => {
  api.reviewKyc.mockImplementation(() => new Promise(() => {}));
  await render({ documentDelivery: 'EMAIL' });
  await click(button('Проверено'));
  const confirm = button('Подтвердить решение');
  await act(async () => { confirm.click(); confirm.click(); await flush(); });
  expect(api.reviewKyc.mock.calls).toEqual([['submission-1', true, undefined]]);
});

test('lost decision response blocks another decision and only refreshes the original submission', async () => {
  api.reviewKyc.mockRejectedValue(new Error('lost response after commit'));
  await render({ documentDelivery: 'EMAIL' });
  await click(button('Проверено'));
  await click(button('Подтвердить решение'));
  expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain('Результат решения неизвестен');
  await click(button('Проверить заявку'));
  expect(onReviewed).toHaveBeenCalledTimes(1);
  expect(api.reviewKyc).toHaveBeenCalledTimes(1);
  expect(button('Проверено').disabled).toBe(true);
  expect(button('Отклонить').disabled).toBe(true);
});

test('changing submission dismisses confirmation without sending a decision for either person', async () => {
  await render({ documentDelivery: 'EMAIL' });
  await click(button('Проверено'));
  await render({ id: 'submission-2', documentDelivery: 'EMAIL', fullName: 'Другой Клиент' });
  expect(host.querySelector('dialog')).toBeNull();
  expect(api.reviewKyc).not.toHaveBeenCalled();
});

test('logout removes protected document, cancels confirmation and rejects its pending response', async () => {
  const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-document');
  api.getKycDocument.mockResolvedValue(new Blob(['private'], { type: 'image/png' }));
  await render();
  await click(button('Проверено'));
  await act(async () => { token = null; sessionListeners.forEach(listener => listener()); await flush(); });
  expect(host.querySelector('dialog')).toBeNull();
  expect(host.querySelector('[data-kyc-document] img')).toBeNull();
  expect(revoke).toHaveBeenCalledWith('blob:private-document');
  expect(api.reviewKyc).not.toHaveBeenCalled();
});
