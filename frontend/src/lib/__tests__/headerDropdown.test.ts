import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const source = readFileSync(resolve(frontend, 'src/components/HeaderDropdown.tsx'), 'utf8');
const expected = {
  TRADING_LINKS: ['/trade', '/futures', '/trade?market=cfd'], MARKET_LINKS: ['/tools'],
  OTC_LINKS: ['/otc', '/arbitrage'],
  KNOWLEDGE_LINKS: ['/academy/learn', '/academy/knowledge', '/academy/faq', '/academy/glossary'],
};

describe('shared header dropdown presentation and navigation', () => {
  let dom: any, root: any, dropdown: any, onNavigate: jest.Mock, location: any;
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div><button id="outside">Outside</button>', { url: 'http://localhost', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('Unexpected network access'))) as typeof fetch;
    onNavigate = jest.fn(); location = { pathname: '/', search: '' };
    const imports: Record<string, unknown> = {
      react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'lucide-react': req('lucide-react'),
      'react-router-dom': { useLocation: () => location,
        Link: ({ to, children, onClick, ...props }: any) => React.createElement('a', { ...props, href: to, onClick: (e: any) => { e.preventDefault(); onClick?.(); } }, children) },
      '../lib/i18n': { useLanguage: () => ({ t: (key: string) => key }) }, './HeaderDropdown.css': {},
    };
    dropdown = {};
    new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText)(dropdown, (name: string) => { if (!(name in imports)) throw new Error(name); return imports[name]; });
    root = createRoot(document.getElementById('root'));
  });
  afterEach(async () => {
    await React.act(async () => root.unmount());
    expect(globalThis.fetch).not.toHaveBeenCalled(); globalThis.fetch = originalFetch;
    dom.window.close();
    delete (globalThis as any).window; delete (globalThis as any).document;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });
  async function mount(group = 'TRADING_LINKS', mobile = false) {
    await React.act(async () => root.render(React.createElement(dropdown.HeaderDropdown, {
      to: '/trade', label: 'Trading', links: dropdown[group], className: 'nav-item', mobile, onNavigate,
    })));
  }
  const toggle = () => document.querySelector('.header-disclosure-toggle') as HTMLButtonElement;
  async function open() { await React.act(async () => toggle().click()); }

  for (const [group, hrefs] of Object.entries(expected)) for (const mobile of [false, true]) {
    test(`${group} has the same routes, SVG icons and descriptions on ${mobile ? 'mobile' : 'desktop'}`, async () => {
      await mount(group, mobile); await open();
      const cards = Array.from(document.querySelectorAll('.header-menu-card'));
      expect(cards.map(card => card.getAttribute('href'))).toEqual(hrefs);
      cards.forEach((card, index) => {
        expect(card.querySelectorAll('.header-menu-icon svg')).toHaveLength(1);
        expect(card.querySelector('.header-menu-icon')?.getAttribute('aria-hidden')).toBe('true');
        expect(card.querySelector('.header-menu-title')?.textContent).toBe(dropdown[group][index].label);
        expect(card.querySelector('.header-menu-description')?.textContent).toBe(dropdown[group][index].description);
      });
      expect(document.querySelector('img')).toBeNull();
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(document.getElementById(toggle().getAttribute('aria-controls')!)).not.toBeNull();
    });
  }
  test('each of the ten products has a distinct icon', () => {
    const items = Object.keys(expected).flatMap(key => dropdown[key]);
    expect(items).toHaveLength(10); expect(new Set(items.map(item => item.icon)).size).toBe(10);
  });
  test('Escape closes the panel and returns keyboard focus; outside focus closes it', async () => {
    await mount(); await open();
    await React.act(async () => {
      const card = document.querySelector('.header-menu-card') as HTMLElement; card.focus();
      card.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('.header-disclosure-panel')).toBeNull();
    expect(document.activeElement).toBe(toggle());
    await open(); await React.act(async () => document.getElementById('outside')!.focus());
    expect(document.querySelector('.header-disclosure-panel')).toBeNull();
  });
  test('whole card navigation closes the drawer once without any data request', async () => {
    await mount('OTC_LINKS', true); await open();
    await React.act(async () => (document.querySelector('.header-menu-description') as HTMLElement).click());
    expect(onNavigate).toHaveBeenCalledTimes(1); expect(document.querySelector('.header-disclosure-panel')).toBeNull();
  });
  test('route changes close an open panel', async () => {
    await mount(); await open(); location = { pathname: '/trade', search: '?market=cfd' }; await mount();
    expect(document.querySelector('.header-disclosure-panel')).toBeNull();
  });
  test('hover opens desktop only; both layouts support explicit toggling', async () => {
    await mount();
    await React.act(async () => document.querySelector('.header-disclosure')!.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })));
    expect(document.querySelector('.header-disclosure-panel')).not.toBeNull();
    await React.act(async () => document.querySelector('.header-disclosure')!.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    expect(document.querySelector('.header-disclosure-panel')).toBeNull();
    await mount('TRADING_LINKS', true);
    await React.act(async () => document.querySelector('.header-disclosure')!.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })));
    expect(document.querySelector('.header-disclosure-panel')).toBeNull(); await open();
    expect(document.querySelector('.header-disclosure-panel')).not.toBeNull();
  });
});
