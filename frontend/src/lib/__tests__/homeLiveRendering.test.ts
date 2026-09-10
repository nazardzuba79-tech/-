import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
function evaluate(file: string, overrides: Record<string, unknown> = {}) {
  const compiled = ts.transpileModule(readFileSync(resolve(frontend, 'src', file), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output: any = {};
  new Function('require', 'exports', compiled)((name: string) => overrides[name] ?? req(name), output);
  return output;
}
const priceChange = evaluate('lib/priceChange.ts');
const marketModule = evaluate('pages/home/useHomeMarket.ts', {
  '../../lib/api': { api: {} }, '../../lib/priceChange': priceChange,
  '../../lib/futuresConfigStore': { futuresConfigStore: {} },
});
const liveValue = evaluate('pages/home/LiveValue.tsx', { './useHomeMarket': marketModule });
const copy = evaluate('pages/home/homeLiveCopy.ts');
const shared = {
  './useHomeMarket': marketModule, './LiveValue': liveValue, './homeLiveCopy': copy,
  '../../lib/i18n': { useLanguage: () => ({ lang: 'en', t: (key: string) => key }), localeOf: () => 'en-US' },
  '../../components/CryptoIcon': { CryptoIcon: () => null },
};
const { TerminalPreview } = evaluate('pages/home/TerminalPreview.tsx', {
  ...shared, '../../components/Logo': { LogoMark: () => null },
});
const { HomeMarkets } = evaluate('pages/home/HomeMarkets.tsx', {
  ...shared,
  '../../components/Sparkline': evaluate('components/Sparkline.tsx'),
  '../../lib/priceChange': priceChange,
  '../../lib/useFavorites': { useFavorites: () => ({ favorites: new Set() }) },
  'react-router-dom': { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) },
});
const quote = (pair = 'BTC/USDT', price = 64123.45, quoteVolume = 81573125) => ({
  pair, base: pair.split('/')[0], quote: 'USDT', price, change: -1.27, quoteVolume, high: 66000, low: 63000,
});
const market = (overrides: any = {}) => ({
  tickers: [quote()], tickersStatus: 'ok', tickersStale: false, tickerUpdatedAt: 1_700_000_000_000,
  tickerSource: 'kraken', priceHistory: {}, rankings: [], rankingsStatus: 'ok', global: null, fearGreed: null,
  globalStatus: 'error', cfd: { configured: false, tickers: [] }, cfdStatus: 'ok',
  futuresSymbols: ['BTC/USDT'], futuresStatus: 'ok', logoOf: () => undefined,
  hero: { pair: 'BTC/USDT', book: null, candles: [], trades: [], bookStatus: 'error', candlesStatus: 'error', tradesStatus: 'error', stale: true },
  ...overrides,
});
const render = (component: any, value: any) => renderToStaticMarkup(React.createElement(component, { market: value }));

test('missing hero sources render explicit unavailable states with no invented candles, depth, or executions', () => {
  const html = render(TerminalPreview, market());
  expect(html).toContain('64,123.45');
  expect(html).toContain('home.dataUnavailable');
  expect(html).not.toMatch(/vx-real-candles|class="vx-book-row|vx-trade-received/);
  expect(html).not.toContain('14:02');
  expect(html).not.toContain('0.4200');
});

test('the selected feed keeps its pair even when it leaves the watchlist or loses its current quote', () => {
  const others = Array.from({ length: 11 }, (_, i) => quote(`COIN${i}/USDT`, 1000 + i, 1e9 - i));
  const withQuote = render(TerminalPreview, market({ tickers: [...others, quote()] }));
  expect(withQuote).toMatch(/vx-terminal-pair[\s\S]*?<strong>BTC\/USDT<\/strong>[\s\S]*?64,123\.45/);
  const withoutQuote = render(TerminalPreview, market({ tickers: others }));
  expect(withoutQuote).toMatch(/vx-terminal-pair[\s\S]*?<strong>BTC\/USDT<\/strong>[\s\S]*?—/);
});

test('market graphs contain only received observations and do not invent a first-visit history', () => {
  const initial = render(HomeMarkets, market());
  expect(initial).not.toContain('<polyline');
  const observed = render(HomeMarkets, market({ priceHistory: { 'BTC/USDT': [64123.45, 64000] } }));
  expect(observed).toContain('points="0.00,0.00 74.00,24.00"');
  expect(observed).toContain('href="/trade?pair=BTC%2FUSDT"');
  expect(observed).toContain('nav.futures');
});

test('CFD change and volume remain unknown when absent; a reported zero change remains zero', () => {
  const cfd = { configured: true, tickers: [
    { symbol: 'XAUUSD', price: '2031.21', changePercent24h: null },
    { symbol: 'EURUSD', price: '1.12', changePercent24h: '0' },
  ] };
  const html = render(HomeMarkets, market({ tickers: [], cfd }));
  const gold = html.match(/<tr[^>]*>[\s\S]*?XAUUSD[\s\S]*?<\/tr>/)?.[0] ?? '';
  expect(gold).toContain('2,031.21');
  expect(gold).not.toContain('+0.00%');
  expect(gold.match(/—/g)?.length).toBeGreaterThanOrEqual(3);
  expect(html).toContain('+0.00%');
  expect(html).toContain('href="/trade?market=cfd&amp;symbol=XAUUSD"');
  expect(html).not.toContain('<polyline');
});
