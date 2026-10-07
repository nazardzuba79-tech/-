import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
import * as browserActivity from '../browserActivity';
import * as strip from '../cfdInfoStrip';
import { cfdMarketCopy } from '../cfdDisplayCopy';

const root = resolve(__dirname, '../../..');
const read = (file:string) => readFileSync(resolve(root, 'src', file), 'utf8');
const DAY = 86_400_000;
const utc = (y:number, m:number, d:number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);

/** Daily bars ending on `last` (UTC midnight), one per calendar day, newest first like the provider. */
function dailyBars(last:number, count:number, options:{ openLast?:boolean; skip?:(openTime:number)=>boolean; price?:(i:number)=>number } = {}) {
  const bars:any[] = [];
  for (let i = 0; i < count; i++) {
    const openTime = last - i * DAY;
    if (options.skip?.(openTime)) continue;
    const base = options.price ? options.price(i) : 4100 + i;
    bars.push({ openTime: new Date(openTime).toISOString(), open: base, high: base + 20, low: base - 20, close: base + 5, volume: 0, tickVolume: 100, isOpen: i === 0 && options.openLast !== false });
  }
  return bars;
}
const body = (symbol:string, bars:any[], interval = '1d') => ({ symbol, interval, fetchedAt: 1, bars });

describe('daily series parsing', () => {
  const today = utc(2026, 10, 7);
  test('accepts the canonical or the provider symbol, sorts ascending and drops broken bars', () => {
    const bars = strip.parseCfdDailyBars(body('USOIL', [
      ...dailyBars(today, 3),
      { openTime: 'not a date', open: 1, high: 2, low: 0.5, close: 1.5 },
      { openTime: new Date(today - 10 * DAY).toISOString(), open: 1, high: 0.5, low: 0.1, close: 0.4 },
      { openTime: new Date(today).toISOString(), open: 9, high: 9, low: 9, close: 9 },
    ]), 'WTIUSD')!;
    expect(bars.map(b => b.openTime)).toEqual([today - 2 * DAY, today - DAY, today]);
    expect(bars[2].isOpen).toBe(true); expect(bars[1].isOpen).toBe(false);
    expect(bars[2].open).toBe(4100);
  });
  test.each([
    ['wrong interval', body('XAUUSD', dailyBars(today, 2), '1h')],
    ['another instrument', body('XAGUSD', dailyBars(today, 2))],
    ['no bars array', { symbol: 'XAUUSD', interval: '1d', bars: null }],
    ['not an object', 'broken'],
  ])('rejects %s', (_label, payload) => expect(strip.parseCfdDailyBars(payload, 'XAUUSD')).toBeNull());
  test('an empty series is valid but yields nothing', () => expect(strip.parseCfdDailyBars(body('XAUUSD', []), 'XAUUSD')).toEqual([]));
});

