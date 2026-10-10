import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as grouping from '../../pages/stocks/global/tradeMarkers';

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
const imports: Record<string, unknown> = {
  react: React, 'react/jsx-runtime': req('react/jsx-runtime'),
  'react-router-dom': req('react-router-dom'), './tradeMarkers': grouping,
  'bignumber.js': req('bignumber.js'),
};
const components: any = {};
new Function('exports', 'require', ts.transpileModule(
  readFileSync(resolve(frontend, 'src/pages/stocks/global/DesktopShell.tsx'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
).outputText)(components, (name: string) => {
  if (!(name in imports)) throw Error(`Unexpected desktop dependency: ${name}`);
  return imports[name];
});
let dom: any, root: any;
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  dom.window.close();
  for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) delete (globalThis as any)[key];
});
const asset = { id: 'BYBIT:AAPLXUSDT', asset: 'AAPLX', provider: 'bybit', sourceSymbol: 'AAPLXUSDT', currency: 'USDT' };
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === name)!;

test('allocation uses the selected settlement price, rounds down and never exceeds available shares or cash', () => {
  expect(components.allocationQuantity('100', '3', 'BUY', 100)).toBe('33.33333333');
  expect(components.allocationQuantity('100', '2.5', 'BUY', 25)).toBe('10.00000000');
  expect(components.allocationQuantity('0.33333333', '', 'SELL', 50)).toBe('0.16666666');
  expect(components.allocationQuantity('100', '0', 'BUY', 50)).toBeNull();
  expect(components.allocationQuantity('-1', '1', 'BUY', 50)).toBeNull();
  expect(components.allocationQuantity('100', '1', 'BUY', 101)).toBeNull();
  expect(components.allocationQuantity('100', '1', 'BUY', NaN)).toBeNull();
});

test('missing quotes remain unavailable instead of becoming invented depth or zero prices', async () => {
  await React.act(async () => root.render(React.createElement(components.DesktopQuotes, {
    asset, fills: [], ready: false, now: 100000,
  })));
  expect(document.querySelectorAll('.vxg-pro-book-side')).toHaveLength(2);
  expect(Array.from(document.querySelectorAll('.vxg-pro-book-side strong')).map(n => n.textContent)).toEqual(['—', '—']);
  expect(document.querySelector('.vxg-pro-mid strong')!.textContent).toBe('—');
  expect(document.body.textContent).toContain('Глубина рынка и объёмы заявок не предоставлены');
  expect(document.body.textContent).toContain('Нет свежих данных');
});

test('desktop quotes preserve real bid/ask and show only fills for the exact provider identity', async () => {
  const quote = { bid: '337.71', ask: '337.83', last: '337.80', change24h: -1, timestamp: 100000 };
  const fills = [
    { id: 'same-token', instrumentId: asset.id, side: 'BUY', nativePrice: '337.79', quantity: '0.25', timestamp: 90000 },
    { id: 'different-token', instrumentId: 'BINANCE:AAPLBUSDT', side: 'SELL', nativePrice: '333', quantity: '8', timestamp: 95000 },
  ];
  const original = JSON.stringify({ quote, fills });
  await React.act(async () => root.render(React.createElement(components.DesktopQuotes, {
    asset, quote, fills, ready: false, now: 220000,
  })));
  expect(document.querySelector('.vxg-pro-book-side .down strong')!.textContent).toBe('337,83');
  expect(document.querySelector('.vxg-pro-book-side .up strong')!.textContent).toBe('337,71');
  expect(document.querySelector('.vxg-pro-mid strong')!.className).toBe('down');
  expect(document.body.textContent).toContain(grouping.quoteAge(quote.timestamp, 220000));
  await React.act(async () => button('Сделки').click());
  expect(document.querySelectorAll('.vxg-pro-executions article')).toHaveLength(1);
  expect(document.querySelector('.vxg-pro-executions article')!.textContent).toContain('337,79');
  expect(document.querySelector('.vxg-pro-executions article')!.textContent).not.toContain('333');
  expect(JSON.stringify({ quote, fills })).toBe(original);
});

test('Stocks desktop navigation invokes the existing catalogue, portfolio, history and wallet actions', async () => {
  const onMarkets = jest.fn(), onPortfolio = jest.fn(), onHistory = jest.fn(), onWallet = jest.fn();
  await React.act(async () => root.render(React.createElement((imports['react-router-dom'] as any).MemoryRouter, null,
    React.createElement(components.DesktopHeader, { currency: 'USDC', onMarkets, onPortfolio, onHistory, onWallet }))));
  for (const text of ['Рынки', 'Акции', 'Портфель', 'История', 'Тестовый кошелёк']) {
    await React.act(async () => button(text).click());
  }
  expect(onMarkets).toHaveBeenCalledTimes(2);
  expect(onPortfolio).toHaveBeenCalledTimes(1);
  expect(onHistory).toHaveBeenCalledTimes(1);
  expect(onWallet).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.vxg-pro-settlement')!.textContent).toBe('USDC');
});
