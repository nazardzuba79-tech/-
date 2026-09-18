import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { FuturesMarginLeverage } from './FuturesMarginLeverage';
import { PercentSlider } from './PercentSlider';
import { FuturesAccountSummary } from './FuturesAccountSummary';
import { useFuturesAccount } from '../lib/useFuturesAccount';
import { useFuturesExecution } from '../lib/futuresExecution';
import type { FuturesCloseTicket } from '../lib/nativeReduceTarget';
import { futuresOrderErrorMessage } from '../lib/futuresOrderErrors';
import {
  getLeverageTier,
  previewLiquidationPrice,
  projectFuturesExposureNotional,
  maxAffordableNotional,
  floorToDecimals,
  fitQuantityToContract,
  stepDecimals,
  orderCost,
  QUANTITY_DECIMALS,
} from '../lib/futuresMath';
import { useFuturesConfig } from '../lib/futuresConfigStore';
import { OrderFamilyTabs, OrderFamilyFields, type OrderFamily } from './OrderFamilyPresentation';

/** Owner-approved position-size presets. The track still snaps to 0 as
 *  well, so the size can be dragged back to nothing. */
const SIZE_PRESETS = [0, 25, 50, 75, 100];

/** The contract rule a refusal names, in the trader's language. */
const CONTRACT_LIMIT_LABEL = {
  minOrderQty: 'futures.limitMinQty',
  minNotionalValue: 'futures.limitMinNotional',
  qtyStep: 'futures.limitQtyStep',
} as const;

