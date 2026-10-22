import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as priceChange from '../priceChange';
import { LOCALES, readDictionaries } from '../../../test-utils/i18nSource';

/**
 * The markets page's CFD card and «popular derivatives» list say nothing while
 * CFD prices load or if they could not be loaded (owner, 2026-10-22, on
 * «Торговля CFD временно недоступна»: «виправляй»): rows of the real rows'
 * height, hidden from screen readers, and no sentence in any language.
 */
const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const dictionaries = readDictionaries();
const FORMER_LINE = ['Торговля CFD временно недоступна', 'CFD trading temporarily unavailable', 'La negociación de CFD no está disponible',
  'CFD ट्रेडिंग अस्थायी रूप से अनुपलब्ध', 'CFD取引は一時的に利用できません', 'CFD 거래를 일시적으로 이용할 수 없습니다', 'CFD 交易暂不可用', 'trade.cfdUnavailable'];

function render(lang: typeof LOCALES[number], tickers: unknown[]) {
  const output: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    '../lib/browserActivity': { browserSetInterval: () => 0, browserClearInterval: () => undefined },
    'react-router-dom': { Link: ({ to, className, children }: { to: string; className?: string; children?: unknown }) => React.createElement('a', { href: to, className }, children) },
    '../lib/api': { api: {} },
    '../lib/i18n': { useLanguage: () => ({ t: (key: string) => dictionaries[lang][key] ?? key, lang }), localeOf: () => 'en-US' },
    './CryptoIcon': { CryptoIcon: () => null },
    '../lib/priceChange': priceChange,
    '../lib/useCfdTickers': { useCfdTickers: () => ({ tickers, configured: true, loadError: false, reload: () => undefined }) },
    './CfdInstrumentIcon': { CfdInstrumentIcon: () => null },
  };
  const source = readFileSync(resolve(frontend, 'src/components/CfdMarketsSection.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)((name: string) => name.endsWith('.css') ? {} : imports[name] ?? req(name), output);
  return renderToStaticMarkup(React.createElement(output.CfdMarketsSection, {}));
}
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe.each(LOCALES)('markets CFD rows in %s', lang => {
  test('no prices yet (loading, or not loaded): quiet placeholder rows, no sentence', () => {
    const html = render(lang, []);
    for (const text of FORMER_LINE) expect(html).not.toContain(text);
    // Three in the CFD card, four in the «popular derivatives» list (its default tab).
    expect(count(html, 'market-dashboard__row--placeholder')).toBe(7);
    expect(count(html, 'market-dashboard__cfd-row market-dashboard__row--placeholder')).toBe(3);
    expect(count(html, 'market-dashboard__popular-row market-dashboard__row--placeholder')).toBe(4);
    expect(html).toMatch(/class="market-dashboard__row market-dashboard__cfd-row market-dashboard__row--placeholder" aria-hidden="true"><span class="market-dashboard__placeholder-mark"><\/span><span class="market-dashboard__placeholder-bar"><\/span>/);
  });

  test('prices arrived: the real rows, no placeholder', () => {
    const html = render(lang, [{ symbol: 'XAUUSD', name: 'Gold Spot', price: '4078.82', changePercent24h: '-0.86', status: 'sampled' }]);
    expect(html).not.toContain('market-dashboard__row--placeholder');
    expect(html).toContain('href="/trade?market=cfd&amp;symbol=XAUUSD"');
    expect(html).toContain('<strong>XAUUSD</strong>');
    for (const text of FORMER_LINE) expect(html).not.toContain(text);
  });
});

test('the placeholder rows keep the real rows’ height and draw no text', () => {
  const css = readFileSync(resolve(frontend, 'src/index.css'), 'utf8');
  const rule = (selector: string) => css.match(new RegExp(`\\n${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  expect(rule('.market-dashboard__placeholder-mark')).toMatch(/max-width: 40px;[\s\S]*aspect-ratio: 1;/);
  expect(rule('.market-dashboard__placeholder-bar')).toContain('height: 14px;');
  expect(css).not.toMatch(/market-dashboard__placeholder[^{]*\{[^}]*content:/);
  // The rows reuse `market-dashboard__cfd-row` / `__popular-row`, whose min-height the page already sets.
  expect(rule('.market-dashboard__cfd-row')).toContain('min-height: 91px;');
  expect(rule('.market-dashboard__popular-row')).toContain('min-height: 79px;');
});

test('TradFi lists the CFD instruments (gold, oil, currency pairs) and the home CFD panel falls back to the neutral data line', () => {
  const markets = readFileSync(resolve(frontend, 'src/pages/markets-bolt/components.tsx'), 'utf8');
  expect(markets).toMatch(/\{activeCategory === 'TradFi' \|\| activeKind === 'CFD' \? \(\s*<CfdMarketsSection \/>/);
  expect(markets).not.toContain('empty-state-panel');
  const home = readFileSync(resolve(frontend, 'src/pages/home/HomeMarketOverview.tsx'), 'utf8');
  expect(home).not.toContain('home.cfdSoon');
  // The CFD panel and the four other panels of the overview: one neutral data line, no «coming soon».
  expect(home.match(/<Unavailable label=\{t\('home\.dataUnavailable'\)\} \/>/g)).toHaveLength(5);
});
