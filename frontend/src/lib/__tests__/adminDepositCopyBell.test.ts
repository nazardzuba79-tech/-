import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { act } = React;
const { JSDOM } = req('jsdom');
const source = readFileSync(resolve(frontend, 'src/pages/admin/DepositCopyBell.tsx'), 'utf8');
const loaded: any = {};
new Function('exports', 'require', ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(loaded, req);
const { DepositCopyBell, depositCopyLabel } = loaded;
const sample = { id: 'copy-1', asset: 'BTC', network: 'bitcoin', receivedAt: '2026-10-01T08:06:07.487Z', clientCopiedAt: '2026-10-01T08:06:05.067Z' };
let dom: any;
let root: any;
let rowClick: jest.Mock;
let network: jest.Mock;
let originalFetch: any;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.invalid/admin/users' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  root = req('react-dom/client').createRoot(document.getElementById('root'));
  rowClick = jest.fn(); network = jest.fn(); originalFetch = globalThis.fetch; globalThis.fetch = network;
});
afterEach(async () => { await act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close(); });
async function render(event: any = sample, failed = false, key = 'u1') {
  await act(async () => root.render(React.createElement('div', { onClick: rowClick },
    React.createElement(DepositCopyBell, { key, event, failed }))));
}

describe('copy-address bell beside admin user balance', () => {
  it('shows BTC and Kyiv time, with full date/network available to assistive technology', async () => {
    await render();
    const b = document.querySelector('[data-deposit-copy-bell]')!;
    expect(b.textContent).toContain('BTC · 11:06');
    expect(b.getAttribute('aria-label')).toContain('bitcoin');
    expect(b.getAttribute('aria-label')).toContain('01.10.2026');
    expect(b.getAttribute('aria-label')).toContain('не подтверждает оплату');
    expect(network).not.toHaveBeenCalled();
  });
  it('expands locally without opening the row or issuing a request; Escape collapses', async () => {
    await render();
    const b = document.querySelector('[data-deposit-copy-bell]') as HTMLButtonElement;
    await act(async () => b.click());
    expect(rowClick).not.toHaveBeenCalled();
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[role="region"]')?.textContent).toContain('11:06:07');
    expect(document.querySelector('a[href="/admin/deposits#copies"]')).not.toBeNull();
    expect(document.querySelector('a[href="/admin/deposits#unattributed"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Подтвердить зачисление');
    expect(network).not.toHaveBeenCalled();
    await act(async () => b.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="region"]')).toBeNull();
  });
  it('no event means no bell, including an older API response without the field', async () => {
    await render(null); expect(document.querySelector('[data-deposit-copy-bell]')).toBeNull();
    await act(async () => root.render(React.createElement(DepositCopyBell, {})));
    expect(document.querySelector('[data-deposit-copy-bell]')).toBeNull();
  });
  it('a failed lookup displays unknown rather than silently reporting no copies', async () => {
    await render(null, true);
    expect(document.querySelector('[data-deposit-copy-unknown]')).not.toBeNull();
    expect(document.querySelector('[data-deposit-copy-bell]')).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });
  it('an older copy is retained, not removed by a one-hour payment assumption', async () => {
    await render({ ...sample, receivedAt: '2026-09-01T08:06:07Z' });
    expect(document.querySelector('[data-deposit-copy-bell]')).not.toBeNull();
    expect(document.querySelector('button')?.getAttribute('aria-label')).toContain('01.09.2026');
  });
  it('a different user/event key does not inherit expanded details', async () => {
    await render(); await act(async () => (document.querySelector('button') as HTMLButtonElement).click());
    await render({ ...sample, id: 'copy-2', asset: 'ETH', network: 'ethereum' }, false, 'u2:copy-2');
    expect(document.querySelector('[role="region"]')).toBeNull();
    expect(document.body.textContent).toContain('ETH');
    expect(document.body.textContent).not.toContain('BTC');
  });
  it('delayed device time is labelled unconfirmed and never replaces server time', async () => {
    await render({ ...sample, clientCopiedAt: '2026-10-01T07:00:00Z' });
    expect(document.querySelector('button')?.textContent).toContain('11:06');
    await act(async () => (document.querySelector('button') as HTMLButtonElement).click());
    expect(document.body.textContent).toContain('Доставлено с задержкой');
    expect(document.body.textContent).toContain('не подтверждено');
  });
  it('Kyiv calendar date and invalid timestamp handling are explicit', () => {
    expect(depositCopyLabel({ ...sample, receivedAt: '2026-10-01T22:30:00Z' }).fullTime).toContain('02.10.2026');
    expect(depositCopyLabel({ ...sample, receivedAt: 'invalid' }).time).toBe('—');
  });
  it('wires both desktop and mobile cells without introducing a transport or timer', () => {
    const page = readFileSync(resolve(frontend, 'src/pages/admin/AdminUsersPage.tsx'), 'utf8');
    expect(page.match(/<DepositCopyBell /g)).toHaveLength(2);
    expect(page).toContain('event={u.lastDepositCopy}');
    expect(page).toContain('failed={u.depositCopyLookupFailed}');
    expect(source).not.toMatch(/\b(fetch|setInterval|setTimeout|WebSocket|EventSource)\s*\(/);
    expect(source).not.toMatch(/from ['"].*(?:api|browserActivity|adminUserActivity)['"]/);
  });
});
