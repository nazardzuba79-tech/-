import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

// Render the actual results and their SVG. No UI/math result is mocked.
const frontend = resolve(__dirname, '../../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const { JSDOM } = req('jsdom');
const modules = new Map<string, any>();
function load(base: string): any {
  const file = ['', '.tsx', '.ts', '/index.ts'].map((extension) => base + extension).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!file) throw new Error(`Module not found: ${base}`);
  if (modules.has(file)) return modules.get(file);
  const exports: any = {}; modules.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new Function('exports', 'require', code)(exports, (name: string) => name.startsWith('.') ? load(resolve(dirname(file), name)) : req(name));
  return exports;
}
const ui = load(resolve(frontend, 'src/pages/trading-tools/ToolResults'));
const drafts = load(resolve(frontend, 'src/pages/trading-tools/types'));
function render(mode: string, overrides: Record<string, unknown> = {}) {
  const draft = { ...drafts.exampleDraft(mode, 'futures'), ...overrides };
  const calculation = ui.calculateTool(mode, draft, 'futures');
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(ui.ToolResults, { calculation, draft })));
  return { document: dom.window.document, calculation, dom };
}

test('P&L SVG increases upwards for Long and decreases upwards for Short', () => {
  for (const side of ['long', 'short']) {
    const view = render('pnl', { side });
    const points = view.document.querySelector('polyline')!.getAttribute('points')!.split(' ').map((point: string) => point.split(',').map(Number));
    expect(points[0][0]).toBeLessThan(points[points.length - 1][0]);
    if (side === 'long') expect(points[0][1]).toBeGreaterThan(points[points.length - 1][1]);
    else expect(points[0][1]).toBeLessThan(points[points.length - 1][1]);
    view.dom.window.close();
  }
});

test('near-identical entry and break-even markers have separate readable label baselines', () => {
  const view = render('pnl');
  const labels = Array.from(view.document.querySelectorAll('.tt-chart svg g text')) as SVGTextElement[];
  expect(labels.map((label) => label.textContent)).toEqual(['Вход', 'Выход', 'Безубыт.']);
  expect(new Set(labels.map((label) => label.getAttribute('y'))).size).toBe(3);
  view.dom.window.close();
});

test('zero trading fees produce zero-width bars and entry-only labels', () => {
  const view = render('fees', { makerRate: '0', takerRate: '0', includeExit: false });
  const bars = Array.from(view.document.querySelectorAll('.tt-bar-track > span')) as HTMLElement[];
  expect(bars.length).toBe(1);
  expect(bars.every((bar) => bar.style.width === '0%')).toBe(true);
  expect(view.document.body.textContent).toContain('Вход Maker');
  expect(view.document.body.textContent).toContain('Вход Taker');
  expect(view.document.body.textContent).not.toContain('Maker →');
  view.dom.window.close();
});

test('liquidation threshold close to entry retains the visible price difference', () => {
  const view = render('liquidation', { entry: '100', quantity: '1', leverage: '1', maintenanceRate: '0', additionalMargin: '0', costs: '99.999999' });
  expect(view.calculation.result.ok).toBe(true);
  expect(view.document.querySelector('.tt-primary-result strong')!.textContent).toContain('99,999999');
  view.dom.window.close();
});

test('only a near-entry liquidation price expands past the usual eight decimals', () => {
  const pnl = render('pnl');
  expect(pnl.document.querySelector('.tt-breakdown')!.textContent).toContain('60 060,03001501');
  expect(pnl.document.querySelector('.tt-breakdown')!.textContent).not.toContain('030015007503751875');
  pnl.dom.window.close();
  const threshold = render('liquidation', { entry: '100', quantity: '1', leverage: '1', maintenanceRate: '0', additionalMargin: '0', costs: '99.9999999999' });
  expect(threshold.document.querySelector('.tt-primary-result strong')!.textContent).toContain('99,9999999999');
  threshold.dom.window.close();
});

test('a threshold closer than 24 decimals is explicitly distinguished from entry', () => {
  const view = render('liquidation', { entry: '100', quantity: '1', leverage: '3', maintenanceRate: '0', additionalMargin: '0', costs: '33.333333333333333333333333' });
  expect(view.calculation.result.ok).toBe(true);
  expect(view.document.querySelector('.tt-result-notice')!.textContent).toContain('Порог почти совпадает с входом');
  expect(view.document.querySelector('.tt-result-notice')!.textContent).toContain('<0,00000001%');
  expect(view.document.querySelector('.tt-exact')!.textContent).toContain('99.999999999999999999999999');
  view.dom.window.close();
});

test('quantity precision and RR orientation agree across headline, exact details and copy', () => {
  const quantity = render('pnl', { quantity: '1.00001' });
  expect(quantity.document.querySelector('.tt-breakdown')!.textContent).toContain('1,00001');
  quantity.dom.window.close();
  const rr = render('risk-reward');
  expect(rr.document.querySelector('.tt-primary-result')!.textContent).toContain('Риск : прибыль');
  expect(rr.document.querySelector('.tt-primary-result strong')!.textContent).toContain('1 : 2');
  expect(rr.document.querySelector('.tt-exact')!.textContent).toContain('1 : 2');
  expect(ui.exactResultText(rr.calculation)).toContain('Риск : прибыль: 1 : 2');
  rr.dom.window.close();
});

test('incomplete input immediately removes the previous result and chart', () => {
  const view = render('pnl', { entry: '' });
  expect(view.document.querySelector('[data-tools-result]')!.getAttribute('data-tools-status')).toBe('incomplete');
  expect(view.document.querySelector('.tt-empty-value')!.textContent).toBe('—');
  expect(view.document.querySelector('svg.tt-chart, .tt-chart')).toBeNull();
  expect(view.document.querySelector('.tt-primary-result')).toBeNull();
  view.dom.window.close();
});
