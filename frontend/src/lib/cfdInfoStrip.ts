// Compact CFD information strip: pure calculations over the public display
// data the terminal already holds. Nothing here fetches; the hook in
// useCfdDailySession.ts reads one cached daily series per instrument and the
// strip derives every figure from that series plus the ticker row. A missing
// or unreliable input becomes null, which the strip renders as «—».

export type CfdDailyBar = { openTime:number; open:number; high:number; low:number; close:number; isOpen:boolean };

/** The provider's daily bars open at 00:00 UTC, so a session is one UTC day. */
export const CFD_DAILY_SESSION_MS = 86_400_000;
/** Previous session must be this close to the current one; a wider hole means data is missing, not a holiday. */
const MAX_PREVIOUS_SESSION_GAP_MS = 5 * CFD_DAILY_SESSION_MS;
const PROVIDER_SYMBOL: Record<string,string> = { WTIUSD:'USOIL', XBRUSD:'UKOIL' };

const positive = (value:unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
const finite = (value:unknown) => { const n = Number(value); return Number.isFinite(n) ? n : null; };

/** Validates a `/cfd/display/candles/:symbol?interval=1d` body. null = wrong instrument or shape. */
export function parseCfdDailyBars(body:unknown, symbol:string):CfdDailyBar[]|null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as { symbol?:unknown; interval?:unknown; bars?:unknown };
  const provider = PROVIDER_SYMBOL[symbol] ?? symbol;
  if (raw.interval !== '1d' || typeof raw.symbol !== 'string' || ![symbol, provider].includes(raw.symbol)) return null;
  if (!Array.isArray(raw.bars)) return null;
  const seen = new Set<number>(), rows:CfdDailyBar[] = [];
  for (const item of raw.bars) {
    if (!item || typeof item !== 'object') continue;
    const bar = item as Record<string,unknown>;
    const openTime = typeof bar.openTime === 'number' ? bar.openTime : typeof bar.openTime === 'string' ? Date.parse(bar.openTime) : NaN;
    const open = positive(bar.open), high = positive(bar.high), low = positive(bar.low), close = positive(bar.close);
    if (!Number.isFinite(openTime) || openTime <= 0 || open === null || high === null || low === null || close === null || seen.has(openTime)) continue;
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) continue;
    seen.add(openTime);
    rows.push({ openTime, open, high, low, close, isOpen: bar.isOpen === true });
  }
  rows.sort((a, b) => a.openTime - b.openTime);
  return rows;
}

export interface CfdSessionResolution { session:CfdDailyBar|null; previous:CfdDailyBar|null; previousClose:number|null }

/** The session that contains the quote's own timestamp, and the closed session before it. */
export function resolveCfdSession(bars:CfdDailyBar[], asOf:number|null|undefined):CfdSessionResolution {
  const none:CfdSessionResolution = { session:null, previous:null, previousClose:null };
  if (typeof asOf !== 'number' || !Number.isFinite(asOf) || asOf <= 0 || !bars.length) return none;
  let session:CfdDailyBar|null = null;
  for (const bar of bars) if (bar.openTime <= asOf && asOf < bar.openTime + CFD_DAILY_SESSION_MS) { session = bar; break; }
  if (!session) return none;
  let previous:CfdDailyBar|null = null;
  for (const bar of bars) if (bar.openTime < session.openTime && !bar.isOpen && (previous === null || bar.openTime > previous.openTime)) previous = bar;
  if (!previous || session.openTime - previous.openTime > MAX_PREVIOUS_SESSION_GAP_MS) return { session, previous:null, previousClose:null };
  return { session, previous, previousClose: previous.close > 0 ? previous.close : null };
}

export interface CfdDayChange { abs:number; pct:number }

/** Change against the previous session close. No value when either side is missing or zero. */
export function cfdDayChange(price:string|number|null|undefined, previousClose:number|null|undefined):CfdDayChange|null {
  const last = positive(price), prev = positive(previousClose);
  if (last === null || prev === null) return null;
  const abs = last - prev;
  return { abs, pct: (abs / prev) * 100 };
}

