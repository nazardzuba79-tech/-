import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as hostPolicy from '../../pages/stocks/stockHostPolicy';

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
const router = req('react-router-dom');
const source = ts.transpileModule(readFileSync(resolve(frontend, 'src/pages/stocks/StocksPage.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const AAPLX = 'BYBIT:AAPLXUSDT', AAPLB = 'BINANCE:AAPLBUSDT', SBER = 'MOEX:TQBR:SBER';
const terminalPath = (id: string) => '/stocks/' + encodeURIComponent(id);

describe('Stocks original catalogue route boundary', () => {
  let dom: any, root: any, Page: any, navigate: (to: string | number) => void;
  let importsSeen: string[], lifecycle: string[], active: Set<string>, legacyReads: jest.Mock;
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  let previous: Map<string, PropertyDescriptor | undefined>;
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;
  const flush = async (work: () => void) => React.act(async () => {
    work(); for (let i = 0; i < 12; i++) await Promise.resolve();
  });
  // Boundaries deliberately expose mounts/imports, not fake charts or balances.
  // Catalogue request/session behavior is separately exercised with its real
  // component in stocksOriginalCatalogue.test.ts.
  const Boundary = ({ kind }: { kind: string }) => {
    const { instrumentId } = router.useParams();
    React.useEffect(() => {
      const name = kind + ':' + (instrumentId || ''); active.add(name); lifecycle.push('mount:' + name);
      return () => { active.delete(name); lifecycle.push('unmount:' + name); };
    }, [kind, instrumentId]);
    return React.createElement('div', { 'data-view': kind, 'data-instrument': instrumentId || '' });
  };
  const load = (enabled: boolean | undefined, widgetPreview = false, hostedPilot = false) => {
    const empty = () => null;
    const imports: Record<string, unknown> = {
      react: React, 'react/jsx-runtime': req('react/jsx-runtime'), 'react-router-dom': router,
      '../../lib/i18n': { useLanguage: () => ({ t: (key: string) => key }) },
      '../../components/Nav': { Nav: empty },
      '../../lib/stocks': { useStocks: legacyReads, isStockCatalogue: () => true },
      './stockModel': { readFavorites: () => [], writeFavorites: jest.fn() }, './stocks.css': {},
      './stockWidgetCatalogue': { widgetPreview, widgetCatalogue: { value: 'widget-catalogue-fixture' } },
      './stockHostPolicy': hostPolicy,
      './global/GlobalStocks': { default: () => React.createElement(Boundary, { kind: 'global-terminal' }) },
      './global/GlobalStocksCatalogue': { default: () => React.createElement(Boundary, { kind: 'global-catalogue' }) },
      './StocksTerminal': { default: () => React.createElement(Boundary, { kind: 'legacy-terminal' }) },
      './StocksOverview': { default: () => React.createElement(Boundary, { kind: 'legacy-overview' }) },
    };
    const output: any = {};
    new Function('exports', 'require', '__VOLTEX_STOCKS_GLOBAL_SIMULATOR__', '__VOLTEX_STOCKS_HOSTED_PILOT__', source)(output, (name: string) => {
      importsSeen.push(name);
      if (!(name in imports)) throw new Error(`Unexpected StocksPage dependency: ${name}`);
      return imports[name];
    }, enabled, hostedPilot);
    Page = output.StocksPage;
  };
  const Navigation = () => { navigate = router.useNavigate(); return null; };
  const render = (path = '/stocks') => flush(() => root.render(React.createElement(router.MemoryRouter,
    { initialEntries: [path] }, React.createElement(Navigation), React.createElement(router.Routes, null,
      React.createElement(router.Route, { path: '/stocks', element: React.createElement(Page) }),
      React.createElement(router.Route, { path: '/stocks/:instrumentId', element: React.createElement(Page) })))));
  const onlyView = (kind: string, instrument = '') => {
    expect(document.querySelectorAll('[data-view]')).toHaveLength(1);
    expect(document.querySelector('[data-view]')!.getAttribute('data-view')).toBe(kind);
    expect(document.querySelector('[data-view]')!.getAttribute('data-instrument')).toBe(instrument);
    expect([...active]).toEqual([kind + ':' + instrument]);
  };
  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4438/stocks', pretendToBeVisual: true });
    previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    importsSeen = []; lifecycle = []; active = new Set(); legacyReads = jest.fn(() => ({ value: 'legacy-catalogue-fixture' }));
    fetchMock = jest.fn(() => { throw new Error('Route boundary must not perform transport itself'); });
    globalThis.fetch = fetchMock; root = createRoot(document.getElementById('root')); load(true);
  });
  afterEach(async () => {
    await flush(() => root.unmount()); expect(active.size).toBe(0); expect(fetchMock).not.toHaveBeenCalled();
    globalThis.fetch = originalFetch; dom.window.close();
    for (const key of globals) { const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
  });

  test('local /stocks loads only catalogue, not the terminal/chart branch or legacy API', async () => {
    await render(); onlyView('global-catalogue');
    expect(importsSeen).toContain('./global/GlobalStocksCatalogue');
    expect(importsSeen).not.toContain('./global/GlobalStocks');
    expect(importsSeen).not.toContain('./StocksTerminal'); expect(legacyReads).not.toHaveBeenCalled();
  });

  test.each([AAPLX, AAPLB, SBER])('direct canonical route preserves %s without mounting catalogue', async id => {
    await render(terminalPath(id)); onlyView('global-terminal', id);
    expect(importsSeen).toContain('./global/GlobalStocks');
    expect(importsSeen).not.toContain('./global/GlobalStocksCatalogue'); expect(legacyReads).not.toHaveBeenCalled();
  });

  test('catalogue, terminal and browser Back transitions keep exactly one mounted view and clean up the prior view', async () => {
    await render(); onlyView('global-catalogue');
    await flush(() => navigate(terminalPath(AAPLX))); onlyView('global-terminal', AAPLX);
    expect(lifecycle).toContain('unmount:global-catalogue:');
    await flush(() => navigate(terminalPath(AAPLB))); onlyView('global-terminal', AAPLB);
    expect(lifecycle).toContain('unmount:global-terminal:' + AAPLX);
    await flush(() => navigate('/stocks')); onlyView('global-catalogue');
    expect(lifecycle).toContain('unmount:global-terminal:' + AAPLB);
    await flush(() => navigate(-1)); onlyView('global-terminal', AAPLB);
    expect(legacyReads).not.toHaveBeenCalled();
  });

  test('legacy overview URL in the isolated build opens catalogue without silently selecting an instrument', async () => {
    await render('/stocks?view=overview'); onlyView('global-catalogue');
    expect(importsSeen).not.toContain('./global/GlobalStocks');
  });

  test.each([false, undefined])('disabled or absent build gate %s retains legacy route behavior', async enabled => {
    load(enabled); await render('/stocks'); onlyView('legacy-terminal');
    expect(legacyReads).toHaveBeenCalled();
    expect(importsSeen).not.toContain('./global/GlobalStocks');
    expect(importsSeen).not.toContain('./global/GlobalStocksCatalogue');
    await flush(() => navigate('/stocks?view=overview')); onlyView('legacy-overview');
  });

  test.each(['https://voltextech.net/stocks', 'http://localhost:4438/stocks', 'https://preview.example.invalid/stocks'])
    ('global build does not admit the isolated catalogue or terminal on %s', async url => {
      dom.reconfigure({ url }); await render(); onlyView('legacy-terminal');
      expect(legacyReads).toHaveBeenCalled();
      expect(importsSeen).not.toContain('./global/GlobalStocks');
      expect(importsSeen).not.toContain('./global/GlobalStocksCatalogue');
    });

  test.each(['https://voltextech.net/stocks', 'https://review.example.invalid/stocks', 'http://127.0.0.1:4438/stocks'])
    ('explicit hosted pilot %s opens the PROFESSIONAL catalogue without legacy reads', async url => {
      dom.reconfigure({ url }); load(false, false, true);
      await render(); onlyView('global-catalogue');
      expect(legacyReads).not.toHaveBeenCalled();
      expect(importsSeen).not.toContain('./StocksTerminal');
    });

  test('explicit hosted pilot direct instrument opens GlobalStocks, not a stand-in terminal', async () => {
    dom.reconfigure({ url: 'https://voltextech.net/stocks' }); load(false, false, true);
    await render(terminalPath(AAPLX)); onlyView('global-terminal', AAPLX);
    expect(legacyReads).not.toHaveBeenCalled();
  });

  test('official-widget preview remains on the existing nonlocal path without invoking either market pipeline', async () => {
    dom.reconfigure({ url: 'https://preview.example.invalid/stocks' }); load(true, true);
    await render(terminalPath('XNGS:AAPL')); onlyView('legacy-terminal', 'XNGS:AAPL');
    expect(legacyReads).not.toHaveBeenCalled();
    expect(importsSeen).not.toContain('./global/GlobalStocks');
    expect(importsSeen).not.toContain('./global/GlobalStocksCatalogue');
  });
});
