/** Shadow/reference-only routing. Deliberately NOT a CfdQuoteSource.
 * No last->mid conversion, synthetic spread, stale execution or DB access.
 * Adapters/collector own fetching; reads are synchronous and spend no quota.
 */
export type ReferenceKind = 'last' | 'mid' | 'daily_reference';
export interface ReferenceInstrument {
  id: string;
  contract: string;
  currency: string;
  unit: string;
  kind: ReferenceKind;
}
export interface ReferenceObservation extends ReferenceInstrument {
  provider: string;
  providerSymbol: string;
  priceDecimal: string;
  sourceTimestamp: number | null;
  observationDate: string | null;
  receivedAt: number;
  marketState: 'open' | 'closed' | 'unknown';
}
export interface ReferenceAdmission {
  provider: string;
  instrument: ReferenceInstrument;
  providerSymbol: string;
  /** An evidence record ID, not an API key. Missing evidence denies admission. */
  mappingEvidence: string;
  displayRightsEvidence: string;
  enabled: boolean;
  /** Null means upstream independence has NOT been verified. */
  lineage: string | null;
  priority: number;
  maxSourceAgeMs: number;
  maxReceiveAgeMs: number;
}
export interface ReferenceSelection {
  status: 'available' | 'market_closed' | 'unavailable' | 'conflict';
  quote: ReferenceObservation | null;
  /** Explicitly stale history, NEVER a fallback current quote. */
  lastKnown: ReferenceObservation | null;
  availableProviders: string[];
  verifiedIndependentSources: number;
  redundant: boolean;
  executionAllowed: false;
}
interface Slot {
  admission: ReferenceAdmission;
  quote: ReferenceObservation | null;
  healthy: boolean;
  consecutiveSamples: number;
}
interface SelectionState { provider: string; selectedAt: number; }
export interface ReferenceRouterOptions {
  now?: () => number;
  maxSkewMs?: number;
  maxDivergenceBps?: number;
  comparableWindowMs?: number;
  failbackSamples?: number;
  failbackHoldMs?: number;
}
const DAY_MS = 86_400_000;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function validDecimal(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && decimal.test(value) && Number.isFinite(Number(value));
}
function dateEpoch(date: unknown): number | null {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : null;
}
function sameInstrument(a: ReferenceInstrument, b: ReferenceInstrument): boolean {
  return a.id === b.id && a.contract === b.contract && a.currency === b.currency && a.unit === b.unit && a.kind === b.kind;
}
function sourceTime(q: ReferenceObservation): number | null {
  return q.kind === 'daily_reference' ? dateEpoch(q.observationDate) : q.sourceTimestamp;
}
function key(provider: string, instrument: string): string { return JSON.stringify([provider, instrument]); }
function positive(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }

export class ReferenceQuoteRouter {
  private readonly slots = new Map<string, Slot>();
  private readonly instruments = new Map<string, ReferenceInstrument>();
  private readonly selected = new Map<string, SelectionState>();
  private readonly history = new Map<string, ReferenceObservation>();
  private readonly now: () => number;
  private readonly skew: number;
  private readonly divergence: number;
  private readonly comparableWindow: number;
  private readonly failbackSamples: number;
  private readonly hold: number;

  constructor(admissions: readonly ReferenceAdmission[], options: ReferenceRouterOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.skew = options.maxSkewMs ?? 1_000;
    this.divergence = options.maxDivergenceBps ?? 50;
    this.comparableWindow = options.comparableWindowMs ?? 5_000;
    this.failbackSamples = options.failbackSamples ?? 3;
    this.hold = options.failbackHoldMs ?? 30_000;
    if (![this.skew, this.comparableWindow, this.hold].every(n => Number.isSafeInteger(n) && n >= 0)
      || !positive(this.failbackSamples) || !Number.isFinite(this.divergence) || this.divergence < 0
      || admissions.length > 256) throw new Error('Invalid reference router policy');
    for (const input of admissions) {
      const a = { ...input, instrument: { ...input.instrument } };
      if (!a.provider || !a.instrument.id || !a.instrument.contract || !a.instrument.currency || !a.instrument.unit
        || !['last', 'mid', 'daily_reference'].includes(a.instrument.kind) || !a.providerSymbol
        || !Number.isSafeInteger(a.priority) || !positive(a.maxSourceAgeMs) || !positive(a.maxReceiveAgeMs)) {
        throw new Error('Invalid reference admission');
      }
      const existing = this.instruments.get(a.instrument.id);
      if (existing && !sameInstrument(existing, a.instrument)) throw new Error('Ambiguous reference instrument identity');
      const id = key(a.provider, a.instrument.id);
      if (this.slots.has(id)) throw new Error('Duplicate reference admission');
      this.instruments.set(a.instrument.id, a.instrument);
      this.slots.set(id, { admission: a, quote: null, healthy: false, consecutiveSamples: 0 });
    }
  }

  private allowed(slot: Slot): boolean {
    const a = slot.admission;
    return a.enabled === true && typeof a.mappingEvidence === 'string' && a.mappingEvidence.trim().length > 0
      && typeof a.displayRightsEvidence === 'string' && a.displayRightsEvidence.trim().length > 0;
  }

