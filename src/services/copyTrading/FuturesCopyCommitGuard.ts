import BigNumber from 'bignumber.js';
import type { NativeAccount, } from '../../private-trading/native/store';
import type { NativeCommitGuard } from '../../private-trading/native/service';

const n = (value: string) => new BigNumber(value);
export class FuturesCopyGuardError extends Error {
  constructor(readonly code: string) { super(code); }
}
export type FuturesCopyCommitLimits = {
  action: 'OPEN' | 'CLOSE';
  symbol: string;
  positionId?: string;
  /** The exact follower quantity requested, not the leader's source quantity. */
  requestedQuantity: string;
  sourcePrice: string;
  maxDeviationBps: string;
  maxFillUsdt: string;
  maxTotalExposureUsdt: string;
  maxLeverage: string;
  stillEnabled?: () => boolean;
};
const positive = (x: string) => /^([1-9][0-9]*|0[.][0-9]*[1-9][0-9]*|[1-9][0-9]*[.][0-9]+)$/.test(x) && n(x).gt(0);
/** A synchronous replay guard. It runs before the Native Demo CAS commit.
 * It never trusts prices from a leader as a follower's execution prices.
 */
export function futuresCopyCommitGuard(limits: FuturesCopyCommitLimits): NativeCommitGuard {
  for (const value of [limits.requestedQuantity, limits.sourcePrice, limits.maxFillUsdt,
    limits.maxTotalExposureUsdt, limits.maxLeverage]) {
    if (!positive(value)) throw new FuturesCopyGuardError('INVALID_COPY_LIMITS');
  }
  if (!/^(0|[1-9][0-9]{0,3})([.][0-9]{1,2})?$/.test(limits.maxDeviationBps)
    || n(limits.maxDeviationBps).gt(10000)) throw new FuturesCopyGuardError('INVALID_SLIPPAGE_LIMIT');
  return (before: Readonly<NativeAccount>, after: Readonly<NativeAccount>, actionId: string | null) => {
    if (!actionId || limits.stillEnabled?.() === false) throw new FuturesCopyGuardError('COPY_EXECUTION_DISABLED');
    if (before.executionMode === 'HISTORICAL_DEMO' || after.executionMode === 'HISTORICAL_DEMO')
      throw new FuturesCopyGuardError('HISTORICAL_FOLLOWER_DENIED');
    const existing = new Set(before.snapshot.events.map(e => e.id));
    const added = after.snapshot.events.filter(e => !existing.has(e.id));
    if (!added.length) throw new FuturesCopyGuardError('FOLLOWER_NOT_FILLED');
    // A copied command must not silently trigger liquidation, unrelated
    // position activity, funding or conditional protective orders.
    if (added.some(e => e.actionId !== actionId || e.kind !== limits.action))
      throw new FuturesCopyGuardError('COPY_UNEXPECTED_LEDGER_EVENT');
    if (added.some(e => !['OBSERVED_BOOK', 'MAKER_MODEL'].includes(e.pricing)
      || e.symbol !== limits.symbol || !e.positionId || !e.price))
      throw new FuturesCopyGuardError('COPY_UNVERIFIED_FILL');
    if (limits.action === 'CLOSE' && added.some(e => e.positionId !== limits.positionId))
      throw new FuturesCopyGuardError('COPY_POSITION_MISMATCH');
    const quantity = added.reduce((sum,e) => sum.plus(e.quantity), n('0'));
    const notional = added.reduce((sum,e) => sum.plus(n(e.quantity).times(e.price!)), n('0'));
    if (!quantity.gt(0) || quantity.gt(limits.requestedQuantity))
      throw new FuturesCopyGuardError('COPY_FILL_QUANTITY_INVALID');
    if (notional.gt(limits.maxFillUsdt)) throw new FuturesCopyGuardError('COPY_FILL_NOTIONAL_EXCEEDED');
    const source = n(limits.sourcePrice);
    for (const fill of added) {
      if (!n(fill.price!).gt(0) || n(fill.price!).minus(source).abs().times(10000).div(source).gt(limits.maxDeviationBps))
        throw new FuturesCopyGuardError('COPY_SLIPPAGE_EXCEEDED');
    }
    // Reject mixing with existing manual positions/orders BEFORE evaluating
    // portfolio exposure so the refusal names the actual segregation rule.
    if (limits.action === 'OPEN' && (
      before.snapshot.positions.some(p=>p.status==='OPEN') ||
      before.snapshot.orders.some(o=>o.status==='OPEN'||o.status==='PARTIALLY_FILLED')
    )) throw new FuturesCopyGuardError('COPY_FOLLOWER_POSITION_NOT_ISOLATED');
    const totalExposure = after.snapshot.positions.filter(p=>p.status==='OPEN').reduce((sum,p) => {
      if (n(p.leverage).gt(limits.maxLeverage)) throw new FuturesCopyGuardError('COPY_LEVERAGE_EXCEEDED');
      const price = BigNumber.maximum(p.entryPrice, p.markPrice);
      return sum.plus(n(p.quantity).times(price));
    }, n('0'));
    const pending = after.snapshot.orders.filter(o => o.status==='OPEN'||o.status==='PARTIALLY_FILLED')
      .reduce((sum,o)=>sum.plus(n(o.remaining).times(n(o.price??'0'))),n('0'));
    if (totalExposure.plus(pending).gt(limits.maxTotalExposureUsdt))
      throw new FuturesCopyGuardError('COPY_TOTAL_EXPOSURE_EXCEEDED');
    if (limits.action === 'OPEN') {
      const beforeIds = new Set(before.snapshot.positions.filter(p=>p.status==='OPEN').map(p=>p.id));
      const preexistingOrders = before.snapshot.orders.some(o => o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED');
      if (beforeIds.size || preexistingOrders || added.some(e=>beforeIds.has(e.positionId!)))
        throw new FuturesCopyGuardError('COPY_FOLLOWER_POSITION_NOT_ISOLATED');
      if (new Set(added.map(e=>e.positionId)).size !== 1)
        throw new FuturesCopyGuardError('COPY_MULTIPLE_POSITIONS_REFUSED');
    } else {
      const prior = before.snapshot.positions.find(p=>p.id===limits.positionId&&p.status==='OPEN');
      if (!prior || quantity.gt(prior.quantity)) throw new FuturesCopyGuardError('COPY_CLOSE_NOT_OWNED');
    }
  };
}