describe('session resolution and day change', () => {
  const today = utc(2026, 10, 7);
  const series = strip.parseCfdDailyBars(body('XAUUSD', dailyBars(today, 8, { skip: t => new Date(t).getUTCDay() === 6 })), 'XAUUSD')!;
  test('a quote inside the open session is measured against the last closed session', () => {
    const r = strip.resolveCfdSession(series, today + 15 * 3_600_000);
    expect(r.session?.openTime).toBe(today); expect(r.session?.isOpen).toBe(true);
    expect(r.previous?.openTime).toBe(today - DAY); expect(r.previousClose).toBe(4101 + 5);
  });
  test('a quote from the previous session (snapshot taken before the session change) keeps that session', () => {
    const r = strip.resolveCfdSession(series, today - 3_600_000);
    expect(r.session?.openTime).toBe(today - DAY); expect(r.previous?.openTime).toBe(today - 2 * DAY);
  });
  test('the first session after a weekend compares with Friday', () => {
    // 2026-10-04 is a Sunday; 10-03 (Saturday) has no bar.
    const r = strip.resolveCfdSession(series, utc(2026, 10, 4, 23));
    expect(r.session?.openTime).toBe(utc(2026, 10, 4)); expect(r.previous?.openTime).toBe(utc(2026, 10, 2));
  });
  test('a quote with no session bar (Saturday) or no timestamp has no change', () => {
    expect(strip.resolveCfdSession(series, utc(2026, 10, 3, 12)).session).toBeNull();
    expect(strip.resolveCfdSession(series, null).previousClose).toBeNull();
    expect(strip.resolveCfdSession([], today).session).toBeNull();
  });
  test('a hole wider than five days means missing data, not a previous close', () => {
    const sparse = strip.parseCfdDailyBars(body('XAUUSD', [...dailyBars(today, 1), ...dailyBars(today - 6 * DAY, 1, { openLast: false })]), 'XAUUSD')!;
    const r = strip.resolveCfdSession(sparse, today + 1000);
    expect(r.session?.openTime).toBe(today); expect(r.previousClose).toBeNull();
  });
  test('an earlier bar still marked open is not a close', () => {
    const odd = strip.parseCfdDailyBars(body('XAUUSD', dailyBars(today, 3).map((b, i) => ({ ...b, isOpen: i < 2 }))), 'XAUUSD')!;
    expect(strip.resolveCfdSession(odd, today + 1000).previous?.openTime).toBe(today - 2 * DAY);
  });
  test.each([
    ['positive', '4150', 4100, 50, 1.2195],
    ['negative', '4059', 4100, -41, -1],
    ['zero', '4100', 4100, 0, 0],
  ])('%s change', (_l, price, prev, abs, pct) => {
    const c = strip.cfdDayChange(price, prev)!;
    expect(c.abs).toBeCloseTo(abs, 6); expect(c.pct).toBeCloseTo(pct, 3);
  });
  test.each([['missing prev', '4100', null], ['zero prev', '4100', 0], ['no price', null, 4100], ['bad price', 'abc', 4100], ['negative prev', '4100', -1]])(
    'no fake change when %s', (_l, price, prev) => expect(strip.cfdDayChange(price as any, prev)).toBeNull());
  test('day range is the session bar range', () => {
    expect(strip.cfdDayRange(series[series.length - 1])).toEqual({ low: 4080, high: 4120 });
    expect(strip.cfdDayRange(null)).toBeNull();
    expect(strip.cfdDayRange({ openTime: 1, open: 1, high: 0.5, low: 1, close: 1, isOpen: false })).toBeNull();
  });
});

describe('52-week range', () => {
  const today = utc(2026, 10, 7);
  const set = strip.CFD_FIFTY_TWO_WEEK_SYMBOLS as Set<string>;
  beforeAll(() => set.add('TESTIDX'));
  afterAll(() => set.delete('TESTIDX'));
  const full = () => strip.parseCfdDailyBars(body('TESTIDX', dailyBars(today, 380, { skip: t => [0, 6].includes(new Date(t).getUTCDay()), price: i => 1000 + (i % 50) })), 'TESTIDX')!;
  test('is hidden for every listed instrument today (metals, energy, FX)', () => {
    for (const symbol of ['XAUUSD', 'WTIUSD', 'EURUSD']) expect(strip.cfdFiftyTwoWeekRange(symbol, full(), today + 1000)).toBeNull();
  });
  test('covers closed sessions of the trailing 52 weeks only', () => {
    const r = strip.cfdFiftyTwoWeekRange('TESTIDX', full(), today + 1000)!;
    expect(r.closedOnly).toBe(true); expect(r.sessions).toBeGreaterThan(200); expect(r.asOfSession).toBe(today - DAY);
    expect(r.low).toBe(1000 - 20); expect(r.high).toBe(1000 + 49 + 20);
  });
  test('a new extreme in the latest closed session enters, an extreme older than 52 weeks drops out', () => {
    const bars = full();
    bars[bars.length - 2].high = 5000; // yesterday, closed
    bars[0].low = 1; // the oldest bar, outside the window
    const r = strip.cfdFiftyTwoWeekRange('TESTIDX', bars, today + 1000)!;
    expect(r.high).toBe(5000); expect(r.low).toBe(980);
    bars[bars.length - 1].high = 9000; // the open session never counts
    expect(strip.cfdFiftyTwoWeekRange('TESTIDX', bars, today + 1000)!.high).toBe(5000);
  });
  test('missing period or thin coverage yields nothing', () => {
    const short = strip.parseCfdDailyBars(body('TESTIDX', dailyBars(today, 120)), 'TESTIDX')!;
    expect(strip.cfdFiftyTwoWeekRange('TESTIDX', short, today + 1000)).toBeNull();
    const thin = full().filter((_, i) => i % 2 === 0);
    expect(strip.cfdFiftyTwoWeekRange('TESTIDX', thin, today + 1000)).toBeNull();
    expect(strip.cfdFiftyTwoWeekRange('TESTIDX', full(), null)).toBeNull();
  });
});

