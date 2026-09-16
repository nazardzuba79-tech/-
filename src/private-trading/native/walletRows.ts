import BigNumber from 'bignumber.js';
import { amount, decimal } from '../math';
import type { CollateralValuation } from './collateral';
import type { CrossAccount } from './accountModel';

/**
 * THE WALLET'S ASSET ROWS, COMPUTED ONCE, SERVER-SIDE.
 *
 * The Wallet page needs a per-asset breakdown that adds up to the account
 * above it. Every figure here is a projection of two things that already
 * exist — the collateral valuation and the authoritative `CrossAccount` —
 * and no new financial rule is invented:
 *
 *   total     = what the wallet row holds, plus (settle asset only) the
 *               balance that has already moved into the trading ledger;
 *   inUse     = the row's own locked quantity, plus (settle asset only) the
 *               margin and order reserve the engine reports as locked;
 *   available = total - inUse, floored at 0;
 *   value     = total x price, or null when the asset has no price.
 *
 * WHY THE SETTLE ASSET CARRIES THE TRADING BALANCE. Initialization DEBITS
 * the settle row it takes and credits the trading ledger with it, so the
 * wallet row and the ledger balance are disjoint. Adding them is the only
 * way to show the owner what they still have in that asset, and it cannot
 * double count precisely because the debit happened.
 *
 * WHY `inUse` PUTS THE MARGIN ON THE SETTLE ROW. Initial margin and order
 * reserve are settle-denominated figures the engine produces; there is no
 * per-asset attribution of Cross margin, and inventing one would be a
 * claim the engine never made. `available` on a single row can therefore
 * floor at 0 while the account still has free margin backed by other
 * collateral — the account-level `available` stays the authoritative
 * spendable figure, and the interface shows it as such.
 *
 * AN UNPRICED ASSET HAS NO VALUE, NOT A VALUE OF ZERO. `value` stays null
 * and the row says UNPRICED, exactly as the valuation reported it.
 */

const D = BigNumber.clone({ DECIMAL_PLACES: 36, ROUNDING_MODE: BigNumber.ROUND_HALF_EVEN, EXPONENTIAL_AT: 100 });

export interface UnifiedWalletRow {
  asset: string;
  /** Quantity in the wallet row itself. */
  walletQuantity: string;
  /** The trading ledger's balance. Non-zero for the settle asset only. */
  tradingBalance: string;
  /** `walletQuantity + tradingBalance`. */
  total: string;
  /** Locked in the wallet row, plus the engine's margin for the settle asset. */
  inUse: string;
  /** `total - inUse`, floored at 0. */
  available: string;
  /** Price in the settle asset; `'1'` for the settle asset, null when unknown. */
  price: string | null;
  /** `total` valued at `price`, or null when the asset could not be priced. */
  value: string | null;
  status: 'SETTLE' | 'PRICED' | 'UNPRICED';
  asOf: number | null;
}

export function unifiedWalletRows(account: CrossAccount, valuation: CollateralValuation): UnifiedWalletRow[] {
  const settleAsset = valuation.settleAsset;
  const margin = decimal(account.initialMargin).plus(account.orderReserve);
  const settleBalance = decimal(account.settleBalance);
  const seen = new Set<string>();

  const rows = valuation.lines.map((line): UnifiedWalletRow => {
    seen.add(line.asset);
    const isSettle = line.asset === settleAsset;
    const walletQuantity = decimal(line.quantity);
    const tradingBalance = isSettle ? settleBalance : new D(0);
    const total = walletQuantity.plus(tradingBalance);
    const inUse = decimal(line.locked).plus(isSettle ? margin : new D(0));
    const price = line.status === 'UNPRICED' ? null : line.price;
    return {
      asset: line.asset,
      walletQuantity: amount(walletQuantity),
      tradingBalance: amount(tradingBalance),
      total: amount(total),
      inUse: amount(inUse),
      available: amount(D.maximum(0, total.minus(inUse))),
      price,
      // Re-valued on `total` rather than reusing `line.value`, which was
      // taken on the wallet quantity alone and would omit the balance now
      // sitting in the trading ledger.
      value: price === null ? null : amount(total.times(price)),
      status: line.status,
      asOf: line.asOf,
    };
  });

  // An account can hold a trading balance with no wallet row left behind it
  // — initialization takes the whole settle row when it takes it. The
  // balance is still the account's, so it still gets a row.
  if (!seen.has(settleAsset)) {
    rows.push({
      asset: settleAsset,
      walletQuantity: amount(new D(0)),
      tradingBalance: amount(settleBalance),
      total: amount(settleBalance),
      inUse: amount(margin),
      available: amount(D.maximum(0, settleBalance.minus(margin))),
      price: '1',
      value: amount(settleBalance),
      status: 'SETTLE',
      asOf: null,
    });
  }

  return rows;
}
