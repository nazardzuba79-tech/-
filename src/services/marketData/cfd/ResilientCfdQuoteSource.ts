import { CFD_REFERENCE_CATALOG } from './catalog';
import { assertCfdFreshQuote, CfdQuoteUnavailable, quoteAgeLimit, type CfdQuote, type CfdQuoteSource } from './CfdQuote';

export interface CfdProviderAdmission {
  id: string;
  source: CfdQuoteSource;
  priority: number;
  /** Distinct non-empty lineage values are treated as independent delivery sources. */
  lineage: string;
  enabled: boolean;
  /** Contract/ticket/agreement evidence identifier, never an API secret. */
  admissionEvidence: string;
}
export interface ResilientCfdOptions {
  now?: () => number;
  maxQuoteAgeMs?: number;
  providerWaitMs?: number;
  maxDivergenceBps?: number;
  comparableWindowMs?: number;
  failbackSamples?: number;
  failbackHoldMs?: number;
  /** New positions need this many independently admitted/configured lineages.
   * Risk quotes (close/liquidation) may still use one healthy source so a
   * provider outage never traps an already-open position. */
  minExecutionLineages?: number;
}
interface Candidate { admission: CfdProviderAdmission; quote: CfdQuote; }
interface Selected { provider: string; selectedAt: number; }
interface Recovery { lastTimestamp: number | null; samples: number; }

