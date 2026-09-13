import { CFD_REFERENCE_CATALOG } from './catalog';
import type { CfdQuote, CfdQuoteSource } from './CfdQuote';

export interface CfdDisplayProvider {
  id: string;
  priority: number;
  source: Pick<CfdQuoteSource, 'getQuotes'> & { diagnostics?: () => unknown | Promise<unknown> };
}

export interface CfdDisplayQuoteRouterOptions {
  now?: () => number;
  providerWaitMs?: number;
  /** Display freshness is intentionally looser than execution freshness. */
  freshAgeMs?: number;
}

function priceValid(q: CfdQuote | undefined): q is CfdQuote {
  return Boolean(q && q.last !== null && Number.isFinite(q.last) && q.last > 0);
}

function eventTime(q: CfdQuote): number {
  return typeof q.providerTimestamp === 'number' && Number.isFinite(q.providerTimestamp)
    ? q.providerTimestamp
    : typeof q.fetchedAt === 'number' && Number.isFinite(q.fetchedAt) ? q.fetchedAt : -Infinity;
}

function current(q: CfdQuote, now: number, freshAgeMs: number): boolean {
  if (!priceValid(q) || q.referenceStatus !== 'available' || q.stale === true) return false;
  for (const time of [q.providerTimestamp, q.fetchedAt]) {
    if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0 || time > now + 1_000 || now - time > freshAgeMs) return false;
  }
  return true;
}

/**
 * Public-display router only. It is deliberately NOT a CfdQuoteSource because
 * its output must never be injectable into open/close/PnL/liquidation code.
 * Public providers may keep prices visible when the financial source is down,
 * while every returned row is stripped of execution/entitlement permission.
 */
export class CfdDisplayQuoteRouter {
  private readonly providers: CfdDisplayProvider[];
  private readonly now: () => number;
  private readonly providerWaitMs: number;
  readonly freshAgeMs: number;

  constructor(providers: readonly CfdDisplayProvider[], options: CfdDisplayQuoteRouterOptions = {}) {
    const ids = new Set<string>();
    if (providers.length < 1 || providers.length > 8) throw new Error('Invalid CFD display provider set');
    this.providers = providers.map(p => ({ ...p }));
    for (const p of this.providers) {
      if (!p.id || ids.has(p.id) || !Number.isSafeInteger(p.priority)) throw new Error('Invalid CFD display provider');
      ids.add(p.id);
    }
    this.providers.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    this.now = options.now ?? Date.now;
    this.providerWaitMs = Math.max(100, Math.min(5_000, options.providerWaitMs ?? 1_300));
    this.freshAgeMs = Math.max(5_000, Math.min(120_000, options.freshAgeMs ?? 120_000));
  }

  private async bounded(source: CfdDisplayProvider['source']): Promise<CfdQuote[]> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        source.getQuotes().catch(() => []),
        new Promise<CfdQuote[]>(resolve => { timer = setTimeout(() => resolve([]), this.providerWaitMs); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  async getQuotes(): Promise<CfdQuote[]> {
    const now = this.now();
    const batches = await Promise.all(this.providers.map(async p => ({ provider: p, quotes: await this.bounded(p.source) })));
    return CFD_REFERENCE_CATALOG.map(row => {
      const candidates = batches.flatMap(batch => {
        const q = batch.quotes.find(q => q.symbol === row.symbol);
        if (!priceValid(q) || q.providerTimestamp === null || q.fetchedAt === null
          || !Number.isFinite(q.providerTimestamp) || !Number.isFinite(q.fetchedAt)
          || q.providerTimestamp <= 0 || q.fetchedAt <= 0
          || q.providerTimestamp > now + 1_000 || q.fetchedAt > now + 1_000) return [];
        return [{ q, priority: batch.provider.priority, isCurrent: current(q, now, this.freshAgeMs), at: eventTime(q) }];
      });
      candidates.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)
        || (a.isCurrent ? a.priority - b.priority : b.at - a.at)
        || a.priority - b.priority || a.q.provider.localeCompare(b.q.provider));
      const winner = candidates[0]?.q;
      if (!winner) return this.missing(row.symbol, row.providerSymbol);
      return {
        ...winner,
        status: current(winner, now, this.freshAgeMs) ? 'reference_only' as const
          : winner.referenceStatus === 'market_closed' ? 'market_closed' as const : 'stale' as const,
        stale: !current(winner, now, this.freshAgeMs),
        entitlementVerified: false,
        executionAllowed: false,
      };
    });
  }

  /** Financial primary wins when it is a genuinely current display quote.
   * Otherwise a fresher public-display quote may replace it for rendering only. */
  choose(primary: CfdQuote, alternative: CfdQuote | undefined): CfdQuote {
    const now = this.now();
    if (current(primary, now, this.freshAgeMs)) return primary;
    if (alternative && current(alternative, now, this.freshAgeMs)) return alternative;
    if (!priceValid(primary) && priceValid(alternative)) return alternative;
    if (priceValid(primary) && priceValid(alternative) && eventTime(alternative) > eventTime(primary)) return alternative;
    return primary;
  }

  private missing(symbol: string, providerSymbol: string): CfdQuote {
    return { provider:'display-router', symbol, providerSymbol, bid:null, ask:null, mid:null, last:null,
      providerTimestamp:null, fetchedAt:null, stale:false, status:'unavailable', referenceStatus:'unavailable',
      entitlementVerified:false, executionAllowed:false };
  }

  async diagnostics() {
    return { providerWaitMs:this.providerWaitMs, freshAgeMs:this.freshAgeMs, providers:await Promise.all(this.providers.map(async p => {
      let details:unknown=null; if (typeof p.source.diagnostics === 'function') { try { details=await p.source.diagnostics(); } catch { details={unavailable:true}; } }
      return {id:p.id,priority:p.priority,details};
    })) };
  }
}
