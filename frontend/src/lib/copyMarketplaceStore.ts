import type { SyntheticCopyTradingResponse } from './syntheticCopyTrading';

/** The marketplace transports display rows, not history. Ten is what the
 *  trade table shows; anything longer is a payload regression. */
export const VISIBLE_TRADE_ROWS = 10;
import type { KseniaResponse, PublicStrategyIdentity } from './kseniaCopyTrading';
import { readSnapshot, writeSnapshot, clearSnapshot, type CachedSnapshot } from './copyMarketplaceCache';

export interface CopyMarketplaceResponse {
  nazar: SyntheticCopyTradingResponse | null;
  ksenia: KseniaResponse | null;
  identities: (PublicStrategyIdentity | null)[] | null;
  generatedAt: string;
  errors: Partial<Record<'nazar' | 'ksenia' | 'identities', string>>;
}
type Section = 'nazar' | 'ksenia' | 'identities';
type PerformancePeriod = '7D' | '30D' | '90D' | 'ALL';

/**
 * WHY A SECTION IS NOT ON SCREEN — for whoever has to fix it.
 *
 * "Данные недоступны" is all a visitor should ever read, but it is useless
 * to a developer: the card looks identical whether the session expired, the
 * request timed out, the server dropped one strategy, or the payload came
 * back in a shape this build refuses. Each of those needs a different fix,
 * and until now the only way to tell them apart was to reproduce it.
 *
 * These are closed, non-identifying labels. They carry no token, no account,
 * no URL and no server text — `server_unavailable` is the server's own
 * generic word for "this section failed", never its exception. Nothing here
 * is rendered: the UI reads `nazar`/`ksenia`, never this.
 */
export type SectionDiagnosis =
  | 'ok'                  // on screen, from this session's own response
  | 'loading'             // asked; no answer yet on this visit
  | 'unauthenticated'     // no session token to ask with
  | 'network'             // the request never completed
  | 'timeout'             // it completed by being abandoned at 15s
  | 'http_error'          // the server answered, but not with a payload
  | 'malformed_envelope'  // a 200 that is not a marketplace response at all
  | 'server_unavailable'  // the server itself marked this section failed
  | 'rejected_by_client'; // the section arrived and this build refuses it

/**
 * A failure that already knows what it was.
 *
 * The fetcher knows things the store cannot infer — that there was no token
 * to send, that the server answered 503 — so it says so here rather than
 * throwing a string the store would have to parse. The message carries no
 * URL, no token and no server text; the label IS the message.
 */
export class MarketplaceFailure extends Error {
  constructor(readonly diagnosis: SectionDiagnosis) {
    super(diagnosis);
    this.name = 'MarketplaceFailure';
  }
}
/** Anything that reached us without a label. A rejected `fetch` is the
 *  network; there is nothing else it can be by the time it gets here. */
function classifyFetchFailure(error: unknown): SectionDiagnosis {
  return (error as { name?: string } | null)?.name === 'AbortError' ? 'timeout' : 'network';
}
export interface CopyMarketplaceState {
  nazar: SyntheticCopyTradingResponse | null;
  ksenia: KseniaResponse | null;
  identities: PublicStrategyIdentity[];
  fetchedAt: Record<Section, number | null>;
  stale: Record<Section, boolean>;
  refreshing: boolean;
  settled: boolean;
  /** Developer diagnosis per section. Never rendered — see SectionDiagnosis. */
  diagnosis: Record<Section, SectionDiagnosis>;
}
const empty = (): CopyMarketplaceState => ({ nazar: null, ksenia: null, identities: [],
  fetchedAt: { nazar: null, ksenia: null, identities: null },
  stale: { nazar: false, ksenia: false, identities: false }, refreshing: false, settled: false,
  diagnosis: { nazar: 'loading', ksenia: 'loading', identities: 'loading' } });
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const numbers = (value: unknown, keys: string) => record(value) && keys.split(' ').every(key => finite(value[key]));
const rows = (value: unknown, keys: string, dates: string[] = []) => Array.isArray(value)
  && value.every(row => numbers(row, keys) && dates.every(key => date(row[key])));

