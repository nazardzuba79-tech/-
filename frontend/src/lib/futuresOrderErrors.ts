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
  native_command_timeout: 'futures.orderError.commandTimeout',
  native_queue_timeout: 'futures.orderError.queueTimeout',
  native_confirmation_unknown: 'futures.orderError.confirmationUnknown',
  COMMAND_LIMIT: 'futures.orderError.commandLimit',
  // A historical journal beyond the engine hard ceiling refuses every command,
  // including a reduce-only LIMIT close. Show the specific account-limit text
  // instead of the generic «Не удалось разместить ордер».
  JOURNAL_LIMIT: 'futures.orderError.commandLimit',
  ACCOUNT_MISSING: 'futures.orderError.accountMissing',
  SET_EXISTING_POSITION_LEVERAGE_FIRST: 'futures.orderError.leverageExistingPosition',
  CANCEL_ORDERS_BEFORE_LEVERAGE: 'futures.orderError.cancelOrdersFirst',
  INVALID_TRIGGER_PRICE: 'futures.orderError.triggerPrice',
  // The protection routes refuse a level on the wrong side of the mark with
  // a sentence written for a developer («stopLoss must be below the current
  // mark price for a LONG position»). The fact it carries — the level is on
  // the wrong side of the current price — is what the trader needs, and
  // this key already says it in all seven languages.
  INVALID_PROTECTION: 'futures.orderError.triggerPrice',
  INVALID_TRIGGER_STEP: 'futures.orderError.triggerStep',
  INVALID_PROTECTION_QUANTITY: 'futures.orderError.protectionQuantity',
  // The order ticket does not offer TP/SL under Reduce Only, so this should
  // not be reachable from it. Mapped anyway: an unmapped code falls back to
  // a generic sentence, and this one has a specific thing to say.
  REDUCE_ORDER_PROTECTION: 'futures.tpslReduceOnlyOff',
  // The contract's near-live price behind a sampled (historical) account.
  // Every contract outside the collector's live sockets is priced from a
  // periodic catalogue snapshot, and a command needs that price younger than
  // the commit headroom; when the frame has aged and the on-demand read
  // fails too, the server refuses with one of these. It is the refusal the
  // owner met on AKEUSDT as «Не удалось разместить ордер»: a price problem
  // that a retry a few seconds later resolves, and it has to say so.
  near_live_price_stale: 'futures.orderError.priceUnavailable',
  near_live_price_unavailable: 'futures.orderError.priceUnavailable',
  quote_stale: 'futures.orderError.priceUnavailable',
  collector_unavailable: 'futures.orderError.priceUnavailable',
  market_data_invalid: 'futures.orderError.priceUnavailable',
  market_data_busy: 'futures.orderError.priceUnavailable',
  private_market_data_unavailable: 'futures.orderError.priceUnavailable',
  MARK_MISSING: 'futures.orderError.priceUnavailable',
  ENTRY_MARK_UNAVAILABLE: 'futures.orderError.priceUnavailable',
  // The account's command lane (client or server) is still busy with the
  // previous command; the order was not taken.
  native_queue_full: 'futures.orderError.busy',
  client_queue_full: 'futures.orderError.busy',
  account_changed: 'futures.orderError.busy',
  // A reducing order named a position it cannot reduce.
  INVALID_REDUCE_SIDE: 'futures.orderError.reduceSide',
  INVALID_REDUCE_SYMBOL: 'futures.orderError.reduceSide',
  MARGIN_TYPE_MISMATCH: 'futures.orderError.reduceSide',
  POSITION_ID_REQUIRED: 'futures.orderError.positionNotOpen',
  EXECUTION_MODE_MISMATCH: 'futures.orderError.executionMode',
  IDEMPOTENCY_CONFLICT: 'futures.orderError.duplicate',
};

export type Translate = (key: Key, params?: Record<string, string | number>) => string;

/**
 * Server text that is NOT safe to show, whatever transport carried it.
 *
 * `ApiError.message` is whatever the route put in `body.error`, and the
 * futures routes put a lot in there: `Order not found or not cancellable`,
 * `No index price available for BTCUSDT`, a caught exception's own
 * `err.message`, a flattened Zod report, or the client's own
 * `Request failed (500)` when the body could not be parsed. The simulation
 * transport is the same story — it builds its error from `data.error` or
 * `data.message` verbatim.
 *
 * None of that is customer wording. It is English in a Russian interface at
 * best, and a stack or an HTML error page at worst.
 */

/** A message is shown only if this module composed it. Nothing else is. */
export function futuresOrderErrorMessage(error: unknown, t: Translate, fallback: string): string {
  // The real account's transport reports its reason in `body.code`, which is
  // the same closed vocabulary the simulation engine uses. Reading it here
  // is what keeps a genuine refusal — not enough margin, a price step, a
  // leverage tier — saying what it is instead of falling to the generic
  // line. It reads the CODE only; `body.error` is never displayed.
  if (!(error instanceof PrivateTradingError)) {
    const body = (error as { body?: Record<string, unknown> } | null)?.body;
    const code = body && typeof body.code === 'string' ? body.code : undefined;
    if (code && CODE_KEY[code]) return t(CODE_KEY[code]);
    if (code) console.warn('[futures] unmapped order error code', code);
    else if (error instanceof Error && error.message) {
      console.warn('[futures] order error without a code', error.message);
    }
    return fallback;
  }

  // A named contract limit is the most specific thing we can say, so it
  // wins over the code: `INVALID_ORDER_SIZE` alone cannot tell the trader
  // whether the size was too small, too large, or too large FOR A MARKET
  // order specifically — `limit` can.
  const limit = error.detail?.limit;
  const allowed = error.detail?.allowed;
  if (limit && allowed !== undefined && LIMIT_KEY[limit]) return t(LIMIT_KEY[limit], { allowed });

  const key = error.code ? CODE_KEY[error.code] : undefined;
  if (key) return t(key);
  // No code and a gateway status: the host answered for an API that was
  // restarting, after the command had already been retried under its key.
  if (!error.code && [502, 503, 504].includes(error.status)) return t('futures.orderError.serverUnavailable');

  // A code with no entry above is a gap in this table, not something to
  // show. The server's own sentence is not a safe substitute either: it is
  // written in one language for one audience, and on this transport it is
  // whatever `data.error` happened to contain. Both go to the console, the
  // trader gets the caller's localized line.
  if (error.code) console.warn('[futures] unmapped order error code', error.code, error.detail);
  else if (error.message) console.warn('[futures] order error without a code', error.message);
  return fallback;
}
