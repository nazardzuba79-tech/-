import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const read = (file: string) => readFileSync(resolve(frontend, 'src/components', file), 'utf8');

describe.each([false, true])('shared trading navigation, stock flag=%s', enabled => {
  let dom: any, root: any, location: any, header: any, bottom: any;
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div><button id="outside">Outside</button>', { url: 'http://localhost' });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('Unexpected request'))) as typeof fetch;
    location = { pathname: '/stocks/fixture', search: '' };
    const imports: Record<string, any> = {
      react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'lucide-react': req('lucide-react'),
      '../lib/i18n': { useLanguage: () => ({ t: (key: string) => key }) },
      'react-router-dom': {
        useLocation: () => location,
        Link: ({ to, children, onClick, ...props }: any) => React.createElement('a', {
          ...props, href: to, onClick: (event: any) => { event.preventDefault(); onClick?.(); },
        }, children),
      }, './HeaderDropdown.css': {}, './BottomNav.css': {},
    };
    const load = (file: string) => {
      const exports = {};
      new Function('exports', 'require', '__VOLTEX_STOCKS_ENABLED__', ts.transpileModule(read(file), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText)(exports, (name: string) => { if (!(name in imports)) throw new Error(name); return imports[name]; }, enabled);
      return exports;
    };
    header = load('HeaderDropdown.tsx'); imports['./HeaderDropdown'] = header; bottom = load('BottomNav.tsx');
    root = createRoot(document.getElementById('root'));
  });
  afterEach(async () => {
    await React.act(async () => root.unmount());
    expect(globalThis.fetch).not.toHaveBeenCalled(); globalThis.fetch = originalFetch;
    dom.window.close(); delete (globalThis as any).window; delete (globalThis as any).document;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
  const mount = async () => { await React.act(async () => root.render(React.createElement(bottom.BottomNav))); };
  const trigger = () => document.querySelector('.bottom-trading-trigger') as HTMLButtonElement;
  const open = async () => { await React.act(async () => trigger().click()); };
  test('one shared market list gates stocks without a fifth bottom tab', async () => {
    expect(header.TRADING_LINKS.map((link: any) => link.to)).toEqual([
      '/trade', '/futures', '/trade?market=cfd', ...(enabled ? ['/stocks'] : []),
    ]);
    if (enabled) expect(header.TRADING_LINKS.at(-1).label).toBe('stocks.title');
    await mount();
    expect(document.querySelectorAll('.bottom-nav > a, .bottom-nav > button')).toHaveLength(4);
    expect(document.querySelector('.bottom-nav > a[href="/stocks"]')).toBeNull();
    await open();
    expect(Array.from(document.querySelectorAll('.bottom-trading-panel > a')).map(a => a.getAttribute('href')))
      .toEqual(header.TRADING_LINKS.map((link: any) => link.to));
    if (enabled) expect(document.querySelector('.bottom-trading-panel [aria-current="page"]')?.getAttribute('href')).toBe('/stocks');
  });
  test('choice, Escape, outside pointer and search-only route changes dismiss the chooser', async () => {
    await mount(); await open();
    await React.act(async () => (document.querySelector('.bottom-trading-panel > a') as HTMLElement).click());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await open();
    await React.act(async () => document.querySelector('.bottom-trading-panel')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(trigger()); expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await open();
    await React.act(async () => document.getElementById('outside')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    location = { pathname: '/trade', search: '' }; await mount(); await open();
    location = { pathname: '/trade', search: '?market=cfd' }; await mount();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await open(); expect(document.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/trade?market=cfd');
  });
});
