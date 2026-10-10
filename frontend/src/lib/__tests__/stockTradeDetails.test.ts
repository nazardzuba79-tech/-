import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as grouping from '../../pages/stocks/global/tradeMarkers';

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');

test('compact arrows open all original trade details and close without changing history', async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} disconnect() {} } });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const code = ts.transpileModule(readFileSync(resolve(frontend, 'src/pages/stocks/global/TradeMarkerRail.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module: any = {};
  const imports: Record<string, unknown> = { react: React, 'react/jsx-runtime': req('react/jsx-runtime'), './tradeMarkers': grouping };
  new Function('exports', 'require', code)(module, (name: string) => {
    if (!(name in imports)) throw Error(`Unexpected marker dependency: ${name}`);
    return imports[name];
  });
  const root = createRoot(document.getElementById('root'));
  const fills = ['BUY', 'SELL'].map((side, i) => ({ id: String(i), instrumentId: 'BYBIT:AAPLXUSDT', side,
    timestamp: 100000 + i, quantity: '0.25', price: '101', nativePrice: '100', currency: 'USDC', realized: i ? '0.50' : '0' }));
  const original = JSON.stringify(fills), unsubscribe = jest.fn();
  const chart = { timeScale: () => ({ timeToCoordinate: () => 50, width: () => 100,
    subscribeVisibleLogicalRangeChange: jest.fn(), unsubscribeVisibleLogicalRangeChange: unsubscribe }) };
  try {
    await React.act(async () => root.render(React.createElement(module.default, {
      chart, id: 'BYBIT:AAPLXUSDT', interval: '1m', candles: [{ time: 60 }], fills,
    })));
    const button = document.querySelector<HTMLButtonElement>('.vxg-trade-rail button')!;
    expect(button.textContent).toBe('↑↓2');
    expect(document.querySelectorAll('.vxg-trade-rail button')).toHaveLength(1);
    await React.act(async () => button.click());
    expect(document.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    expect(document.querySelectorAll('dialog article')).toHaveLength(2);
    expect(document.querySelector('dialog')!.textContent).toContain('0.50 USDC');
    expect(document.querySelector('dialog')!.textContent).toContain('100 USDT');
    await React.act(async () => document.querySelector<HTMLButtonElement>('dialog header button')!.click());
    expect(document.querySelector('dialog')!.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(JSON.stringify(fills)).toBe(original);
  } finally {
    await React.act(async () => root.unmount());
    expect(unsubscribe).toHaveBeenCalled();
    dom.window.close();
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver']) delete (globalThis as any)[key];
  }
});
