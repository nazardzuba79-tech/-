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
const homeCopy = evaluate('pages/home/homeLiveCopy.ts');
const globalCopy = evaluate('pages/home/globalHeroCopy.ts');
const quote = (price: number, pair = 'BTC/USDT') => ({
  pair, base: pair.split('/')[0], quote: 'USDT', price, change: 0, high: price, low: price, quoteVolume: 0,
});
const feed = (overrides: any = {}) => ({
  pair: 'BTC/USDT', candles: [], trades: [], book: null,
  candlesStatus: 'error', tradesStatus: 'error', bookStatus: 'error', stale: false, updatedAt: null,
  ...overrides,
});
const market = (overrides: any = {}) => ({
  tickers: [], tickerSource: '', tickerUpdatedAt: null, tickersStale: false,
  logoOf: () => undefined, hero: feed(), ...overrides,
});
function render(value: any, lang = 'en') {
  const dictionary = evaluate(`lib/i18n/locales/${lang}.ts`)[lang.toUpperCase()];
  const t = (key: string) => {
    if (!(key in dictionary)) throw new Error(`Missing ${lang} translation: ${key}`);
    return dictionary[key];
  };
  const { TerminalPreview } = evaluate('pages/home/TerminalPreview.tsx', {
    './useHomeMarket': marketModule, './LiveValue': liveValue,
    './homeLiveCopy': homeCopy, './globalHeroCopy': globalCopy,
    '../../components/Logo': { LogoMark: () => null },
    '../../components/CryptoIcon': { CryptoIcon: () => null },
    '../../lib/i18n': { useLanguage: () => ({ lang, t }), localeOf: () => 'en-US' },
  });
  return { html: renderToStaticMarkup(React.createElement(TerminalPreview, { market: value })), t };
}
const orderArea = (html: string) => html.match(/<aside class="vx-terminal-order-entry"[\s\S]*?<\/aside>/)?.[0] ?? '';

test('unavailable market renders honest blanks and public-data fallback, with no invented account or order state', () => {
  const { html, t } = render(market());
  expect(html.match(/—/g)?.length).toBeGreaterThanOrEqual(8);
  expect(html).toContain(t('home.dataUnavailable'));
  expect(html).not.toMatch(/<form|<input|vx-real-candles|class="vx-book-row|class="vx-trade-row vx-trade-received|My Orders/);
  expect(orderArea(html)).toContain('<dd>— <small>BTC</small></dd>');
  expect(orderArea(html)).toContain('<span>Available</span><span>— USDT</span>');
  expect(orderArea(html)).not.toMatch(/12,?426|0\.00|BTC[\s\S]*balance/i);
});

test('received zero prices, sizes and candle volume remain zero without non-finite chart geometry', () => {
  const { html } = render(market({ tickers: [quote(0)], hero: feed({
    book: { asks: [{ price: '0', quantity: '0' }], bids: [{ price: '0', quantity: '0' }] },
    candles: [{ time: 1_700_000_000, open: 0, high: 0, low: 0, close: 0, volume: 0 }],
    trades: [{ id: 'zero-received', time: 1_700_000_000, side: 'BUY', price: '0', quantity: '0' }],
  }) }));
  expect(html.match(/>0<\/span>/g)?.length).toBeGreaterThanOrEqual(7);
  expect(html).toContain('+0.00%');
  expect(html).toMatch(/class="vx-candle-volume"[^>]*height="0"/);
  expect(html).not.toMatch(/NaN|Infinity|undefined/);
  expect(orderArea(html)).toContain('<span>— USDT</span>');
});

test('chart volumes and UTC labels derive from received candles, and executions retain the public pair and exact size', () => {
  const { html } = render(market({ tickers: [quote(120)], hero: feed({
    pair: 'BTC/USDT',
    candles: [
      { time: Date.UTC(2026, 0, 1, 9, 0) / 1000, open: 100, high: 115, low: 95, close: 110, volume: 2 },
      { time: Date.UTC(2026, 0, 1, 9, 15) / 1000, open: 110, high: 125, low: 105, close: 120, volume: 4 },
    ],
    trades: [{ id: 'received-unique', time: Date.UTC(2026, 0, 1, 9, 15, 7), side: 'SELL', price: '119.5', quantity: '0.01842' }],
  }) }));
  const bars = [...html.matchAll(/<rect class="vx-candle-volume"[^>]*height="([^"]+)"/g)];
  expect(bars.map(match => Number(match[1]))).toEqual([14.5, 29]);
  expect(html).toContain('>09:00</text>');
  expect(html).toContain('>09:15</text>');
  expect(html).toContain('>UTC</text>');
  expect(html).toContain('2026-01-01T09:15:07.000Z');
  const executions = html.slice(html.indexOf('vx-terminal-public-trades'));
  expect(executions).toContain('<span>BTC/USDT</span>');
  expect(executions).toContain('>Sell</span>');
  expect(executions).toContain('>119.50</span>');
  expect(executions).toContain('>0.01842</span>');
});

test('a missing volume or blank depth quantity does not silently become real zero', () => {
  const { html } = render(market({ hero: feed({
    candles: [{ time: 1_700_000_000, open: 100, high: 110, low: 95, close: 105 }],
    book: { asks: [{ price: '105', quantity: '' }], bids: [] },
  }) }));
  expect(html).toContain('vx-real-candles');
  expect(html).not.toContain('vx-candle-volume');
  const ask = html.match(/<div class="vx-book-row vx-book-ask">[\s\S]*?<\/div>/)?.[0] ?? '';
  expect(ask).toContain('>105.00</span>');
  expect(ask).toContain('>—</span>');
  expect(ask).not.toContain('>0</span>');
});

test.each(['en', 'ru', 'es', 'zh', 'hi', 'ja', 'ko'])('%s trade actions open the real selected market with localized labels and no unsupported side parameter', lang => {
  const { html, t } = render(market({ hero: feed({ pair: 'ETH/USDT' }) }), lang);
  const area = orderArea(html);
  const links = [...area.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
  expect(links.map(match => match[1])).toEqual(Array(3).fill('/trade?pair=ETH%2FUSDT'));
  expect(links.map(match => match[2])).toEqual([`${t('trade.buy')} ETH`, `${t('trade.sell')} ETH`, t('home.cta.openTerminal')]);
  expect(area).not.toContain('<form');
  expect(area).not.toContain('side=');
  expect(area).toContain('<span>— USDT</span>');
});
