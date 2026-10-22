/**
 * CFD on the shared Chart Workspace (2026-10-15): the display candle source,
 * session-aware derived bars, the asset registry, partial practice closes
 * and the session countdown. Fixtures follow the provider's measured bar
 * grid (daily bars at 00:00 UTC, Sunday included, Saturday absent; CME has
 * no 21:00 UTC hourly bar, Brent none from 21:00 to 24:00 UTC).
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

jest.mock('../api', () => ({ API_BASE: '/api/v1' }));
const readDisplayJson = jest.fn();
jest.mock('../displaySnapshotCache', () => ({ readDisplayJson: (...args: unknown[]) => readDisplayJson(...args), SLOW_DISPLAY_REFRESH_MS: 6 * 60 * 60 * 1000 }));

import { CFD_CANDLE_LIMIT, cfdCandleUrl, getCfdDisplayCandles, parseCfdCandles } from '../cfdCandles';
import { aggregateCandles, type ChartTimeframe } from '../chartTimeframes';
import { expectedBarFor } from '../chartSessions';
import { isTimeframeUnavailable, loadChartCandles, resetChartCandleSource } from '../chartCandleSource';
import { CFD_ASSETS, CFD_ASSET_CLASSES, CFD_SYMBOLS, CURRENCY_FLAG, cfdAsset, cfdAssetName } from '../cfdAssetIdentity';
import { cfdNextSessionChange, cfdSessionOpenAt } from '../cfdInfoStrip';
import type { Candle } from '../indicators';

const frontend = resolve(__dirname, '../../..');
const HOUR = 3600, DAY = 86400;
const at = (iso: string) => Date.parse(iso) / 1000;
const bar = (time: number, close = 100): Candle => ({ time, open: close - 1, high: close + 2, low: close - 2, close, volume: 0 });
const envelope = (symbol: string, interval: string, bars: Array<{ openTime: number | string; open: unknown; high: unknown; low: unknown; close: unknown }>) => ({ symbol, interval, bars });

/** Daily bars from `from` (inclusive) to `to` (exclusive), Saturday left out as the provider does. */
function dailyBars(from: string, to: string, skip: string[] = []): Candle[] {
  const out: Candle[] = [];
  for (let t = at(from); t < at(to); t += DAY) {
    const day = new Date(t * 1000);
    if (day.getUTCDay() === 6 || skip.includes(day.toISOString().slice(0, 10))) continue;
    out.push(bar(t, 1 + out.length / 100));
  }
  return out;
}
/** Hourly bars over [from, to), without the UTC hours the provider leaves out on weekdays. */
function hourlyBars(from: string, to: string, missing: number[]): Candle[] {
  const out: Candle[] = [];
  for (let t = at(from); t < at(to); t += HOUR) {
    const d = new Date(t * 1000);
    if (d.getUTCDay() === 6 || d.getUTCDay() === 0 || missing.includes(d.getUTCHours())) continue;
    out.push(bar(t, 2000 + out.length));
  }
  return out;
}