  private valid(q: ReferenceObservation, a: ReferenceAdmission, now: number): boolean {
    if (!sameInstrument(q, a.instrument) || q.provider !== a.provider || q.providerSymbol !== a.providerSymbol
      || !validDecimal(q.priceDecimal) || !Number.isFinite(q.receivedAt) || q.receivedAt <= 0
      || q.receivedAt > now + this.skew || now - q.receivedAt > a.maxReceiveAgeMs
      || !['open', 'closed', 'unknown'].includes(q.marketState)) return false;
    const at = sourceTime(q);
    if (at === null || !Number.isFinite(at) || at <= 0 || now - at > a.maxSourceAgeMs) return false;
    if (q.kind === 'daily_reference') {
      // A calendar observation date is NOT a made-up intraday timestamp.
      return q.sourceTimestamp === null && at <= Math.floor(now / DAY_MS) * DAY_MS;
    }
    return q.observationDate === null && at <= now + this.skew && at <= q.receivedAt + this.skew;
  }

  ingest(q: ReferenceObservation): boolean {
    const slot = this.slots.get(key(q.provider, q.id));
    if (!slot || !this.allowed(slot)) return false;
    // A delayed stale response must not invalidate a newer healthy sample.
    const candidateTime = sourceTime(q);
    if (slot.quote && sameInstrument(q, slot.admission.instrument) && q.providerSymbol === slot.admission.providerSymbol
      && candidateTime !== null && Number.isFinite(candidateTime)
      && candidateTime < sourceTime(slot.quote)!) return false;
    if (!this.valid(q, slot.admission, this.now())) {
      this.fail(q.provider, q.id);
      return false;
    }
    const oldTime = slot.quote ? sourceTime(slot.quote)! : -Infinity;
    const nextTime = sourceTime(q)!;
    // Late responses and same-timestamp conflicting values cannot overwrite a newer quote.
    if (nextTime < oldTime || (slot.quote && q.receivedAt < slot.quote.receivedAt)) return false;
    if (slot.quote && nextTime === oldTime && q.priceDecimal !== slot.quote.priceDecimal) {
      this.fail(q.provider, q.id);
      return false;
    }
    slot.consecutiveSamples = nextTime > oldTime ? slot.consecutiveSamples + 1 : slot.consecutiveSamples;
    slot.quote = { ...q };
    slot.healthy = true;
    return true;
  }

  fail(provider: string, instrument: string): void {
    const slot = this.slots.get(key(provider, instrument));
    if (slot) { slot.healthy = false; slot.consecutiveSamples = 0; }
  }

  revoke(provider: string, instrument: string): void {
    const slot = this.slots.get(key(provider, instrument));
    if (slot) { slot.admission.enabled = false; slot.quote = null; slot.healthy = false; slot.consecutiveSamples = 0; }
    if (this.history.get(instrument)?.provider === provider) this.history.delete(instrument);
    if (this.selected.get(instrument)?.provider === provider) this.selected.delete(instrument);
  }

  read(instrument: string): ReferenceSelection {
    const now = this.now();
    const available = [...this.slots.values()].filter(s => s.admission.instrument.id === instrument && this.allowed(s)
      && s.healthy && s.quote && this.valid(s.quote, s.admission, now));
    // Prefer latest published DAILY observation; never let an old release override a newer one.
    available.sort((a, b) => (a.quote!.kind === 'daily_reference' ? sourceTime(b.quote!)! - sourceTime(a.quote!)! : 0)
      || a.admission.priority - b.admission.priority || a.admission.provider.localeCompare(b.admission.provider));
    const groups = new Set(available.map(s => s.admission.lineage).filter((g): g is string => typeof g === 'string' && g.trim().length > 0));
    const result: ReferenceSelection = {
      status: 'unavailable', quote: null, lastKnown: this.history.has(instrument) ? { ...this.history.get(instrument)! } : null,
      availableProviders: available.map(s => s.admission.provider), verifiedIndependentSources: groups.size,
      redundant: groups.size >= 2, executionAllowed: false,
    };
    for (let i = 0; i < available.length; i++) for (let j = i + 1; j < available.length; j++) {
      const a = available[i].quote!, b = available[j].quote!;
      const gap = Math.abs(sourceTime(a)! - sourceTime(b)!);
      if ((a.kind === 'daily_reference' && gap !== 0) || (a.kind !== 'daily_reference' && gap > this.comparableWindow)) continue;
      const x = Number(a.priceDecimal), y = Number(b.priceDecimal), scale = Math.max(Math.abs(x), Math.abs(y));
      const bps = scale === 0 ? 0 : Math.abs(x / scale - y / scale) * 10_000;
      if (bps > this.divergence) return { ...result, status: 'conflict', redundant: false };
    }
    if (!available.length) return result;
    let winner = available[0];
    const selected = this.selected.get(instrument);
    const incumbent = selected && available.find(s => s.admission.provider === selected.provider);
    if (incumbent && incumbent !== winner && winner.quote!.kind !== 'daily_reference'
      && (winner.consecutiveSamples < this.failbackSamples || now - selected!.selectedAt < this.hold)) winner = incumbent;
    if (selected?.provider !== winner.admission.provider) this.selected.set(instrument, { provider: winner.admission.provider, selectedAt: now });
    const quote = { ...winner.quote! };
    this.history.set(instrument, quote);
    return { ...result, status: quote.marketState === 'closed' ? 'market_closed' : 'available', quote: { ...quote }, lastKnown: null };
  }
}