const KSENIA_REPORTED_TRADE_ID = 'KS-REPORTED-20260916-BTC';
const KSENIA_REPORTED_CLOSE_DATE = '2026-09-16';
const PERIOD_DAYS: Record<Exclude<PerformancePeriod, 'ALL'>, number> = { '7D': 7, '30D': 30, '90D': 90 };
function reportedKseniaTrade(value: unknown, strategyId: string): value is Record<string, any> {
  if (strategyId !== 'VX-KSENIA' || !record(value) || value.id !== KSENIA_REPORTED_TRADE_ID
    || value.source !== 'OWNER_REPORTED' || value.marketSymbol !== 'BTCUSDT' || value.side !== 'SHORT'
    || value.result !== 'WIN' || value.leverage !== 10 || value.netPnl !== 1754 || value.returnPct !== 7.8
    || value.openedOn !== '2026-09-15' || value.closedOn !== KSENIA_REPORTED_CLOSE_DATE) return false;
  // Exact prices, size, intraday timestamps and holding duration were not
  // supplied. They must stay absent so the existing formatters render “—”.
  return ['entryPrice','exitPrice','quantity','holdingTimeMinutes','grossPnl','fees','funding','riskR']
    .every(key => value[key] === undefined);
}
/**
 * The payload's own DECLARATION that an owner-reported trade is folded into
 * its aggregates.
 *
 * This is deliberately separate from whether the trade's ROW is still one of
 * the ten the table renders. The strategy closes a trade every few hours, so
 * the reported row scrolls out of the display window within about a week —
 * but it stays counted in totals until it leaves each rolling period, and the
 * holding-time aggregate stays unknowable for as long as it is counted,
 * because that one trade's duration was never supplied.
 *
 * Tying the two together is what broke the card: the server deletes the
 * aggregate for every period that still contains the trade, the row scrolls
 * away, and the section then fails validation and is dropped wholesale —
 * taking ROI 7D, the profile and the history with it.
 *
 * Every known field is pinned and every unknown one must be an explicit
 * `null`, so this cannot be used to smuggle a payload with fields simply
 * missing.
 */
function reportedKseniaPerformance(value: Record<string, any>, strategyId: string): boolean {
  if (strategyId !== 'VX-KSENIA' || !Array.isArray(value.reportedPerformance)
    || value.reportedPerformance.length !== 1) return false;
  const entry = value.reportedPerformance[0];
  if (!record(entry) || entry.id !== KSENIA_REPORTED_TRADE_ID || entry.source !== 'OWNER_REPORTED'
    || entry.market !== 'BTCUSDT' || entry.side !== 'SHORT' || entry.leverage !== 10
    || entry.netPnl !== 1754 || entry.returnPct !== 7.8
    || entry.openedOn !== '2026-09-15' || entry.closedOn !== KSENIA_REPORTED_CLOSE_DATE) return false;
  return ['entryPrice','exitPrice','quantity','openedAt','closedAt','fees','funding']
    .every(key => entry[key] === null);
}
/** The reported row can justify an unknown holding-time aggregate only for a
 * period that actually still counts the trade. A valid declaration is not a
 * blanket permission to omit unrelated period aggregates. This mirrors the
 * backend's strict cutoff rule: closeDate > endDate - periodDays. */
function reportedKseniaCountsInPeriod(value: Record<string, any>, period: PerformancePeriod): boolean {
  const end = value.simulation?.simulatedAt?.slice?.(0, 10);
  if (typeof end !== 'string' || end < KSENIA_REPORTED_CLOSE_DATE) return false;
  if (period === 'ALL') return true;
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const closeMs = Date.parse(`${KSENIA_REPORTED_CLOSE_DATE}T00:00:00Z`);
  return Number.isFinite(endMs) && closeMs > endMs - PERIOD_DAYS[period] * 86_400_000;
}
/**
 * The server's DECLARATION that it withheld the executions.
 *
 * Without this the redacted payload is indistinguishable from a broken one:
 * `trades: []` on a strategy with 465 trades is exactly what a truncated or
 * half-built response looks like, and the client would rightly drop the
 * whole card — which is the failure mode this file already exists to
 * prevent. So the omission has to be stated, not inferred.
 *
 * It is checked strictly. `mode` and `reason` are exact, and the periods it
 * excuses must be real period names — a declaration cannot be a blanket
 * permission to omit whatever the payload happens to be missing.
 *
 * NOTHING FINANCIAL IS RELAXED BY IT. Every ROI, PnL, gross profit/loss,
 * net total, trade count, drawdown and volatility is still required to be a
 * finite number, in every period, exactly as before. The only thing this
 * can excuse is the HOLDING-TIME aggregate, which is a duration rather than
 * a financial figure, and only for the periods it names.
 */
