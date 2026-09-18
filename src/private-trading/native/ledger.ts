import BigNumber from 'bignumber.js';
import { amount, decimal } from '../math';
import type { DemoEvent, DemoState } from './engine';

/**
 * EVERY CHANGE TO THIS ACCOUNT'S EQUITY, WITH ITS SOURCE AND ITS HISTORY.
 *
 * The engine keeps one number, `walletBalance`, and moves it as trading
 * happens. That number is correct but it is not an explanation: "your
 * balance is 9 994 100" does not say which part was a fee, which was
 * funding, and which was the trade itself. This module turns the engine's
 * own event journal into a ledger that answers that question line by line.
 *
 * The design rule is that the ledger is a PROJECTION, not a second
 * bookkeeping system. Nothing is recomputed from prices here: every figure
 * comes from an event the engine already emitted, and the ledger's closing
 * balance is compared against the engine's `walletBalance` on every read.
 * `reconciled: false` is therefore a real alarm — it means the engine moved
 * money without journaling it, which is exactly the bug a second,
 * independent calculation would hide instead of reveal.
 *
 * Fees and funding appear as their OWN lines. That is what makes the
 * double-counting question answerable: a position's realized result is the
 * sum of its lines here, and each component appears exactly once.
 */

const D = BigNumber.clone({ DECIMAL_PLACES: 36, ROUNDING_MODE: BigNumber.ROUND_HALF_EVEN, EXPONENTIAL_AT: 100 });
const n = (x: string) => decimal(x);
const out = (x: BigNumber) => amount(x);

export type LedgerSource =
  /** The wallet collateral this simulation account started from. */
  | 'INITIAL_COLLATERAL'
  /** Taker/maker fee charged when a position was opened or added to. */
  | 'OPENING_FEE'
  /** Taker/maker fee charged when a position was reduced or closed. */
  | 'CLOSING_FEE'
  /** The fee charged on a forced close. Named apart so it is never read as an ordinary exit. */
  | 'LIQUIDATION_FEE'
  /** Price movement banked on the quantity that left the position. Fees are NOT inside this. */
  | 'REALIZED_PNL'
  /** The custom VOLTEX funding cash-flow, debited or credited at settlement. */
  | 'FUNDING'
  /** A loss (fees included) an isolated settlement realised beyond its post, covered by the simulation insurance model. */
  | 'SHORTFALL_COVER';

export interface LedgerEntry {
  /** Stable across reads: the journal event it came from, plus which component of it. */
  id: string;
  time: number;
  source: LedgerSource;
  /** The journal event kind this line was projected from. */
  kind: DemoEvent['kind'] | 'INITIALIZE';
  positionId: string | null;
  symbol: string | null;
  quantity: string | null;
  price: string | null;
  /** Signed change to the wallet balance. */
  amount: string;
  /** The wallet balance after this line. */
  balanceAfter: string;
}

export interface AccountLedger {
  entries: LedgerEntry[];
  openingBalance: string;
  closingBalance: string;
  totals: {
    realizedPnl: string;
    fees: string;
    funding: string;
    /** SHORTFALL lines: what isolated settlements lost beyond their posts and the account did not pay. */
    shortfallCovered: string;
    /** realizedPnl - fees + funding + shortfallCovered. The whole of what trading did to the balance. */
    net: string;
  };
  /** The engine's own free-cash figure, carried so a caller can see the parts. */
  walletBalance: string;
  /**
   * Free cash PLUS margin posted to open isolated positions. A post is a
   * TRANSFER out of free cash, not an economic event, so it has no ledger
   * line; the ledger's closing balance is therefore the settle balance,
   * and it is this figure the fold is reconciled against.
   */
  settleBalance: string;
  /** closingBalance === settleBalance. False means money moved without a journal entry. */
  reconciled: boolean;
}

/** Events that move money, and how their `cashflow`/`fee` decompose. */
const REDUCING: DemoEvent['kind'][] = ['CLOSE', 'TAKE_PROFIT', 'STOP_LOSS', 'LIQUIDATION'];

