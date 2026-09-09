import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { LeverageSlider } from './LeverageSlider';
import { MarginTypeToggle } from './MarginTypeToggle';
import { PercentSlider } from './PercentSlider';
import { FuturesAccountSummary } from './FuturesAccountSummary';
import { useFuturesAccount, refreshFuturesAccount } from '../lib/useFuturesAccount';
import { getLeverageTier, previewLiquidationPrice, projectFuturesExposureNotional } from '../lib/futuresMath';

export function FuturesOrderForm({
  symbol,
  onPlaced,
  onOpenTransfer,
  pickedPrice,
  pickedPriceSequence,
}: {
  symbol: string;
  onPlaced: () => void;
  onOpenTransfer?: () => void;
  /** A level clicked in the order book — fills the price field, the same
   *  affordance the spot terminal's form has. */
  pickedPrice?: string | null;
  /** Repeated clicks on the same level must refill an edited Limit field too. */
  pickedPriceSequence?: number;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const [, quoteAsset] = symbol.split('/');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [type, setType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState('');
  useEffect(() => {
    if (pickedPrice) {
      setPrice(pickedPrice);
      setType('LIMIT');
    }
  }, [pickedPrice, pickedPriceSequence]);
  const [quantity, setQuantity] = useState('');
  const [percent, setPercent] = useState(0);
  const [leverage, setLeverage] = useState(10);
  const [marginType, setMarginType] = useState<'ISOLATED' | 'CROSS'>('ISOLATED');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [config, setConfig] = useState<Awaited<ReturnType<typeof api.getFuturesConfig>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Balances, positions and open orders all come from the one shared
  // account store now, at the same 5s cadence this form always used. The
  // three `setInterval`s that used to live in this file are gone; so is the
  // second copy of /futures/balances and the third of /futures/positions.
  const account = useFuturesAccount({ balances: 5000, positions: 5000, orders: 5000 });
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
    api.getFuturesConfig().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
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

  const effectivePrice = type === 'LIMIT' ? parseFloat(price) : markPrice ?? 0;
  const notional = effectivePrice && quantity ? effectivePrice * parseFloat(quantity) : 0;
  const requiredMargin = leverage > 0 ? notional / leverage : 0;

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

  /** `null` = cannot be projected because the account state is unknown.
   *  `0` is a REAL zero: a reduce-only order, nothing typed yet, or an
   *  account that genuinely answered with no position and no orders. */
  const projectedExposure: number | null = !exposureNeedsAccountState
    ? 0
    : exposureInputsKnown
      ? projectFuturesExposureNotional({
          position: currentPosition
            ? {
                side: currentPosition.side,
                size: Number(currentPosition.size),
                entryPrice: Number(currentPosition.entryPrice),
              }
            : null,
          activeOrders: pendingExposureOrders,
          candidate: { side, remainingQuantity: Number(quantity), price: effectivePrice },
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
  useEffect(() => {
    if (effectiveMaxLeverage !== null && leverage > effectiveMaxLeverage) setLeverage(effectiveMaxLeverage);
  }, [effectiveMaxLeverage, leverage]);
  // `freeBalance` only enters the formula for CROSS margin (it is the
  // backstop ratio; ISOLATED ignores it entirely — see futuresMath). So an
  // unknown balance suppresses the preview for CROSS, where it would
  // otherwise be computed from a fake 0 and quote a liquidation price
  // closer to entry than the real one, and changes nothing for ISOLATED.
  // The formula itself is untouched: when the balance is known, the inputs
  // are exactly what they were.
  const liqPreviewComputable =
    orderTier && effectivePrice > 0 && quantity && (marginType === 'ISOLATED' || availableMargin !== null);
  const liqPreview = liqPreviewComputable
    ? previewLiquidationPrice({
        entryPrice: effectivePrice,
        side: side === 'BUY' ? 'LONG' : 'SHORT',
        leverage,
        marginType,
        maintenanceMarginRate: orderTier!.maintenanceMarginRate,
        notional,
        freeBalance: availableMargin ?? 0,
      })
    : null;

  // % slider spends a share of available margin, scaled up by leverage —
  // spending 100% of margin at 10x opens a 10x-larger notional than at 1x,
  // same as every real exchange's position-size slider.
  function applyPercent(pct: number) {
    setPercent(pct);
    if (!effectivePrice || effectivePrice <= 0) return;
    // An unknown available margin sizes nothing. Previously this read a
    // fake 0 and produced a quantity of 0; refusing to size is the same
    // outcome without writing a misleading number into the field.
    if (availableMargin === null) return;
    const marginToSpend = availableMargin * (pct / 100);
    setQuantity(((marginToSpend * leverage) / effectivePrice).toFixed(8));
  }

  async function submitOrder() {
    setError(null);
    setSubmitting(true);
    try {
      await api.placeFuturesOrder({
        symbol,
        side,
        type,
        price: type === 'LIMIT' ? price : undefined,
        quantity,
        leverage,
        marginType,
        reduceOnly,
      });
      setPrice('');
      setQuantity('');
      setPercent(0);
      // The account really did change: refresh it now rather than waiting
      // for whichever poll fires next. Balances too — placing an order
      // locks margin, and that figure used to lag by up to five seconds.
      refreshFuturesAccount(['balances', 'positions', 'orders']);
      onPlaced();
      toast.success(t('trade.orderPlaced'));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('futures.placeOrderError');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!config || effectiveMaxLeverage === null || leverage > effectiveMaxLeverage || submitting) return;
    if (leverage >= config.highLeverageWarningThreshold && !window.confirm(
      `${t('futures.leverageWarningTitle')}\n\n${t('futures.leverageWarningBody', { leverage })}`
    )) return;
    submitOrder();
  }

  return (
    <div className="fo-panel">
      <div className="fo-sideTabs">
        <button
          type="button"
          onClick={() => setSide('BUY')}
          className={`fo-sideTab ${side === 'BUY' ? 'fo-sideTabBuy' : ''}`} aria-pressed={side === 'BUY'}
        >
          {t('futures.buyLong')}
        </button>
        <button
          type="button"
          onClick={() => setSide('SELL')}
          className={`fo-sideTab ${side === 'SELL' ? 'fo-sideTabSell' : ''}`} aria-pressed={side === 'SELL'}
        >
          {t('futures.sellShort')}
        </button>
      </div>

      <div className="fo-typeTabs">
        <button
          type="button"
          onClick={() => setType('LIMIT')}
          className={`fo-typeTab ${type === 'LIMIT' ? 'fo-typeTabActive' : ''}`} aria-pressed={type === 'LIMIT'}
        >
          {t('trade.limitOrder')}
        </button>
        <button
          type="button"
          onClick={() => setType('MARKET')}
          className={`fo-typeTab ${type === 'MARKET' ? 'fo-typeTabActive' : ''}`} aria-pressed={type === 'MARKET'}
        >
          {t('trade.marketOrder')}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="fo-form">
        <MarginTypeToggle value={marginType} onChange={setMarginType} />

        {config && effectiveMaxLeverage !== null && (
          <>
            <LeverageSlider
              value={leverage}
              onChange={setLeverage}
              min={config.minLeverage}
              max={effectiveMaxLeverage}
              warningThreshold={config.highLeverageWarningThreshold}
            />
          </>
        )}

        {type === 'LIMIT' ? (
          <label className="fo-label">
            {t('trade.price')}
            <div className="fo-priceInputRow">
              <input
                className="mono fo-input"
                type="number"
                step="any"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
              {markPrice !== null && (
                <button type="button" onClick={() => setPrice(String(markPrice))} className="fo-lastPriceBtn">
                  {t('trade.lastPriceBtn')}
                </button>
              )}
            </div>
          </label>
        ) : (
          <label className="fo-label">
            {t('futures.markPrice')}
            <div className="mono fo-input fo-markPrice">
              {markPrice !== null ? `≈ ${markPrice}` : t('trade.loading')} {quoteAsset}
            </div>
          </label>
        )}

        <label className="fo-label">
          <span className="fo-qtyLabelRow">
            {t('trade.quantity')}
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
              {t('futures.availableMargin')}: {availableMargin === null ? '—' : availableMargin.toFixed(2)} {quoteAsset}
            </span>
          </span>
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
        </label>

        <PercentSlider value={percent} onChange={applyPercent} />

        <label className="fo-reduceOnlyRow">
          <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />
          {t('futures.reduceOnly')}
        </label>

        <div className="fo-infoBox">
          <div className="fo-infoRow">
            <span style={{ color: 'var(--text-secondary)' }}>{t('futures.orderValue')}</span>
            <span className="mono">
              {notional.toFixed(2)} {quoteAsset}
            </span>
          </div>
          <div className="fo-infoRow">
            <span style={{ color: 'var(--text-secondary)' }}>{t('futures.margin')}</span>
            <span className="mono">
              {requiredMargin.toFixed(2)} {quoteAsset}
            </span>
          </div>
          <div className="fo-infoRow">
            <span style={{ color: 'var(--text-secondary)' }}>{t('trade.fee')}</span>
            <span className="mono">0.00 {quoteAsset} (0%)</span>
          </div>
          <div className="fo-infoRow">
            <span style={{ color: 'var(--text-secondary)' }}>{t('futures.estLiqPrice')}</span>
            <span className="mono" style={{ color: liqPreview ? 'var(--sell)' : 'var(--text-tertiary)' }}>
              {liqPreview ? liqPreview.toFixed(2) : '—'}
            </span>
          </div>
        </div>

        {error && <div className="fo-error">{error}</div>}

        {/* The shared terminal CTA, same as spot — this used to be a
            flat accent fill under a coloured outer glow, which is the one
            treatment the terminal's design system doesn't use anywhere
            else. Long/Short keep their own labels and their own colour
            sides; only the surface is now the common one. */}
        <button
          type="submit"
          disabled={submitting}
          className={`submit-btn ${side === 'BUY' ? 'buy' : 'sell'}`}
        >
          {submitting ? t('auth.wait') : side === 'BUY' ? t('futures.buyLong') : t('futures.sellShort')}
        </button>
      </form>

      <FuturesAccountSummary quoteAsset={quoteAsset} config={config} onOpenTransfer={onOpenTransfer} />

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
