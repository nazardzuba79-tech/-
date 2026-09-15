import BigNumber from 'bignumber.js';
import { amount, decimal } from '../math';
import type { CollateralValuation } from './collateral';

/**
 * THE ONE PLACE THE ACCOUNT'S MONEY IS COMPUTED.
 *
 * Two things back a Cross account, and until now only one of them was
 * counted:
 *
 *   1. the SIMULATION LEDGER — the settle-asset balance the engine has been
 *      moving as trades, fees and funding happened;
 *   2. the REST OF THE WALLET — every other asset the owner still holds,
 *      valued at the same mark the positions are valued at.
 *
 * Adding them is not double counting: the collateral that was moved into
 * the simulation ledger at initialization was DEBITED from the wallet rows,
 * so each unit of value is in exactly one of the two.
 *
 * The rule that governs the rest of this module is what to do when the
 * wallet cannot be fully valued. An incomplete valuation UNDERSTATES
 * collateral. Understated collateral makes a solvent account look
 * liquidatable — so when any held asset is unpriced this model refuses to
 * answer the liquidation question at all (`liquidatable: null`) and says
 * which assets it could not price. It does not guess, and it does not
 * quietly report the understated figure as if it were the account.
 */

const D = BigNumber.clone({ DECIMAL_PLACES: 36, ROUNDING_MODE: BigNumber.ROUND_HALF_EVEN, EXPONENTIAL_AT: 100 });
const n = (x: string) => decimal(x);
const out = (x: BigNumber) => amount(x);

/** Exactly the fields the engine's own `demoAccount()` returns that this model consumes. */
export interface EngineAccount {
  walletBalance: string;
  unrealizedPnl: string;
  usedMargin: string;
  orderReserve: string;
  maintenanceMargin: string;
}

export interface CrossAccount {
  /** The simulation ledger's settle-asset balance. */
  settleBalance: string;
  /** The rest of the wallet, valued at mark. Only the part that COULD be valued. */
  walletCollateral: string;
  /** settleBalance + walletCollateral. What backs the account before P&L. */
  collateral: string;
  unrealizedPnl: string;
  /** collateral + unrealizedPnl. */
  equity: string;
  /** Initial margin locked by open positions. */
  initialMargin: string;
  /** Margin reserved by resting orders. */
  orderReserve: string;
  maintenanceMargin: string;
  /** equity - initialMargin - orderReserve, floored at 0. */
  available: string;
  /** maintenanceMargin / equity, or null when equity is not positive. */
  maintenanceRatio: string | null;
  /**
   * `true`/`false` only when the wallet is fully valued. `null` means the
   * question cannot be answered on an understated collateral figure.
   */
  liquidatable: boolean | null;
  /** False when any held asset could not be priced — `equity` is then a FLOOR, not the account. */
  collateralComplete: boolean;
  /** The assets that could not be priced, so the interface can name them. */
  unpricedAssets: string[];
  /** The stalest price behind `walletCollateral`. */
  collateralAsOf: number | null;
}

/**
 * `hasOpenPositions` is passed in rather than inferred: an account with no
 * position is never liquidatable, however small its equity, and that is a
 * fact about the positions, not about the money.
 */
export function crossAccount(
  engine: EngineAccount,
  valuation: CollateralValuation,
  hasOpenPositions: boolean,
): CrossAccount {
  const settleBalance = n(engine.walletBalance);
  const walletCollateral = n(valuation.priced);
  const collateral = settleBalance.plus(walletCollateral);
  const unrealizedPnl = n(engine.unrealizedPnl);
  const equity = collateral.plus(unrealizedPnl);
  const initialMargin = n(engine.usedMargin);
  const orderReserve = n(engine.orderReserve);
  const maintenanceMargin = n(engine.maintenanceMargin);

  return {
    settleBalance: out(settleBalance),
    walletCollateral: out(walletCollateral),
    collateral: out(collateral),
    unrealizedPnl: out(unrealizedPnl),
    equity: out(equity),
    initialMargin: out(initialMargin),
    orderReserve: out(orderReserve),
    maintenanceMargin: out(maintenanceMargin),
    available: out(D.maximum(0, equity.minus(initialMargin).minus(orderReserve))),
    maintenanceRatio: equity.gt(0) ? out(maintenanceMargin.div(equity)) : null,
    // The whole point: never liquidate against collateral we know is short.
    liquidatable: valuation.complete ? hasOpenPositions && equity.lte(maintenanceMargin) : null,
    collateralComplete: valuation.complete,
    unpricedAssets: valuation.unpriced,
    collateralAsOf: valuation.asOf,
  };
}
