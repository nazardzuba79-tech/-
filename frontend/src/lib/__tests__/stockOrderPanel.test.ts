import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { widgetCatalogue } from '../../pages/stocks/stockWidgetCatalogue';

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
const compile = (file: string, imports: Record<string, unknown>) => {
  const source = ts.transpileModule(readFileSync(resolve(frontend, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const out: any = {};
  new Function('exports', 'require', source)(out, (id: string) => {
    if (!(id in imports)) throw new Error(`Unexpected dependency: ${id}`);
    return imports[id];
  });
  return out;
};
describe('Stocks order ticket is presentation only', () => {
  let dom: any, root: any, Panel: any, Tabs: any;
  const imports = { react: React, 'react/jsx-runtime': req('react/jsx-runtime'),
    '../../lib/i18n': { useLanguage: () => ({ t: (key: string) => key }) } };
  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    Tabs = compile('src/components/OrderFamilyPresentation.tsx', {
      ...imports, '../lib/i18n': imports['../../lib/i18n'],
    }).OrderFamilyTabs;
    Panel = compile('src/pages/stocks/StockOrderPanel.tsx', {
      ...imports, '../../components/OrderFamilyPresentation': { OrderFamilyTabs: Tabs }, './stockOrderPanel.css': {},
    }).StockOrderPanel;
    root = createRoot(document.getElementById('root'));
  });
  afterEach(async () => {
    await React.act(async () => root.unmount()); dom.window.close();
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) delete (globalThis as any)[key];
  });
  const draw = async (index = 0) => React.act(async () => root.render(React.createElement(Panel, {
    key: widgetCatalogue.data!.instruments[index].instrumentId, instrument: widgetCatalogue.data!.instruments[index],
  })));
  const click = async (text: string) => React.act(async () => Array.from(document.querySelectorAll('button')).find(b => b.textContent === text)!.click());
  test('unknown balance/total, disabled submission and no network dependencies', async () => {
    await draw();
    expect(document.querySelector('.vxs-order-available')!.textContent).toBe('trade.available— USD');
    expect(document.querySelector<HTMLInputElement>('input[aria-label="trade.total"]')!.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('input[aria-label="trade.total"]')!.readOnly).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(document.querySelector('.vxs-order-notice')!.textContent).toBe('stocks.tradingUnavailable');
    const event = new window.Event('submit', { bubbles: true, cancelable: true });
    await React.act(async () => document.querySelector('form')!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  });
  test('Buy/Sell and Limit/Market remain usable while submission stays disabled', async () => {
    await draw(); await click('trade.sell');
    expect(document.querySelector('.vxs-order-submit')!.classList.contains('sell')).toBe(true);
    await click('futures.closeMarket');
    expect(document.querySelector<HTMLInputElement>('input[aria-label="trade.price"]')!.readOnly).toBe(true);
    expect(document.querySelectorAll('.order-family-tabs button')).toHaveLength(2);
    await click('futures.closeLimit');
    expect(document.querySelector<HTMLInputElement>('input[aria-label="trade.price"]')!.readOnly).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
  test('switching the instrument resets side and family without retaining another ticket', async () => {
    await draw(); await click('trade.sell'); await click('futures.closeMarket'); await draw(1);
    expect(document.querySelector('.vxs-order-submit')!.classList.contains('buy')).toBe(true);
    expect(document.querySelector('.order-family-tabs .active')!.textContent).toBe('futures.closeLimit');
    expect(document.querySelectorAll('.vxs-order-panel')).toHaveLength(1);
  });
  test('existing Futures/Spot callers retain every existing family by default', async () => {
    await React.act(async () => root.render(React.createElement(Tabs, { value: 'LIMIT', onChange: () => {} })));
    expect(document.querySelectorAll('.order-family-tabs button')).toHaveLength(5);
    await React.act(async () => root.render(React.createElement(Tabs, { value: 'LIMIT', archive: true, onChange: () => {} })));
    expect(document.querySelectorAll('.order-family-tabs button')).toHaveLength(4);
  });
});