describe('session calendar (New York wall clock, DST aware)', () => {
  // July: EDT = UTC-4. January: EST = UTC-5.
  test('forex closes Friday 17:00 and reopens Sunday 17:00 New York time', () => {
    expect(strip.cfdSessionOpenAt('EURUSD', utc(2026, 7, 10, 20, 59))).toBe(true);   // Fri 16:59 EDT
    expect(strip.cfdSessionOpenAt('EURUSD', utc(2026, 7, 10, 21, 0))).toBe(false);   // Fri 17:00 EDT
    expect(strip.cfdSessionOpenAt('EURUSD', utc(2026, 7, 11, 12))).toBe(false);      // Saturday
    expect(strip.cfdSessionOpenAt('EURUSD', utc(2026, 7, 12, 20, 59))).toBe(false);  // Sun 16:59 EDT
    expect(strip.cfdSessionOpenAt('EURUSD', utc(2026, 7, 12, 21, 0))).toBe(true);    // Sun 17:00 EDT
    expect(strip.cfdSessionOpenAt('EURUSD', utc(2026, 1, 9, 21, 59))).toBe(true);    // Fri 16:59 EST: still open in winter
    expect(strip.cfdSessionOpenAt('EURUSD', utc(2026, 1, 9, 22, 0))).toBe(false);    // Fri 17:00 EST
  });
  test('metals and WTI keep the daily 17:00–18:00 break and open Sunday 18:00', () => {
    expect(strip.cfdSessionOpenAt('XAUUSD', utc(2026, 7, 13, 20, 59))).toBe(true);   // Mon 16:59 EDT
    expect(strip.cfdSessionOpenAt('XAUUSD', utc(2026, 7, 13, 21, 30))).toBe(false);  // Mon 17:30 EDT break
    expect(strip.cfdSessionOpenAt('WTIUSD', utc(2026, 7, 13, 22, 0))).toBe(true);    // Mon 18:00 EDT
    expect(strip.cfdSessionOpenAt('XAUUSD', utc(2026, 7, 12, 21, 30))).toBe(false);  // Sun 17:30 EDT
    expect(strip.cfdSessionOpenAt('XAUUSD', utc(2026, 7, 12, 22, 0))).toBe(true);    // Sun 18:00 EDT
    expect(strip.cfdSessionOpenAt('XBRUSD', utc(2026, 7, 13, 22, 30))).toBe(false);  // ICE break 18:00–20:00
    expect(strip.cfdSessionOpenAt('XBRUSD', utc(2026, 7, 14, 0, 0))).toBe(true);     // Mon 20:00 EDT
    expect(strip.cfdSessionOpenAt('UNKNOWN', utc(2026, 7, 13))).toBeNull();
  });
  test('segments identify one continuous session', () => {
    expect(strip.cfdSessionSegment('EURUSD', utc(2026, 7, 13, 14))).toBe(strip.cfdSessionSegment('EURUSD', utc(2026, 7, 16, 14)));
    expect(strip.cfdSessionSegment('EURUSD', utc(2026, 7, 10, 14))).not.toBe(strip.cfdSessionSegment('EURUSD', utc(2026, 7, 13, 14)));
    expect(strip.cfdSessionSegment('XAUUSD', utc(2026, 7, 13, 14))).toBe(strip.cfdSessionSegment('XAUUSD', utc(2026, 7, 13, 20)));
    expect(strip.cfdSessionSegment('XAUUSD', utc(2026, 7, 13, 20))).not.toBe(strip.cfdSessionSegment('XAUUSD', utc(2026, 7, 13, 23)));
    expect(strip.cfdSessionSegment('XAUUSD', utc(2026, 7, 11, 12))).toBeNull();
  });
});

