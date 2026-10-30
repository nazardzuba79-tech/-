import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import { STOCK_MESSAGES } from '../../pages/stocks/global/stockMessages';
import { stockText, stockTranslator, stockNoticeText, stockOrderLabel, stockFxPolicyText, type StockMessage } from '../../pages/stocks/global/stockText';
import { globalStockErrorText } from '../../pages/stocks/stockRequestError';
import { stockOverloadText, stockCooldownMs } from '../../pages/stocks/global/overload';
import * as grouping from '../../pages/stocks/global/tradeMarkers';
import type { Lang } from '../i18n';

const languages: Lang[] = ['ru', 'en', 'es', 'zh', 'hi', 'ja', 'ko'];
const expected = {
  ru: ['Акции', 'Торговля', 'Нет', 'Детали сделок', 'Цена исполнения'],
  en: ['Stocks', 'Trade', 'None', 'Trade details', 'Execution price'],
  es: ['Acciones', 'Operar', 'Ninguno', 'Detalles de las operaciones', 'Precio de ejecución'],
  zh: ['股票', '交易', '无', '成交详情', '成交价'],
  hi: ['शेयर', 'ट्रेडिंग', 'कोई नहीं', 'ट्रेड विवरण', 'निष्पादन मूल्य'],
  ja: ['株式', '取引', 'なし', '約定詳細', '約定価格'],
  ko: ['주식', '거래', '없음', '체결 상세', '체결가'],
};
const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m => m[1]).sort();

test('all seven Stocks languages have complete explicit messages and identical placeholders', () => {
  expect(Object.keys(STOCK_MESSAGES)).toHaveLength(182);
  for (const [source, translations] of Object.entries(STOCK_MESSAGES)) {
    expect(translations).toHaveLength(6);
    for (const text of translations) {
      expect(text.trim()).not.toBe('');
      expect(placeholders(text)).toEqual(placeholders(source));
      expect(text).not.toMatch(/[А-Яа-яЁё]/);
    }
  }
  for (const lang of languages) {
    expect(stockText(lang, 'Акции')).toBe(expected[lang][0]);
    expect(stockText(lang, 'Торговля')).toBe(expected[lang][1]);
    expect(stockText(lang, 'Нет')).toBe(expected[lang][2]);
  }
});

test('safe error, overload, order and age states translate at render without exposing raw upstream input', () => {
  const notice = Object.freeze({ kind: 'order' as const, status: 'FILLED', filled: '0.12500000', asset: 'AAPLX' });
  for (const lang of languages) {
    const s = stockTranslator(lang);
    for (const code of ['AUTH_REQUIRED', 'QUOTE_STALE', 'MOEX_UNVERIFIED', 'FX_UNAVAILABLE', 'INSUFFICIENT_FUNDS']) {
      expect(globalStockErrorText(code, lang)).not.toBe(code);
      if (lang !== 'ru') expect(globalStockErrorText(code, lang)).not.toMatch(/[А-Яа-яЁё]/);
    }
    expect(globalStockErrorText('SECRET=https://private.invalid/token', lang)).toBe(s('Не удалось выполнить запрос. Повторите попытку.'));
    expect(globalStockErrorText({ message: 'private-token' }, lang)).not.toContain('private-token');
    expect(stockOverloadText('RATE_LIMIT', lang)).toBe(s('Достигнут лимит запросов источника. Автообновление приостановлено.'));
    expect(stockOverloadText('ACCOUNT_BUSY', lang)).toBe(s('Тестовый счёт занят. Автообновление приостановлено.'));
    expect(stockFxPolicyText('observed USDT per USDC',s)).toBe(s('Наблюдаемый курс USDT за USDC'));
    expect(stockFxPolicyText('daily official reference, not live RUB FX',s)).toBe(s('Официальный дневной справочный курс, не текущий курс RUB'));
    expect(stockFxPolicyText('RUB per USDC: daily reference × observed stablecoin legs',s)).toBe(s('RUB за USDC: дневной справочный курс × наблюдаемые курсы стейблкоинов'));
    expect(stockFxPolicyText('unknown native policy v2',s)).toBe('unknown native policy v2');
    expect(stockFxPolicyText(undefined,s)).toBeUndefined();
    expect(stockNoticeText(notice, s)).toBe(stockOrderLabel('FILLED', s) + ' · 0.12500000 AAPLX');
    expect(grouping.quoteAge(1000, 43000, lang)).toBe(s('{value0} с назад', { value0: 42 }));
    expect(grouping.quoteAge(undefined, 43000, lang)).toBe(s('Время не подтверждено'));
    expect(s('Повторить можно через {value0} с.', { value0: 7 })).not.toContain('{value0}');
  }
  expect(stockCooldownMs('RATE_LIMIT', 1)).toBe(60000);
  expect(stockCooldownMs('ACCOUNT_BUSY', 1)).toBe(3000);
  expect(notice).toEqual({ kind: 'order', status: 'FILLED', filled: '0.12500000', asset: 'AAPLX' });
});