/**
 * `state.events` is append-only and chronological, so the fold is the
 * account's history in the order it happened. Events that change no money —
 * CANCEL, LEVERAGE, PROTECTION — produce no line: a ledger of non-events is
 * a ledger nobody reads.
 */
export function accountLedger(state: DemoState): AccountLedger {
  const entries: LedgerEntry[] = [];
  let balance = n(state.initialDeposit);
  let realizedPnl = new D(0), fees = new D(0), funding = new D(0), shortfallCovered = new D(0);

  entries.push({
    id: 'initial', time: state.events[0]?.time ?? state.time, source: 'INITIAL_COLLATERAL', kind: 'INITIALIZE',
    positionId: null, symbol: null, quantity: null, price: null,
    amount: state.initialDeposit, balanceAfter: out(balance),
  });

  const push = (event: DemoEvent, source: LedgerSource, value: BigNumber) => {
    balance = balance.plus(value);
    entries.push({
      id: `${event.id}:${source}`, time: event.time, source, kind: event.kind,
      positionId: event.positionId, symbol: event.symbol,
      quantity: event.quantity === '0' ? null : event.quantity, price: event.price,
      amount: out(value), balanceAfter: out(balance),
    });
  };

  for (const event of state.events) {
    const fee = n(event.fee), cashflow = n(event.cashflow);

    if (event.kind === 'OPEN') {
      // Opening charges a fee and nothing else: `cashflow` IS the negated fee.
      if (fee.isZero()) continue;
      fees = fees.plus(fee);
      push(event, 'OPENING_FEE', fee.negated());
      continue;
    }

    if (event.kind === 'FUNDING') {
      if (cashflow.isZero()) continue;
      funding = funding.plus(cashflow);
      push(event, 'FUNDING', cashflow);
      continue;
    }

    if (event.kind === 'SHORTFALL') {
      // The slice it follows booked its real loss and fee; this line is the
      // part of that settlement the post could not cover and the account did
      // not pay. Positive, and always paired with a reducing event.
      if (cashflow.isZero()) continue;
      shortfallCovered = shortfallCovered.plus(cashflow);
      push(event, 'SHORTFALL_COVER', cashflow);
      continue;
    }

    if (REDUCING.includes(event.kind)) {
      // The engine books `cashflow = gross - fee`, so the gross is recovered
      // rather than recomputed from the price — one source, not two.
      const gross = cashflow.plus(fee);
      if (!gross.isZero()) {
        realizedPnl = realizedPnl.plus(gross);
        push(event, 'REALIZED_PNL', gross);
      }
      if (!fee.isZero()) {
        fees = fees.plus(fee);
        push(event, event.kind === 'LIQUIDATION' ? 'LIQUIDATION_FEE' : 'CLOSING_FEE', fee.negated());
      }
      continue;
    }
    // CANCEL, LEVERAGE, PROTECTION move no money and get no line.
  }

  const closing = out(balance);
  const posted = state.positions.filter((p) => p.status === 'OPEN' && p.marginType === 'ISOLATED').reduce((v, p) => v.plus(p.isolatedMargin), new D(0));
  const settleBalance = out(n(state.walletBalance).plus(posted));
  return {
    entries, openingBalance: state.initialDeposit, closingBalance: closing,
    totals: {
      realizedPnl: out(realizedPnl), fees: out(fees), funding: out(funding), shortfallCovered: out(shortfallCovered),
      net: out(realizedPnl.minus(fees).plus(funding).plus(shortfallCovered)),
    },
    walletBalance: state.walletBalance,
    settleBalance,
    reconciled: n(closing).eq(n(settleBalance)),
  };
}

/**
 * The same ledger narrowed to one position — what the position's realized
 * result is actually made of. Summing `amount` over these lines reproduces
 * `demoPositionView(...).realizedPnl` exactly, which is the check that
 * neither figure is counting a fee or a funding flow twice.
 */
export function positionLedger(state: DemoState, positionId: string): LedgerEntry[] {
  return accountLedger(state).entries.filter((e) => e.positionId === positionId);
}
