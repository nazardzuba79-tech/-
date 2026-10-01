import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const { JSDOM } = req('jsdom');
const React = req('react');
const { act } = React;
const flush = () => new Promise<void>((done) => setImmediate(done));
const address = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
const wallet = { chain: 'tether:tron', assets: ['USDT'], address, networkName: 'TRON', standard: 'TRC-20' };
let dom: any, root: any;
let token: string | null, tokenReadError: boolean;
let finishCopy: () => void;
let rejectCopy: (error: Error) => void;
let report: jest.Mock, clipboard: jest.Mock;

function loadDialog() {
  const source = readFileSync(resolve(frontend, 'src/components/DepositCatalogueDialog.tsx'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mocks: Record<string, any> = {
    '../lib/api': { getToken: () => { if (tokenReadError) throw new Error('SecurityError'); return token; } },
    '../lib/depositCopyLog': { reportDepositAddressCopy: (...args: any[]) => report(...args) },
    '../lib/i18n': { useLanguage: () => ({ lang: 'ru', t: (key: string) => key }), localeOf: () => 'ru-RU' },
    '../lib/useDepositOptions': {
      useDepositWallets: () => ({ loaded: true, wallets: [wallet], error: null }),
      useDepositSelection: () => ({ assets: ['USDT'], asset: 'USDT', setAsset: () => {}, networks: [wallet], wallet, setChain: () => {} }),
    },
    './CryptoIcon': { CryptoIcon: () => null },
    '../lib/depositAssetMetadata': { depositAssetMetadata: {} },
    '../lib/depositMinimum': { depositMinimumView: () => ({ pegged: true, usd: 500, estimate: null, estimateExpiresAt: null }) },
    '../lib/marketDataStore': { marketDataStore: { getState: () => ({ tickers: new Map(), tickersMeta: null }) } },
    '../lib/depositOrder': { orderDepositDestinations: (value: unknown) => value },
    qrcode: { default: { create: () => ({ modules: { size: 1, data: [1] } }) } },
  };
  const exports: any = {};
  new Function('exports', 'require', code)(exports, (name: string) => {
    if (name.endsWith('.css')) return {};
    return Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : req(name);
  });
  return exports.DepositCatalogueDialog;
}

beforeEach(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'https://example.invalid/wallet' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  token = 'session-user-A'; tokenReadError = false;
  report = jest.fn();
  clipboard = jest.fn(() => new Promise<void>((done, reject) => { finishCopy = done; rejectCopy = reject; }));
  Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  root = req('react-dom/client').createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(loadDialog(), { onClose: () => {}, source: 'wallet' })); await flush(); });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); await flush(); });
  dom.window.close();
});
async function pressCopy() {
  await act(async () => { (document.querySelector('.dc-copy-row .dc-primary') as HTMLButtonElement).click(); await flush(); });
  expect(clipboard).toHaveBeenCalledWith(address);
  expect(report).not.toHaveBeenCalled();
}
async function finish() { await act(async () => { finishCopy(); await flush(); }); }
const expected = { asset: 'USDT', network: 'tron', destinationId: 'tether:tron', address, memo: undefined, source: 'wallet' };

describe('deposit clipboard completion stays with the session that pressed Copy', () => {
  it('same session: one immutable destination is reported only after successful copying', async () => {
    await pressCopy(); await finish();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expected);
    expect(document.body.textContent).toContain('deposit.ui.copied');
  });

  it.each(['session-user-B', null, 'replacement-session-user-A'])('a pending copy followed by session %s cannot be reported under that new session', async (next) => {
    await pressCopy(); token = next; await finish();
    expect(report).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('deposit.ui.copied');
  });

  it('a guest copy followed by sign-in is not assigned to the new user', async () => {
    token = null; await pressCopy(); token = 'session-user-B'; await finish();
    expect(report).not.toHaveBeenCalled();
  });

  it('closing the modal while clipboard is pending still records the same-session copy', async () => {
    await pressCopy();
    await act(async () => { root.unmount(); root = null; await flush(); });
    await finish();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expected);
  });

  it('blocked token storage cannot break address copying or create a note', async () => {
    tokenReadError = true; await pressCopy(); await finish();
    expect(report).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('deposit.ui.copied');
  });

  it('a failed clipboard never creates a note', async () => {
    await pressCopy();
    await act(async () => { rejectCopy(new Error('NotAllowedError')); await flush(); });
    expect(report).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('deposit.ui.copyError');
  });

  it('a logging error cannot undo clipboard success', async () => {
    report.mockImplementation(() => { throw new Error('Note unavailable'); });
    await pressCopy(); await finish();
    expect(report).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('deposit.ui.copied');
    expect(document.body.textContent).not.toContain('deposit.ui.copyError');
  });
});