describe('the CFD display source', () => {
  it('reads one URL per instrument and interval, at the route\'s 500-bar ceiling, on the API host outside production', () => {
    expect(CFD_CANDLE_LIMIT).toBe(500);
    expect(cfdCandleUrl('XAUUSD', '15m')).toBe('/api/v1/cfd/display/candles/XAUUSD?interval=15m&limit=500');
    const source = readFileSync(resolve(frontend, 'src/lib/cfdCandles.ts'), 'utf8');
    expect(source).toContain("`${MARKET_EDGE_BASE}${path}&v=9`");
    expect(source).not.toMatch(/WebSocket|EventSource|setInterval|biquote\.io/);
  });

  it('keeps real OHLC only: identity checked, broken bars left out, duplicates once, oldest first, no volume invented', () => {
    const t0 = Date.parse('2026-10-14T10:00:00Z');
    const body = envelope('XAUUSD', '1h', [
      { openTime: t0 + 3_600_000, open: 2, high: 3, low: 1, close: 2.5 },
      { openTime: t0, open: 2, high: 3, low: 1, close: 2 },
      { openTime: t0, open: 9, high: 9, low: 9, close: 9 }, // the same instant again
      { openTime: t0 + 7_200_000, open: 2, high: 1, low: 1, close: 2 }, // high below the open
      { openTime: t0 + 10_800_000, open: -1, high: 3, low: 1, close: 2 },
      { openTime: 'not a date', open: 2, high: 3, low: 1, close: 2 },
    ]);
    const candles = parseCfdCandles(body, 'XAUUSD', '1h');
    expect(candles).toEqual([
      { time: t0 / 1000, open: 2, high: 3, low: 1, close: 2, volume: 0 },
      { time: t0 / 1000 + 3600, open: 2, high: 3, low: 1, close: 2.5, volume: 0 },
    ]);
    // The provider's oil names are the same instruments.
    expect(parseCfdCandles(envelope('USOIL', '1d', []), 'WTIUSD', '1d')).toEqual([]);
    expect(parseCfdCandles(envelope('UKOIL', '1d', []), 'XBRUSD', '1d')).toEqual([]);
    // Another instrument or interval is never drawn.
    expect(() => parseCfdCandles(envelope('XAGUSD', '1h', []), 'XAUUSD', '1h')).toThrow('cfd_chart_identity');
    expect(() => parseCfdCandles(envelope('XAUUSD', '4h', []), 'XAUUSD', '1h')).toThrow('cfd_chart_identity');
    expect(() => parseCfdCandles({ symbol: 'XAUUSD', interval: '1h', bars: 'x' }, 'XAUUSD', '1h')).toThrow('cfd_chart_shape');
  });

  it('serves a native interval from the cache, filters by the paging instant and caps the answer', async () => {
    const t0 = Date.parse('2026-10-14T00:00:00Z');
    readDisplayJson.mockResolvedValueOnce(envelope('EURUSD', '1h', Array.from({ length: 6 }, (_, i) => ({ openTime: t0 + i * 3_600_000, open: 1.1, high: 1.2, low: 1, close: 1.15 }))));
    const answer = await getCfdDisplayCandles('EURUSD', '1h', 3, undefined, t0 + 4 * 3_600_000);
    expect(readDisplayJson).toHaveBeenLastCalledWith('/api/v1/cfd/display/candles/EURUSD?interval=1h&limit=500', 6 * 60 * 60 * 1000, undefined);
    expect(answer.candles.map(c => c.time)).toEqual([2, 3, 4].map(i => t0 / 1000 + i * 3600));
  });

  it('refuses a derived interval by name, so the workspace builds it from the base bars instead of asking the route', async () => {
    readDisplayJson.mockClear();
    for (const interval of ['3m', '2h', '6h', '12h', '1w', '1M']) {
      const error = await getCfdDisplayCandles('XAUUSD', interval, 100).then(() => null, (failure: unknown) => failure);
      expect(isTimeframeUnavailable(error)).toBe(true);
    }
    expect(readDisplayJson).not.toHaveBeenCalled();
  });
});

