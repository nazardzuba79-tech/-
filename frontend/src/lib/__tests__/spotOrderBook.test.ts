import { aggregateSpotBook, defaultSpotGroupStep, formatSpotBookNumber, formatSpotSpreadPercent,
  spotBookMetrics, spotGroupSteps, spotLevelPrice } from '../spotOrderBook';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as helpers from '../spotOrderBook';

const level = (price: number | string, quantity: number | string = 1) => ({ price: String(price), quantity: String(quantity) });

test.each([null, 80000, 3200, 125, 0.51, 0.0000081, 1e-14])('group default is a real selectable step for %s', price => {
  const steps = spotGroupSteps(price);
  expect(steps).toContain(defaultSpotGroupStep(price));
  expect(steps.every(step => step > 0 && Number.isFinite(step))).toBe(true);
  expect(new Set(steps).size).toBe(steps.length);
  for (const step of steps) expect(Number(spotLevelPrice(step, step))).toBe(step);
});

test('bid floors, ask ceils, exact grid boundaries and cumulative quantity conserve the real book', () => {
  const raw = [level(100.09, 2), level(100.01, 3), level(99.99, 4), level(99.9, 5)];
  const before = JSON.stringify(raw);
  expect(aggregateSpotBook(raw, 0.1, 'BUY')).toEqual([
    { price: 100, quantity: 5, cumulative: 5 }, { price: 99.9, quantity: 9, cumulative: 14 },
  ]);
  expect(aggregateSpotBook(raw, 0.1, 'SELL')).toEqual([
    { price: 99.9, quantity: 5, cumulative: 5 }, { price: 100, quantity: 4, cumulative: 9 },
    { price: 100.1, quantity: 5, cumulative: 14 },
  ]);
  expect(JSON.stringify(raw)).toBe(before);
});

test('tiny coin rows remain nonzero and selectable with exact displayed decimal precision', () => {
  const step = defaultSpotGroupStep(0.0000081);
  const rows = aggregateSpotBook([level('0.000008123456', 1000), level('0.00000813', 500)], step, 'SELL');
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const text = spotLevelPrice(row.price, step);
    expect(text).not.toMatch(/e|,/i);
    expect(Number(text)).toBe(row.price);
    expect(Number(text)).toBeGreaterThan(0);
  }
});

test('spread derives from best valid ungrouped prices even when input is unsorted', () => {
  const bids = [level(90), level(100, 3), level('NaN'), level(110, 0)];
  const asks = [level(120), level(102, 2), level(-2), level(1, -2)];
  expect(spotBookMetrics(bids, asks)).toEqual({ bestBid: 100, bestAsk: 102, mid: 101, spread: 2, spreadPercent: 2 / 101 * 100 });
});

test.each([
  [[], [level(2)]], [[level(1)], []], [[level(3)], [level(2)]], [[level('Infinity')], [level(2)]],
])('missing/invalid/crossed book never invents a spread', (bids, asks) => {
  const metrics = spotBookMetrics(bids, asks);
  expect(metrics.mid).toBeNull(); expect(metrics.spread).toBeNull(); expect(metrics.spreadPercent).toBeNull();
});

test('locked book has real zero spread, not unavailable', () => {
  expect(spotBookMetrics([level(2)], [level(2)]).spread).toBe(0);
});

test('aggregation excludes invalid/nonpositive rows, preserves valid quantity and rejects bad steps', () => {
  const raw = [level(1, 3), level('NaN'), level('Infinity'), level(-1), level(2, 0), level(2, -1), level(3, '')];
  expect(aggregateSpotBook(raw, 0.1, 'BUY')).toEqual([{ price: 1, quantity: 3, cumulative: 3 }]);
  for (const step of [0, -1, NaN, Infinity]) expect(aggregateSpotBook(raw, step, 'BUY')).toEqual([]);
});

test('display formatting does not zero small positive spreads or append a false USD unit', () => {
  expect(formatSpotBookNumber(0.00000012)).toBe('0.00000012');
  expect(formatSpotSpreadPercent(0.00000012)).toBe('0.00000012%');
  expect(formatSpotBookNumber(NaN)).toBe('—');
  expect(formatSpotSpreadPercent(Infinity)).toBe('—');
});