describe('market status is informational and never guessed', () => {
  const monday = utc(2026, 7, 13, 14); // Mon 10:00 EDT
  test.each<[string, strip.CfdStatusRow|undefined, number, strip.CfdMarketStatus]>([
    ['no row', undefined, monday, 'unknown'],
    ['weekend by calendar even with a fresh open quote', { price: '1', asOf: utc(2026, 7, 11, 11) }, utc(2026, 7, 11, 12), 'closed'],
    ['provider closed inside the same segment', { price: '1', marketClosed: true, asOf: monday - 3_600_000 }, monday, 'closed'],
    ['provider closed in an earlier segment', { price: '1', marketClosed: true, asOf: utc(2026, 7, 10, 14) }, monday, 'unknown'],
    ['fresh quote in the same segment', { price: '1', asOf: monday - 3_600_000 }, monday, 'open'],
    ['quote from before the daily break', { price: '1', asOf: utc(2026, 7, 13, 14) }, utc(2026, 7, 14, 0, 30), 'unknown'],
    ['missing quote is not closed', { price: null, status: 'unavailable', asOf: monday - 1000 }, monday, 'unknown'],
    ['timestamp from the future', { price: '1', asOf: monday + 3_600_000 }, monday, 'unknown'],
    ['no timestamp', { price: '1' }, monday, 'unknown'],
  ])('%s', (_l, row, now, expected) => expect(strip.cfdMarketStatus('XAUUSD', row, now)).toBe(expected));
  test('an instrument without a calendar only reports the provider flag', () => {
    expect(strip.cfdMarketStatus('UNKNOWN', { price: '1', marketClosed: true, asOf: monday }, monday)).toBe('closed');
    expect(strip.cfdMarketStatus('UNKNOWN', { price: '1', asOf: monday }, monday)).toBe('unknown');
  });
});

