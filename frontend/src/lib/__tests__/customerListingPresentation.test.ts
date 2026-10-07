import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import ts from 'typescript';
import * as markets from '../testMarkets';
import { customerErrorText } from '../customerError';
import { positionStatus, spotOrderStatus, spotOrderType, type SpotOrderRow } from '../../components/spotOrderPresentation';
import * as orderPresentation from '../../components/spotOrderPresentation';
import { LOCALES, readDictionaries } from '../../../test-utils/i18nSource';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const dictionaries = readDictionaries();
const now = Date.parse('2026-10-07T12:00:00Z');
const fixture: markets.TestAsset = {
  pair: 'ZQNEW/USDT', symbol: 'ZQNEW', name: 'New listing', quote: 'USDT',
  isTestAsset: true, isTradable: false, managed: true, status: 'TEST · NOT TRADABLE',
  listingArmed: true, listingAt: '2026-10-11T15:00:00Z', initialPrice: 2,
  state: { phase: 'pre-listing', lastPrice: null, openPrice24h: null, change24hPercent: null,
    high24h: null, low24h: null, volume24h: null, quoteVolume24h: null, serverTime: now },
};
function translate(lang: typeof LOCALES[number]) {
  return (key: string) => dictionaries[lang][key] ?? key;
}
function component(file: string, lang: typeof LOCALES[number], assets = [fixture], error = false) {
  const output: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    '../lib/i18n': { useLanguage: () => ({ t: translate(lang), lang }), localeOf: () => lang },
    '../lib/testMarkets': markets,
    '../lib/browserActivity': {},
    '../lib/testMarketStore': { refreshTestMarket: jest.fn() },
    '../lib/testMarketCandles': {},
    '../lib/nrxMarket': { nrxListingTime: (s: string) => s },
    './CryptoIcon': { CryptoIcon: () => null },
    './TerminalChart': { TerminalChart: () => React.createElement('div', { 'data-chart': true }) },
    './spotOrderPresentation': orderPresentation,
    '../../lib/i18n': { useLanguage: () => ({ t: translate(lang), lang }), localeOf: () => lang },
    '../../lib/testMarketStore': { useTestMarkets: () => ({ assets, error, clockOffsetMs: 0 }) },
    '../../lib/testMarkets': markets,
    '../../lib/nrxMarket': { nrxListingTime: (s: string) => s },
    '../../components/CryptoIcon': { CryptoIcon: () => null },
  };
  const source = readFileSync(resolve(frontend, 'src', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)((name: string) => name.endsWith('.css') ? {} : imports[name] ?? req(name), output);
  return output;
}
function chart(asset: markets.TestAsset | null, lang: typeof LOCALES[number] = 'ru', error = false, loaded = true) {
  const { TestMarketChart } = component('components/TestMarketTerminal.tsx', lang);
  return renderToStaticMarkup(React.createElement(TestMarketChart, { pair: fixture.pair, asset, loaded, error, clockOffsetMs: 0 }));
}

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now));
afterEach(() => jest.restoreAllMocks());

describe.each(LOCALES)('listing customer states in %s', lang => {
  const t = translate(lang);
  test('unknown ticker parses without special-casing; technical status is never rendered', () => {
    const parsed = markets.parseTestMarkets({ serverTime: now, assets: [fixture] })!.assets[0];
    expect(parsed).toMatchObject(fixture);
    const html = chart(parsed, lang);
    expect(html).toContain(t('listing.simulation'));
    expect(html).toContain(t('listing.tradingUnavailable'));
    expect(html).toContain(t('listing.scheduledAt'));
    expect(html).toContain('role="timer"');
    expect(html).not.toContain(fixture.status);
    expect(html).not.toContain('listing.');
    expect(parsed.initialPrice).toBe(2);
    expect(parsed.isTradable).toBe(false);
  });
  test.each([true, false])('live simulation remains identified, tradable=%s', isTradable => {
    const html = chart({ ...fixture, isTradable, status: 'Prisma SQL /internal/worker', state: { ...fixture.state, phase: 'live' } }, lang);
    expect(html).toContain(t('listing.simulation'));
    expect(html).toContain(t(isTradable ? 'listing.marketLive' : 'listing.tradingUnavailable'));
    expect(html).toContain('data-chart');
    expect(html).not.toMatch(/Prisma|SQL|worker|role="timer"/);
  });
  test('unarmed listing never promises a date or start', () => {
    const html = chart({ ...fixture, listingArmed: false }, lang);
    expect(html).toContain(t('listing.dateUnconfirmed'));
    expect(html).not.toContain('role="timer"');
    expect(html).not.toContain('<dt>' + t('listing.scheduledAt') + '</dt>');
  });
  test('clock crossing zero cannot claim the market opened', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(fixture.listingAt) + 1);
    const html = chart({ ...fixture, isTradable: true }, lang);
    expect(html).toContain(t('listing.awaitingStart'));
    expect(html).not.toMatch(/role="timer"|data-chart/);
    expect(html).not.toContain(t('listing.marketLive'));
  });
  test('missing data is an explicit failure, stale data stays marked', () => {
    expect(chart(null, lang)).toContain(t('listing.loadFailed'));
    expect(chart(null, lang)).toContain('role="alert"');
    expect(chart(null, lang, false, false)).toContain(t('trade.loading'));
    expect(chart(fixture, lang, true)).toContain(t('listing.dataStale'));
  });
  test('Markets/search/favorites share the generic presentation', () => {
    const { TestMarketsStrip } = component('pages/markets-bolt/TestMarketsStrip.tsx', lang);
    const render = (search: string, favoritesOnly: boolean, favorites: Set<string>) => renderToStaticMarkup(React.createElement(TestMarketsStrip, {
      search, favoritesOnly, favorites, onToggleFavorite: () => {}, onOpen: () => {},
    }));
    const html = render('zqnew', true, new Set([fixture.pair]));
    expect(html).toContain(t('listing.simulation'));
    expect(html).toContain(t('listing.tradingUnavailable'));
    expect(html).not.toContain(fixture.status);
    expect(render('absent', false, new Set())).toBe('');
    expect(render('', true, new Set())).toBe('');
  });
});