describe('derived CFD bars follow the trading calendar', () => {
  const forex = expectedBarFor('cfd', 'EURUSD')!;
  const cme = expectedBarFor('cfd', 'XAUUSD')!;
  const brent = expectedBarFor('cfd', 'XBRUSD')!;

  it('has no calendar rule for a 24/7 market', () => {
    expect(expectedBarFor('spot', 'BTC/USDT')).toBeUndefined();
    expect(expectedBarFor('futures', 'BTC/USDT')).toBeUndefined();
    expect(forex).toEqual(expect.any(Function));
  });

  it('expects Sunday to Friday daily bars and no Saturday one', () => {
    expect(forex(at('2026-10-10T00:00:00Z'), DAY)).toBe(false); // Saturday
    expect(forex(at('2026-10-11T00:00:00Z'), DAY)).toBe(true); // Sunday: opens 17:00 New York
    expect(forex(at('2026-10-09T00:00:00Z'), DAY)).toBe(true); // Friday: closes 17:00 New York
    expect(cme(at('2026-10-10T00:00:00Z'), DAY)).toBe(false);
  });

  it('builds a whole week from Sunday–Friday daily bars, and drops a week with a missing Wednesday', () => {
    const bars = dailyBars('2026-09-21T00:00:00Z', '2026-10-12T00:00:00Z', ['2026-10-07']);
    const now = at('2026-10-15T12:00:00Z');
    const strict = aggregateCandles(bars, '1d', '1w', now);
    const session = aggregateCandles(bars, '1d', '1w', now, { expectedBar: forex });
    // Without the calendar every week lacks its Saturday and is dropped.
    expect(strict.candles).toHaveLength(0);
    // With it: the weeks of 21 and 28 September are whole; the week of 5 October has no Wednesday.
    expect(session.candles.map(c => new Date(c.time * 1000).toISOString().slice(0, 10))).toEqual(['2026-09-21', '2026-09-28']);
    expect(session.dropped).toBe(1);
    const week = session.candles[0], days = bars.filter(b => b.time >= week.time && b.time < week.time + 7 * DAY);
    expect(days).toHaveLength(6);
    expect(week.open).toBe(days[0].open);
    expect(week.close).toBe(days[days.length - 1].close);
    expect(week.high).toBe(Math.max(...days.map(d => d.high)));
    expect(week.low).toBe(Math.min(...days.map(d => d.low)));
    expect(week.volume).toBe(0);
  });

  it('keeps the forming week as a partial bar from the days that are due', () => {
    const bars = dailyBars('2026-10-12T00:00:00Z', '2026-10-15T00:00:00Z');
    const result = aggregateCandles(bars, '1d', '1w', at('2026-10-14T18:00:00Z'), { expectedBar: forex });
    expect(result.candles).toHaveLength(1);
    expect(result.partialLast).toBe(true);
  });

  it('builds CME 2h bars across the daily 17:00 New York break instead of dropping them', () => {
    const bars = hourlyBars('2026-10-13T00:00:00Z', '2026-10-15T00:00:00Z', [21]);
    const now = at('2026-10-16T00:00:00Z');
    const strict = aggregateCandles(bars, '1h', '2h', now);
    const session = aggregateCandles(bars, '1h', '2h', now, { expectedBar: cme });
    expect(strict.dropped).toBe(2); // 20:00–22:00 on each of the two days
    expect(session.dropped).toBe(0);
    expect(session.candles).toHaveLength(24);
    // A real gap inside the session still drops its bucket.
    const holed = bars.filter(b => b.time !== at('2026-10-13T10:00:00Z'));
    expect(aggregateCandles(holed, '1h', '2h', now, { expectedBar: cme }).dropped).toBe(1);
  });

  it('knows Brent\'s provider pause from 17:00 New York, so its 6h bars survive it', () => {
    const bars = hourlyBars('2026-10-13T00:00:00Z', '2026-10-15T00:00:00Z', [21, 22, 23]);
    const result = aggregateCandles(bars, '1h', '6h', at('2026-10-16T00:00:00Z'), { expectedBar: brent });
    expect(result.dropped).toBe(0);
    expect(result.candles).toHaveLength(8);
    expect(brent(at('2026-10-13T21:00:00Z'), HOUR)).toBe(false); // 17:00 New York: no provider bar
    expect(brent(at('2026-10-13T20:00:00Z'), HOUR)).toBe(true);
    // Every other instrument's pauses are its calendar's own.
    expect(cme(at('2026-10-13T22:00:00Z'), HOUR)).toBe(true);
  });

  it('runs end to end through the workspace loader: a CFD week is built from the cached daily bars', async () => {
    resetChartCandleSource();
    const daily = dailyBars('2026-08-03T00:00:00Z', '2026-10-12T00:00:00Z');
    const loader = jest.fn(async (_pair: string, interval: string) => {
      if (interval !== '1d') throw new Error(`unexpected ${interval}`);
      return { candles: daily };
    });
    const answer = await loadChartCandles(loader, 'cfd-display', { market: 'cfd', pair: 'EURUSD', timeframe: '1w', limit: 50 });
    expect(answer.plan).toEqual({ kind: 'derived', base: '1d', factor: 7 });
    expect(answer.candles.length).toBe(10);
    expect(loader.mock.calls.every(call => call[1] === '1d')).toBe(true);
  });
});

