import { useEffect, useMemo, useState, FormEvent } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { cfdDisplayState, cfdMarketCopy, cfdQuoteCurrency, formatCfdPrice } from '../lib/cfdPresentation';
import { LeverageSlider } from './LeverageSlider';
import { getLeverageTier, previewLiquidationPrice } from '../lib/futuresMath';
import { openCfdPaperPosition } from '../lib/cfdPaperStore';
import type { CfdTickerRow } from './CfdInstrumentList';
import '../pages/trade-terminal/CfdPractice.css';

export function CfdOrderForm({
  symbol,
  ticker,
  configured: _configured = true,
  onPlaced,
}: {
  symbol: string;
  ticker: CfdTickerRow | undefined;
  configured?: boolean;
  onPlaced: () => void;
}) {
  const { t, lang } = useLanguage();
  const copy = cfdMarketCopy(lang);
  const toast = useToast();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('');
  const [leverage, setLeverage] = useState(10);
  const [config, setConfig] = useState<Awaited<ReturnType<typeof api.getCfdConfig>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getCfdConfig().then(value => { if (!cancelled) setConfig(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setQuantity('');
    setError(null);
  }, [symbol]);

  const price = ticker?.price != null && Number.isFinite(Number(ticker.price)) && Number(ticker.price) > 0 ? Number(ticker.price) : null;
  const qty = quantity.trim() !== '' && Number.isFinite(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : null;
  const notional = price !== null && qty !== null ? price * qty : 0;
  /** The practice books value, margin and P&L in the instrument's quote currency (JPY for USDJPY), and says so. */
  const currency = cfdQuoteCurrency(symbol);
  const requiredMargin = leverage > 0 ? notional / leverage : 0;
  const state = cfdDisplayState(ticker, lang);
  const minLeverage = config?.minLeverage ?? 1;
  const maxLeverage = config?.maxLeverage ?? 100;
  const warningThreshold = config?.highLeverageWarningThreshold ?? 20;
  const tier = config && notional > 0 ? getLeverageTier(config.leverageTiers, notional) : null;
  const maxForOrder = tier ? Math.min(maxLeverage, tier.maxLeverage) : maxLeverage;

  useEffect(() => {
    if (leverage > maxForOrder) setLeverage(maxForOrder);
  }, [leverage, maxForOrder]);

  const liqPreview = useMemo(() => {
    if (!tier || price === null || qty === null || requiredMargin <= 0) return null;
    return previewLiquidationPrice({
      entryPrice: price,
      side: side === 'BUY' ? 'LONG' : 'SHORT',
      leverage,
      marginType: 'ISOLATED',
      maintenanceMarginRate: tier.maintenanceMarginRate,
      notional,
      freeBalance: 0,
    });
  }, [tier, price, qty, requiredMargin, side, leverage, notional]);

  async function submitOrder() {
    if (price === null) { setError(copy.priceUnavailable); return; }
    if (qty === null) { setError(t('trade.quantity')); return; }
    if (leverage < minLeverage || leverage > maxForOrder) { setError(`${minLeverage}x–${maxForOrder}x`); return; }
    setError(null);
    setSubmitting(true);
    try {
      openCfdPaperPosition({
        symbol,
        side,
        quantity: qty,
        price,
        leverage,
        initialMargin: requiredMargin,
        liquidationPrice: liqPreview,
      });
      setQuantity('');
      onPlaced();
      toast.success(t('trade.orderPlaced'));
    } catch (failure) {
      const message=(failure as Error)?.message==='cfd_practice_storage_unavailable'
        ? copy.storageUnavailable : t('futures.placeOrderError');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submitOrder();
  }

  return (
    <div className="cfd-order-panel">
      <div className="cfd-sideTabs">
        <button type="button" onClick={() => setSide('BUY')} className={`cfd-sideTab${side === 'BUY' ? ' buy active' : ''}`} aria-pressed={side === 'BUY'}>
          {t('futures.buyLong')}
        </button>
        <button type="button" onClick={() => setSide('SELL')} className={`cfd-sideTab${side === 'SELL' ? ' sell active' : ''}`} aria-pressed={side === 'SELL'}>
          {t('futures.sellShort')}
        </button>
      </div>

      {/* Market orders only (2026-10-15). The limit / stop / take-profit / OCO tabs used to show fields
          that went nowhere and a disabled button: the practice fills at the snapshot quote and cannot
          fill a resting or conditional order honestly, so it no longer offers one. No note under it
          (owner, 2026-10-15); the reason stays in the tooltip. */}
      <div className="order-family-tabs cfd-order-type" role="group" aria-label={t('trade.orderType')} title={copy.marketOnlyNote}>
        <span className="active" aria-current="true">{copy.marketOrder}</span>
      </div>
      <div className="cfd-product-terms">
        <span className="terminal-practice-label" title={copy.practiceNote} aria-label={copy.practice}>SIM</span>
        <span>{t('futures.isolated')}</span>
      </div>
      <form onSubmit={handleSubmit} className="cfd-form">
        <div className="cfd-form-fields" style={{ display: 'contents' }}>
        <LeverageSlider
          value={leverage}
          onChange={setLeverage}
          min={minLeverage}
          max={maxForOrder}
          warningThreshold={warningThreshold}
        />

        <label className="cfd-label">
          {t('trade.cfdMarketPrice')}
          <div className="cfd-reference-wrap">
            <div className="mono cfd-input cfd-referencePrice">
              {price !== null ? `≈ ${formatCfdPrice(price, symbol)}` : copy.priceUnavailable}
            </div>
            <span className={`cfd-order-state cfd-state-${state.tone}`}>{state.label}</span>
          </div>
        </label>

        <label className="cfd-label">
          {t('trade.quantity')}
          <input
            type="number"
            step="any"
            min="0"
            required
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mono cfd-input"
            placeholder="0.00"
          />
        </label>

        <div className="cfd-infoBox">
          <div className="cfd-infoRow">
            <span className="cfd-muted">{t('futures.orderValue')}</span>
            <span className="mono">{notional > 0 ? `${notional.toFixed(2)} ${currency}` : '—'}</span>
          </div>
          <div className="cfd-infoRow">
            <span className="cfd-muted">{t('futures.margin')}</span>
            <span className="mono">{requiredMargin > 0 ? `${requiredMargin.toFixed(2)} ${currency}` : '—'}</span>
          </div>
          <div className="cfd-infoRow">
            <span className="cfd-muted">{t('futures.estLiqPrice')}</span>
            <span className={`mono ${liqPreview ? 'text-sell' : 'cfd-muted'}`}>
              {liqPreview ? formatCfdPrice(liqPreview, symbol) : '—'}
            </span>
          </div>
        </div>

        {error && <div className="cfd-error" role="alert">{error}</div>}
        </div>

        <button
          type="submit"
          disabled={submitting || price === null || qty === null}
          className={`cfd-submit ${side === 'BUY' ? 'buy' : 'sell'}`}
        >
          {submitting ? t('auth.wait') : side === 'BUY' ? t('futures.buyLong') : t('futures.sellShort')}
        </button>
      </form>
    </div>
  );
}
