/** Public, display-only fallback observations. Never implements CfdQuoteSource.
 * Fixed destinations, bounded payload/cache/concurrency, no credentials or DB.
 * Daily benchmarks and indicative metal quotes are NOT executable CFD prices.
 */
export type PublicReferenceKind = 'indicative' | 'daily_reference';
export interface PublicReference {
  symbol: string;
  provider: 'gold-api' | 'ecb' | 'eia';
  providerSymbol: string;
  contract: string;
  currency: string;
  unit: string;
  kind: PublicReferenceKind;
  priceDecimal: string;
  sourceTimestamp: number | null;
  observationDate: string | null;
  receivedAt: number;
  attribution: string;
  derivation: string | null;
}
export interface PublicReferenceView extends PublicReference {
  status: 'available' | 'stale';
  validUntil: number;
  executionAllowed: false;
}
const DAY = 86_400_000;
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function referenceDecimal(v: unknown): string | null {
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : '';
  return s.length > 0 && s.length <= 80 && DECIMAL.test(s) && Number.isFinite(Number(s)) ? s : null;
}
function dateTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('invalid_date');
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('invalid_date');
  return time;
}
function checkedDate(value: string, now: number): string {
  if (dateTime(value) > Math.floor(now / DAY) * DAY) throw new Error('future_date');
  return value;
}
function eventTime(q: PublicReference): number {
  return q.observationDate === null ? q.sourceTimestamp! : dateTime(q.observationDate);
}
export const METALS = ['XAU', 'XAG', 'XPT', 'XPD'] as const;
export const FX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD'] as const;
const OIL = {
  WTIUSD: { series: 'RWTC', title: 'Cushing, OK WTI Spot Price FOB', contract: 'WTI:Cushing:spot:daily', file: 'RWTCD.htm' },
  XBRUSD: { series: 'RBRTE', title: 'Europe Brent Spot Price FOB', contract: 'Brent:Europe:spot:daily', file: 'RBRTED.htm' },
} as const;
export function parseGoldReference(text: string, metal: typeof METALS[number], now: number): PublicReference[] {
  const raw = JSON.parse(text);
  if (!raw || raw.symbol !== metal || (raw.currency !== undefined && raw.currency !== 'USD')) throw new Error('metal_identity');
  // Preserve a JSON numeric token, not a rounded binary representation.
  const price = typeof raw.price === 'string' ? referenceDecimal(raw.price)
    : referenceDecimal(text.match(/"price"\s*:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*[,}]/)?.[1]);
  const at = typeof raw.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw.updatedAt)
    ? Date.parse(raw.updatedAt) : NaN;
  if (price === null || Number(price) !== Number(raw.price) || !Number.isFinite(at) || at <= 0 || at > now + 1000 || new Date(at).toISOString().slice(0, 19) !== raw.updatedAt.slice(0, 19)) throw new Error('metal_payload');
  return [{ symbol: `${metal}USD`, provider: 'gold-api', providerSymbol: metal,
    contract: `Gold-API:${metal}:indicative`, currency: 'USD', unit: 'provider_native_quote', kind: 'indicative',
    priceDecimal: price, sourceTimestamp: at, observationDate: null, receivedAt: now,
    attribution: 'Gold API', derivation: null }];
}
/** Decimal rational division for display-only ECB cross rates; 12 decimal places,
 * half-up. This never changes global BigNumber settings or financial arithmetic. */