describe('the CFD asset registry', () => {
  it('covers the 13 instruments of the catalogue, by class, with a readable name in every language', () => {
    expect(CFD_SYMBOLS).toEqual(['XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD', 'WTIUSD', 'XBRUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD']);
    expect(CFD_ASSET_CLASSES).toEqual(['metals', 'energy', 'forex']);
    for (const asset of CFD_ASSETS) for (const lang of ['ru', 'en', 'es', 'hi', 'ja', 'ko', 'zh']) {
      const name = cfdAssetName(asset.symbol, lang);
      expect(name.trim().length).toBeGreaterThan(0); // «金» is a whole name in Chinese and Japanese
      expect(name).not.toBe(asset.symbol);
    }
    expect(cfdAsset('xauusd')?.assetClass).toBe('metals');
    expect(cfdAsset('WTIUSD')?.assetClass).toBe('energy');
    expect(cfdAsset('USDJPY')).toMatchObject({ assetClass: 'forex', base: 'USD', quote: 'JPY' });
    // An unknown symbol keeps the provider's own name.
    expect(cfdAsset('US500')).toBeNull();
    expect(cfdAssetName('US500', 'ru', 'S&P 500')).toBe('S&P 500');
  });

  it('ships a local, licensed flag for every currency in the registry, and nothing fetched per row', () => {
    const currencies = new Set(CFD_ASSETS.filter(a => a.assetClass === 'forex').flatMap(a => [a.base, a.quote]));
    for (const currency of currencies) {
      const flag = CURRENCY_FLAG[currency as keyof typeof CURRENCY_FLAG];
      expect(flag).toBeDefined();
      expect(existsSync(resolve(frontend, `src/assets/cfd-flags/${flag}.svg`))).toBe(true);
    }
    expect(readFileSync(resolve(frontend, 'src/assets/cfd-flags/LICENSE-flag-icons.txt'), 'utf8')).toMatch(/MIT/);
    const icon = readFileSync(resolve(frontend, 'src/components/CfdInstrumentIcon.tsx'), 'utf8');
    expect(icon).toContain("from '../assets/cfd-flags/");
    expect(icon).toContain('onError');
    expect(icon).not.toMatch(/https?:\/\//);
  });
});

describe('a practice position closes in part', () => {
  const store = new Map<string, string>();
  beforeAll(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } },
      dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
    } });
  });
  afterAll(() => { Reflect.deleteProperty(globalThis, 'window'); });
  beforeEach(() => store.clear());
  const paper = () => jest.requireActual('../cfdPaperStore') as typeof import('../cfdPaperStore');

  it('books the part with its share of the margin and leaves the rest open at the same entry', () => {
    const { openCfdPaperPosition, closeCfdPaperPosition, getCfdPaperState } = paper();
    const long = openCfdPaperPosition({ symbol: 'XAUUSD', side: 'BUY', quantity: 2, price: 4000, leverage: 20, initialMargin: 400, liquidationPrice: 3820 });
    const part = closeCfdPaperPosition(long.id, 4010, 0.5);
    expect(Number(part.size)).toBe(0.5);
    expect(Number(part.realizedPnl)).toBeCloseTo(5, 10); // (4010 − 4000) × 0.5
    expect(Number(part.initialMargin)).toBeCloseTo(100, 10);
    expect(part.id).not.toBe(long.id);
    const state = getCfdPaperState();
    expect(state.open).toHaveLength(1);
    expect(state.open[0]).toMatchObject({ id: long.id, size: '1.5', entryPrice: '4000', leverage: 20, liquidationPrice: '3820' });
    expect(Number(state.open[0].initialMargin)).toBeCloseTo(300, 10);
    // The rest then closes whole, exactly as before.
    const rest = closeCfdPaperPosition(long.id, 3990);
    expect(Number(rest.realizedPnl)).toBeCloseTo(-15, 10);
    expect(rest.id).toBe(long.id);
    expect(getCfdPaperState()).toMatchObject({ open: [], history: [expect.objectContaining({ id: long.id }), expect.objectContaining({ id: part.id })] });
  });

  it('books a short\'s part with the short\'s sign, and treats the whole size as a whole close', () => {
    const { openCfdPaperPosition, closeCfdPaperPosition, getCfdPaperState } = paper();
    const short = openCfdPaperPosition({ symbol: 'USDJPY', side: 'SELL', quantity: 1000, price: 150, leverage: 10, initialMargin: 15000, liquidationPrice: null });
    expect(Number(closeCfdPaperPosition(short.id, 149, 250).realizedPnl)).toBeCloseTo(250, 8);
    const whole = closeCfdPaperPosition(short.id, 151, 750);
    expect(whole.id).toBe(short.id);
    expect(Number(whole.realizedPnl)).toBeCloseTo(-750, 8);
    expect(getCfdPaperState().open).toHaveLength(0);
  });

  it('refuses a quantity that is not a part of the position, and a missing price, changing nothing', () => {
    const { openCfdPaperPosition, closeCfdPaperPosition, getCfdPaperState } = paper();
    const p = openCfdPaperPosition({ symbol: 'EURUSD', side: 'BUY', quantity: 1, price: 1.1, leverage: 30, initialMargin: 0.0366, liquidationPrice: null });
    const before = JSON.stringify(getCfdPaperState());
    expect(() => closeCfdPaperPosition(p.id, 1.2, 2)).toThrow('close_quantity_exceeds_position');
    expect(() => closeCfdPaperPosition(p.id, 1.2, 0)).toThrow('invalid_close_quantity');
    expect(() => closeCfdPaperPosition(p.id, 1.2, -1)).toThrow('invalid_close_quantity');
    expect(() => closeCfdPaperPosition(p.id, 1.2, Number.NaN)).toThrow('invalid_close_quantity');
    expect(() => closeCfdPaperPosition(p.id, 0, 0.5)).toThrow('price_unavailable');
    expect(() => closeCfdPaperPosition('missing', 1.2, 0.5)).toThrow('position_not_found');
    expect(JSON.stringify(getCfdPaperState())).toBe(before);
  });
});