function hiddenTradeHistory(value: Record<string, any>): boolean {
  const visibility = value.tradeVisibility;
  return record(visibility) && visibility.mode === 'HIDDEN' && visibility.reason === 'OWNER_RESTRICTED'
    && Array.isArray(visibility.holdingTimeUnknownPeriods)
    && visibility.holdingTimeUnknownPeriods.every((period: unknown) =>
      typeof period === 'string' && ['7D', '30D', '90D', 'ALL'].includes(period));
}
function holdingTimeMayBeUnknown(value: Record<string, any>, period: PerformancePeriod): boolean {
  return hiddenTradeHistory(value) && value.tradeVisibility.holdingTimeUnknownPeriods.includes(period);
}

function visibleTrade(value: unknown, strategyId: string): value is Record<string, any> {
  if (reportedKseniaTrade(value, strategyId)) return true;
  return record(value)
    && numbers(value, 'entryPrice exitPrice quantity leverage netPnl returnPct holdingTimeMinutes')
    && date(value.openedAt) && date(value.closedAt)
    && typeof value.id === 'string' && typeof value.symbol === 'string' && ['LONG','SHORT'].includes(value.side);
}
function closeTime(value: Record<string, any>): number {
  if (value.id === KSENIA_REPORTED_TRADE_ID) return Date.parse(`${value.closedOn}T23:59:59.999Z`);
  return Date.parse(value.closedAt);
}

/** Validate at the network boundary, before any projection/formatting. Never
 * coerce null, strings, missing arrays, or a different trader into real zeros.
 * Reject a malformed section independently, preserving its last-good value. */