describe('economic events', () => {
  const now = utc(2026, 10, 7, 12);
  const src = { name: 'Official', url: 'https://example.invalid/schedule' };
  const events:strip.EconomicEvent[] = [
    { id: 'us-cpi-sep', kind: 'cpi', region: 'US', at: now - DAY, source: src },
    { id: 'us-cpi-oct', kind: 'cpi', region: 'US', at: now + 6 * DAY, source: src },
    { id: 'fomc', kind: 'rate_decision', region: 'US', at: now + 2 * DAY, source: src },
    { id: 'ecb', kind: 'rate_decision', region: 'EU', at: now + DAY, source: src },
    { id: 'eia', kind: 'eia_petroleum', region: 'US', at: now + 3 * 3_600_000, source: src },
    { id: 'boe', kind: 'rate_decision', region: 'GB', at: now + 3_600_000, source: src },
  ];
  test('relevance follows the instrument', () => {
    expect(strip.relevantEconomicEvents('EURUSD')).toEqual([{ region: 'EU', kinds: ['rate_decision','cpi'] }, { region: 'US', kinds: ['rate_decision','cpi','nfp'] }]);
    expect(strip.relevantEconomicEvents('WTIUSD')).toEqual([{ region: 'US', kinds: ['eia_petroleum'] }]);
    expect(strip.relevantEconomicEvents('XBRUSD')).toEqual([{ region: 'US', kinds: ['eia_petroleum'] }]);
    expect(strip.relevantEconomicEvents('XAUUSD')).toEqual([{ region: 'US', kinds: ['cpi','rate_decision','nfp'] }]);
    expect(strip.relevantEconomicEvents('UNKNOWN')).toEqual([]);
  });
  test('the nearest future relevant event wins; past and foreign ones never show', () => {
    expect(strip.pickNearestEconomicEvent(events, 'EURUSD', now)?.id).toBe('ecb');
    expect(strip.pickNearestEconomicEvent(events, 'XAUUSD', now)?.id).toBe('fomc');
    expect(strip.pickNearestEconomicEvent(events, 'WTIUSD', now)?.id).toBe('eia');
    expect(strip.pickNearestEconomicEvent(events, 'XAUUSD', now + 2 * DAY)?.id).toBe('us-cpi-oct');
    expect(strip.pickNearestEconomicEvent(events, 'XAUUSD', now + 7 * DAY)).toBeNull();
    expect(strip.pickNearestEconomicEvent([], 'XAUUSD', now)).toBeNull();
  });
  test('a moved event is simply the schedule as published', () => {
    const moved = events.map(e => e.id === 'fomc' ? { ...e, at: now + 10 * DAY } : e);
    expect(strip.pickNearestEconomicEvent(moved, 'XAUUSD', now)?.id).toBe('us-cpi-oct');
  });
  test('relative time counts down locally and ends at zero', () => {
    expect(strip.relativeTimeUntil(now + 2 * DAY + 3 * 3_600_000 + 7 * 60_000, now)).toEqual({ days: 2, hours: 3, minutes: 7 });
    expect(strip.relativeTimeUntil(now + 30_000, now)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(strip.relativeTimeUntil(now - 1, now)).toBeNull();
  });
  test('no live source is attached until an official machine-readable schedule is approved', () => {
    expect(strip.ECONOMIC_EVENT_SOURCE).toBeNull();
    expect(read('lib/useCfdEconomicEvent.ts')).toContain('ECONOMIC_EVENT_SOURCE');
  });
});

describe('strip model', () => {
  const today = utc(2026, 10, 7); // Wednesday
  const bars = strip.parseCfdDailyBars(body('XAUUSD', dailyBars(today, 5)), 'XAUUSD')!;
  const ticker = { price: '4150.5', status: 'sampled', asOf: today + 14 * 3_600_000 };
  test('assembles price, change, ranges and status from the ticker and its own series', () => {
    const m = strip.cfdInfoStripModel('XAUUSD', ticker, { symbol: 'XAUUSD', bars }, today + 14 * 3_600_000 + 60_000);
    expect(m.price).toBe(4150.5); expect(m.previousClose).toBe(4106); expect(m.change?.abs).toBeCloseTo(44.5);
    expect(m.dayRange).toEqual({ low: 4080, high: 4120 }); expect(m.session).toBe(today); expect(m.sessionOpen).toBe(true);
    expect(m.weekRange).toBeNull(); expect(m.status).toBe('open'); expect(m.asOf).toBe(ticker.asOf);
  });
  test('another instrument\'s series is never mixed in', () => {
    const m = strip.cfdInfoStripModel('XAGUSD', { ...ticker, price: '48.1' }, { symbol: 'XAUUSD', bars }, today + 15 * 3_600_000);
    expect(m.price).toBe(48.1); expect(m.change).toBeNull(); expect(m.dayRange).toBeNull(); expect(m.previousClose).toBeNull();
  });
  test('no ticker means dashes and an unknown status', () => {
    const m = strip.cfdInfoStripModel('XAUUSD', undefined, { symbol: 'XAUUSD', bars }, today + 15 * 3_600_000);
    expect(m.price).toBeNull(); expect(m.change).toBeNull(); expect(m.status).toBe('unknown');
  });
});

describe('strip component and copy', () => {
  test('the ticker bar renders the strip from the shared daily series and shows no provider percent', () => {
    const source = read('components/CfdTickerBar.tsx');
    for (const needle of ['useCfdDailySession', 'cfdInfoStripModel', 'cfd-info-strip', 'cfd-ticker-day-change', 'cfd-ticker-day-range', 'cfd-market-state', 'cfd-state-pill', 'cfd-pair-cluster', '<CfdInstrumentIcon symbol={symbol} compact />'])
      expect(source).toContain(needle);
    expect(source).not.toContain('changePercent24h');
    expect(source).not.toContain('cfd-product-badge');
  });
  test('the daily series rides the cached display route: one bounded GET, no stream, no timer left behind', () => {
    const source = read('lib/useCfdDailySession.ts');
    for (const needle of ['/cfd/display/candles/', 'interval=1d', 'readDisplayJson', 'SLOW_DISPLAY_REFRESH_MS', 'displayRefreshDelay', 'MARKET_EDGE_BASE', 'controller?.abort()', 'clearTimeout(timer)'])
      expect(source).toContain(needle);
    expect(source).not.toMatch(/EventSource|WebSocket|setInterval|fetch\(/);
    expect(strip.CFD_DAILY_SESSION_MS).toBe(DAY);
  });
  test('all seven languages carry the strip labels', () => {
    for (const lang of ['ru','en','zh','es','hi','ja','ko']) {
      const copy = cfdMarketCopy(lang);
      for (const key of ['dayChange','dayRange','prevClose','range52w','sessionUnknown','utcSession','nextEvent','eventCpi','eventRate','eventNfp','eventEia','officialSource'] as const)
        expect(copy[key].trim().length).toBeGreaterThan(0);
    }
  });
});

describe('daily series hook', () => {
  type Call = { url:string; signal:AbortSignal; resolve:(v:any)=>void; reject:(e:any)=>void };
  function mountHook() {
    const calls:Call[] = [];
    let index = 0; const hooks:any[] = []; const effects:(()=>void)[] = []; const cleanups = new Map<number,()=>void>(); const deps = new Map<number,any[]>();
    const react = {
      useState(initial:any) { const at = index++; if (!(at in hooks)) hooks[at] = typeof initial === 'function' ? initial() : initial; return [hooks[at], (value:any) => { hooks[at] = typeof value === 'function' ? value(hooks[at]) : value; }]; },
      useEffect(fn:() => void | (() => void), list?:any[]) { const at = index++; const prev = deps.get(at); const changed = !prev || !list || list.some((v, i) => v !== prev[i]); deps.set(at, list ?? []); if (changed) effects.push(() => { cleanups.get(at)?.(); cleanups.delete(at); const c = fn(); if (typeof c === 'function') cleanups.set(at, c); }); },
    };
    const compiled = ts.transpileModule(read('lib/useCfdDailySession.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const output:any = {};
    new Function('require', 'exports', compiled)((name:string) => {
      if (name === 'react') return react;
      if (name.endsWith('/browserActivity')) return browserActivity;
      if (name.endsWith('/displaySnapshotCache')) return { SLOW_DISPLAY_REFRESH_MS: 6 * 60 * 60 * 1000, displayRefreshDelay: () => 6 * 60 * 60 * 1000,
        readDisplayJson: (url:string, _ttl:number, signal:AbortSignal) => new Promise((resolve, reject) => { calls.push({ url, signal, resolve, reject }); signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); }) };
      if (name.endsWith('/api')) return { API_BASE: '/api/v1' };
      if (name.endsWith('/cfdInfoStrip')) return strip;
      throw new Error(`unexpected import ${name}`);
    }, output);
    return { calls, render(symbol:string, enabled = true) { index = 0; const result = output.useCfdDailySession(symbol, enabled); effects.splice(0).forEach(fn => fn()); return result; }, unmount() { for (const c of cleanups.values()) c(); cleanups.clear(); } };
  }
  const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const today = utc(2026, 10, 7);
  beforeEach(() => jest.useFakeTimers().setSystemTime(today + 12 * 3_600_000));
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  test('one bounded request per instrument, aborted and replaced on a switch', async () => {
    const h = mountHook();
    h.render('XAUUSD'); expect(h.calls.map(c => c.url)).toEqual(['/api/v1/cfd/display/candles/XAUUSD?interval=1d&limit=20']);
    h.calls[0].resolve(body('XAUUSD', dailyBars(today, 3))); await tick();
    let state = h.render('XAUUSD'); expect(state.state).toBe('ready'); expect(state.session?.bars).toHaveLength(3);
    state = h.render('EURUSD');
    expect(state.session).toBeNull(); expect(h.calls).toHaveLength(2); expect(h.calls[1].url).toContain('/EURUSD?interval=1d&limit=20');
    h.calls[1].resolve(body('EURUSD', dailyBars(today, 2))); await tick();
    state = h.render('EURUSD'); expect(state.session?.symbol).toBe('EURUSD'); expect(state.session?.bars).toHaveLength(2);
    h.unmount();
  });
  test('fast switching: the stale response is dropped and the current instrument wins', async () => {
    const h = mountHook();
    h.render('XAUUSD'); h.render('EURUSD'); h.render('XAUUSD');
    expect(h.calls).toHaveLength(3); expect(h.calls[0].signal.aborted).toBe(true); expect(h.calls[1].signal.aborted).toBe(true); expect(h.calls[2].signal.aborted).toBe(false);
    h.calls[1].resolve(body('EURUSD', dailyBars(today, 2))); await tick();
    expect(h.render('XAUUSD').session).toBeNull();
    h.calls[2].resolve(body('XAUUSD', dailyBars(today, 4))); await tick();
    const state = h.render('XAUUSD'); expect(state.session?.symbol).toBe('XAUUSD'); expect(state.session?.bars).toHaveLength(4);
    h.unmount();
  });
  test('a failed refresh keeps the last good series and retries in a minute, never faster', async () => {
    const h = mountHook();
    h.render('XAUUSD'); h.calls[0].resolve(body('XAUUSD', dailyBars(today, 3))); await tick();
    expect(h.render('XAUUSD').state).toBe('ready');
    jest.advanceTimersByTime(6 * 60 * 60 * 1000); expect(h.calls).toHaveLength(2);
    h.calls[1].reject(new Error('HTTP 429')); await tick();
    const state = h.render('XAUUSD'); expect(state.state).toBe('error'); expect(state.session?.bars).toHaveLength(3);
    jest.advanceTimersByTime(59_000); expect(h.calls).toHaveLength(2);
    jest.advanceTimersByTime(1_000); expect(h.calls).toHaveLength(3);
    h.calls[2].resolve({ symbol: 'XAUUSD', interval: '1h', bars: [] }); await tick();
    expect(h.render('XAUUSD').state).toBe('error');
    h.unmount();
  });
  test('disabled means no request and no state', () => {
    const h = mountHook();
    const state = h.render('XAUUSD', false); expect(h.calls).toHaveLength(0); expect(state.session).toBeNull(); expect(state.state).toBe('idle');
    h.unmount();
  });
});