function positiveInt(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function priceOf(q: CfdQuote): number { return Number(q.lastDecimal ?? q.last); }

/**
 * Financial quote router. Unlike ReferenceQuoteRouter this DOES implement
 * CfdQuoteSource and is therefore intentionally much stricter:
 * - a provider is invisible unless an explicit admission-evidence ID exists;
 * - every quote still has to pass the shared execution/risk freshness gate;
 * - independent fresh providers that materially disagree quarantine the symbol;
 * - provider failure switches immediately, while return to a higher-priority
 *   source requires distinct healthy samples plus a hold time;
 * - losing redundancy blocks NEW positions, but one admitted fresh source may
 *   still safely mark/close/liquidate existing positions.
 */
export class ResilientCfdQuoteSource implements CfdQuoteSource {
  readonly maxQuoteAgeMs: number;
  private readonly providers: CfdProviderAdmission[];
  private readonly now: () => number;
  private readonly providerWaitMs: number;
  private readonly divergence: number;
  private readonly comparableWindowMs: number;
  private readonly failbackSamples: number;
  private readonly failbackHoldMs: number;
  private readonly minExecutionLineages: number;
  private readonly selected = new Map<string, Selected>();
  private readonly recovery = new Map<string, Recovery>();
  private readonly failures = new Map<string, { count: number; lastAt: number | null; lastReason: string | null }>();

  constructor(admissions: readonly CfdProviderAdmission[], options: ResilientCfdOptions = {}) {
    if (admissions.length < 1 || admissions.length > 8) throw new Error('Invalid CFD provider set');
    const ids = new Set<string>();
    this.providers = admissions.map(a => ({ ...a, admissionEvidence: a.admissionEvidence.trim(), lineage: a.lineage.trim() }));
    for (const p of this.providers) {
      if (!p.id || ids.has(p.id) || !Number.isSafeInteger(p.priority) || !p.lineage) throw new Error('Invalid CFD provider admission');
      ids.add(p.id);
    }
    this.now = options.now ?? (() => Date.now());
    this.maxQuoteAgeMs = quoteAgeLimit(options.maxQuoteAgeMs ?? Math.min(...this.providers.map(p => p.source.maxQuoteAgeMs)));
    this.providerWaitMs = Math.max(100, Math.min(5_000, options.providerWaitMs ?? 1_200));
    this.divergence = options.maxDivergenceBps ?? 100;
    this.comparableWindowMs = options.comparableWindowMs ?? 5_000;
    this.failbackSamples = options.failbackSamples ?? 3;
    this.failbackHoldMs = options.failbackHoldMs ?? 30_000;
    this.minExecutionLineages = options.minExecutionLineages ?? 2;
    if (!Number.isFinite(this.divergence) || this.divergence < 0 || !positiveInt(this.failbackSamples)
      || !Number.isSafeInteger(this.comparableWindowMs) || this.comparableWindowMs < 0
      || !Number.isSafeInteger(this.failbackHoldMs) || this.failbackHoldMs < 0
      || !positiveInt(this.minExecutionLineages) || this.minExecutionLineages > admissions.length) throw new Error('Invalid CFD routing policy');
  }

  private active(): CfdProviderAdmission[] {
    return this.providers.filter(p => p.enabled && p.admissionEvidence.length > 0 && p.source.isConfigured());
  }
  private admittedLineages(active = this.active()): number { return new Set(active.map(p => p.lineage)).size; }
  private executionRedundancy(active = this.active()): boolean { return this.admittedLineages(active) >= this.minExecutionLineages; }
  isConfigured(): boolean { return this.active().length > 0; }

  private async bounded<T>(p: Promise<T>): Promise<T | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([p.catch(() => null), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), this.providerWaitMs); })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private valid(admission: CfdProviderAdmission, quote: CfdQuote | undefined, symbol: string): Candidate | null {
    try {
      assertCfdFreshQuote(quote, symbol, this.maxQuoteAgeMs, this.now());
      if (!quote || quote.provider !== admission.id) return null;
      return { admission, quote };
    } catch { return null; }
  }

  private noteFailure(provider: string, symbol: string, reason: string): void {
    const key = `${provider}:${symbol}`, prev = this.failures.get(key) ?? { count: 0, lastAt: null, lastReason: null };
    this.failures.set(key, { count: prev.count + 1, lastAt: this.now(), lastReason: reason });
  }

  private conflict(candidates: Candidate[]): boolean {
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      if (a.admission.lineage === b.admission.lineage) continue;
      const at = a.quote.providerTimestamp!, bt = b.quote.providerTimestamp!;
      if (Math.abs(at - bt) > this.comparableWindowMs) continue;
      const x = priceOf(a.quote), y = priceOf(b.quote), scale = Math.max(Math.abs(x), Math.abs(y));
      const bps = scale === 0 ? 0 : Math.abs(x - y) / scale * 10_000;
      if (!Number.isFinite(bps) || bps > this.divergence) return true;
    }
    return false;
  }

  private choose(symbol: string, candidates: Candidate[], active: CfdProviderAdmission[]): CfdQuote {
    if (!candidates.length) throw new CfdQuoteUnavailable('all_providers_unavailable');
    if (this.conflict(candidates)) {
      for (const c of candidates) this.noteFailure(c.admission.id, symbol, 'provider_conflict');
      throw new CfdQuoteUnavailable('provider_conflict');
    }
    candidates.sort((a, b) => Number(b.quote.executionAllowed) - Number(a.quote.executionAllowed)
      || a.admission.priority - b.admission.priority || a.admission.id.localeCompare(b.admission.id));
    let winner = candidates[0];
    const selected = this.selected.get(symbol);
    const incumbent = selected ? candidates.find(c => c.admission.id === selected.provider) : undefined;
    if (incumbent && incumbent !== winner && winner.admission.priority < incumbent.admission.priority
      && winner.quote.executionAllowed === incumbent.quote.executionAllowed) {
      const key = `${winner.admission.id}:${symbol}`;
      const r = this.recovery.get(key) ?? { lastTimestamp: null, samples: 0 };
      if (winner.quote.providerTimestamp !== r.lastTimestamp) { r.lastTimestamp = winner.quote.providerTimestamp; r.samples++; this.recovery.set(key, r); }
      if (r.samples < this.failbackSamples || this.now() - selected!.selectedAt < this.failbackHoldMs) winner = incumbent;
    }
    if (!selected || selected.provider !== winner.admission.id) {
      this.selected.set(symbol, { provider: winner.admission.id, selectedAt: this.now() });
      for (const key of [...this.recovery.keys()]) if (key.endsWith(`:${symbol}`)) this.recovery.delete(key);
    }
    return { ...winner.quote, executionAllowed: winner.quote.executionAllowed && this.executionRedundancy(active) };
  }

  async getFreshQuote(symbol: string): Promise<CfdQuote> {
    const active = this.active();
    if (!active.length) throw new CfdQuoteUnavailable('no_admitted_provider');
    const rows = await Promise.all(active.map(async admission => {
      const quote = await this.bounded(admission.source.getFreshQuote(symbol));
      const valid = this.valid(admission, quote ?? undefined, symbol);
      if (!valid) this.noteFailure(admission.id, symbol, quote ? 'invalid_or_stale' : 'unavailable_or_timeout');
      return valid;
    }));
    return this.choose(symbol, rows.filter((x): x is Candidate => x !== null), active);
  }

  async getQuotes(): Promise<CfdQuote[]> {
    const active = this.active();
    if (!active.length) return CFD_REFERENCE_CATALOG.map(i => this.missing(i.symbol));
    const batches = await Promise.all(active.map(async admission => ({ admission, quotes: await this.bounded(admission.source.getQuotes()) })));
    return CFD_REFERENCE_CATALOG.map(i => {
      const candidates: Candidate[] = [];
      for (const batch of batches) {
        const quote = batch.quotes?.find(q => q.symbol === i.symbol);
        const valid = this.valid(batch.admission, quote, i.symbol);
        if (valid) candidates.push(valid);
      }
      try { return this.choose(i.symbol, candidates, active); }
      catch { return this.missing(i.symbol); }
    });
  }

  private missing(symbol: string): CfdQuote {
    const catalog = CFD_REFERENCE_CATALOG.find(i => i.symbol === symbol)!;
    return { provider: 'multi-provider', symbol, providerSymbol: catalog.providerSymbol, bid: null, ask: null, mid: null, last: null,
      providerTimestamp: null, fetchedAt: null, stale: false, status: 'unavailable', referenceStatus: 'unavailable',
      entitlementVerified: false, executionAllowed: false, changePercent24h: undefined };
  }

  catalog() {
    const active = this.active(), redundant = this.executionRedundancy(active);
    return CFD_REFERENCE_CATALOG.map(row => {
      const providerRows = active.flatMap(p => {
        const source: any = p.source as any;
        if (typeof source.catalog !== 'function') return [];
        const item = source.catalog().find((x: any) => x.symbol === row.symbol);
        return item ? [{ provider: p.id, lineage: p.lineage, entitlement: item.entitlement, executionAllowed: item.executionAllowed === true }] : [];
      });
      return { ...row, providers: providerRows, entitlement: providerRows.some(p => p.entitlement === 'verified') ? 'verified' : 'entitlement_required',
        executionAllowed: redundant && providerRows.some(p => p.executionAllowed) };
    });
  }

  async diagnostics() {
    const active = this.active();
    const providerDiagnostics = await Promise.all(this.providers.map(async p => {
      const source: any = p.source as any;
      let details: unknown = null;
      if (typeof source.diagnostics === 'function') { try { details = await source.diagnostics(); } catch { details = { unavailable: true }; } }
      return { id: p.id, priority: p.priority, lineage: p.lineage, enabled: p.enabled, admissionEvidenceConfigured: Boolean(p.admissionEvidence),
        sourceConfigured: p.source.isConfigured(), active: active.includes(p), details };
    }));
    return { maxQuoteAgeMs: this.maxQuoteAgeMs, providerWaitMs: this.providerWaitMs, maxDivergenceBps: this.divergence,
      minExecutionLineages: this.minExecutionLineages, admittedLineages: this.admittedLineages(active), executionRedundancyConfigured: this.executionRedundancy(active),
      selected: Object.fromEntries([...this.selected.entries()]), failures: Object.fromEntries([...this.failures.entries()]), providers: providerDiagnostics };
  }
}
