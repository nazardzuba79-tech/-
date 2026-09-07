import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { formatCfdPrice } from '../lib/cfdPresentation';
import { LeverageSlider } from './LeverageSlider';
import { getLeverageTier, previewLiquidationPrice } from '../lib/futuresMath';
import type { CfdTickerRow } from './CfdInstrumentList';

const PERCENT_STOPS = [0, 25, 50, 75, 100];

/**
 * CFD counterpart of FuturesOrderForm — same layout and margin-preview
 * math, simplified for the dealer model: MARKET fills only (there's no
 * internal book to rest a LIMIT order against), ISOLATED margin only. See
 * CfdPositionService's doc comment for why.
 */
export function CfdOrderForm({
  symbol,
  ticker,
  configured = true,
  onPlaced,
}: {
  symbol: string;
  ticker: CfdTickerRow | undefined;
  configured?: boolean;
  onPlaced: () => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('');
  const [percent, setPercent] = useState(0);
  const [leverage, setLeverage] = useState(10);
  const [availableMargin, setAvailableMargin] = useState(0);
  const [config, setConfig] = useState<Awaited<ReturnType<typeof api.getCfdConfig>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getCfdConfig().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    api
      .getFuturesBalances()
      .then((balances) => {
        const b = balances.find((x) => x.asset === 'USDT');
        setAvailableMargin(b ? parseFloat(b.available) : 0);
      })
      .catch(() => {});
  }, [side]);

  const price = ticker ? parseFloat(ticker.price) : 0;
  const notional = price && quantity ? price * parseFloat(quantity) : 0;
  const requiredMargin = leverage > 0 ? notional / leverage : 0;

  const tier = config && notional > 0 ? getLeverageTier(config.leverageTiers, notional) : null;
  const liqPreview =
    tier && price > 0 && quantity
      ? previewLiquidationPrice({
          entryPrice: price,
          side: side === 'BUY' ? 'LONG' : 'SHORT',
          leverage,
          marginType: 'ISOLATED',
          maintenanceMarginRate: tier.maintenanceMarginRate,
          notional,
          freeBalance: availableMargin,
        })
      : null;

  function applyPercent(pct: number) {
    setPercent(pct);
    if (!price || price <= 0) return;
    const marginToSpend = availableMargin * (pct / 100);
    setQuantity(((marginToSpend * leverage) / price).toFixed(6));
  }

  async function submitOrder() {
    setError(null);
    setSubmitting(true);
    try {
      await api.openCfdPosition({ symbol, side, quantity, leverage });
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
    <div className="cfd-order-panel">
      <div className="cfd-sideTabs">
        <button type="button" onClick={() => setSide('BUY')} className={`cfd-sideTab${side === 'BUY' ? ' buy active' : ''}`} aria-pressed={side === 'BUY'}>
          {t('futures.buyLong')}
        </button>
        <button type="button" onClick={() => setSide('SELL')} className={`cfd-sideTab${side === 'SELL' ? ' sell active' : ''}`} aria-pressed={side === 'SELL'}>
          {t('futures.sellShort')}
        </button>
      </div>

      <div className="cfd-product-terms"><span>{t('trade.market')}</span><span>{t('futures.isolated')}</span></div>
      <form onSubmit={handleSubmit} className="cfd-form">
        {config && (
          <LeverageSlider
            value={leverage}
            onChange={setLeverage}
            min={config.minLeverage}
            max={config.maxLeverage}
            warningThreshold={config.highLeverageWarningThreshold}
          />
        )}

        <label className="cfd-label">
          {t('trade.cfdMarketPrice')}
          <div className="mono cfd-input cfd-referencePrice">
            {ticker ? `≈ ${formatCfdPrice(ticker.price, symbol)}` : configured ? t('trade.loading') : t('trade.cfdUnavailable')}
          </div>
        </label>

        <label className="cfd-label">
          <span className="cfd-qtyLabelRow">
            {t('trade.quantity')}
            <span className="cfd-available">
              {t('futures.availableMargin')}: {availableMargin.toFixed(2)} USDT
            </span>
          </span>
          <input
            type="number"
            step="any"
            required
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
              setPercent(0);
            }}
            className="mono cfd-input"
            placeholder="0.00"
          />
        </label>

        <div className="cfd-percentRow">
          {PERCENT_STOPS.map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => applyPercent(pct)}
              className={`cfd-percentBtn${percent === pct ? ' active' : ''}`} aria-pressed={percent === pct}
            >
              {pct}%
            </button>
          ))}
        </div>

        <div className="cfd-infoBox">
          <div className="cfd-infoRow">
            <span className="cfd-muted">{t('futures.orderValue')}</span>
            <span className="mono">{notional.toFixed(2)} USDT</span>
          </div>
          <div className="cfd-infoRow">
            <span className="cfd-muted">{t('futures.margin')}</span>
            <span className="mono">{requiredMargin.toFixed(2)} USDT</span>
          </div>
          <div className="cfd-infoRow">
            <span className="cfd-muted">{t('futures.estLiqPrice')}</span>
            <span className={`mono ${liqPreview ? 'text-sell' : 'cfd-muted'}`}>
              {liqPreview ? formatCfdPrice(liqPreview, symbol) : '—'}
            </span>
          </div>
        </div>

        {error && <div className="cfd-error" role="alert">{error}</div>}

        <button
          type="submit"
          disabled={submitting || !ticker}
          className={`cfd-submit ${side === 'BUY' ? 'buy' : 'sell'}`}
        >
          {submitting ? t('auth.wait') : side === 'BUY' ? t('futures.buyLong') : t('futures.sellShort')}
        </button>
      </form>
    </div>
  );
}