export function cfdDayRange(session:CfdDailyBar|null|undefined):{ low:number; high:number }|null {
  if (!session || !(session.low > 0) || !(session.high >= session.low)) return null;
  return { low: session.low, high: session.high };
}

/** Index and stock CFDs only. The catalogue lists none today (metals, energy, FX majors), so the strip never shows this field yet. */
export const CFD_FIFTY_TWO_WEEK_SYMBOLS:ReadonlySet<string> = new Set<string>();
const FIFTY_TWO_WEEKS_MS = 364 * CFD_DAILY_SESSION_MS;
const MIN_CLOSED_SESSIONS_52W = 200;
const MIN_COVERAGE_52W_MS = 350 * CFD_DAILY_SESSION_MS;

export interface CfdFiftyTwoWeekRange { low:number; high:number; closedOnly:true; asOfSession:number; sessions:number }

/** Closed sessions inside the trailing 52 weeks; null unless the series really covers that period. */
export function cfdFiftyTwoWeekRange(symbol:string, bars:CfdDailyBar[], asOf:number|null|undefined):CfdFiftyTwoWeekRange|null {
  if (!CFD_FIFTY_TWO_WEEK_SYMBOLS.has(symbol) || typeof asOf !== 'number' || !Number.isFinite(asOf)) return null;
  const from = asOf - FIFTY_TWO_WEEKS_MS;
  const closed = bars.filter(bar => !bar.isOpen && bar.openTime >= from && bar.openTime <= asOf);
  if (closed.length < MIN_CLOSED_SESSIONS_52W) return null;
  const oldest = closed[0].openTime, newest = closed[closed.length - 1].openTime;
  if (asOf - oldest < MIN_COVERAGE_52W_MS) return null;
  let low = Infinity, high = -Infinity;
  for (const bar of closed) { if (bar.low < low) low = bar.low; if (bar.high > high) high = bar.high; }
  return { low, high, closedOnly:true, asOfSession:newest, sessions:closed.length };
}

// ---------------------------------------------------------------------------
// Session calendar (informational only; never gates an order).
// Weekly windows in America/New_York wall-clock time, DST-aware through Intl:
//  - forex: Sunday 17:00 to Friday 17:00, continuous.
//  - cme (COMEX metals, NYMEX WTI): Sunday 18:00 to Friday 17:00 with a daily
//    17:00–18:00 maintenance break (CME Globex schedule).
//  - ice (ICE Brent): Sunday 20:00 to Friday 18:00 with a daily 18:00–20:00 break.
// Exchange holidays are not modelled here; the provider's own closed flag covers them.
export type CfdSessionClass = 'forex'|'cme'|'ice';
const SESSION_CLASS:Record<string,CfdSessionClass> = {
  XAUUSD:'cme', XAGUSD:'cme', XPTUSD:'cme', XPDUSD:'cme', WTIUSD:'cme', XBRUSD:'ice',
  EURUSD:'forex', GBPUSD:'forex', USDJPY:'forex', AUDUSD:'forex', USDCAD:'forex', USDCHF:'forex', NZDUSD:'forex',
};
export function cfdSessionClass(symbol:string):CfdSessionClass|null { return SESSION_CLASS[symbol] ?? null; }

