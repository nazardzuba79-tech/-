import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

/**
 * «Зачисление пакета» drawer, two money-safety details:
 *  - an answer that never arrived (network cut, proxy 502/504) does not say
 *    «Ничего не зачислено»; the admin re-checks with the SAME key, which the
 *    server answers with the first result instead of a second credit;
 *  - the drawer never shows one user's package under another user's name.
 */

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const flush = () => new Promise<void>((done) => setImmediate(done));
const modules = new Map<string, any>();
let dom: any, root: any, host: HTMLElement;
let confirmBodies: any[];
let confirmAnswer: () => Promise<any>;
let previewAnswer: (url: string) => Promise<any>;

function load(file: string): any {
  for (const suffix of ['', '.tsx', '.ts']) if (existsSync(file + suffix)) { file += suffix; break; }
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8').replace(/import\.meta\.env/g, '({} as any)'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/api')) return { API_BASE: '/api/v1', getToken: () => 'admin-token' };
    return name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name);
  });
  return exports;
}

const preview = (userId: string, email: string, ids: string[], total: string) => ({
  key: `${userId}|tron|USDT`, userId, userEmail: email, chain: 'tron', asset: 'USDT',
  transfers: ids.map((id) => ({ id, txHash: id.padEnd(64, 'a'), amount: '150', confirmations: 25, minConfirmations: 19, finalized: true })),
  total, unconfirmedTotal: '0', unconfirmedCount: 0, minDepositUsd: 300, usdValue: total, usdPolicy: 'USD_PEGGED_POLICY', priceUsd: '1', pricedAt: null,
  minimumReached: true, remaining: null, remainingUsd: null, state: 'READY', reviewReason: null, token: 'c'.repeat(64),
  balanceAvailable: '0', balanceAfter: total,
});
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, json: async () => body });

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/admin/deposits' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  confirmBodies = [];
  previewAnswer = (url) => json(url.includes('u-2') ? preview('u-2', 'two@example.invalid', ['d-2a', 'd-2b'], '300') : preview('u-1', 'one@example.invalid', ['d-1a', 'd-1b'], '300'));
  confirmAnswer = () => json({ status: 'CREDITED', batchId: 'b-1', userId: 'u-1', chain: 'tron', asset: 'USDT', totalAmount: '300', depositIds: ['d-1a', 'd-1b'], replayed: false });
  (globalThis as any).fetch = jest.fn((url: string, init: any = {}) => {
    if (url.includes('/admin/deposit-packages/preview')) return previewAnswer(url);
    if (url.includes('/admin/deposit-packages/confirm')) { confirmBodies.push(JSON.parse(init.body)); return confirmAnswer(); }
    return json({});
  });
  modules.clear();
  host = document.getElementById('root')!;
  root = req('react-dom/client').createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); });

async function render(userId: string, email: string, onDone = jest.fn()) {
  const { CreditDepositDrawer } = load(resolve(frontend, 'src/pages/admin/CreditDepositDrawer'));
  await act(async () => {
    root.render(React.createElement(CreditDepositDrawer, { userId, chain: 'tron', asset: 'USDT', email, onClose: () => {}, onDone }));
    await flush(); await flush();
  });
  return onDone;
}
const confirmButton = () => host.querySelector('[data-confirm-credit]') as HTMLButtonElement;
const press = async () => { await act(async () => { confirmButton().click(); await flush(); await flush(); }); };

test('a lost answer is not reported as «nothing credited»; the re-check uses the same key and ends with the first result', async () => {
  const onDone = await render('u-1', 'one@example.invalid');
  confirmAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
  await press();
  const alert = host.querySelector('[role="alert"]')!.textContent!;
  expect(alert).not.toContain('Ничего не зачислено');
  expect(alert).toContain('могло пройти');
  expect(confirmButton().textContent).toBe('Проверить результат');
  expect(onDone).not.toHaveBeenCalled();

  // The server had committed: the same key replays the first result.
  confirmAnswer = () => json({ status: 'CREDITED', batchId: 'b-1', userId: 'u-1', chain: 'tron', asset: 'USDT', totalAmount: '300', depositIds: ['d-1a', 'd-1b'], replayed: true });
  await press();
  expect(confirmBodies).toHaveLength(2);
  expect(confirmBodies[1].idempotencyKey).toBe(confirmBodies[0].idempotencyKey);
  expect(confirmBodies[1].depositIds).toEqual(confirmBodies[0].depositIds);
  expect(onDone).toHaveBeenCalledWith({ status: 'CREDITED', totalAmount: '300', asset: 'USDT' });
});

test.each([[502], [504]])('a gateway %s without the server’s own answer is treated as unknown too', async (status) => {
  await render('u-1', 'one@example.invalid');
  confirmAnswer = () => Promise.resolve({ ok: false, status, json: async () => { throw new SyntaxError('not json'); } });
  await press();
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('могло пройти');
  expect(confirmButton().textContent).toBe('Проверить результат');
});

test('a refusal the server explains keeps its own words and a fresh review', async () => {
  await render('u-1', 'one@example.invalid');
  confirmAnswer = () => json({ error: 'Проверка сети сейчас недоступна. Ничего не зачислено — повторите позже.', code: 'PROVIDER_UNAVAILABLE' }, 503);
  await press();
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Проверка сети сейчас недоступна. Ничего не зачислено — повторите позже.');
  expect(confirmButton().textContent).toBe('Подтвердить зачисление');
});

test('switching to another user while the first preview is loading never shows the first user’s package', async () => {
  let releaseFirst!: () => void;
  previewAnswer = (url) => url.includes('u-1')
    ? new Promise((done) => { releaseFirst = () => done({ ok: true, status: 200, json: async () => preview('u-1', 'one@example.invalid', ['d-1a', 'd-1b'], '300') }); })
    : json(preview('u-2', 'two@example.invalid', ['d-2a', 'd-2b'], '300'));
  await render('u-1', 'one@example.invalid');
  await render('u-2', 'two@example.invalid');
  // The first user's answer arrives last.
  await act(async () => { releaseFirst(); await flush(); await flush(); });
  const ids = Array.from(host.querySelectorAll('[data-package-transfer]')).map((el) => el.getAttribute('data-package-transfer'));
  expect(ids).toEqual(['d-2a', 'd-2b']);
  expect(host.textContent).toContain('two@example.invalid');
  expect(host.textContent).not.toContain('one@example.invalid');
  await press();
  expect(confirmBodies[0]).toMatchObject({ userId: 'u-2', depositIds: ['d-2a', 'd-2b'] });
});

test('while the new user’s package loads, nothing of the previous one can be confirmed', async () => {
  let releaseSecond!: () => void;
  previewAnswer = (url) => url.includes('u-2')
    ? new Promise((done) => { releaseSecond = () => done({ ok: true, status: 200, json: async () => preview('u-2', 'two@example.invalid', ['d-2a'], '300') }); })
    : json(preview('u-1', 'one@example.invalid', ['d-1a', 'd-1b'], '300'));
  await render('u-1', 'one@example.invalid');
  await render('u-2', 'two@example.invalid');
  expect(host.querySelectorAll('[data-package-transfer]')).toHaveLength(0);
  expect(confirmButton().disabled).toBe(true);
  await act(async () => { releaseSecond(); await flush(); await flush(); });
  expect(confirmButton().disabled).toBe(false);
});
