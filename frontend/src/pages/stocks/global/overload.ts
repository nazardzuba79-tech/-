export type StockOverloadCode = 'RATE_LIMIT' | 'ACCOUNT_BUSY' | 'SOURCE_BUSY';
export type StockOverloadState = { code: StockOverloadCode; retryAt: number; recovering: boolean };
export type StockReadResult = { kind: 'ready' | 'failed' } | { kind: 'overload' | 'prior-overload'; code: StockOverloadCode; retryAfterMs?: unknown };
export const stockOverloadCode = (value: unknown): StockOverloadCode | null =>
  value === 'RATE_LIMIT' || value === 'ACCOUNT_BUSY' || value === 'SOURCE_BUSY' ? value : null;
export function stockOverloadText(code: StockOverloadCode) {
  return code === 'RATE_LIMIT' ? 'Достигнут лимит запросов источника. Автообновление приостановлено.'
    : code === 'ACCOUNT_BUSY' ? 'Тестовый счёт занят. Автообновление приостановлено.'
      : 'Источник котировок занят. Автообновление приостановлено.';
}
export function stockCooldownMs(code: StockOverloadCode, hint?: unknown) {
  const minimum = code === 'RATE_LIMIT' ? 60000 : 3000;
  return typeof hint === 'number' && Number.isFinite(hint) ? Math.min(60000, Math.max(minimum, hint)) : minimum;
}

// A latched circuit, not an automatic retry loop. Only a user action begins a
// bounded read-only recovery. All queued callbacks are invalidated on session change.
export class StockOverloadCircuit {
  state: StockOverloadState | null = null;
  private generation = 0;
  private cancelWait?: () => void;
  constructor(private readonly changed: (state: StockOverloadState | null) => void,
    private readonly hidden: () => boolean, private readonly now = Date.now) {}
  get paused() { return this.state !== null; }
  private publish(state: StockOverloadState | null) { this.state = state; this.changed(state); }
  trip(value: unknown, hint?: unknown) {
    const code = stockOverloadCode(value); if (!code) return false;
    if (this.state && !this.state.recovering && (this.state.code === 'RATE_LIMIT' || code !== 'RATE_LIMIT')) return true;
    this.generation++; this.cancelWait?.();
    this.publish({ code, retryAt: this.now() + stockCooldownMs(code, hint), recovering: false });
    return true;
  }
  reset(notify = true) {
    this.generation++; this.cancelWait?.(); this.state = null;
    if (notify) this.changed(null);
  }
  cancelRecovery() {
    if (!this.state?.recovering) return;
    this.generation++; this.cancelWait?.(); this.publish({ ...this.state, recovering: false });
  }
  private wait(ms: number): Promise<boolean> {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.cancelWait = undefined; resolve(true); }, ms);
      this.cancelWait = () => { clearTimeout(timer); this.cancelWait = undefined; resolve(false); };
    });
  }
  async recover(stateRead: () => Promise<StockReadResult>, historyRead: () => Promise<StockReadResult>) {
    const previous = this.state;
    if (!previous || previous.recovering || this.hidden() || this.now() < previous.retryAt) return false;
    const generation = ++this.generation;
    const current = () => generation === this.generation && !this.hidden();
    this.publish({ ...previous, recovering: true });
    const safe = async (read: () => Promise<StockReadResult>): Promise<StockReadResult> => { try { return await read(); } catch { return { kind: 'failed' }; } };
    const fail = (result: StockReadResult) => {
      if (!current()) return false;
      this.trip('code' in result ? result.code : previous.code, 'retryAfterMs' in result ? result.retryAfterMs : undefined);
      return false;
    };
    let [state, history] = await Promise.all([safe(stateRead), safe(historyRead)]);
    if (!current()) return false;
    if (history.kind !== 'ready') return fail(history);
    if (state.kind === 'prior-overload') {
      // GET state renews the existing quote lease. Allow one server poll tick to
      // clear a previous quote error; do not POST refresh or replay a pending order.
      if (!await this.wait(3500) || !current()) return false;
      state = await safe(stateRead);
    }
    if (!current()) return false;
    if (state.kind !== 'ready') return fail(state);
    this.publish(null); return true;
  }
}