describe.each(LOCALES)('failure messages in %s', lang => {
  const t = translate(lang);
  test('unknown order/position fields never echo machine text; known refusal states retain meaning', () => {
    for (const raw of ['PRIVATE_SECRET', 'Prisma SQL', '[object Object]']) {
      expect(spotOrderStatus(raw, t)).toBe(t('trade.statusUnavailable'));
      expect(positionStatus(raw, t)).toBe(t('trade.statusUnavailable'));
      expect(spotOrderType({ type: raw } as SpotOrderRow, t)).toBe(t('trade.orderTypeUnavailable'));
    }
    expect(spotOrderStatus('REJECTED', t)).toBe(t('trade.status.REJECTED'));
    expect(spotOrderStatus('EXPIRED', t)).toBe(t('trade.status.EXPIRED'));
    expect(positionStatus('LIQUIDATED', t)).toBe(t('futures.positionStatus.LIQUIDATED'));
    expect(positionStatus('CLOSED', t)).toBe(t('futures.positionStatus.CLOSED'));
  });
  test('Spot table tooltips localize types and withhold invalid raw date/decimal fields', () => {
    const { SpotOrdersView } = component('components/SpotOrdersView.tsx', lang);
    const order = { id: 'qa', pair: 'BTC/USDT', side: 'BUY', type: 'PRIVATE_SECRET', status: 'PRIVATE_SECRET',
      price: 'NaN', triggerPrice: 'undefined', originalQuantity: '[object Object]', remainingQuantity: '1',
      createdAt: '/srv/internal.ts:123', ocoGroupId: null };
    const html = renderToStaticMarkup(React.createElement(SpotOrdersView, { orders: [order], t, history: true, locale: lang, cancelling: false }));
    expect(html.replace(/<[^>]+>/g, '')).not.toMatch(/PRIVATE_SECRET|NaN|undefined|object Object|internal.ts/);
    for (const match of html.matchAll(/title="([^"]*)"/g)) expect(match[1]).not.toMatch(/PRIVATE_SECRET|NaN|undefined|object Object|internal.ts/);
    expect(html).toContain(t('trade.statusUnavailable'));
  });
  test.each([
    [401, 'serverError.signInRequired'], [403, 'serverError.forbidden'],
    [429, 'serverError.tooManyAttempts'], [500, 'serverError.unavailable'], [504, 'serverError.timeout'],
  ])('HTTP %s keeps a visible refusal', (status, key) => {
    const report = jest.fn();
    const error = Object.assign(new Error('SQL Prisma user@example.test token=secret at /api/internal.ts:1'), { status, body: { code: 'PRIVATE_SECRET', error: 'do not show' } });
    expect(customerErrorText(error, t, 'fallback', { report })).toBe(t(String(key)));
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/SQL|Prisma|user@example|secret|PRIVATE_SECRET|internal.ts/);
    expect(report).toHaveBeenCalledWith({ message: 'Unmapped server failure', status });
  });
  test('network, timeout, empty response and unknown rejection do not become success', () => {
    expect(customerErrorText(new TypeError('Failed to fetch'), t, 'fallback')).toBe(t('serverError.network'));
    expect(customerErrorText(Object.assign(new Error('private details'), { name: 'TimeoutError' }), t, 'fallback', { report: () => {} })).toBe(t('serverError.timeout'));
    for (const input of [null, undefined, {}, new Error(''), new Error('[object Object] fixture DEBUG'), { body: { code: 'UNKNOWN' } }]) {
      expect(customerErrorText(input, t, t('auth.genericError'), { report: () => {} })).toBe(t('auth.genericError'));
    }
  });
  test.each(['constructor', '__proto__', 'toString'])('unknown code %s cannot resolve an inherited property as a translation', code => {
    const error = Object.assign(new Error(code), { body: { code } });
    expect(customerErrorText(error, t, t('auth.genericError'), { report: () => {} })).toBe(t('auth.genericError'));
  });
});