const ET_ZONE = 'America/New_York';
let etFormatter:Intl.DateTimeFormat|null = null;
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
/** Weekday (0 = Sunday), minute of day and calendar date in New York for an instant. */
export function newYorkClock(at:number):{ weekday:number; minute:number; date:string } {
  etFormatter ??= new Intl.DateTimeFormat('en-US', { timeZone:ET_ZONE, weekday:'short', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
  const parts:Record<string,string> = {};
  for (const part of etFormatter.formatToParts(new Date(at))) parts[part.type] = part.value;
  const hour = Number(parts.hour) % 24, minute = Number(parts.minute);
  return { weekday: WEEKDAYS.indexOf(parts.weekday), minute: hour * 60 + minute, date: `${parts.year}-${parts.month}-${parts.day}` };
}

const H = (hour:number) => hour * 60;
/** true/false by the weekly window above, null for an instrument without a calendar. */
export function cfdSessionOpenAt(symbol:string, at:number):boolean|null {
  const cls = cfdSessionClass(symbol);
  if (!cls) return null;
  const { weekday, minute } = newYorkClock(at);
  if (weekday === 6) return false;
  if (cls === 'forex') return !((weekday === 5 && minute >= H(17)) || (weekday === 0 && minute < H(17)));
  const dailyClose = cls === 'cme' ? H(17) : H(18), dailyOpen = cls === 'cme' ? H(18) : H(20);
  if (weekday === 5) return minute < dailyClose;
  if (weekday === 0) return minute >= dailyOpen;
  return !(minute >= dailyClose && minute < dailyOpen);
}

/** Identity of the continuous trading segment an instant belongs to, or null while closed. */
export function cfdSessionSegment(symbol:string, at:number):string|null {
  const cls = cfdSessionClass(symbol);
  if (!cls || cfdSessionOpenAt(symbol, at) !== true) return null;
  if (cls === 'forex') {
    // Sunday 17:00 ET + 7h = Monday 00:00 ET: the shifted calendar date names the trading week.
    const { date } = newYorkClock(at + 7 * 3_600_000);
    const [y, m, d] = date.split('-').map(Number);
    const days = Math.floor(Date.UTC(y, m - 1, d) / CFD_DAILY_SESSION_MS);
    return `forex:${Math.floor((days + 3) / 7)}`;
  }
  // 18:00 ET + 6h (CME) or 20:00 ET + 4h (ICE) = midnight: the shifted date names the trading day.
  const shift = cls === 'cme' ? 6 : 4;
  return `${cls}:${newYorkClock(at + shift * 3_600_000).date}`;
}

export type CfdMarketStatus = 'open'|'closed'|'unknown';
export interface CfdStatusRow { price?:string|null; status?:string; marketClosed?:boolean; asOf?:number|null }

/** Provider flag at the quote's time, cross-checked with the weekly calendar. Unknown rather than guessed. */
export function cfdMarketStatus(symbol:string, row:CfdStatusRow|undefined, now = Date.now()):CfdMarketStatus {
  if (!row) return 'unknown';
  const calendarOpen = cfdSessionOpenAt(symbol, now);
  if (calendarOpen === false) return 'closed';
  const asOf = typeof row.asOf === 'number' && Number.isFinite(row.asOf) && row.asOf > 0 && row.asOf <= now + 60_000 ? row.asOf : null;
  if (calendarOpen === null) return row.marketClosed === true ? 'closed' : 'unknown';
  const sameSegment = asOf !== null && cfdSessionSegment(symbol, asOf) === cfdSessionSegment(symbol, now);
  if (row.marketClosed === true) return sameSegment ? 'closed' : 'unknown';
  if (!sameSegment || row.price == null || row.status === 'unavailable') return 'unknown';
  return 'open';
}

// ---------------------------------------------------------------------------
// Economic events. Only official schedules may feed this; none with a permitted
// machine-readable endpoint is wired yet, so ECONOMIC_EVENT_SOURCE stays null
// and the strip hides the block. The adapter and the selection rules are kept
// so a source can be attached without touching the strip.
export type EconomicEventKind = 'cpi'|'rate_decision'|'nfp'|'eia_petroleum';
export type EconomicRegion = 'US'|'EU'|'GB'|'JP'|'AU'|'CA'|'CH'|'NZ';
export interface EconomicEvent { id:string; kind:EconomicEventKind; region:EconomicRegion; at:number; source:{ name:string; url:string } }
export interface EconomicEventSource { list(now:number):Promise<EconomicEvent[]> }
export const ECONOMIC_EVENT_SOURCE:EconomicEventSource|null = null;

const CURRENCY_REGION:Record<string,EconomicRegion> = { USD:'US', EUR:'EU', GBP:'GB', JPY:'JP', AUD:'AU', CAD:'CA', CHF:'CH', NZD:'NZ' };
export interface EconomicRelevance { region:EconomicRegion; kinds:EconomicEventKind[] }

/** Which official releases matter for an instrument. */
export function relevantEconomicEvents(symbol:string):EconomicRelevance[] {
  const cls = cfdSessionClass(symbol);
  if (cls === 'forex') {
    const base = symbol.slice(0, 3), quote = symbol.slice(3, 6), out:EconomicRelevance[] = [];
    for (const code of [base, quote]) {
      const region = CURRENCY_REGION[code];
      if (!region) continue;
      out.push({ region, kinds: region === 'US' ? ['rate_decision','cpi','nfp'] : ['rate_decision','cpi'] });
    }
    return out;
  }
  if (cls === 'cme' && (symbol === 'WTIUSD')) return [{ region:'US', kinds:['eia_petroleum'] }];
  if (cls === 'ice') return [{ region:'US', kinds:['eia_petroleum'] }];
  if (cls === 'cme') return [{ region:'US', kinds:['cpi','rate_decision','nfp'] }];
  return [];
}

/** Nearest relevant event strictly in the future. A past event is never "nearest". */
export function pickNearestEconomicEvent(events:EconomicEvent[], symbol:string, now:number):EconomicEvent|null {
  const relevance = relevantEconomicEvents(symbol);
  let best:EconomicEvent|null = null;
  for (const event of events) {
    if (!Number.isFinite(event.at) || event.at <= now) continue;
    if (!relevance.some(r => r.region === event.region && r.kinds.includes(event.kind))) continue;
    if (!best || event.at < best.at) best = event;
  }
  return best;
}

export interface RelativeTime { days:number; hours:number; minutes:number }
export function relativeTimeUntil(at:number, now:number):RelativeTime|null {
  const total = Math.floor((at - now) / 60_000);
  if (!Number.isFinite(total) || total < 0) return null;
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}

// ---------------------------------------------------------------------------
export interface CfdInfoStripModel {
  price:number|null;
  change:CfdDayChange|null;
  previousClose:number|null;
  previousSession:number|null;
  session:number|null;
  sessionOpen:boolean;
  dayRange:{ low:number; high:number }|null;
  weekRange:CfdFiftyTwoWeekRange|null;
  status:CfdMarketStatus;
  asOf:number|null;
}

export interface CfdDailySeries { symbol:string; bars:CfdDailyBar[] }

/** Everything the strip renders, from the ticker row and the instrument's own daily series. */
export function cfdInfoStripModel(symbol:string, ticker:CfdStatusRow|undefined, series:CfdDailySeries|null, now = Date.now()):CfdInfoStripModel {
  const price = ticker ? positive(ticker.price) : null;
  const asOf = ticker && typeof ticker.asOf === 'number' && Number.isFinite(ticker.asOf) && ticker.asOf > 0 ? ticker.asOf : null;
  const bars = series && series.symbol === symbol ? series.bars : [];
  const resolved = resolveCfdSession(bars, asOf);
  const change = price !== null && finite(resolved.previousClose) !== null ? cfdDayChange(price, resolved.previousClose) : null;
  return {
    price,
    change,
    previousClose: resolved.previousClose,
    previousSession: resolved.previous?.openTime ?? null,
    session: resolved.session?.openTime ?? null,
    sessionOpen: resolved.session?.isOpen === true,
    dayRange: cfdDayRange(resolved.session),
    weekRange: cfdFiftyTwoWeekRange(symbol, bars, asOf),
    status: cfdMarketStatus(symbol, ticker, now),
    asOf,
  };
}
