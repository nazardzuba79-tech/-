import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const source = (file: string) => readFileSync(resolve(frontend, 'src', file), 'utf8');

function findJsx(file: string, tag: string) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  const walk = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === tag) result.push(node);
    ts.forEachChild(node, walk);
  };
  walk(ast);
  return result;
}

/** Real Nav mounted by React. Child transports are explicit spies: a hidden
 * ticker must not mount at all, rather than merely hide its rendered output. */
describe('local trading tools keeps the real authenticated shell without a market subscription', () => {
  let dom: any, root: any, Nav: any, activeTicker: number;
  let getMe: jest.Mock, tickerMount: jest.Mock, tickerRead: jest.Mock;
  let prefetchDepositConfig: jest.Mock, prefetchCopyMarketplace: jest.Mock, clearToken: jest.Mock, navigate: jest.Mock, logout: jest.Mock;
  const nativeFetch = globalThis.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/tools', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('Unexpected network access'))) as typeof fetch;
    activeTicker = 0;
    getMe = jest.fn(async () => ({ isAdmin: true, avatarUrl: null }));
    tickerMount = jest.fn(); tickerRead = jest.fn();
    prefetchDepositConfig = jest.fn(); prefetchCopyMarketplace = jest.fn();
    clearToken = jest.fn(); navigate = jest.fn(); logout = jest.fn().mockResolvedValue({ status: 'ok' });
    function TopGainersTicker() {
      React.useEffect(() => {
        activeTicker += 1; tickerMount(); tickerRead();
        const timer = setInterval(tickerRead, 15_000);
        return () => { activeTicker -= 1; clearInterval(timer); };
      }, []);
      return React.createElement('div', { 'data-ticker-fixture': true });
    }
    const empty = () => null;
    const imports: Record<string, unknown> = {
      react: React,
      'react/jsx-runtime': req('react/jsx-runtime'),
      'lucide-react': new Proxy({}, { get: () => empty }),
      'react-router-dom': {
        useLocation: () => ({ pathname: '/tools' }), useNavigate: () => navigate,
        Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children),
      },
      '../lib/api': { api: { getMe, logout }, getToken: () => 'fixture-session', clearToken },
      '../lib/i18n': { useLanguage: () => ({ t: (key: string) => key, lang: 'ru' }) },
      '../lib/useDepositOptions': { prefetchDepositConfig },
      // Pure open-request bus (no fetch, no timer): the header's own deposit window.
      '../lib/depositRequest': require('../depositRequest'),
      '../lib/useCopyMarketplace': { prefetchCopyMarketplace },
      './TopGainersTicker': { TopGainersTicker },
      './Logo': { Logo: () => React.createElement('span', { 'data-real-logo-slot': true }, 'VOLTEX') },
      './TradingBotIcon': { TradingBotIcon: empty },
      './LanguageSwitcher': { LanguageSwitcher: empty },
      './BottomNav': { BottomNav: empty },
      './DepositModal': { DepositModal: ({ onClose }: any) => React.createElement('button', { 'data-deposit-fixture': true, onClick: onClose }, 'Close deposit') },
    };
    const dropdown: any = {};
    const dropdownCode = ts.transpileModule(source('components/HeaderDropdown.tsx'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    new Function('exports', 'require', dropdownCode)(dropdown, (name: string) => name.endsWith('.css') ? {} : imports[name]);
    imports['./HeaderDropdown'] = dropdown;
    const output: any = {};
    const code = ts.transpileModule(source('components/Nav.tsx'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    new Function('exports', 'require', code)(output, (name: string) => {
      if (!(name in imports)) throw new Error(`Unexpected Nav dependency: ${name}`);
      return imports[name];
    });
    Nav = output.Nav;
    root = createRoot(document.getElementById('root'));
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
    expect(activeTicker).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    globalThis.fetch = nativeFetch;
    dom.window.close(); jest.useRealTimers();
    delete (globalThis as any).window; delete (globalThis as any).document;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  async function mount(props: Record<string, unknown> = { active: '/tools', hideTicker: true }) {
    await React.act(async () => { root.render(React.createElement(Nav, props)); });
  }
  async function click(selector: string) {
    const element = document.querySelector(selector) as HTMLElement;
    expect(element).not.toBeNull();
    await React.act(async () => element.click());
  }

  test('the actual trading tools page opts out of mounting the ticker', () => {
    const nav = findJsx('pages/TradingToolsPage.tsx', 'Nav');
    expect(nav).toHaveLength(1);
    const hidden = nav[0].attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText() === 'hideTicker');
    expect(hidden).toBeDefined();
    if (!hidden || !ts.isJsxAttribute(hidden)) throw new Error('Trading Tools must explicitly unmount the market ticker');
    expect(!hidden.initializer || (ts.isJsxExpression(hidden.initializer) && hidden.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword)).toBe(true);
  });

  test('trading tools never mounts the ticker, including twelve hours of idle time and visibility events', async () => {
    await mount();
    expect(getMe).toHaveBeenCalledTimes(1); // Existing profile/auth read, separate from the module.
    expect(document.querySelector('[data-ticker-fixture]')).toBeNull();
    await React.act(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
      await jest.advanceTimersByTimeAsync(43_200_000);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
      window.dispatchEvent(new dom.window.Event('focus'));
    });
    expect(tickerMount).not.toHaveBeenCalled(); expect(tickerRead).not.toHaveBeenCalled();
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(prefetchCopyMarketplace).not.toHaveBeenCalled();
    expect(prefetchDepositConfig).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('existing pages keep their ticker and transition to trading tools disposes it', async () => {
    await mount({ active: '/markets' });
    expect(activeTicker).toBe(1); expect(tickerRead).toHaveBeenCalledTimes(1);
    await React.act(async () => jest.advanceTimersByTimeAsync(15_000));
    expect(tickerRead).toHaveBeenCalledTimes(2);
    await mount();
    expect(activeTicker).toBe(0);
    await React.act(async () => jest.advanceTimersByTimeAsync(60_000));
    expect(tickerRead).toHaveBeenCalledTimes(2);
    await mount({ active: '/markets' });
    expect(activeTicker).toBe(1); expect(tickerRead).toHaveBeenCalledTimes(3);
  });

  test('logo, wallet and Banking & Earn remain genuine navigation entries', async () => {
    await mount();
    expect(document.querySelector('.header-brand')?.getAttribute('href')).toBe('/trade');
    expect(document.querySelector('.header-brand [data-real-logo-slot]')).not.toBeNull();
    expect(document.querySelector('.nav-wallet-link')?.getAttribute('href')).toBe('/wallet');
    expect(Array.from(document.querySelectorAll('a[href="/banking"]')).map(node => node.textContent)).toEqual(['Banking & Earn', 'Banking & Earn']);
    expect(document.querySelector('.nav-desktop-links a[href="/markets"].nav-active')).not.toBeNull();
    expect(document.querySelector('a[href="/futures"]')).not.toBeNull();
    await click('.nav-mobile-menu button[aria-label="nav.trade"]');
    expect(document.querySelector('a[href="/trade?market=cfd"]')).not.toBeNull();
    expect(document.querySelector('a[href="/otc"]')).not.toBeNull();
  });

  test('desktop Tools lives under Markets; Futures stays direct; Trading contains only Spot and CFD', async () => {
    await mount();
    expect(document.querySelector('.nav-desktop-links > a[href="/tools"]')).toBeNull();
    expect(document.querySelector('.nav-desktop-links > a[href="/futures"]')).not.toBeNull();

    const marketsToggle = document.querySelector('.nav-desktop-links button[aria-label="nav.markets"]') as HTMLElement;
    await React.act(async () => marketsToggle.click());
    expect(Array.from(document.querySelectorAll('.nav-desktop-links .header-disclosure-panel a')).map(a => a.getAttribute('href'))).toEqual(['/tools']);
    expect(document.querySelector('.nav-desktop-links a[href="/markets"].nav-active')).not.toBeNull();
    await React.act(async () => marketsToggle.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    const trigger = document.querySelector('.nav-desktop-links a[href="/trade"]') as HTMLElement;
    expect(trigger.classList.contains('nav-active')).toBe(false);
    await click('.nav-desktop-links button[aria-label="nav.trade"]');
    expect(Array.from(document.querySelectorAll('.nav-desktop-links .header-disclosure-panel a')).map(a => a.getAttribute('href'))).toEqual(['/trade', '/trade?market=cfd']);
    await React.act(async () => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.header-disclosure-panel')).toBeNull();
  });

  test.each(['.nav-desktop-links', '.nav-mobile-menu'])('knowledge disclosure has four destinations and closes on Escape: %s', async selector => {
    await mount();
    const button = selector + ' button[aria-label="nav.academy"]';
    expect(document.querySelector(selector + ' a[href="/academy"]')).not.toBeNull();
    await click(button);
    expect(Array.from(document.querySelectorAll(selector + ' .header-disclosure-panel a')).map(a => a.getAttribute('href')))
      .toEqual(['/academy/learn', '/academy/knowledge', '/academy/faq', '/academy/glossary']);
    const last = document.querySelector(selector + ' a[href="/academy/glossary"]') as HTMLElement;
    await React.act(async () => { last.focus(); last.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector(selector + ' .header-disclosure-panel')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector(button));
  });

  test.each(['/futures', '/trade', '/tools'])('%s shares the short Card and Academy labels in desktop and mobile headers', async active => {
    await mount({ active, hideTicker: true });
    for (const selector of ['.nav-desktop-links', '.nav-mobile-menu']) {
      expect(document.querySelector(selector + ' a[href="/card"]')?.textContent).toBe('nav.card');
      expect(document.querySelector(selector + ' a[href="/academy"]')?.textContent).toBe('nav.academy');
      expect(document.querySelector(selector + ' button[aria-label="nav.academy"]')).not.toBeNull();
    }
  });

  test('mobile Trading only exposes Spot and CFD, and selecting CFD closes the drawer', async () => {
    await mount();
    await click('.nav-burger');
    await click('.nav-mobile-menu button[aria-label="nav.trade"]');
    expect(Array.from(document.querySelectorAll('.nav-mobile-menu .header-disclosure-panel a')).map(a => a.getAttribute('href')))
      .toEqual(['/trade', '/trade?market=cfd']);
    expect(document.querySelector('.nav-mobile-menu > a[href="/futures"]')).not.toBeNull();
    await click('.nav-mobile-menu a[href="/trade?market=cfd"]');
    expect(document.querySelector('.nav-mobile-menu.open')).toBeNull();
    expect(document.querySelector('.nav-mobile-menu .header-disclosure-panel')).toBeNull();
  });

  test('mobile drawer keeps Tools under Markets and retains the existing Arbitrage entry', async () => {
    await mount();
    await click('.nav-burger');
    expect(document.querySelector('.nav-mobile-menu.open')).not.toBeNull();
    await click('.nav-mobile-menu button[aria-label="nav.markets"]');
    expect(Array.from(document.querySelectorAll('.nav-mobile-menu .header-disclosure-panel a')).map(a => a.getAttribute('href'))).toEqual(['/tools']);
    await click('.nav-mobile-menu button[aria-label="nav.otc"]');
    expect(document.querySelectorAll('.nav-mobile-menu a[href="/arbitrage"]')).toHaveLength(1);
    await click('.nav-burger');
    expect(document.querySelector('.nav-mobile-menu.open')).toBeNull();
  });

  test('deposit remains the existing user-opened modal; no automatic prefetch', async () => {
    await mount();
    expect(document.querySelector('[data-deposit-fixture]')).toBeNull();
    expect(prefetchDepositConfig).not.toHaveBeenCalled();
    await React.act(async () => (document.querySelector('.top-nav-fund-btn') as HTMLElement).focus());
    expect(prefetchDepositConfig).toHaveBeenCalledTimes(1);
    await click('.top-nav-fund-btn');
    expect(document.querySelector('[data-deposit-fixture]')).not.toBeNull();
    await click('[data-deposit-fixture]');
    expect(document.querySelector('[data-deposit-fixture]')).toBeNull();
    expect(tickerMount).not.toHaveBeenCalled();
  });

  test('profile authorization and logout remain active', async () => {
    await mount();
    await click('.top-nav-profile-btn');
    expect(document.querySelector('.top-nav-profile-menu a[href="/settings"]')).not.toBeNull();
    expect(document.querySelector('.top-nav-profile-menu a[href="/admin"]')).not.toBeNull();
    await click('.top-nav-profile-menu button');
    // Logout also ends the server session (remembered devices), then clears locally.
    expect(logout).toHaveBeenCalledTimes(1);
    expect(clearToken).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledWith('/');
  });

  test('trading tools retains the existing route auth boundary', () => {
    const route = findJsx('App.tsx', 'Route').find(node => node.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === 'path' &&
      attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === '/tools'));
    expect(route).toBeDefined();
    expect(route!.getText()).toMatch(/element=\{<RequireAuth><TradingToolsPage\s*\/><\/RequireAuth>\}/);
  });

  test('the calculator route is lazy and excluded from global route warming', () => {
    const app = source('App.tsx');
    const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports: ts.CallExpression[] = [];
    const walk = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.some(argument => ts.isStringLiteral(argument) && argument.text.includes('TradingToolsPage'))) imports.push(node);
      ts.forEachChild(node, walk);
    };
    walk(ast);
    expect(imports).toHaveLength(1);
    let parent: ts.Node | undefined = imports[0];
    while (parent && !ts.isVariableDeclaration(parent)) parent = parent.parent;
    expect(parent && ts.isVariableDeclaration(parent) && parent.name.getText(ast)).toBe('TradingToolsPage');
    expect(parent?.getText(ast)).toMatch(/lazy\s*\(/);
    const warm = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'usePrefetchLikelyRoutes');
    expect(warm?.getText(ast)).not.toMatch(/TradingToolsPage|trading-tools|\/tools/);
  });

  test('the calculator stylesheet stays within its own page subtree', () => {
    const css = source('pages/trading-tools/TradingTools.css');
    expect(css).not.toMatch(/@import|@font-face|https?:\/\//);
    expect(css).not.toMatch(/(?:^|})\s*(?:body|html|:root|\.global-header|\.main-nav)\s*[{,]/m);
    expect(css).toContain('.vx-trading-tools');
  });
});
