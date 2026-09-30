import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * THE FUTURES TERMINAL ON ONE DESIGN SYSTEM — the owner's «VOLTEX —
 * дизайн-система терминала» page, as a proposal beside «Мій» (2026-09-30).
 * Pins the page's values, the sheet's place in the cascade, and that the
 * chart's new tokens fall back to the colours every other chart keeps.
 */
const root = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const css = read('frontend/src/pages/trade-terminal/FuturesLookSystem.css');

it('is one sheet, just before the panel tiles it re-tones', () => {
  const order = [...read('frontend/src/pages/FuturesPage.tsx').matchAll(/import '\.\/trade-terminal\/(\w+)\.css';/g)].map(m => m[1]);
  expect(order.slice(-2)).toEqual(['FuturesLookSystem', 'TerminalPanelTiles']);
});

it('carries the page\'s tokens verbatim', () => {
  for (const token of ['--ds-bg-0:#0B0E11', '--ds-bg-1:#12161B', '--ds-bg-2:#181D23', '--ds-bg-3:#1F252C', '--ds-line:#22282F',
    '--ds-t1:#EAECEF', '--ds-t2:#8A93A0', '--ds-t3:#5C6470', '--ds-brand:#E5B42A', '--ds-long:#21B37A', '--ds-short:#EE4B5A']) {
    expect(css).toContain(token);
  }
  expect(css).toContain("--font-family:'Inter Terminal',Inter");
  // Weights 400/500/600 only.
  expect(css).not.toMatch(/font-weight:\s*(700|800|900)/);
});

it('keeps gold for the deposit button and the active underline, and Long / Short at 32px, radius 6', () => {
  expect(css).toMatch(/\.top-nav-fund-btn \{[^}]*background:var\(--ds-brand\)/);
  expect(css).toMatch(/\.top-nav-link\.is-active::after \{ background:var\(--ds-brand\); \}/);
  expect(css).toMatch(/\.fo-submitPair button \{ height:32px; min-height:32px; border-radius:6px;/);
});

it('gives the chart tokens whose fallbacks are the existing colours', () => {
  const chart = read('frontend/src/components/PriceChart.tsx');
  expect(chart).toContain("priceLineColor: token('--voltex-price-line', '#f0b90b')");
  expect(chart).toContain("color: token('--voltex-ma-color', '#f7d51d')");
  expect(chart).toContain("token('--voltex-crosshair', '#f0b90b')");
  expect(chart).toContain("token('--voltex-candle-standard-up', '')");
});
