import type { Key } from './i18n/locales/keys';
import { PrivateTradingError } from './privateTradingError';

/**
 * Turning an execution refusal into a sentence the trader can act on.
 *
 * The engine answers with a machine-readable `code` and, for a contract
 * rule, the `limit` it broke plus the value that limit allows. That pair is
 * the ONLY thing this module reads: the sentence is then composed in the
 * interface language, so a trader reading the terminal in Japanese is not
 * shown the server's Russian, and nobody is ever shown `INVALID_ORDER_SIZE`.
 *
 * The rule that matters most here is that a refusal must name its OWN
 * cause. A maximum-market-quantity message on an order that was actually
 * too large for the free collateral sends the trader to shrink a size that
 * was never the problem; the two are separate codes and stay separate
 * sentences.
 */

/** Contract limits, keyed by the name the engine reports them under. */
const LIMIT_KEY: Record<string, Key> = {
  minOrderQty: 'futures.orderError.minOrderQty',
  maxOrderQty: 'futures.orderError.maxOrderQty',
  maxMarketOrderQty: 'futures.orderError.maxMarketOrderQty',
  minNotionalValue: 'futures.orderError.minNotional',
  qtyStep: 'futures.orderError.qtyStep',
  tickSize: 'futures.orderError.tickSize',
  tierMaxLeverage: 'futures.orderError.tierLeverage',
  maxLeverage: 'futures.orderError.maxLeverage',
  minLeverage: 'futures.orderError.minLeverage',
  leverageStep: 'futures.orderError.leverageStep',
};

/**
 * Engine and validation codes, used when no limit VALUE came with the
 * refusal. These sentences quote no number, which is why the step and tier
 * cases have their own `…Plain` wording rather than reusing the keys above
 * and leaving a `{allowed}` placeholder on screen.
 */
const CODE_KEY: Record<string, Key> = {
  INSUFFICIENT_DEMO_MARGIN: 'futures.orderError.insufficientMargin',
  INSUFFICIENT_FILL_MARGIN: 'futures.orderError.insufficientFillMargin',
  INVALID_ORDER_SIZE: 'futures.orderError.orderSize',
  INVALID_QUANTITY_STEP: 'futures.orderError.qtyStepPlain',
  INVALID_PRICE_STEP: 'futures.orderError.tickSizePlain',
  INVALID_LEVERAGE: 'futures.orderError.invalidLeverage',
  TIER_LEVERAGE_EXCEEDED: 'futures.orderError.tierLeveragePlain',
  RISK_LIMIT_EXCEEDED: 'futures.orderError.riskLimit',
  INVALID_QUANTITY: 'futures.orderError.marginTooSmall',
  INVALID_AMOUNT: 'futures.orderError.invalidAmount',
  INVALID_PRICE: 'futures.orderError.invalidPrice',
  LIMIT_PRICE_REQUIRED: 'futures.orderError.limitPriceRequired',
  CONTRACT_LIMIT: 'futures.orderError.contractLimit',
  CLOSE_EXCEEDS_POSITION: 'futures.orderError.closeExceedsPosition',
  POSITION_NOT_OPEN: 'futures.orderError.positionNotOpen',
  POSITION_MISSING: 'futures.orderError.positionNotOpen',
  ORDER_NOT_OPEN: 'futures.orderError.orderNotOpen',
  ORDER_NOT_FOUND: 'futures.orderError.orderNotFound',
  LATEST_MARK_STALE: 'futures.orderError.staleQuote',
  STALE_BOOK: 'futures.orderError.staleQuote',
  COMMAND_LIMIT: 'futures.orderError.commandLimit',
  ACCOUNT_MISSING: 'futures.orderError.accountMissing',
  SET_EXISTING_POSITION_LEVERAGE_FIRST: 'futures.orderError.leverageExistingPosition',
  CANCEL_ORDERS_BEFORE_LEVERAGE: 'futures.orderError.cancelOrdersFirst',
  INVALID_TRIGGER_PRICE: 'futures.orderError.triggerPrice',
  INVALID_TRIGGER_STEP: 'futures.orderError.triggerStep',
  INVALID_PROTECTION_QUANTITY: 'futures.orderError.protectionQuantity',
};

export type Translate = (key: Key, params?: Record<string, string | number>) => string;

/**
 * `fallback` is the message for anything this module has no wording for —
 * the caller's own generic text, or the real account's `ApiError.message`.
 *
 * A code with no entry above is a gap in this table, not something to show:
 * it goes to the console for the logs and the trader gets the generic
 * sentence. Raw codes never reach the interface.
 */
export function futuresOrderErrorMessage(error: unknown, t: Translate, fallback: string): string {
  if (!(error instanceof PrivateTradingError)) return fallback;

  // A named contract limit is the most specific thing we can say, so it
  // wins over the code: `INVALID_ORDER_SIZE` alone cannot tell the trader
  // whether the size was too small, too large, or too large FOR A MARKET
  // order specifically — `limit` can.
  const limit = error.detail?.limit;
  const allowed = error.detail?.allowed;
  if (limit && allowed !== undefined && LIMIT_KEY[limit]) return t(LIMIT_KEY[limit], { allowed });

  const key = error.code ? CODE_KEY[error.code] : undefined;
  if (key) return t(key);

  if (error.code) console.warn('[futures] unmapped order error code', error.code, error.detail);
  // The engine's own text is a written sentence, never a code, so it is a
  // better last resort than a generic line — just in the wrong language.
  return error.message || fallback;
}
