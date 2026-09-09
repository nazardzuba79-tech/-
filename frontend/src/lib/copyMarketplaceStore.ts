import type { SyntheticCopyTradingResponse } from './syntheticCopyTrading';
import type { KseniaResponse, PublicStrategyIdentity } from './kseniaCopyTrading';

export interface CopyMarketplaceResponse {
  nazar: SyntheticCopyTradingResponse | null;
  ksenia: KseniaResponse | null;
  identities: (PublicStrategyIdentity | null)[] | null;
  generatedAt: string;
  errors: Partial<Record<'nazar' | 'ksenia' | 'identities', string>>;
}
type Section = 'nazar' | 'ksenia' | 'identities';
export interface CopyMarketplaceState {
  nazar: SyntheticCopyTradingResponse | null;
  ksenia: KseniaResponse | null;
  identities: PublicStrategyIdentity[];
  fetchedAt: Record<Section, number | null>;
  stale: Record<Section, boolean>;
  refreshing: boolean;
  settled: boolean;
}
const empty = (): CopyMarketplaceState => ({ nazar: null, ksenia: null, identities: [],
  fetchedAt: { nazar: null, ksenia: null, identities: null },
  stale: { nazar: false, ksenia: false, identities: false }, refreshing: false, settled: false });
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const numbers = (value: unknown, keys: string) => record(value) && keys.split(' ').every(key => finite(value[key]));
const rows = (value: unknown, keys: string, dates: string[] = []) => Array.isArray(value)
  && value.every(row => numbers(row, keys) && dates.every(key => date(row[key])));

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
  return rows(value.equityHistory, 'equity', ['date'])
    && rows(value.aumHistory, 'aum', ['date'])
    && rows(value.dailyResults, 'startEquity endEquity realizedPnl dailyReturn drawdown', ['date'])
    && rows(value.trades, 'entryPrice exitPrice quantity leverage netPnl returnPct holdingTimeMinutes', ['openedAt','closedAt'])
    && value.trades.every((trade: any) => typeof trade.id === 'string' && typeof trade.symbol === 'string' && ['LONG','SHORT'].includes(trade.side))
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

/** Session-memory only, one request and one timer per mounted marketplace.
 * No economics are persisted across a reload or carried into another login.
 * Successful sections replace in place; failures retain their own fetchedAt.
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
  constructor(private fetchSnapshot: (signal: AbortSignal) => Promise<unknown>, private getSession: () => string | null,
    private now: () => number = Date.now) {}

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
  private checkSession() {
    const session = this.getSession();
    if (session === this.session) return;
    this.session = session;
    this.generation++;
    this.controller?.abort(); this.controller = null; this.pending = null;
    this.state = empty(); this.lastAttempt = -Infinity;
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
      void this.refresh();
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
    if (this.now() - this.lastAttempt < 30_000) return this.pending ?? Promise.resolve();
    return this.refresh();
  };
  refresh = (): Promise<void> => {
    this.checkSession();
    if (!this.session) return Promise.resolve();
    if (this.pending) return this.pending;
    // Collapse StrictMode mount/focus/prefetch bursts; route returns still
    // revalidate once outside this short window, without clearing any data.
    if (this.now() - this.lastAttempt < 1000) return Promise.resolve();
    this.lastAttempt = this.now();
    const generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    this.emit({ ...this.state, refreshing: true });
    this.pending = Promise.resolve().then(() => this.fetchSnapshot(controller.signal)).then(payload => {
      if (generation !== this.generation || this.getSession() !== this.session) return;
      if (!record(payload) || !date(payload.generatedAt)) throw new Error('Invalid marketplace response');
      const next = { ...this.state, refreshing: false, settled: true,
        fetchedAt: { ...this.state.fetchedAt }, stale: { ...this.state.stale } };
      for (const section of ['nazar','ksenia','identities'] as const) {
        const value = payload[section];
        const valid = !payload.errors?.[section] && (section === 'identities' ? validIdentities(value)
          : validStrategy(value, section === 'nazar' ? 'VX-001' : 'VX-KSENIA'));
        if (valid) {
          if (section === 'identities') next.identities = value.filter((i: PublicStrategyIdentity | null) => i !== null);
          else if (section === 'nazar') next.nazar = value;
          else next.ksenia = value;
          next.fetchedAt[section] = this.now();
        }
        next.stale[section] = !valid;
      }
      this.emit(next);
    }).catch(() => {
      if (generation === this.generation && this.getSession() === this.session) this.emit({ ...this.state,
        refreshing: false, settled: true, stale: { nazar: true, ksenia: true, identities: true } });
    }).finally(() => {
      clearTimeout(timeout);
      if (generation === this.generation) { this.pending = null; this.controller = null; }
    });
    return this.pending;
  };
}
