import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { LeverageSlider } from './LeverageSlider';
import { MarginTypeToggle } from './MarginTypeToggle';
import { PercentSlider } from './PercentSlider';
import { FuturesAccountSummary } from './FuturesAccountSummary';
import { getLeverageTier, previewLiquidationPrice } from '../lib/futuresMath';

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
  const [availableMargin, setAvailableMargin] = useState(0);
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [config, setConfig] = useState<Awaited<ReturnType<typeof api.getFuturesConfig>> | null>(null);
  const [accountCreatedAt, setAccountCreatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getFuturesConfig().then(setConfig).catch(() => {});
  }, []);

  // Account age gates leverage server-side (FuturesPositionService rejects
  // > newAccountMaxLeverage for the first newAccountPeriodDays — see
  // config/futuresConfig.ts) but nothing client-side knew about it, so the
  // slider let a new account drag past that cap and only find out from a
  // rejected order. /me is already fetched elsewhere in the app for exactly
  // this field; nothing else here depends on the rest of the profile.
  useEffect(() => {
    api
      .getMe()
      .then((me) => setAccountCreatedAt(me.createdAt))
      .catch(() => {});
  }, []);

  const accountAgeDays = accountCreatedAt ? (Date.now() - new Date(accountCreatedAt).getTime()) / 86_400_000 : null;
  const isNewAccount = config !== null && accountAgeDays !== null && accountAgeDays < config.newAccountPeriodDays;
  const effectiveMaxLeverage = config ? (isNewAccount ? Math.min(config.maxLeverage, config.newAccountMaxLeverage) : config.maxLeverage) : null;

  // Clamp down if the effective cap drops below whatever is currently
  // selected — e.g. the slider defaulted to 10x before /me answered, and
  // the account turns out to still be within its first newAccountPeriodDays
  // with a lower newAccountMaxLeverage.
  useEffect(() => {
    if (effectiveMaxLeverage !== null && leverage > effectiveMaxLeverage) setLeverage(effectiveMaxLeverage);
  }, [effectiveMaxLeverage, leverage]);

  useEffect(() => {
    let cancelled = false;
    // Polled on the same 5s cadence as FuturesAccountSummary's own margin
    // balance, which sits right below this form — without it, a transfer
    // completed in the modal (or a fill that just locked margin) left this
    // figure stale until the trader happened to flip Long/Short, while the
    // summary card below it had already caught up.
    function load() {
      api
        .getFuturesBalances()
        .then((balances) => {
          if (cancelled) return;
          const b = balances.find((x) => x.asset === quoteAsset);
          setAvailableMargin(b ? parseFloat(b.available) : 0);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [quoteAsset]);

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
  const tier = config && notional > 0 ? getLeverageTier(config.leverageTiers, notional) : null;
  const liqPreview =
    tier && effectivePrice > 0 && quantity
      ? previewLiquidationPrice({
          entryPrice: effectivePrice,
          side: side === 'BUY' ? 'LONG' : 'SHORT',
          leverage,
          marginType,
          maintenanceMarginRate: tier.maintenanceMarginRate,
          notional,
          freeBalance: availableMargin,
        })
      : null;

  // % slider spends a share of available margin, scaled up by leverage —
  // spending 100% of margin at 10x opens a 10x-larger notional than at 1x,
  // same as every real exchange's position-size slider.
  function applyPercent(pct: number) {
    setPercent(pct);
    if (!effectivePrice || effectivePrice <= 0) return;
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
            {isNewAccount && (
              <div className="fo-newAccountNotice">
                {t('futures.newAccountLimitNotice', {
                  max: config.newAccountMaxLeverage,
                  days: config.newAccountPeriodDays,
                })}
              </div>
            )}
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
              {t('futures.availableMargin')}: {availableMargin.toFixed(2)} {quoteAsset}
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
                <tr key={i} className={tier === tr ? 'fo-tiersRowActive' : undefined}>
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
