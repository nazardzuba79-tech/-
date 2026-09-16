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
  /** CROSS free cash. Margin posted to isolated positions has already left it. */
  walletBalance: string;
  /** CROSS positions only. */
  unrealizedPnl: string;
  usedMargin: string;
  orderReserve: string;
  maintenanceMargin: string;
  /** Posted against isolated positions: out of the cross pool, still the owner's. */
  isolatedMargin?: string;
  /** ISOLATED positions' P&L, which the cross account is not entitled to. */
  isolatedUnrealizedPnl?: string;
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
  /** Initial margin locked by open positions, including margin posted to isolated ones. */
  initialMargin: string;
  /** Margin reserved by resting orders. */
  orderReserve: string;
  maintenanceMargin: string;
  /** What a NEW position may use: cross equity less everything already committed, floored at 0. */
  available: string;
  /** initialMargin / equity, or null when equity is not positive. */
  initialMarginRatio: string | null;
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
  // ISOLATED MARGIN IS STILL THE OWNER'S MONEY. It left the cross pool when
  // the position filled, so `walletBalance` no longer holds it — but it was
  // not spent, and the Wallet must not report the account as smaller by the
  // amount its own positions are holding. It is added back HERE, once, into
  // the settle balance, and counted as initial margin in use, which is what
  // it is. Adding it is not double counting for exactly the reason the
  // wallet-row addition above is not: the debit and the credit are the same
  // movement seen from two sides.
  const isolatedMargin = n(engine.isolatedMargin ?? '0');
  const isolatedPnl = n(engine.isolatedUnrealizedPnl ?? '0');
  const settleBalance = n(engine.walletBalance).plus(isolatedMargin);
  const walletCollateral = n(valuation.priced);
  const collateral = settleBalance.plus(walletCollateral);
  const unrealizedPnl = n(engine.unrealizedPnl).plus(isolatedPnl);
  const equity = collateral.plus(unrealizedPnl);
  const initialMargin = n(engine.usedMargin).plus(isolatedMargin);
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
    // What can still be opened with. Isolated P&L is NOT in it: an unrealised
    // gain inside a ring-fenced position is not collateral for a new one
    // until that position is closed, so it is subtracted back out here.
    available: out(D.maximum(0, equity.minus(isolatedPnl).minus(initialMargin).minus(orderReserve))),
    // Both ratios are answered HERE, on the same equity, so an interface
    // can print them without dividing anything itself. Null rather than 0
    // when equity is not positive: a ratio of an empty account is not zero,
    // it is undefined.
    initialMarginRatio: equity.gt(0) ? out(initialMargin.div(equity)) : null,
    maintenanceRatio: equity.gt(0) ? out(maintenanceMargin.div(equity)) : null,
    // The whole point: never liquidate against collateral we know is short.
    // The cross question, asked on cross money: isolated positions answer for
    // themselves in the engine and neither rescue nor endanger the account.
    liquidatable: valuation.complete
      ? hasOpenPositions && equity.minus(isolatedMargin).minus(isolatedPnl).lte(maintenanceMargin)
      : null,
    collateralComplete: valuation.complete,
    unpricedAssets: valuation.unpriced,
    collateralAsOf: valuation.asOf,
  };
}