describe('the next session change', () => {
  it('finds the forex weekend close and the Sunday open to the minute', () => {
    const friday = Date.parse('2026-10-16T15:00:00Z');
    expect(cfdNextSessionChange('EURUSD', friday)).toEqual({ at: Date.parse('2026-10-16T21:00:00Z'), opens: false });
    const saturday = Date.parse('2026-10-17T12:00:00Z');
    expect(cfdNextSessionChange('EURUSD', saturday)).toEqual({ at: Date.parse('2026-10-18T21:00:00Z'), opens: true });
  });
  it('finds the CME daily break and its reopening', () => {
    const tuesday = Date.parse('2026-10-13T20:30:00Z');
    expect(cfdNextSessionChange('XAUUSD', tuesday)).toEqual({ at: Date.parse('2026-10-13T21:00:00Z'), opens: false });
    expect(cfdNextSessionChange('XAUUSD', Date.parse('2026-10-13T21:10:00Z'))).toEqual({ at: Date.parse('2026-10-13T22:00:00Z'), opens: true });
  });
  it('agrees with the calendar on both sides of the change, and has nothing for an unknown instrument', () => {
    const now = Date.parse('2026-10-14T09:13:00Z');
    for (const symbol of ['EURUSD', 'XAUUSD', 'XBRUSD']) {
      const change = cfdNextSessionChange(symbol, now)!;
      expect(cfdSessionOpenAt(symbol, change.at - 60_000)).toBe(!change.opens);
      expect(cfdSessionOpenAt(symbol, change.at)).toBe(change.opens);
    }
    expect(cfdNextSessionChange('US500', now)).toBeNull();
  });
});