function ratio(numerator: string, denominator: string): string {
  const parts = (s: string): [bigint, bigint] => {
    if (!/^\d{1,20}(?:\.\d{1,20})?$/.test(s) || Number(s) <= 0) throw new Error('ecb_rate');
    const [a, b = ''] = s.split('.'); return [BigInt(a + b), 10n ** BigInt(b.length)];
  };
  const [a, as] = parts(numerator), [b, bs] = parts(denominator), scale = 10n ** 12n;
  const den = as * b, num = a * bs * scale;
  const rounded = (num + den / 2n) / den;
  const digits = rounded.toString().padStart(13, '0');
  return `${digits.slice(0, -12)}.${digits.slice(-12)}`.replace(/0+$/, '').replace(/\.$/, '');
}
export function parseEcbReferences(text: string, now: number): PublicReference[] {
  // Deliberately restricted to the published daily Cube schema. No XML entity
  // expansion or general-purpose XML execution; unexpected schema fails closed.
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || !text.includes('European Central Bank')) throw new Error('ecb_schema');
  const dates = [...text.matchAll(/<Cube\s+time\s*=\s*['"](\d{4}-\d{2}-\d{2})['"]\s*>/g)];
  if (dates.length !== 1) throw new Error('ecb_date');
  const date = checkedDate(dates[0][1], now);
  const rates = new Map<string, string>([['EUR', '1']]);
  for (const match of text.matchAll(/<Cube\s+currency\s*=\s*['"]([A-Z]{3})['"]\s+rate\s*=\s*['"](\d+(?:\.\d+)?)['"]\s*\/>/g)) {
    if (rates.has(match[1]) || Number(match[2]) <= 0) throw new Error('ecb_rate');
    rates.set(match[1], match[2]);
  }
  return FX_PAIRS.flatMap(symbol => {
    const base = symbol.slice(0, 3), quote = symbol.slice(3), a = rates.get(quote), b = rates.get(base);
    if (!a || !b) return [];
    return [{ symbol, provider: 'ecb' as const, providerSymbol: `${base}/${quote}`,
      contract: `ECB:${base}/${quote}:daily-reference`, currency: quote, unit: base, kind: 'daily_reference' as const,
      priceDecimal: base === 'EUR' ? a : ratio(a, b), sourceTimestamp: null, observationDate: date, receivedAt: now,
      attribution: 'ECB', derivation: base === 'EUR' ? null : `${quote}/EUR divided by ${base}/EUR; 12 decimals, half-up` }];
  });
}
function htmlText(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function parseEiaReference(text: string, symbol: keyof typeof OIL, now: number): PublicReference[] {
  const meta = OIL[symbol];
  if (!meta || !htmlText(text).includes(meta.title) || !htmlText(text).includes('Dollars per Barrel')
    || !/Week Of\s+Mon\s+Tue\s+Wed\s+Thu\s+Fri/i.test(htmlText(text))) throw new Error('eia_identity');
  let last: { date: string; price: string } | null = null;
  for (const row of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => htmlText(c[1]));
    if (cells.length !== 6) continue;
    const m = cells[0].match(/^(\d{4})\s+([A-Z][a-z]{2})-\s*(\d{1,2})\s+to\s+([A-Z][a-z]{2})-\s*(\d{1,2})$/);
    if (!m) continue;
    const month = MONTHS.indexOf(m[2]), year = Number(m[1]);
    if (month < 0) throw new Error('eia_week');
    const start = dateTime(`${year}-${String(month + 1).padStart(2, '0')}-${m[3].padStart(2, '0')}`);
    const end = new Date(start + 4 * DAY);
    if (new Date(start).getUTCDay() !== 1 || MONTHS[end.getUTCMonth()] !== m[4] || end.getUTCDate() !== Number(m[5])) throw new Error('eia_week');
    for (let day = 0; day < 5; day++) {
      const price = referenceDecimal(cells[day + 1]);
      if (price === null) {
        if (cells[day + 1] !== '' && !['-', '--', 'NA', 'N/A'].includes(cells[day + 1])) throw new Error('eia_value');
        continue;
      }
      const date = checkedDate(new Date(start + day * DAY).toISOString().slice(0, 10), now);
      if (!last || date > last.date) last = { date, price };
      else if (date === last.date && price !== last.price) throw new Error('eia_conflict');
    }
  }
  if (!last) throw new Error('eia_no_observation');
  return [{ symbol, provider: 'eia', providerSymbol: meta.series, contract: meta.contract,
    currency: 'USD', unit: 'barrel', kind: 'daily_reference', priceDecimal: last.price,
    sourceTimestamp: null, observationDate: last.date, receivedAt: now, attribution: 'U.S. EIA', derivation: null }];
}
interface Target {
  id: string; provider: PublicReference['provider']; symbols: string[]; url: string; interval: number; maxBytes: number;
  parse: (text: string, now: number) => PublicReference[];
}
const targets: Target[] = [
  ...METALS.map(metal => ({ id: `gold:${metal}`, provider: 'gold-api' as const, symbols: [`${metal}USD`],
    url: `https://api.gold-api.com/price/${metal}`, interval: 60_000, maxBytes: 16_384,
    parse: (text: string, now: number) => parseGoldReference(text, metal, now) })),
  { id: 'ecb', provider: 'ecb', symbols: [...FX_PAIRS], url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    interval: 3_600_000, maxBytes: 32_768, parse: parseEcbReferences },
  ...(['WTIUSD', 'XBRUSD'] as const).map(symbol => ({ id: `eia:${symbol}`, provider: 'eia' as const, symbols: [symbol],
    url: `https://www.eia.gov/dnav/pet/hist/${OIL[symbol].file}`, interval: 6 * 3_600_000, maxBytes: 2_000_000,
    parse: (text: string, now: number) => parseEiaReference(text, symbol, now) })),
];
interface TargetState { nextAt: number; failures: number; error: string | null; requests: number; }
export interface PublicReferenceFeedOptions {
  enabled?: boolean; fetchFn?: typeof fetch; now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
export class PublicReferenceFeed {
  private readonly cache = new Map<string, PublicReference>();
  private readonly state = new Map<string, TargetState>();
  private readonly failedSymbols = new Set<string>();
  private inFlight: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly enabled: boolean;
  constructor(options: PublicReferenceFeedOptions = {}) {
    this.now = options.now ?? Date.now; this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.enabled = options.enabled === true;
    targets.forEach(t => this.state.set(t.id, { nextAt: -Infinity, failures: 0, error: null, requests: 0 }));
  }
  isEnabled(): boolean { return this.enabled; }
  isRefreshing(): boolean { return this.inFlight !== null; }
  /** One refresh owner for all browser clients. Three bounded provider lanes;
   * same-host requests are serialized and spaced. No retry loops or timers on import. */
  refreshDue(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const pending = Promise.all((['gold-api', 'ecb', 'eia'] as const).map(async provider => {
      let sent = false;
      for (const target of targets.filter(t => t.provider === provider)) {
        if (this.now() < this.state.get(target.id)!.nextAt) continue;
        if (sent) await this.sleep(1100);
        await this.fetchTarget(target); sent = true;
      }
    })).then(() => undefined);
    this.inFlight = pending.finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  private async fetchTarget(target: Target): Promise<void> {
    const state = this.state.get(target.id)!;
    state.nextAt = this.now() + target.interval; state.requests++;
    try {
      const response = await this.fetchFn(target.url, { redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Accept: target.provider === 'gold-api' ? 'application/json' : target.provider === 'ecb' ? 'application/xml,text/xml' : 'text/html',
          'User-Agent': 'VOLTEX-public-reference/1.0' } });
      if (!response.ok) {
        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const until = retry && /^\d+$/.test(retry) ? this.now() + Number(retry) * 1000 : retry ? Date.parse(retry) : NaN;
          if (Number.isFinite(until)) state.nextAt = Math.max(state.nextAt, until);
        }
        await response.body?.cancel(); throw new Error(`http_${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('no_body');
      let size = 0; const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > target.maxBytes) { await reader.cancel(); throw new Error('body_limit'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const all = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
      const values = target.parse(new TextDecoder('utf-8', { fatal: true }).decode(all), this.now());
      const seen = new Set<string>();
      const updates: PublicReference[] = [];
      for (const q of values) {
        if (!target.symbols.includes(q.symbol) || seen.has(q.symbol) || q.provider !== target.provider) throw new Error('identity');
        seen.add(q.symbol);
        const old = this.cache.get(q.symbol);
        if (old && eventTime(q) < eventTime(old)) continue;
        if (old && eventTime(q) === eventTime(old) && q.priceDecimal !== old.priceDecimal) throw new Error('revision_conflict');
        // Retain at most one observation per fixed catalog member, including
        // dated weekend history. Stale data never becomes a current observation.
        updates.push(q);
      }
      for (const q of updates) this.cache.set(q.symbol, { ...q });
      for (const symbol of target.symbols) {
        if (seen.has(symbol)) this.failedSymbols.delete(symbol); else this.failedSymbols.add(symbol);
      }
      state.error = seen.size === target.symbols.length ? null : 'partial_response'; state.failures = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      state.error = /^http_\d{3}$/.test(message) ? message : 'source_unavailable';
      target.symbols.forEach(symbol => this.failedSymbols.add(symbol));
      state.failures = Math.min(10, state.failures + 1);
      state.nextAt = Math.max(state.nextAt, this.now() + Math.min(3_600_000, 60_000 * 2 ** state.failures));
      // No raw payloads, URLs, exceptions or secrets in logs/public responses.
    }
  }
  snapshot(): PublicReferenceView[] {
    if (!this.enabled) return [];
    const now = this.now();
    return [...this.cache.values()].flatMap(q => {
      const at = eventTime(q);
      if (now - at > 30 * DAY || at > now + 1000 || q.receivedAt > now + 1000) return [];
      const freshUntil = Math.min(at + (q.kind === 'daily_reference' ? 7 * DAY : 180_000), q.receivedAt + (q.kind === 'daily_reference' ? 12 * 3_600_000 : 180_000));
      const stale = now > freshUntil || this.failedSymbols.has(q.symbol);
      return [{ ...q, status: stale ? 'stale' as const : 'available' as const,
        validUntil: freshUntil, executionAllowed: false as const }];
    });
  }
  /** Diagnostics are operator data; the public serializer deliberately omits errors. */
  diagnostics() { return targets.map(t => ({ id: t.id, ...this.state.get(t.id)! })); }
}
