import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useToast } from '../lib/toast';
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
    <div style={styles.panel}>
      <div style={styles.sideTabs}>
        <button type="button" onClick={() => setSide('BUY')} style={{ ...styles.sideTab, ...(side === 'BUY' ? styles.sideTabBuy : {}) }}>
          {t('futures.buyLong')}
        </button>
        <button type="button" onClick={() => setSide('SELL')} style={{ ...styles.sideTab, ...(side === 'SELL' ? styles.sideTabSell : {}) }}>
          {t('futures.sellShort')}
        </button>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        {config && (
          <LeverageSlider
            value={leverage}
            onChange={setLeverage}
            min={config.minLeverage}
            max={config.maxLeverage}
            warningThreshold={config.highLeverageWarningThreshold}
          />
        )}

        <label style={styles.label}>
          {t('trade.cfdMarketPrice')}
          <div style={{ ...styles.input, color: 'var(--text-tertiary)' }} className="mono">
            {ticker ? `≈ ${ticker.price}` : configured ? t('trade.loading') : t('trade.cfdUnavailable')}
          </div>
        </label>

        <label style={styles.label}>
          <span style={styles.qtyLabelRow}>
            {t('trade.quantity')}
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
              {t('futures.availableMargin')}: {availableMargin.toFixed(2)} USDT
            </span>
          </span>
          <input
            className="mono"
            type="number"
            step="any"
            required
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
              setPercent(0);
            }}
            style={styles.input}
            placeholder="0.00"
          />
        </label>

        <div style={styles.percentRow}>
          {PERCENT_STOPS.map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => applyPercent(pct)}
              style={{ ...styles.percentBtn, ...(percent === pct ? styles.percentBtnActive : {}) }}
            >
              {pct}%
            </button>
          ))}
        </div>

        <div style={styles.infoBox}>
          <div style={styles.infoRow}>
            <span style={{ color: 'var(--text-secondary)' }}>{t('futures.orderValue')}</span>
            <span className="mono">{notional.toFixed(2)} USDT</span>
          </div>
          <div style={styles.infoRow}>
            <span style={{ color: 'var(--text-secondary)' }}>{t('futures.margin')}</span>
            <span className="mono">{requiredMargin.toFixed(2)} USDT</span>
          </div>
          <div style={styles.infoRow}>
            <span style={{ color: 'var(--text-secondary)' }}>{t('futures.estLiqPrice')}</span>
            <span className="mono" style={{ color: liqPreview ? 'var(--sell)' : 'var(--text-tertiary)' }}>
              {liqPreview ? liqPreview.toFixed(2) : '—'}
            </span>
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          type="submit"
          disabled={submitting || !ticker}
          style={{
            ...styles.submit,
            background: side === 'BUY' ? 'var(--buy)' : 'var(--sell)',
            boxShadow: side === 'BUY' ? '0 4px 16px rgba(0,214,143,0.3)' : '0 4px 16px rgba(255,77,106,0.3)',
          }}
        >
          {submitting ? t('auth.wait') : side === 'BUY' ? t('futures.buyLong') : t('futures.sellShort')}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' },
  sideTabs: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
    background: 'var(--panel-alt)',
    borderRadius: 10,
    padding: 4,
    margin: 10,
  },
  sideTab: { padding: '10px 0', background: 'transparent', border: 'none', borderRadius: 8, color: 'var(--text-secondary)', fontWeight: 700, fontSize: 13 },
  sideTabBuy: { color: 'var(--on-accent)', background: 'var(--buy)' },
  sideTabSell: { color: 'var(--on-accent)', background: 'var(--sell)' },
  form: { padding: '14px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11, color: 'var(--text-secondary)' },
  qtyLabelRow: { display: 'flex', justifyContent: 'space-between', fontSize: 11 },
  input: { background: 'var(--panel-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 13 },
  percentRow: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 },
  percentBtn: { background: 'var(--panel-alt)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 0', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600 },
  percentBtnActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--on-accent)' },
  infoBox: { background: 'var(--panel-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  infoRow: { display: 'flex', justifyContent: 'space-between', fontSize: 12 },
  error: { background: 'var(--sell-dim)', color: 'var(--sell)', padding: '6px 10px', borderRadius: 6, fontSize: 11 },
  submit: { border: 'none', borderRadius: 10, padding: '14px 0', color: 'var(--on-accent)', fontWeight: 800, fontSize: 14, letterSpacing: '0.01em' },
};
