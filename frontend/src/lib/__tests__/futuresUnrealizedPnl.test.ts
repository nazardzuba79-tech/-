import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as format from '../cardNumberFormat';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const read = (path: string) => readFileSync(resolve(frontend, 'src', path), 'utf8');
const source = read('components/FuturesUnrealizedPnl.tsx');
const output: any = {};
new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
} }).outputText)((name: string) => name.endsWith('.css') ? {} : name === '../lib/cardNumberFormat' ? format : req(name), output);
const render = (amount: string | null, roi: string | null, asset = 'USDT', approx?: string | null) => renderToStaticMarkup(
  React.createElement(output.FuturesUnrealizedPnl, { amount, roi, asset, approx }));

test.each([
  ['16136162', '33391.29', '+16,136,162.00', '(+33,391.29%)', 'profit'],
  ['136.25', '3.91', '+136.25', '(+3.91%)', 'profit'],
  ['-136.25', '-3.91', '-136.25', '(-3.91%)', 'loss'],
  ['0', '0', '0.00', '(0.00%)', 'neutral'],
  ['-0', '-0', '0.00', '(0.00%)', 'neutral'],
  ['0.0000012345', '0.001', '+0.0000012345', '(0.00%)', 'profit'],
  ['-0.0000012345', '-0.001', '-0.0000012345', '(0.00%)', 'loss'],
  ['136.25', '128450.75', '+136.25', '(+128,450.75%)', 'profit'],
])('renders authoritative amount %s and ROI %s together', (amount, roi, money, percent, tone) => {
  const html = render(amount, roi);
  expect(html).toContain(`data-tone="${tone}"`);
  expect(html).toContain(`class="futures-position-money">${money} <span class="futures-unrealized-unit">USDT</span>`);
  expect(html).toContain(`class="futures-position-roi">${percent}</small>`);
  expect(html).not.toMatch(/USD<|\$|\d[KMB]<|NaN|Infinity/);
});
test.each([null, '', 'NaN', 'Infinity', '-Infinity', '12oops'])('unknown %s is a neutral dash, not fabricated zero', value => {
  const html = render(value, value);
  expect(html).toContain('data-tone="neutral"');
  expect(html).toContain('class="futures-position-money">—</span>');
  expect(html).toContain('class="futures-position-roi">—</small>');
  expect(html).not.toMatch(/NaN|Infinity|0\.00/);
});
test('actual quote asset is supplied by the position, not globally assumed', () => {
  expect(render('1', '2', 'USDC')).toContain('>USDC</span>');
  const panel = read('components/FuturesPositionsPanel.tsx');
  expect(panel).toContain("const quoteAsset = p.symbol.split('/')[1] ?? '';");
  expect(panel).toContain('<FuturesUnrealizedPnl amount={p.unrealizedPnl} roi={p.roe} asset={quoteAsset} approx={p.unrealizedPnl === null ? null : approxUsd(Number(p.unrealizedPnl), quoteAsset)}>');
});
// Owner, 2026-09-30, with a Bybit screenshot: «З низу дублювання в usd як у байбіт».
test('draws the caller\'s «≈… USD» line under the ROI, and nothing when it has none', () => {
  const html = render('3860.0118', '73.81', 'USDT', '≈3,860.01 USD');
  expect(html).toMatch(/class="futures-position-roi">\(\+73\.81%\)<\/small><small class="futures-position-approx">≈3,860\.01 USD<\/small>/);
  expect(render('1', '2', 'USDT', null)).not.toContain('futures-position-approx');
  const panel = read('components/FuturesPositionsPanel.tsx');
  // Dollars only for a dollar-stable quote, at two decimals, never «-0.00».
  expect(panel).toContain("const USD_QUOTES = new Set(['USDT', 'USDC', 'USD']);");
  expect(panel).toContain('return `≈${group(Math.abs(value) < 0.005 ? 0 : value, 2)} USD`;');
  // Realized carries the same line, on the live (archive) terminal too.
  expect(panel).toContain('const realizedApprox = approxUsd(realized, quoteAsset);');
  expect(panel).toContain('{realizedApprox && <small className="futures-position-approx">{realizedApprox}</small>}');
  expect(panel).not.toContain('!archive && Number.isFinite(realized)');
  const css = read('components/FuturesUnrealizedPnl.css');
  expect(css).toContain('.futures-unrealized .futures-position-approx {\n  grid-column: 1; grid-row: 3;');
  expect(css).toContain('.futures-unrealized:has(.futures-position-approx) .archive-pnl-open { grid-row: 1 / 4; }');
});
test('engine values are passed through; presentation has no financial inputs/formulas', () => {
  const adapter = read('lib/nativeFuturesAdapter.ts');
  expect(adapter).toContain('unrealizedPnl: position.unrealizedPnl');
  expect(adapter).toContain('roe: position.roiPercent');
  expect(source).not.toMatch(/entryPrice|markPrice|initialMargin|leverage|quantity|roiBasis|fetch\(/);
  expect(source).toContain('cardPrice(amount)');
  expect(source).toContain('cardSignedPercent(roi)');
});
test('full localized column header and chart position marker remain', () => {
  expect(read('lib/i18n/locales/ru.ts')).toContain("'futures.colUnrealized': 'Нереализованный P&L (ROI)'");
  expect(read('components/FuturesPositionsPanel.tsx')).toContain("<Th title={t('futures.hintUnrealized')}>{t('futures.colUnrealized')}</Th>");
  expect(read('components/TerminalChart.tsx')).toContain('positionLines={positionLines}');
  expect(read('components/PriceChart.tsx')).toContain('positionLinesRef.current.push(visible.createPriceLine(');
});
test('layout is two rows with tabular figures and wrapping rather than truncation on mobile', () => {
  const css = read('components/FuturesUnrealizedPnl.css');
  expect(css).toContain('grid-row: 1;'); expect(css).toContain('grid-row: 2;');
  expect(css).toContain('font-variant-numeric: tabular-nums');
  expect(css).toContain('overflow-wrap: anywhere');
  expect(css).not.toMatch(/text-overflow|overflow:\s*hidden|line-clamp/);
  expect(css).toContain('[data-tone=profit] { color: var(--buy); }');
  expect(css).toContain('[data-tone=loss] { color: var(--sell); }');
});
