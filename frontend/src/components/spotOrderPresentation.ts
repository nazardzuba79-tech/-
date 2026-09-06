/** Presentation arithmetic only: preserve the API's decimal strings instead
 * of rounding small prices to zero or manufacturing floating-point dust. */
type Decimal = { units: bigint; scale: number };
function decimal(value: string): Decimal | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100 || value.length > 256) return null;
  const fraction = match[3] ?? '';
  let units = BigInt((match[1] === '-' ? '-' : '') + match[2] + fraction);
  let scale = fraction.length - exponent;
  if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
  return { units, scale };
}
function render(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, '0');
  const whole = value.scale ? digits.slice(0, -value.scale) : digits;
  const fraction = value.scale ? digits.slice(-value.scale).replace(/0+$/, '') : '';
  return `${negative ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? '.' + fraction : ''}`;
}
export function formatOrderDecimal(value: string | null | undefined): string {
  const parsed = value == null ? null : decimal(value);
  return parsed ? render(parsed) : '—';
}
export function formatOrderDifference(total: string, remaining: string): string {
  const a = decimal(total), b = decimal(remaining);
  if (!a || !b) return '—';
  const scale = Math.max(a.scale, b.scale);
  return render({ units: a.units * 10n ** BigInt(scale - a.scale) - b.units * 10n ** BigInt(scale - b.scale), scale });
}
export function formatOrderProduct(price: string | null, quantity: string): string {
  const a = price == null ? null : decimal(price), b = decimal(quantity);
  return a && b ? render({ units: a.units * b.units, scale: a.scale + b.scale }) : '—';
}
export function formatOrderSum(available: string, locked: string): string {
  const a = decimal(available), b = decimal(locked);
  if (!a || !b) return '—';
  const scale = Math.max(a.scale, b.scale);
  return render({ units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale), scale });
}

export interface SpotOrderRow {
  id: string; pair: string; side: 'BUY' | 'SELL'; type: string;
  price: string | null; triggerPrice: string | null; ocoGroupId: string | null;
  originalQuantity: string; remainingQuantity: string; status: string; createdAt: string;
}
export function spotOrderType(order: SpotOrderRow, t: (key: any) => string): string {
  if (order.ocoGroupId) return t('trade.orderType.OCO');
  switch (order.type) {
    case 'STOP_LIMIT': return `${t('trade.orderType.STOP_LIMIT')} · ${t('trade.orderType.LIMIT')}`;
    case 'STOP_MARKET': return `${t('trade.orderType.STOP_MARKET')} · ${t('trade.orderType.MARKET')}`;
    case 'TAKE_PROFIT_LIMIT': return `${t('trade.orderType.TAKE_PROFIT_LIMIT')} · ${t('trade.orderType.LIMIT')}`;
    case 'TAKE_PROFIT_MARKET': return `${t('trade.orderType.TAKE_PROFIT_MARKET')} · ${t('trade.orderType.MARKET')}`;
    case 'LIMIT': return t('trade.orderType.LIMIT');
    case 'MARKET': return t('trade.orderType.MARKET');
    default: return order.type;
  }
}
export function spotOrderStatus(status: string, t: (key: any) => string): string {
  return ['OPEN', 'PENDING_TRIGGER', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'].includes(status)
    ? t(`trade.status.${status}`) : status;
}

export interface SpotReadController {
  read: (fresh?: boolean) => Promise<void>;
  resume: () => void;
  pause: () => void;
}

/** Periodic polls share one request so a slow response is never starved.
 * A mutation/refresh invalidates that response and queues one immediate read;
 * its returned promise waits for the fresh read as well. */
export function createSpotReadController<T>(request: () => Promise<T>, handlers: {
  accept: (rows: T) => void; reject: () => void; settled: () => void;
}): SpotReadController {
  let enabled = true, revision = 0, queued = false;
  let pending: Promise<void> | null = null;
  function read(fresh = false): Promise<void> {
    if (!enabled) return Promise.resolve();
    if (fresh) { revision++; queued = true; }
    if (pending) return pending;
    // Start in a microtask so even a synchronous request failure cannot leave
    // an already-settled promise stuck in the single-flight slot.
    pending = Promise.resolve().then(async () => {
      if (!enabled) return;
      do {
        queued = false;
        const requestedRevision = revision;
        const current = () => enabled && requestedRevision === revision;
        try { const rows = await request(); if (current()) handlers.accept(rows); }
        catch { if (current()) handlers.reject(); }
        finally { if (current()) handlers.settled(); }
      } while (enabled && queued);
    }).finally(() => {
      pending = null;
      // A forced refresh arriving just as this promise settles still runs.
      if (enabled && queued) return read();
    });
    return pending;
  }
  return { read, resume: () => { enabled = true; }, pause: () => { enabled = false; revision++; queued = false; } };
}

/** Keep real sequential cancels and continue after one rejection. Report the
 * actual outcome, never claim that failed cancellations were successful. */
export function spotOrderCancelIds(orders: Pick<SpotOrderRow, 'id' | 'ocoGroupId'>[]): string[] {
  const groups = new Set<string>();
  return orders.filter(order => {
    // The existing backend cancels both OCO siblings in one transaction.
    // A second DELETE would correctly return 404 for the cancelled sibling.
    if (order.ocoGroupId == null) return true;
    if (groups.has(order.ocoGroupId)) return false;
    groups.add(order.ocoGroupId);
    return true;
  }).map(order => order.id);
}

export async function cancelSpotOrders(ids: string[], cancel: (id: string) => Promise<unknown>) {
  let succeeded = 0, failed = 0;
  for (const id of ids) { try { await cancel(id); succeeded++; } catch { failed++; } }
  return { succeeded, failed };
}