const frontend = resolve(__dirname, '../../..');
const requireFrontend = createRequire(resolve(frontend, 'package.json'));
const React = requireFrontend('react');
const { renderToStaticMarkup } = requireFrontend('react-dom/server');
const source = readFileSync(resolve(frontend, 'src/components/OrderBookPanel.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const output: Record<string, any> = {};
new Function('require', 'exports', compiled)((name: string) => {
  if (name === '../lib/spotOrderBook') return helpers;
  if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
  if (name === '../lib/formatNumber') return { formatPrice: (price: number) => `legacy:${price}` };
  return requireFrontend(name);
}, output);
const render = (props: object) => renderToStaticMarkup(React.createElement(output.OrderBookPanel, props));

test('actual Spot component shows real tiny prices, accessible rows and no false EUR dollar approximation', () => {
  const html = render({ pair: 'PEPE/EUR', bids: [level('0.00000811')], asks: [level('0.00000813')], spotPrecision: true, onPickPrice: () => {} });
  expect(html).toContain('role="button" tabindex="0" aria-label="Bid 0.000008110"');
  expect(html).toContain('aria-label="Ask 0.000008130"');
  expect(html).toContain('0.00000002');
  expect(html).not.toContain('≈ $');
  expect(html).not.toContain('legacy:');
  expect(html).not.toContain('>0.00</span>');
});

test('shared/default Futures path retains legacy options/formatting and no Spot keyboard behavior', () => {
  const html = render({ pair: 'BTC/USDT', bids: [level(79000)], asks: [level(79010)], onPickPrice: () => {} });
  expect(html).toContain('legacy:79005');
  expect([...html.matchAll(/<option value="([^"]+)"/g)].map(match => match[1])).toEqual(['0.1', '1', '10', '50']);
  expect(html).not.toContain('role="button"');
  expect(html).not.toContain('ob-row--spot');
  expect(html).not.toContain('class="cell" title=');
});

test('Spot tiny-price rows keep unchanged full numeric labels and narrowly scoped non-overlapping cells', () => {
  const quantity = 1234567890.12;
  const price = '0.0000001091';
  const html = render({ pair: 'MOG/USDT', bids: [level(price, quantity)], asks: [level('0.0000001092', quantity)],
    spotPrecision: true, onPickPrice: () => {} });
  expect(html).toContain('ob-row--spot');
  const expectedPrice = spotLevelPrice(Number(price), defaultSpotGroupStep(0.00000010915));
  expect(html).toContain(`class="cell bid-price" title="${expectedPrice}">${expectedPrice}</span>`);
  expect(html).toContain(`class="cell" title="${formatSpotBookNumber(quantity)}">${formatSpotBookNumber(quantity)}</span>`);
  const total = formatSpotBookNumber(Number(expectedPrice) * quantity);
  expect(html).toContain(`class="cell" title="${total}">${total}</span>`);
  const css = readFileSync(resolve(frontend, 'src/components/SpotMarketControls.css'), 'utf8');
  expect(css).toMatch(/\.ob-row\.ob-row--spot\s*\{\s*gap:\s*6px;/);
  expect(css).toMatch(/\.ob-row\.ob-row--spot \.cell\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
  expect(css).toMatch(/\.ob-row\.ob-row--spot \.cell\.ask-price\s*\{[^}]*flex:\s*0 0 auto;[^}]*max-width:\s*55%;/);
});

test('exact Spot selection text is shared by click and keyboard, not toFixed(2)', () => {
  expect(source).toContain("const pick = () => onPick?.(spotStep === undefined ? level.price.toFixed(2) : priceText)");
  expect(source).toContain("event.key === 'Enter' || event.key === ' '");
  expect(source).toContain('event.preventDefault(); pick();');
});

test('actual row handlers select exact small price by click, Enter and Space only', () => {
  const bindings: Record<string, any> = {};
  new Function('require', 'exports', compiled)((name: string) => {
    if (name === 'react') return { ...React, memo: (fn: any) => fn, useEffect: () => {}, useMemo: (fn: any) => fn(),
      useRef: (value: any) => ({ current: value }), useState: (value: any) => [typeof value === 'function' ? value() : value, () => {}] };
    if (name === '../lib/spotOrderBook') return helpers;
    if (name === '../lib/i18n') return { useLanguage: () => ({ t: (key: string) => key }) };
    if (name === '../lib/formatNumber') return { formatPrice: String };
    return requireFrontend(name);
  }, bindings);
  const picked: string[] = [];
  const element = bindings.OrderBookPanel({ pair: 'PEPE/USDT', bids: [level('0.00000811')], asks: [level('0.00000813')],
    spotPrecision: true, onPickPrice: (price: string) => picked.push(price) });
  const elements: any[] = [];
  function walk(node: any) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === 'function') { walk(node.type(node.props)); return; }
    elements.push(node); walk(node.props?.children);
  }
  walk(element);
  const rowNode = elements.find(node => node.props?.['aria-label'] === 'Bid 0.000008110');
  expect(rowNode).toBeDefined();
  const preventDefault = jest.fn();
  rowNode.props.onClick();
  for (const key of ['Enter', ' ', 'ArrowDown']) rowNode.props.onKeyDown({ key, preventDefault });
  expect(picked).toEqual(['0.000008110', '0.000008110', '0.000008110']);
  expect(preventDefault).toHaveBeenCalledTimes(2);
});

// ── The two sides of the book must be the same size ──────────────────

test('an order-book row never compresses, so asks and bids show the same levels', () => {
  // THE DEFECT THIS PINS. `.orderbook-asks` is a flex container — it is
  // column-reverse, so the sell side builds upward from the spread — while
  // `.orderbook-bids` is an ordinary block. A flex child defaults to
  // `flex-shrink: 1`, so as soon as the asks overflowed (15 rows at 26px
  // into a 234px column) the browser squeezed every ask row down to its
  // line-height, 17.4px, while the bids kept 26px and simply clipped.
  //
  // Measured in Chromium before the fix: ask row 17.4px, bid row 26px,
  // 14 sells visible against 9 buys. It reads as "the sells use a smaller
  // font" — they do not, both are 12px. The ROW was collapsing.
  //
  // After: both rows 26px, nine levels visible on each side.
  const css = readFileSync(resolve(frontend, 'src/pages/trade-terminal/TradeTerminal.css'), 'utf8');
  const row = css.match(/\.trade-terminal \.ob-row \{[^}]*\}/)?.[0];
  expect(row).toBeDefined();
  expect(row).toMatch(/flex-shrink:\s*0/);

  // The asymmetry that makes the rule necessary is real, not assumed: one
  // side is a flex container and the other is not. If that ever changes,
  // this test should be revisited rather than silently kept.
  const asks = css.match(/\.trade-terminal \.orderbook-asks \{[^}]*\}/s)?.[0];
  const bids = css.match(/\.trade-terminal \.orderbook-bids \{[^}]*\}/s)?.[0];
  expect(asks).toMatch(/display:\s*flex/);
  expect(asks).toMatch(/column-reverse/);
  expect(bids).not.toMatch(/display:\s*flex/);

  // Both sides are clipped, so neither can scroll away from the spread.
  expect(asks).toMatch(/overflow:\s*hidden/);
  expect(bids).toMatch(/overflow:\s*hidden/);

  // And the Futures override may set a taller row, but must not reinstate
  // shrinking by redeclaring flex on it.
  const futures = readFileSync(resolve(frontend, 'src/pages/trade-terminal/FuturesTerminal.css'), 'utf8');
  const fRow = futures.match(/\.trade-terminal\.futures-terminal \.ob-row \{[^}]*\}/)?.[0];
  expect(fRow).toMatch(/height:\s*26px/);
  expect(fRow).not.toMatch(/flex-shrink:\s*[1-9]/);
});
