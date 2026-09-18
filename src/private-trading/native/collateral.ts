import BigNumber from 'bignumber.js';
import { decimal, amount } from '../math';

/**
 * WHAT A MULTI-ASSET WALLET IS WORTH AS CROSS COLLATERAL.
 *
 * Cross margin is backed by the whole wallet, not by its USDT row alone, so
 * the collateral base has to value every asset the owner holds. The rule
 * that makes this safe is the one this module exists to enforce:
 *
 *   AN UNAVAILABLE PRICE IS NOT A PRICE OF ZERO.
 *
 * A holding whose price could not be fetched is reported as UNPRICED and
 * named in `unpriced`; its value stays `null` and it is left out of the
 * total. It is never valued at 0 — that would quietly shrink the account's
 * collateral and liquidate a solvent position — and it is never valued at a
 * guess, a stale figure or a neighbouring asset's price.
 *
 * The consequence is that `priced` alone is not a wallet valuation. It is
 * the part of the wallet that is KNOWN to be worth something, and `complete`
 * says whether that is the whole of it. Callers that need a collateral
 * figure to size or liquidate against must read `complete` too.
 */

/** 36 dp, matching `math.ts` — never touches the production engine's global config. */
const D = BigNumber.clone({ DECIMAL_PLACES: 36, ROUNDING_MODE: BigNumber.ROUND_HALF_EVEN, EXPONENTIAL_AT: 100 });

export interface CollateralHolding {
  asset: string;
  /** Free quantity, as a decimal string. */
  available: string;
  /** Quantity held against open orders/positions, as a decimal string. */
  locked?: string;
}

/**
 * One asset's price in the settle asset.
 *
 * `price` is `null` when the quote could not be obtained. That is the whole
 * point of the type: the absence of a price is a value the caller must carry,
 * not an exception to swallow into 0.
 */
export interface CollateralPrice {
  asset: string;
  price: string | null;
  source: string;
  asOf: number | null;
}

export type CollateralStatus = 'SETTLE' | 'PRICED' | 'UNPRICED';

export interface CollateralLine {
  asset: string;
  /** Whether this wallet asset currently contributes to Cross margin. */
  collateralEnabled: boolean;
  /** Free quantity, carried through so a reader can show it without a second read. */
  available: string;
  /** Quantity held against this account's own orders/positions. */
  locked: string;
  /** `available + locked` — what the valuation below is taken on. */
  quantity: string;
  price: string | null;
  value: string | null;
  status: CollateralStatus;
  source: string | null;
  asOf: number | null;
}

export interface CollateralValuation {
  settleAsset: string;
  lines: CollateralLine[];
  /** Market value of every wallet holding that could be priced, even when not used as margin. */
  priced: string;
  /** The subset of `priced` that is actually enabled as Cross collateral. */
  collateralPriced: string;
  /** Assets held in non-zero quantity whose market value is unknown. */
  unpriced: string[];
  /** Enabled collateral assets whose price is unknown. */
  collateralUnpriced: string[];
  /** True when every ENABLED collateral asset can be valued. */
  complete: boolean;
  /** The STALEST `asOf` among the priced lines: a valuation is only as fresh as its oldest input. */
  asOf: number | null;
}

const partsOf = (holding: CollateralHolding): { available: BigNumber; locked: BigNumber; quantity: BigNumber } => {
  const available = decimal(holding.available, 'collateral_quantity');
  const locked = holding.locked === undefined ? new D(0) : decimal(holding.locked, 'collateral_quantity');
  if (available.lt(0) || locked.lt(0)) throw new Error('INVALID_COLLATERAL_QUANTITY');
  // Locked collateral is still collateral: it backs the account's own orders
  // and positions, and leaving it out would understate the wallet.
  return { available, locked, quantity: available.plus(locked) };
};

/**
 * `prices` may omit an asset entirely, or carry it with `price: null` — both
 * mean the same thing and are reported the same way. A price that is not a
 * positive number (0, negative, unparseable) is treated as no price at all,
 * because a zero-priced collateral asset and an unpriced one are the same
 * uncertainty and only one of them is honest.
 */
export function valueCollateral(
  holdings: CollateralHolding[],
  prices: CollateralPrice[],
  settleAsset = 'USDT',
  disabledAssets: ReadonlySet<string> = new Set(),
): CollateralValuation {
  const quoted = new Map(prices.map((p) => [p.asset, p]));
  const lines: CollateralLine[] = [];
  const unpriced: string[] = [];
  const collateralUnpriced: string[] = [];
  let priced = new D(0);
  let collateralPriced = new D(0);
  let asOf: number | null = null;

  for (const holding of holdings) {
    const parts = partsOf(holding);
    const quantity = parts.quantity;
    const split = { available: amount(parts.available), locked: amount(parts.locked) };

    if (holding.asset === settleAsset) {
      // The settle asset is the unit of account and the engine's cash ledger.
      // It is always eligible collateral; the UI therefore renders it as a
      // locked-on switch rather than pretending it can be removed.
      priced = priced.plus(quantity);
      collateralPriced = collateralPriced.plus(quantity);
      lines.push({ asset: holding.asset, collateralEnabled: true, ...split, quantity: amount(quantity), price: '1', value: amount(quantity), status: 'SETTLE', source: null, asOf: null });
      continue;
    }

    const collateralEnabled = !disabledAssets.has(holding.asset);
    const quote = quoted.get(holding.asset);
    let price: BigNumber | null = null;
    if (quote && quote.price !== null) {
      const parsed = new D(quote.price);
      if (parsed.isFinite() && parsed.gt(0)) price = parsed;
    }

    if (price === null) {
      // A holding of nothing is not an unknown: there is no value to miss.
      if (quantity.gt(0)) {
        unpriced.push(holding.asset);
        if (collateralEnabled) collateralUnpriced.push(holding.asset);
      }
      lines.push({ asset: holding.asset, collateralEnabled, ...split, quantity: amount(quantity), price: null, value: null, status: 'UNPRICED', source: quote?.source ?? null, asOf: quote?.asOf ?? null });
      continue;
    }

    const value = quantity.times(price);
    priced = priced.plus(value);
    if (collateralEnabled) {
      collateralPriced = collateralPriced.plus(value);
      if (quote!.asOf !== null && (asOf === null || quote!.asOf < asOf)) asOf = quote!.asOf;
    }
    lines.push({ asset: holding.asset, collateralEnabled, ...split, quantity: amount(quantity), price: amount(price), value: amount(value), status: 'PRICED', source: quote!.source, asOf: quote!.asOf });
  }

  return {
    settleAsset,
    lines,
    priced: amount(priced),
    collateralPriced: amount(collateralPriced),
    unpriced,
    collateralUnpriced,
    complete: collateralUnpriced.length === 0,
    asOf,
  };
}