describe('the stats bar and the market list read only real figures', () => {
  const read = (p: string) => readFileSync(resolve(frontend, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('shows bid / ask and the spread only as the provider\'s own sane pair', () => {
    const feed = read('src/lib/useCfdTickers.ts');
    expect(feed).toContain('Number(ask)>=Number(bid)');
    const bar = read('src/components/CfdTickerBar.tsx');
    expect(bar).toContain('ask>=bid?{bid,ask,spread:ask-bid}:null');
    const route = readFileSync(resolve(frontend, '../src/api/routes/cfd.ts'), 'utf8');
    expect(route).toMatch(/bid/);
  });
  it('takes each row\'s day change from the strip model, not the provider\'s percent', () => {
    const list = read('src/components/CfdInstrumentList.tsx');
    expect(list).toContain('useCfdDailySeries(CFD_SYMBOLS');
    expect(list).toContain('model.change?.pct');
    expect(list).not.toContain('changePercent24h)');
  });
  it('offers the market order only: no order type the practice cannot fill', () => {
    const form = read('src/components/CfdOrderForm.tsx');
    expect(form).not.toMatch(/OrderFamilyTabs|OrderFamilyFields|'limit'|'stop'|takeProfit|stopLoss/);
    expect(form).toContain('copy.marketOrder');
  });
  it('carries no explanatory note under the order type and no «too few bars» note on the chart (owner, 2026-10-15)', () => {
    const raw = readFileSync(resolve(frontend, 'src/components/CfdOrderForm.tsx'), 'utf8');
    expect(raw).not.toContain('cfd-order-type-note');
    expect(readFileSync(resolve(frontend, 'src/components/PriceChart.tsx'), 'utf8')).toContain("if (short && market === 'cfd') return null;");
    const indicators = jest.requireActual('../chartIndicators') as typeof import('../chartIndicators');
    expect(indicators.defaultChartIndicators('cfd')).toEqual([]);
    expect(indicators.defaultChartIndicators('spot').map(i => i.id)).toEqual(['ma-200']);
    expect(indicators.defaultChartIndicators('futures').map(i => i.id)).toEqual(['ma-200']);
  });
  it('shows no explanatory hover notes: SIM, order type, quote currency, 52-week range (owner, 2026-10-15)', () => {
    const form = readFileSync(resolve(frontend, 'src/components/CfdOrderForm.tsx'), 'utf8');
    expect(form).toMatch(/<span className="terminal-practice-label" aria-label=\{copy\.practice\}>SIM<\/span>/);
    expect(form).not.toMatch(/practiceNote|marketOnlyNote/);
    expect(readFileSync(resolve(frontend, 'src/components/CfdPositionsPanel.tsx'), 'utf8')).not.toMatch(/quoteCurrencyNote|cfd-tabs-note/);
    expect(readFileSync(resolve(frontend, 'src/components/CfdTickerBar.tsx'), 'utf8')).not.toContain('closedSessionsOnly');
    const copy = readFileSync(resolve(frontend, 'src/lib/cfdDisplayCopy.ts'), 'utf8');
    for (const phrase of ['отображаемой котировке', 'не отправляются на внешний рынок', 'Суммы в валюте котировки', 'только закрытые сессии', 'Лимитные, стоп-ордера']) expect(copy).not.toContain(phrase);
  });
  it('lists the order-time estimates honestly and has no TP/SL column', () => {
    const panel = read('src/components/CfdPositionsPanel.tsx');
    expect(panel).toContain('copy.liqEstimate');
    expect(panel).not.toMatch(/takeProfit|stopLoss|TP\/SL/);
  });
});

describe('the derived interval list', () => {
  it.each<[ChartTimeframe, ChartTimeframe, number]>([['3m', '1m', 3], ['2h', '1h', 2], ['6h', '1h', 6], ['12h', '4h', 3], ['1w', '1d', 7], ['1M', '1d', 30]])('%s is built from %s × %d', (target, base, factor) => {
    const caps = jest.requireActual('../chartCapabilities') as typeof import('../chartCapabilities');
    expect(caps.sourcePlans('cfd-display')[target]).toEqual({ kind: 'derived', base, factor });
  });
});