export function FuturesOrderForm({
  symbol,
  onPlaced,
  onOpenTransfer,
  pickedPrice,
  pickedPriceSequence,
  executionEnabled = true,
  closeTicket,
  lastPrice = null,
}: {
  symbol: string;
  onPlaced: () => void;
  onOpenTransfer?: () => void;
  /** A level clicked in the order book — fills the price field, the same
   *  affordance the spot terminal's form has. */
  pickedPrice?: string | null;
  /** Repeated clicks on the same level must refill an edited Limit field too. */
  pickedPriceSequence?: number;
  /** Discovery is broader than the server's execution whitelist. */
  executionEnabled?: boolean;
  /** A reduce-only close started from the positions table: the form fills
   *  in the direction and the quantity, and the trader prices it. Nothing
   *  is placed until they press the button, exactly as for any other
   *  order. */
  closeTicket?: FuturesCloseTicket;
  /**
   * The last TRADED price for this contract.
   *
   * Separate from mark price on purpose. The button beside the Limit field
   * is labelled "Последняя" and used to fill the MARK price, which is a
   * different quantity — the fair price the engine values and liquidates
   * positions at, not the price the market last traded at. On a contract
   * with any basis the two differ, so the button filled a number the label
   * did not describe. `null` means we do not know it, and the button is not
   * offered rather than filled with something else.
   */
  lastPrice?: number | null;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const [baseAsset, quoteAsset] = symbol.split('/');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [type, setType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [family, setFamily] = useState<OrderFamily>('LIMIT');
  const connectedFamily = family === 'LIMIT' || family === 'MARKET';
  const [price, setPrice] = useState('');
  const [priceEdited, setPriceEdited] = useState(false);
  useEffect(() => {
    if (pickedPrice) {
      setPrice(pickedPrice);
      setPriceEdited(true);
      setType('LIMIT');
      setFamily('LIMIT');
    }
  }, [pickedPrice, pickedPriceSequence]);
  /**
   * A LIMIT order opens ready to calculate and trade at the current last
   * price. The old form left `price` empty while painting a `0.00`
   * placeholder, so entering only Quantity produced dashes and then sent an
   * empty price to the engine. Once the trader edits the field (or picks a
   * book level) we never overwrite that choice with a moving market price.
   */
  useEffect(() => {
    if (family !== 'LIMIT' || priceEdited || price !== '') return;
    if (lastPrice !== null && Number.isFinite(lastPrice) && lastPrice > 0) {
      setPrice(String(lastPrice));
    }
  }, [family, lastPrice, price, priceEdited]);
  const [quantity, setQuantity] = useState('');
  const [closeTarget, setCloseTarget] = useState<FuturesCloseTicket | null>(null);
  /** A close requested from the positions table fills the ticket in, in
   *  reduce-only LIMIT, sized at the position. The trader still types the
   *  price and still presses the button. Identity survives price/quantity
   *  edits and a LIMIT/MARKET switch; only explicit cancellation, successful
   *  submission or leaving the symbol discards it. */
  useEffect(() => {
    if (!closeTicket || closeTicket.symbol !== symbol) { setCloseTarget(null); return; }
    setCloseTarget(closeTicket);
    setType('LIMIT');
    setFamily('LIMIT');
    setReduceOnly(true);
    setSide(closeTicket.side === 'LONG' ? 'SELL' : 'BUY');
    setMarginType(closeTicket.marginType);
    setQuantity(closeTicket.size);
    setPercent(0);
    setError(null);
  }, [closeTicket?.seq, symbol]);
  const [percent, setPercent] = useState(0);
  /**
   * The leverage the TRADER asked for. What the order actually uses is
   * `leverage` below — this capped by the live tier ceiling.
   *
   * Holding the request separately is what stops the ceiling from being a
   * one-way ratchet. When the clamp wrote back into this value, a single
   * large size permanently rewrote a 100x selection to 50x: shrink the
   * order again and the ceiling rose, but the selection did not, so the
   * panel went on sizing and charging at a leverage the trader had never
   * chosen and could not get back without reloading the page.
   */
  const [requestedLeverage, setRequestedLeverage] = useState(10);
  /**
   * CROSS IS THE DEFAULT, because this account is a Cross account.
   *
   * The Wallet calls it `Единый торговый счёт` under a `Кросс-маржа` chip,
   * and the engine backs every position from the shared collateral until
   * the trader says otherwise. Opening the panel on Isolated would ring
   * fence the first order by accident and contradict the header on the
   * other page. Isolated is a choice the trader makes, not a state they
   * arrive in.
   */
  /**
   * The bucket the TRADER picked, or `null` for "hasn't picked one".
   *
   * Not seeded from the engine's default, because the engine binding is
   * resolved asynchronously: a value latched at mount would be whichever
   * engine happened to be bound one render early. `null` lets the default
   * below follow the engine that actually ends up backing this terminal,
   * and stops following it the moment the trader touches the control.
   */
  const [chosenMarginType, setMarginType] = useState<'ISOLATED' | 'CROSS' | null>(null);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Balances, positions and open orders all come from the one shared
  // account store now, at the same 5s cadence this form always used. The
  // three `setInterval`s that used to live in this file are gone; so is the
  // second copy of /futures/balances and the third of /futures/positions.
  const account = useFuturesAccount({ balances: 5000, positions: 5000, orders: 5000 });
  /**
   * Which engine takes this order, and where the account state came from.
   *
   * Outside a provider this is the real engine and the real `api` call the
   * form used to make inline, so nothing about an ordinary account's path
   * changes. See lib/futuresExecution.
   */
  const execution = useFuturesExecution();
  const activeCloseTarget = reduceOnly ? closeTarget : null;
  /** An engine that settles in one margin mode is not offering a choice.
   *  A named close also keeps its position's bucket, not a different one
   *  selected while the form still contains that position's id. */
  const marginType = execution.marginType ?? activeCloseTarget?.marginType ?? chosenMarginType ?? execution.defaultMarginType;
  // The leverage bounds and the tier table come from the one shared read of
  // /futures/config rather than this form's own copy — same values, same
  // `null`-until-known semantics, one request for the page instead of three.
  // See lib/futuresConfigStore.
  const { config } = useFuturesConfig();
  const balanceRow = account.balances.data?.find((x) => x.asset === quoteAsset);
  /** null = not known (never loaded, or the request failed). Never 0: a
   *  fake zero here would silently size every percentage order at nothing
   *  while looking like a funded account with no free margin. */
  const availableMargin = account.balances.data ? (balanceRow ? parseFloat(balanceRow.available) : 0) : null;
  /** UNKNOWN is not EMPTY. These stay `null` until the server actually
   *  answered — coercing them to `[]` would tell the exposure projection
   *  that the account holds no position and no working order, which is a
   *  strictly optimistic guess, not a safe default. */
  const positions = account.positions.data;
  const activeOrders = account.orders.data;

  useEffect(() => {
    let cancelled = false;
    setMarkPrice(null);
    function load() {
      api
        .getFuturesMarkPrice(symbol)
        .then((res) => !cancelled && setMarkPrice(parseFloat(res.markPrice)))
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol]);

  /**
   * THE CALCULATOR ANSWERS ON THE KEYSTROKE, NOT ON THE NEXT POLL.
   *
   * A MARKET order used to be valued at the mark price alone, which this
   * form fetches on a 5-second timer — so for up to five seconds after
   * opening the panel (and for as long as that endpoint is slow or down)
   * a typed quantity showed "—" for its value and cost, and the buttons
   * stayed disabled. The page already has the last traded price from the
   * stream the book uses; until the mark arrives, the estimate is priced
   * at that, and it re-prices itself the moment the mark is known. The
   * engine still executes on ITS book: this figure is an estimate and is
   * labelled as one.
   */
  const referencePrice = markPrice ?? (lastPrice !== null && Number.isFinite(lastPrice) && lastPrice > 0 ? lastPrice : null);
  const effectivePrice = !connectedFamily ? 0 : type === 'LIMIT' ? parseFloat(price) : referencePrice ?? 0;
  const quantityNumber = parseFloat(quantity);
  const notional = effectivePrice && quantity ? effectivePrice * quantityNumber : 0;
  /**
   * Whether Order Value and Required Margin describe a real order.
   *
   * Both formulas above are unchanged. What changes is the RENDERING of a
   * figure nobody has entered yet, or one that depends on a mark price the
   * client has not received: a MARKET order with no mark price used to
   * show "0.00 USDT" for its value, which reads as a free order rather
   * than an unknown one.
   */
  const orderSizeKnown = Number.isFinite(effectivePrice) && effectivePrice > 0
    && quantity !== '' && Number.isFinite(quantityNumber) && quantityNumber > 0;

  // Live liquidation-price preview — same formula the backend uses
  // (src/futures/marginMath.ts) to actually set it at fill time. Purely
  // informational here: nothing about submitting the order depends on
  // this number, it just shows the trader what to expect before they commit.
  const orderTier = config && notional > 0 ? getLeverageTier(config.leverageTiers, notional) : null;

  // The projection reads the account's existing position and working orders
  // ONLY on this path: a reduce-only order and a zero-notional order both
  // short-circuit to 0 before either is touched, so they need no account
  // state at all. That matters — reduce-only is how a trader sheds risk,
  // and an outage is the worst possible moment to block it.
  const exposureNeedsAccountState = !reduceOnly && notional > 0;
  const exposureInputsKnown = positions !== null && activeOrders !== null;
  /** False only when the projection genuinely needs positions/orders and
   *  one of them has not been answered yet. */
  const exposureKnown = !exposureNeedsAccountState || exposureInputsKnown;

  const currentPosition = positions?.find(
    (position) => position.symbol === symbol && position.marginType === marginType
      && (!activeCloseTarget || position.id === activeCloseTarget.id)
  );
  const pendingExposureOrders = (activeOrders ?? [])
    .filter((order) =>
      order.symbol === symbol
      && order.marginType === marginType
      && !order.reduceOnly
      && order.price !== null
    )
    .map((order) => ({
      side: order.side,
      remainingQuantity: Number(order.remainingQuantity),
      price: Number(order.price),
    }))
    .filter((order) => Number.isFinite(order.remainingQuantity) && Number.isFinite(order.price));

  /** The position as the projection wants it — one mapping, read by both
   *  the exposure projection and the sizing below. */
  const exposurePosition = currentPosition
    ? {
        side: currentPosition.side,
        size: Number(currentPosition.size),
        entryPrice: Number(currentPosition.entryPrice),
      }
    : null;

  /** `null` = cannot be projected because the account state is unknown.
   *  `0` is a REAL zero: a reduce-only order, nothing typed yet, or an
   *  account that genuinely answered with no position and no orders. */
  const projectedExposure: number | null = !exposureNeedsAccountState
    ? 0
    : exposureInputsKnown
      ? projectFuturesExposureNotional({
          position: exposurePosition,
          activeOrders: pendingExposureOrders,
          candidate: { side, remainingQuantity: Number(quantity), price: effectivePrice },
        })
      : null;

  /** The same projection with the candidate taken OUT — the exposure a new
   *  order has to be sized around. The projection drops any leg with no
   *  remaining quantity, so a zero candidate is exactly "everything else".
   *  `null` while positions or orders are still unknown; sizing refuses
   *  rather than guessing an empty account, which is the optimistic guess. */
  const baseExposure: number | null = exposureInputsKnown
    ? projectFuturesExposureNotional({
        position: exposurePosition,
        activeOrders: pendingExposureOrders,
        candidate: { side, remainingQuantity: 0, price: effectivePrice },
      })
    : null;
  const resultingTier = config && projectedExposure !== null && projectedExposure > 0
    ? getLeverageTier(config.leverageTiers, projectedExposure)
    : null;
  // Informational only: the backend recomputes this projection transactionally.
  // But an unknown existing exposure must not be shown as a ceiling: it
  // would quote a maximum leverage derived from an account the client has
  // not actually seen, and the ceiling can only ever be too HIGH that way.
  // Null suspends the slider and the submit guard until the state is known,
  // which is what the backend would enforce anyway.
  const effectiveMaxLeverage = config && exposureKnown
    ? Math.min(config.maxLeverage, resultingTier?.maxLeverage ?? config.maxLeverage)
    : null;
  /** The leverage this order will really use: the request, under the live
   *  ceiling. Derived rather than clamped in an effect, so it rises again
   *  by itself when the size — and with it the ceiling — comes back down. */
  const leverage = effectiveMaxLeverage === null
    ? requestedLeverage
    : Math.min(requestedLeverage, effectiveMaxLeverage);
  /** What this order locks: initial margin, plus — when the engine
   *  publishes a fee rate — the fee reserve it takes with it, exactly as
   *  the simulation engine's admission does. Derived, never stored, so it
   *  follows the quantity and the leverage on the same render. */
  const orderCosting = orderCost(notional, leverage, execution.contract?.takerFeeRate);
  const requiredMargin = orderCosting.cost;
  // `freeBalance` only enters the formula for CROSS margin (it is the
  // backstop ratio; ISOLATED ignores it entirely — see futuresMath). So an
  // unknown balance suppresses the preview for CROSS, where it would
  // otherwise be computed from a fake 0 and quote a liquidation price
  // closer to entry than the real one, and changes nothing for ISOLATED.
  // The formula itself is untouched: when the balance is known, the inputs
  // are exactly what they were.
  const liqPreviewComputable =
    orderTier && effectivePrice > 0 && quantity && (marginType === 'ISOLATED' || availableMargin !== null);
  /** The side is no longer chosen before the form is filled in, so the
   *  preview cannot be for "the selected side" any more — it is computed
   *  for BOTH and shown as a long/short pair. Same formula, same inputs,
   *  called twice; nothing about the calculation changed. */
  const liqPreviewFor = (previewSide: 'LONG' | 'SHORT') =>
    liqPreviewComputable
      ? previewLiquidationPrice({
          entryPrice: effectivePrice,
          side: previewSide,
          leverage,
          marginType,
          maintenanceMarginRate: orderTier!.maintenanceMarginRate,
          notional,
          freeBalance: availableMargin ?? 0,
        })
      : null;
  const liqPreviewLong = liqPreviewFor('LONG');
  const liqPreviewShort = liqPreviewFor('SHORT');

  /**
   * The % slider spends a share of available margin, scaled up by leverage
   * — spending 100% of margin at 10x opens a 10x-larger notional than at
   * 1x, same as every real exchange's position-size slider.
   *
   * It is `maxAffordableNotional` that does the scaling, not
   * `margin × leverage`, because the selected leverage is not necessarily
   * the leverage the resulting position may use: past a tier boundary the
   * ceiling drops, `leverage` is capped to it, and the raw product would
   * leave a quantity sized at 100x being charged margin at 50x. That is
   * what rejected a 100 000 / 500 000 / 1 000 000 USDT order
   * with "Insufficient USDT margin balance" on an account that had asked
   * for exactly 100% of its margin. See lib/futuresMath.
   *
   * The budget is measured against the REQUESTED leverage, not the derived
   * one: the derived value is capped by a ceiling computed from the size
   * that is about to be replaced, so reading it here would let one large
   * order shrink every size offered afterwards. `atLeverage` is a
   * parameter for the same reason — the leverage control calls this with
   * the value it is about to request, and a `setRequestedLeverage`
   * scheduled in the same event is not readable here.
   */
  function applyPercent(pct: number, atLeverage: number = requestedLeverage) {
    setPercent(pct);
    if (!effectivePrice || effectivePrice <= 0) return;
    if (reduceOnly) {
      // A reduce-only order locks no margin and can never be larger than
      // the position it closes, so the free balance is the wrong budget
      // for it entirely: sizing from it offers a quantity the server
      // rejects as "would exceed the current position size".
      if (positions === null || (activeCloseTarget && !currentPosition)) return;
      const closable = exposurePosition ? exposurePosition.size : 0;
      setQuantity(contractSized(closable * (pct / 100)));
      return;
    }
    // An unknown available margin or an unknown existing exposure sizes
    // nothing. Previously this read a fake 0 and produced a quantity of 0;
    // refusing to size is the same outcome without writing a misleading
    // number into the field.
    if (availableMargin === null || baseExposure === null || !config) return;
    const { notional } = maxAffordableNotional({
      tiers: config.leverageTiers,
      freeMargin: availableMargin * (pct / 100),
      selectedLeverage: atLeverage,
      existingExposure: baseExposure,
    });
    setQuantity(contractSized(notional / effectivePrice));
  }

  /**
   * A quantity the CONTRACT will accept, not merely one the margin covers.
   *
   * When the engine publishes its rules, the size is floored onto the
   * contract's quantity step and clamped to its ceiling — both downward, so
   * a size that fitted the margin still fits it. Without rules (every real
   * account, and a contract that has not answered yet) this is the plain
   * 8-decimal floor the form has always used.
   */
  function contractSized(raw: number): string {
    const rules = execution.contract;
    if (!rules) return floorToDecimals(raw, QUANTITY_DECIMALS).toFixed(QUANTITY_DECIMALS);
    const fitted = fitQuantityToContract(raw, effectivePrice, rules, { market: type === 'MARKET' });
    return fitted.quantity.toFixed(stepDecimals(rules.qtyStep));
  }

  /**
   * The contract rule this order breaks, if any — checked here so the
   * refusal is visible before a round trip, and named so it can be acted
   * on. The ENGINE remains the authority: this never relaxes a rule, it
   * only reports the same one the engine would.
   */
  const contractCheck = execution.contract && orderSizeKnown && !reduceOnly
    ? fitQuantityToContract(quantityNumber, effectivePrice, execution.contract, { market: type === 'MARKET' })
    : null;
  const contractBreach = contractCheck && (
    contractCheck.rejectedBy !== null
      // A quantity the fitter had to change is a quantity the contract
      // would have refused as typed.
      || Math.abs(contractCheck.quantity - quantityNumber) > Number(execution.contract!.qtyStep) / 2
  ) ? contractCheck : null;

  /**
   * Whether this order asks for more margin than the account has free.
   *
   * Deliberately narrow. Reduce-only is exempt because it locks nothing,
   * and an unknown balance is exempt because a `null` there means "not
   * answered yet", never "zero" — blocking on either would block the
   * orders that matter most during an outage.
   */
  const marginShortfall = !reduceOnly
    && orderSizeKnown
    && availableMargin !== null
    && requiredMargin > availableMargin;

  /** The side is an ARGUMENT, not a read of state. The button that starts
   *  this is also the button that decides the direction, and a `setSide`
   *  scheduled by its click is not visible here in the same event — taking
   *  it as a parameter is what makes "the direction is the button" true
   *  rather than one render out of date. */
  async function submitOrder(orderSide: 'BUY' | 'SELL') {
    setError(null);
    setSubmitting(true);
    setSide(orderSide);
    try {
      await execution.placeOrder({
        symbol,
        side: orderSide,
        type,
        price: type === 'LIMIT' ? price : undefined,
        quantity,
        leverage,
        marginType,
        reduceOnly,
        ...(execution.engine === 'NATIVE' && activeCloseTarget ? { positionId: activeCloseTarget.id } : {}),
      });
      setCloseTarget(null);
      setPrice('');
      setPriceEdited(false);
      setQuantity('');
      setPercent(0);
      // The account really did change: refresh it now rather than waiting
      // for whichever poll fires next. Balances too — placing an order
      // locks margin, and that figure used to lag by up to five seconds.
      execution.refresh(['balances', 'positions', 'orders']);
      onPlaced();
      toast.success(t('trade.orderPlaced'));
    } catch (err) {
      // The refusal is localized from the engine's own reason code, so a
      // margin shortfall reads as a margin shortfall rather than borrowing
      // whichever contract limit happened to be nearby.
      const message = futuresOrderErrorMessage(
        err,
        t,
        err instanceof ApiError ? err.message : t('futures.placeOrderError'),
      );
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * The single source of truth for "can this order be submitted".
   *
   * `handleSubmit` and the submit button read the SAME expression, so a
   * button that looks actionable always is. The button previously reacted
   * to the submitting flag alone, which left it live while the leverage
   * ceiling was unknown — a CTA that looks pressable and silently does
   * nothing is the worst kind of control in a trading interface.
   *
   * A valid price and positive quantity are part of that same guard. The
   * old panel allowed a LIMIT button to look live with an empty price and
   * then sent `price: ''` to the engine; the browser screenshot showed the
   * exact symptom as `0.00` placeholder + dashes in the calculator.
   *
   * `effectiveMaxLeverage !== null` remains: a null ceiling means the
   * account state behind it is unknown, and the panel does not submit a
   * leverage it cannot justify. `marginShortfall` and `contractBreach` are
   * still server-authoritative preflight mirrors, never substitutes for the
   * engine's validation.
   */
  const canSubmit = Boolean(config)
    // An engine whose access verdict or account state is not known yet
    // takes no orders. It never falls back to the other engine.
    && execution.ready
    && executionEnabled
    && connectedFamily
    && orderSizeKnown
    && effectiveMaxLeverage !== null
    && !marginShortfall
    && !contractBreach
    && !submitting;

  /** Same guard, same confirmation, same order of checks as before — only
   *  the direction now arrives from the caller. */
  function place(orderSide: 'BUY' | 'SELL') {
    if (!canSubmit) return;
    if (activeCloseTarget && orderSide !== (activeCloseTarget.side === 'LONG' ? 'SELL' : 'BUY')) return;
    /**
     * A MISSING THRESHOLD MEANS NO WARNING, NOT A WARNING ON EVERYTHING.
     *
     * `highLeverageWarningThreshold` is nullable, and `leverage >= null`
     * is `leverage >= 0` — true for every order ever placed. That put a
     * confirm dialog in front of a 1x order, and a trader who dismissed
     * it had their order silently dropped with no error shown, because
     * this guard returns without saying anything.
     *
     * `Infinity` is the same fallback the leverage control beside it
     * already uses for the same field; this call site was the one that
     * read it bare.
     */
    const warnAt = config!.highLeverageWarningThreshold ?? Infinity;
    if (leverage >= warnAt && !window.confirm(
      `${t('futures.leverageWarningTitle')}\n\n${t('futures.leverageWarningBody', { leverage })}`
    )) return;
    submitOrder(orderSide);
  }

  /** Enter in any field still places an order, and it places the one the
   *  trader last acted on — never a silent guess at the opposite side. */
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // A table close names its direction as well as its position. Enter must
    // use that named closing side instead of whichever BUY/SELL state the
    // form happened to hold before the close ticket arrived.
    place(activeCloseTarget ? (activeCloseTarget.side === 'LONG' ? 'SELL' : 'BUY') : side);
  }

  return (
    <div className="fo-panel">
      <OrderFamilyTabs value={family} onChange={next => {
        setFamily(next);
        if (next === 'LIMIT' || next === 'MARKET') setType(next);
        setPercent(0); setError(null);
      }} />

      <form onSubmit={handleSubmit} className="fo-form" data-close-position-id={activeCloseTarget?.id}>
        {/* One compact control where a margin-mode toggle and a full
            leverage slider used to stack. The panel now has exactly ONE
            persistent slider, and it is position size. Every bound comes
            from the same values as before: config.minLeverage, the live
            effectiveMaxLeverage, and config.highLeverageWarningThreshold. */}
        <FuturesMarginLeverage
          marginType={marginType}
          onMarginTypeChange={execution.marginType || activeCloseTarget ? () => {} : setMarginType}
          marginTypeLocked={execution.marginType !== null || activeCloseTarget !== null}
          leverage={leverage}
          onLeverageChange={(next) => {
            setRequestedLeverage(next);
            // A size chosen as a PERCENTAGE of the account has to follow
            // the leverage that pays for it; leaving the quantity behind
            // is what made the displayed % and the real margin disagree.
            // A hand-typed quantity sets `percent` to 0 and is left alone.
            if (percent > 0) applyPercent(percent, next);
          }}
          min={config?.minLeverage ?? 1}
          max={config ? effectiveMaxLeverage : null}
          warningThreshold={config?.highLeverageWarningThreshold ?? Infinity}
        />

        <OrderFamilyFields key={`${symbol}-${family}`} family={family} quote={quoteAsset} />
        {/* PRICE AND QUANTITY ARE ONE FIELD SHAPE, TWICE.
            Both are `fo-field`: the same outer box, the same caption inside
            at the top left, the same trailing element inside at the right.
            Neither the "Последняя" button nor the unit changes the box —
            they sit in a fixed-width trailing slot inside it, which is what
            keeps the two fields' outer width and height equal to the pixel
            whatever either one contains. The caption used to sit ABOVE the
            quantity field and INSIDE the price field, which is exactly why
            the two were different heights. */}
        {family === 'LIMIT' ? (
          <label className="fo-label fo-field fo-priceField">
            <span className="fo-fieldCaption">{t('trade.price')}</span>
            <div className="fo-fieldRow fo-priceInputRow">
              <input
                className="mono fo-input"
                type="number"
                step="any"
                required
                value={price}
                onChange={(e) => {
                  setPriceEdited(true);
                  setPrice(e.target.value);
                }}
                placeholder="0.00"
              />
              <span className="fo-fieldTrailing">
                {lastPrice !== null && Number.isFinite(lastPrice) && lastPrice > 0 && (
                  <button type="button" onClick={() => {
                    setPriceEdited(true);
                    setPrice(String(lastPrice));
                  }} className="fo-lastPriceBtn">
                    {t('trade.lastPriceBtn')}
                  </button>
                )}
              </span>
            </div>
          </label>
        ) : family === 'MARKET' ? (
          <label className="fo-label fo-field fo-priceField">
            <span className="fo-fieldCaption">{t('futures.markPrice')}</span>
            <div className="fo-fieldRow fo-priceInputRow">
              <div className="mono fo-input fo-markPrice">
                {markPrice !== null ? `≈ ${markPrice}` : '—'}
              </div>
              <span className="fo-fieldTrailing"><span className="fo-unit">{quoteAsset}</span></span>
            </div>
          </label>
        ) : null}

        <label className="fo-label fo-field">
          <span className="fo-fieldCaption">{t('trade.quantity')}</span>
          {/* The unit is a label, not a selector: this form trades one
              contract, the one the page is on, so a dropdown here would
              offer a choice that does not exist. Changing the pair is the
              pair list's job. */}
          <div className="fo-fieldRow fo-qtyInputRow">
            <input
              className="mono fo-input"
              type="number"
              step="any"
              required
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setPercent(0);
              }}
              placeholder="0.00000"
            />
            <span className="fo-fieldTrailing"><span className="fo-unit">{baseAsset}</span></span>
          </div>
        </label>

        {/* The ONLY persistent slider in this panel. */}
        <PercentSlider value={percent} onChange={applyPercent} presets={SIZE_PRESETS} continuous label={t('trade.quantity')} />

        <label className="fo-reduceOnlyRow">
          <input type="checkbox" checked={reduceOnly} onChange={(e) => {
            setReduceOnly(e.target.checked);
            if (!e.target.checked) setCloseTarget(null);
          }} />
          {t('futures.reduceOnly')}
        </label>

        <div className="fo-infoBox">
          <div className="fo-infoRow">
            <span style={{ color: 'var(--text-secondary)' }}>{t('futures.orderValue')}</span>
            <span className="mono">
              {orderSizeKnown ? `${notional.toFixed(2)} ${quoteAsset}` : '—'}
            </span>
          </div>
          <div className="fo-infoRow">
            <span style={{ color: 'var(--text-secondary)' }}>{t('futures.margin')}</span>
            <span className="mono">
              {orderSizeKnown ? `${requiredMargin.toFixed(2)} ${quoteAsset}` : '—'}
            </span>
          </div>
          {/* Long and short, in that order, coloured the same as the two
              buttons below — so the pair reads without a label saying
              which is which. */}
          <div className="fo-infoRow">
            <span style={{ color: 'var(--text-secondary)' }}>{t('futures.estLiqPrice')}</span>
            <span className="mono fo-sidePair">
              <span className="fo-sidePairLong">{liqPreviewLong ? liqPreviewLong.toFixed(2) : '—'}</span>
              <span className="fo-sidePairSep">/</span>
              <span className="fo-sidePairShort">{liqPreviewShort ? liqPreviewShort.toFixed(2) : '—'}</span>
            </span>
          </div>
          {/* NO FEE ROW.
              VOLTEX charges nothing on futures: there is no fee rate in
              src/futures, none in src/config/futuresConfig, and no fee
              column in the Prisma schema. (The only `feeRate` in the
              codebase is Copy Trading's PERFORMANCE fee — a different
              thing, and not applicable to an order here.)

              The row read "0.00 USDT (0%)" once, which was a number nobody
              computed, and then a dash. Both were noise: a line that only
              ever says "nothing" is a line asking the trader to check for
              something that does not exist. Zero fees are a fact worth
              stating on a fees page, not a field to leave empty here.

              When a real rate exists it comes back with the work that
              CHARGES it — a config value, settlement at fill, and the
              amount stored on the trade. A displayed fee that is not
              deducted is as wrong as an invented one. */}
        </div>

        {error && <div className="fo-error">{error}</div>}
        {contractBreach && !error && (
          <div className="fo-error" role="status">
            {t('futures.contractLimit', {
              limit: t(CONTRACT_LIMIT_LABEL[contractBreach.rejectedBy ?? 'qtyStep']),
              allowed: contractBreach.rejectedBy !== null
                ? contractBreach.limit!
                : `${contractBreach.quantity} ${baseAsset}`,
            })}
          </div>
        )}
        {marginShortfall && !contractBreach && !error && (
          <div className="fo-error" role="status">
            {t('futures.insufficientMargin', {
              required: requiredMargin.toFixed(2),
              available: availableMargin!.toFixed(2),
              asset: quoteAsset,
            })}
          </div>
        )}
        {!executionEnabled && <div className="fo-error" role="status">{t('analytics.unavailable')}</div>}

        {/* The shared terminal CTA, same as spot — this used to be a
            flat accent fill under a coloured outer glow, which is the one
            treatment the terminal's design system doesn't use anywhere
            else. Long/Short keep their own labels and their own colour
            sides; only the surface is now the common one. */}
        {/* TWO BUTTONS, NOT A MODE.
            The side used to be a tab above the form: a trader had to
            declare the direction before touching a single field, and
            reversing meant switching back and losing the view of the
            other side's numbers. Here the form is direction-neutral and
            the DIRECTION IS THE BUTTON — the same way every derivatives
            terminal does it. `side` is still the one piece of state the
            request carries; it is simply written at the moment of
            submitting rather than minutes earlier. */}
        {/* The visible side buttons intentionally stay type=button because
            they decide BUY vs SELL. This hidden submit control gives the
            form a real implicit-submit target, so Enter in Price/Quantity
            reliably reaches handleSubmit instead of doing nothing when the
            form has multiple blocking inputs. handleSubmit still derives
            the exact closing side for a named reduce-only target. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        <div className="fo-submitPair">
          <button
            type="button"
            disabled={!canSubmit || activeCloseTarget?.side === 'LONG'}
            title={!connectedFamily ? t('analytics.unavailable') : undefined}
            onClick={() => place('BUY')}
            className="submit-btn buy"
          >
            {submitting && side === 'BUY' ? t('auth.wait') : t('futures.buyLong')}
          </button>
          <button
            type="button"
            disabled={!canSubmit || activeCloseTarget?.side === 'SHORT'}
            title={!connectedFamily ? t('analytics.unavailable') : undefined}
            onClick={() => place('SELL')}
            className="submit-btn sell"
          >
            {submitting && side === 'SELL' ? t('auth.wait') : t('futures.sellShort')}
          </button>
        </div>
      </form>

      {/* The compact account summary sits directly under the order buttons,
          and it is the ONE place the account's margin figures are stated —
          which is why "Доступная маржа" no longer rides along in the
          quantity field's label, where it could stretch that field
          relative to the price field beside it. */}
      <FuturesAccountSummary quoteAsset={quoteAsset} config={config} marginType={marginType} onOpenTransfer={onOpenTransfer} />

      {config && (
        <details className="fo-tiersBox">
          <summary className="fo-tiersTitle">{t('futures.leverageTiersTitle')}</summary>
          <table className="fo-tiersTable">
            <thead>
              <tr>
                <th className="fo-tiersTh">{t('futures.tierNotional')}</th>
                <th className="fo-tiersTh">{t('futures.tierMaxLeverage')}</th>
                <th className="fo-tiersTh">{t('futures.tierMmr')}</th>
              </tr>
            </thead>
            <tbody>
              {config.leverageTiers.map((tr, i) => (
                <tr key={i} className={resultingTier === tr ? 'fo-tiersRowActive' : undefined}>
                  <td className="fo-tiersTd mono">
                    {tr.notionalCap === null ? '∞' : tr.notionalCap.toLocaleString('en-US')}
                  </td>
                  <td className="fo-tiersTd mono">
                    {tr.maxLeverage}x
                  </td>
                  <td className="fo-tiersTd mono">
                    {(tr.maintenanceMarginRate * 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