const frontend = resolve(__dirname, '../../..'), req = createRequire(resolve(frontend, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), { JSDOM } = req('jsdom');
const tags: Record<Lang, string> = { ru: 'ru-RU', en: 'en-US', es: 'es-ES', zh: 'zh-CN', hi: 'hi-IN', ja: 'ja-JP', ko: 'ko-KR' };

test('mounted desktop, chart and open trade details change language without chart/data/selection replacement', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1', pretendToBeVisual: true });
  const originalFetch = globalThis.fetch;
  const network = jest.fn(() => { throw Error('LOCALIZATION_MUST_NOT_FETCH'); });
  globalThis.fetch = network as any;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} disconnect() {} } });
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const language = React.createContext({ lang: 'ru' as Lang });
  const priceTitle = jest.fn(), setData = jest.fn(), removeChart = jest.fn(), options = jest.fn();
  const priceLine = { applyOptions: priceTitle };
  const scale = { fitContent() {}, width: () => 500, timeToCoordinate: () => 100,
    subscribeVisibleLogicalRangeChange() {}, unsubscribeVisibleLogicalRangeChange() {} };
  const chart = { addSeries: () => ({ setData, applyOptions() {}, priceScale: () => ({ applyOptions() {} }),
    createPriceLine: () => priceLine, removePriceLine() {} }), applyOptions: options, timeScale: () => scale,
    priceScale: () => ({ applyOptions() {} }), subscribeCrosshairMove() {}, remove: removeChart };
  const createChart = jest.fn(() => chart);
  const modules = new Map<string, any>();
  const common: Record<string, any> = { react: React, 'react/jsx-runtime': req('react/jsx-runtime'),
    'bignumber.js': req('bignumber.js'), './tradeMarkers': grouping,
    '../../../components/LanguageSwitcher': { LanguageSwitcher: () => null },
    './stockText': { stockTranslator },
    '../../../lib/i18n': { useLanguage: () => React.useContext(language), localeOf: (lang: Lang) => tags[lang] },
    'react-router-dom': { Link: ({ children, to, ...rest }: any) => React.createElement('a', { ...rest, href: to }, children) },
    'lightweight-charts': { createChart, CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, ColorType: { Solid: 'solid' }, CrosshairMode: { Normal: 0 } },
    '../../../lib/indicators': { computeSMA: () => [] },
  };
  function load(name: string): any {
    if (modules.has(name)) return modules.get(name);
    const output: any = {}; modules.set(name, output);
    const file = name === 'useStocksText' ? name + '.ts' : name + '.tsx';
    const source = readFileSync(resolve(frontend, 'src/pages/stocks/global', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('exports', 'require', code)(output, (key: string) => {
      if (key in common) return common[key];
      if (key === './useStocksText' || key === './TradeMarkerRail') return load(key.slice(2));
      throw Error('Unexpected localization component dependency: ' + key);
    });
    return output;
  }
  const desktop = load('DesktopShell'), Chart = load('GlobalChart').default;
  const root = createRoot(document.getElementById('root'));
  const candles = Object.freeze([Object.freeze({ time: 900, open: 100, high: 102, low: 99, close: 101, volume: 25 })]);
  const fills = Object.freeze([Object.freeze({ id: 'fixture-fill', instrumentId: 'BYBIT:AAPLXUSDT', side: 'BUY', timestamp: 910000,
    quantity: '0.12500000', price: '100.00000000', currency: 'USDT', nativePrice: '100.00000000', realized: '0.00000000' })]);
  const asset = { id: 'BYBIT:AAPLXUSDT', asset: 'AAPLX', sourceSymbol: 'AAPLXUSDT', currency: 'USDT', provider: 'bybit' };
  const props = { id: asset.id, interval: '15m', currency: 'USDT', candles, fills, entry: '100', error: '', loading: false, older() {} };
  const draw = async (lang: Lang) => React.act(async () => root.render(React.createElement(language.Provider, { value: { lang } },
    React.createElement(React.Fragment, null,
      React.createElement(desktop.DesktopHeader, { currency: 'USDT', onMarkets() {}, onPortfolio() {}, onHistory() {}, onWallet() {} }),
      React.createElement(desktop.DesktopQuotes, { asset, fills, now: 920000, ready: false }),
      React.createElement(Chart, props)))));
  try {
    await draw('ru');
    const marker = document.querySelector<HTMLButtonElement>('.vxg-trade-rail button')!;
    await React.act(async () => marker.click());
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.open).toBe(true);
    const originalChartHost = document.querySelector('.vxg-plot');
    const initialDataCalls = setData.mock.calls.length;
    for (const lang of languages) {
      await draw(lang);
      expect(document.querySelector('.vxg-pro-nav nav .selected')?.textContent).toBe(expected[lang][0]);
      expect(document.querySelector('.vxg-pro-nav nav span')?.textContent).toBe(expected[lang][1]);
      expect(document.querySelector('option[value="none"]')?.textContent).toBe(expected[lang][2]);
      expect(document.querySelector('dialog')).toBe(dialog);
      expect(dialog.open).toBe(true);
      expect(dialog.querySelector('header strong')?.textContent).toContain(expected[lang][3]);
      expect(dialog.textContent).toContain(expected[lang][4]);
      expect(dialog.textContent).toContain('BYBIT:AAPLXUSDT');
      expect(dialog.textContent).toContain('0.12500000');
      expect(document.querySelector('.vxg-plot')).toBe(originalChartHost);
      expect(options.mock.calls.some(([value]) => value.localization?.locale === tags[lang])).toBe(true);
      expect(priceTitle.mock.calls[priceTitle.mock.calls.length-1]?.[0].title).toBe(stockText(lang, 'Средняя цена входа'));
      expect(setData).toHaveBeenCalledTimes(initialDataCalls);
      expect(createChart).toHaveBeenCalledTimes(1);
      expect(removeChart).not.toHaveBeenCalled();
    }
    expect(network).not.toHaveBeenCalled();
    expect(document.querySelector('select')?.value).toBe('MA');
  } finally {
    await React.act(async () => root.unmount());
    globalThis.fetch = originalFetch; dom.window.close();
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver']) delete (globalThis as any)[key];
  }
});