export function validStrategy(value: unknown, id: string): value is SyntheticCopyTradingResponse {
  if (!record(value) || !record(value.trader) || value.trader.id !== id || typeof value.trader.name !== 'string'
    || !record(value.simulation) || !date(value.simulation.simulatedAt) || !finite(value.simulation.seed)) return false;
  if (!numbers(value.analytics, 'roi7 roi30 roi90 roiAll winRate maximumDrawdown aum activeFollowers tradingVolume followerPnl7 followerPnl30 followerPnl90')
    || !numbers(value.analytics.allTime, 'roi pnl winningTrades losingTrades totalTrades winRate maximumDrawdown followersPnl tradingDays aum')) return false;
  const economics = value.economics;
  if (!record(economics) || !finite(economics.performanceFeeRate) || !record(economics.periods)
    || !['DAILY_TWR', 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN'].includes(economics.methodology)) return false;
  if (!['7D','30D','90D','ALL'].every(period => {
    const metrics = economics.periods[period];
    return numbers(metrics, 'roi masterPnl masterTradingVolume copiedTradingVolume grossFollowersPnl performanceFeeEarnings netFollowersPnl activeTradingDays calendarDays maximumDrawdown annualizedVolatility')
      && ['sharpe','sortino','profitFactor'].every(key => metrics[key] === null || finite(metrics[key]));
  })) return false;
  // The visible trade rows: at most ten, newest first. Canonical rows remain
  // fully formed. The single owner-reported Ksenia row is intentionally
  // partial only where the operator did not provide the underlying facts.
  // Counted, not necessarily on screen. See reportedKseniaPerformance.
  const hidden = hiddenTradeHistory(value);
  // With the executions withheld there is no reported ROW and no reported
  // BLOCK to read — redaction removes both, deliberately, because one
  // owner-reported execution is still an execution. The declaration takes
  // over that job for exactly the periods it names.
  const reportedPresent = hidden
    || (Array.isArray(value.trades) && value.trades.some((trade: unknown) => reportedKseniaTrade(trade, id)))
    || reportedKseniaPerformance(value, id);
  const visibleTrades = Array.isArray(value.trades)
    && value.trades.length <= VISIBLE_TRADE_ROWS
    && value.trades.every((trade: unknown) => visibleTrade(trade, id))
    && value.trades.every((trade: any, index: number) => index === 0
      || closeTime(value.trades[index - 1]) >= closeTime(trade));
  const tradeStats = record(value.tradeStats)
    && (['7D','30D','90D','ALL'] as PerformancePeriod[]).every(period => {
      const stats = (value.tradeStats as any)[period];
      const mayOmitHolding = hidden
        ? holdingTimeMayBeUnknown(value, period)
        : reportedPresent && reportedKseniaCountsInPeriod(value, period);
      return numbers(stats, 'totalTrades winningTrades losingTrades grossProfit grossLoss netPnlTotal')
        && (finite(stats.holdingTimeTotalMinutes) || (mayOmitHolding && stats.holdingTimeTotalMinutes === undefined));
    })
    // The real total must be at least what is shown, or the count under the
    // table would be smaller than the table. When the rows are withheld this
    // still has to be the REAL total — «скрыто» is not «ноль сделок», and a
    // redacted payload that forgot its count would be a bug, not a policy.
    && finite(value.tradeHistoryCount) && (value.tradeHistoryCount as number) >= value.trades.length
    && (value.tradeStats as any).ALL.totalTrades === value.tradeHistoryCount
    // Main Markets is a FULL-HISTORY aggregate. A summary that omits it
    // would leave the profile with nothing but the ten display rows to
    // rank, so the shape is rejected rather than silently downgraded.
    && Array.isArray(value.mainMarkets) && value.mainMarkets.length > 0
    && value.mainMarkets.every((market: unknown) => typeof market === 'string' && market.length > 0);
  return rows(value.equityHistory, 'equity', ['date'])
    && rows(value.aumHistory, 'aum', ['date'])
    && rows(value.dailyResults, 'startEquity endEquity realizedPnl dailyReturn drawdown', ['date'])
    && visibleTrades && tradeStats
    && rows(value.followers, 'allocatedCapital currentEquity realizedPnl unrealizedPnl roi copiedTrades copyRatio slippageBps latencyMs', ['copyStartDate'])
    && value.followers.every((f: any) => typeof f.id === 'string' && typeof f.displayName === 'string' && typeof f.active === 'boolean'
      && ['startingAllocation','grossPnl','performanceFees','netPnl','copiedVolume','highWaterMark'].every(key => f[key] === undefined || finite(f[key])))
    && Array.isArray(value.weekly) && Array.isArray(value.monthly)
    && (id !== 'VX-KSENIA' || (value.provenance === 'SYNTHETIC_REVIEW' && finite(value.traderEarnings365)));
}
function validIdentities(value: unknown): value is (PublicStrategyIdentity | null)[] {
  return Array.isArray(value) && value.length === 2 && value.every((item, index) => item === null || (record(item)
    && item.traderId === ['VX-001','VX-KSENIA'][index] && typeof item.displayName === 'string'
    && typeof item.verified === 'boolean' && typeof item.premium === 'boolean'
    && (item.avatarUrl === null || (typeof item.avatarUrl === 'string' && item.avatarUrl.length <= 300_000
      && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.avatarUrl)))
    && (item.avatarVersion === null || typeof item.avatarVersion === 'string')));
}

/**
 * One request and one timer per mounted marketplace.
 *
 * Successful sections replace in place; a section that fails keeps the value
 * and `fetchedAt` it already had, so one broken section never blanks another.
 *
 * The last CONFIRMED snapshot is also written to browser storage, keyed by a
 * digest of the session token, and read back on the next visit through the
 * same validators the live response passes — so a reload paints the real
 * figures this browser was already given instead of a skeleton, while the
 * live request is in flight behind them. Nothing is persisted that was not
 * validated first, nothing is carried into another login, and the token
 * itself is never written. See copyMarketplaceCache.ts.
 */
export class CopyMarketplaceStore {
  private state = empty();
  private session: string | null = null;
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAttempt = -Infinity;
  /**
   * WHETHER THE LAST ATTEMPT ACTUALLY DELIVERED.
   *
   * `lastAttempt` is stamped when an attempt STARTS, so on its own it cannot
   * tell a request that succeeded from one that failed — and `prefetch()`
   * throttles on it. That is what put «Данные недоступны» on both cards with
   * nothing in flight behind it: the nav-link hover's request failed, the
   * user clicked through inside the thirty-second window, the page mounted,
   * asked for data, and was told it had just asked.
   *
   * A SUCCESS is worth reusing for thirty seconds. A FAILURE is worth
   * nothing, so it is never reused: the next caller that wants data gets a
   * real request. `refresh()`'s own one-second collapse still applies, which
   * is what keeps a StrictMode double-mount from becoming two requests.
   */
  private lastAttemptFailed = false;
  constructor(private fetchSnapshot: (signal: AbortSignal) => Promise<unknown>, private getSession: () => string | null,
    private now: () => number = Date.now,
    /** Injectable so the cache can be driven without a DOM. Undefined means
     *  "use the browser's", null means "there is none". */
    private storage: Parameters<typeof readSnapshot>[1] = undefined) {}

  getState = () => {
    this.checkSession();
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const stale = { ...this.state.stale };
    for (const section of ['nazar','ksenia'] as const) {
      if (this.state[section] && this.state[section]!.simulation.simulatedAt.slice(0, 10) < today) stale[section] = true;
    }
    if (this.state.fetchedAt.identities !== null && this.now() - this.state.fetchedAt.identities >= 60_000) stale.identities = true;
    if (Object.keys(stale).some(key => stale[key as Section] !== this.state.stale[key as Section])) this.state = { ...this.state, stale };
    return this.state;
  };
  /**
   * Re-read the session now. A logout is a client-side route change, not a
   * reload: the marketplace page has already unmounted by the time the token
   * is cleared, so nothing would otherwise ask this store for state, and the
   * snapshot it wrote would stay on disk until the marketplace is next
   * opened. api.ts broadcasts every token change; this is the receiver.
   */
  syncSession = () => { this.checkSession(); };
  private checkSession() {
    const session = this.getSession();
    if (session === this.session) return;
    const previous = this.session;
    this.session = session;
    this.generation++;
    this.controller?.abort(); this.controller = null; this.pending = null;
    this.lastAttempt = -Infinity;
    this.lastAttemptFailed = false;
    // Leaving a session takes its snapshot with it. A logout must not leave
    // one account's figures readable on a shared machine.
    if (previous !== null && session === null) clearSnapshot(previous, this.storage);
    this.state = session === null ? empty() : this.hydrate(session);
  }

  /**
   * The last confirmed snapshot for THIS session, re-validated.
   *
   * Every section goes back through the same validator a live response
   * faces, so a snapshot from an older build or a truncated write is
   * dropped rather than trusted for being ours. `settled` stays false: the
   * figures are real and already confirmed, but this browser has not yet
   * heard from the server on this visit, and the UI is entitled to know
   * that a live answer is still coming.
   */
  private hydrate(session: string): CopyMarketplaceState {
    const snapshot = readSnapshot(session, this.storage);
    if (!snapshot) return empty();
    const state = empty();
    if (validStrategy(snapshot.nazar, 'VX-001')) {
      state.nazar = snapshot.nazar as SyntheticCopyTradingResponse;
      state.fetchedAt.nazar = snapshot.fetchedAt.nazar;
      state.diagnosis.nazar = 'ok';
    }
    if (validStrategy(snapshot.ksenia, 'VX-KSENIA')) {
      state.ksenia = snapshot.ksenia as KseniaResponse;
      state.fetchedAt.ksenia = snapshot.fetchedAt.ksenia;
      state.diagnosis.ksenia = 'ok';
    }
    if (validIdentities(snapshot.identities)) {
      state.identities = snapshot.identities.filter((i): i is PublicStrategyIdentity => i !== null);
      state.fetchedAt.identities = snapshot.fetchedAt.identities;
      state.diagnosis.identities = 'ok';
    }
    return state;
  }

  /** Persist only what is confirmed. A null section is simply absent, so a
   *  later visit restores what was real and nothing else. */
  private persist() {
    if (!this.session) return;
    const { nazar, ksenia, identities, fetchedAt } = this.state;
    if (!nazar && !ksenia && !identities.length) return;
    const snapshot: CachedSnapshot = { nazar, ksenia, identities: identities.length ? identities : null, fetchedAt };
    writeSnapshot(this.session, snapshot, this.storage);
  }
  private emit(state: CopyMarketplaceState) {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
  subscribe = (listener: () => void) => {
    this.checkSession();
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.timer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.refresh();
      }, 60_000);
      if (typeof window !== 'undefined') window.addEventListener('focus', this.onFocus);
      // A completed intent prefetch is useful too: mounting a few seconds
      // later must not throw it away and repeat the bootstrap request.
      void this.prefetch();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        if (typeof window !== 'undefined') window.removeEventListener('focus', this.onFocus);
      }
    };
  };
  private onFocus = () => { void this.refresh(); };
  /** Hover/focus only; no timer or background traffic on unrelated pages. */
  prefetch = () => {
    this.checkSession();
    // An attempt already in flight is the one to wait for, whatever it does.
    if (this.pending) return this.pending;
    // Only a SUCCESSFUL attempt is worth reusing. A failed one must not
    // stand in for the data it did not fetch. See `lastAttemptFailed`.
    if (!this.lastAttemptFailed && this.now() - this.lastAttempt < 30_000) return Promise.resolve();
    return this.refresh();
  };
  refresh = (): Promise<void> => {
    this.checkSession();
    if (!this.session) return Promise.resolve();
    if (this.pending) return this.pending;
    // Collapse StrictMode mount/focus/prefetch bursts; route returns still
    // revalidate once outside this short window, without clearing any data.
    // A failed attempt is exempt: retrying it is the whole point.
    if (!this.lastAttemptFailed && this.now() - this.lastAttempt < 1000) return Promise.resolve();
    this.lastAttempt = this.now();
    const generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    let abandoned = false;
    const timeout = setTimeout(() => { abandoned = true; controller.abort(); }, 15_000);
    this.emit({ ...this.state, refreshing: true });
    this.pending = Promise.resolve().then(() => this.fetchSnapshot(controller.signal)).then(payload => {
      if (generation !== this.generation || this.getSession() !== this.session) return;
      if (!record(payload) || !date(payload.generatedAt)) throw new MarketplaceFailure('malformed_envelope');
      const next = { ...this.state, refreshing: false, settled: true,
        fetchedAt: { ...this.state.fetchedAt }, stale: { ...this.state.stale },
        diagnosis: { ...this.state.diagnosis } };
      for (const section of ['nazar','ksenia','identities'] as const) {
        const value = payload[section];
        const reported = payload.errors?.[section];
        const valid = !reported && (section === 'identities' ? validIdentities(value)
          : validStrategy(value, section === 'nazar' ? 'VX-001' : 'VX-KSENIA'));
        // Which of the two it was matters: the server refusing to produce a
        // section and this build refusing to accept one are different bugs
        // in different places, and they look identical on the card.
        next.diagnosis[section] = valid ? 'ok' : reported ? 'server_unavailable' : 'rejected_by_client';
        if (valid) {
          if (section === 'identities') next.identities = value.filter((i: PublicStrategyIdentity | null) => i !== null);
          else if (section === 'nazar') next.nazar = value;
          else next.ksenia = value;
          next.fetchedAt[section] = this.now();
        }
        next.stale[section] = !valid;
      }
      // Delivered. Worth reusing for the prefetch window — but only if at
      // least one section actually came back usable; a 200 whose every
      // section was rejected is a failure wearing a success's clothes.
      this.lastAttemptFailed = !next.nazar && !next.ksenia && !next.identities.length;
      this.emit(next);
      this.persist();
    }).catch((error: unknown) => {
      this.lastAttemptFailed = true;
      // `controller.abort()` after fifteen seconds and a connection that
      // never opened both surface as one rejection; the flag we set when we
      // fired the timer is what separates them.
      const cause: SectionDiagnosis = error instanceof MarketplaceFailure ? error.diagnosis
        : abandoned ? 'timeout' : classifyFetchFailure(error);
      if (generation === this.generation && this.getSession() === this.session) this.emit({ ...this.state,
        refreshing: false, settled: true, stale: { nazar: true, ksenia: true, identities: true },
        diagnosis: { nazar: cause, ksenia: cause, identities: cause } });
    }).finally(() => {
      clearTimeout(timeout);
      if (generation === this.generation) { this.pending = null; this.controller = null; }
    });
    return this.pending;
  };
}
