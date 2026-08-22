import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { LeverageSlider } from './LeverageSlider';
import { MarginTypeToggle } from './MarginTypeToggle';
import { HighLeverageConfirmModal } from './HighLeverageConfirmModal';

const PERCENT_STOPS = [0, 25, 50, 75, 100];

export function FuturesOrderForm({ symbol, onPlaced }: { symbol: string; onPlaced: () => void }) {
  const { t } = useLanguage();
  const [, quoteAsset] = symbol.split('/');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [type, setType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [percent, setPercent] = useState(0);
  const [leverage, setLeverage] = useState(10);
  const [marginType, setMarginType] = useState<'ISOLATED' | 'CROSS'>('ISOLATED');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [availableMargin, setAvailableMargin] = useState(0);
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [config, setConfig] = useState<{ minLeverage: number; maxLeverage: number; highLeverageWarningThreshold: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showLeverageConfirm, setShowLeverageConfirm] = useState(false);

  useEffect(() => {
    api.getFuturesConfig().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    api
      .getFuturesBalances()
      .then((balances) => {
        const b = balances.find((x) => x.asset === quoteAsset);
        setAvailableMargin(b ? parseFloat(b.available) : 0);
      })
      .catch(() => {});
  }, [quoteAsset, side]);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('futures.placeOrderError'));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (config && leverage >= config.highLeverageWarningThreshold) {
      setShowLeverageConfirm(true);
      return;
    }
    submitOrder();
  }

  return (
    <div style={styles.panel}>
      <div style={styles.sideTabs}>
        <button
          type="button"
          onClick={() => setSide('BUY')}
          style={{ ...styles.sideTab, ...(side === 'BUY' ? styles.sideTabBuy : {}) }}
        >
          {t('futures.buyLong')}
        </button>
        <button
          type="button"
          onClick={() => setSide('SELL')}
          style={{ ...styles.sideTab, ...(side === 'SELL' ? styles.sideTabSell : {}) }}
        >
          {t('futures.sellShort')}
        </button>
      </div>

      <div style={styles.typeTabs}>
        <button
          type="button"
          onClick={() => setType('LIMIT')}
          style={{ ...styles.typeTab, ...(type === 'LIMIT' ? styles.typeTabActive : {}) }}
        >
          {t('trade.limitOrder')}
        </button>
        <button
          type="button"
          onClick={() => setType('MARKET')}
          style={{ ...styles.typeTab, ...(type === 'MARKET' ? styles.typeTabActive : {}) }}
        >
          {t('trade.marketOrder')}
        </button>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        <MarginTypeToggle value={marginType} onChange={setMarginType} />

        {config && (
          <LeverageSlider
            value={leverage}
            onChange={setLeverage}
            min={config.minLeverage}
            max={config.maxLeverage}
            warningThreshold={config.highLeverageWarningThreshold}
          />
        )}

        {type === 'LIMIT' ? (
          <label style={styles.label}>
            {t('trade.price')}
            <input
              className="mono"
              type="number"
              step="any"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              style={styles.input}
              placeholder="0.00"
            />
          </label>
        ) : (
          <label style={styles.label}>
            {t('futures.markPrice')}
            <div style={{ ...styles.input, color: 'var(--text-tertiary)' }} className="mono">
              {markPrice !== null ? `≈ ${markPrice}` : t('trade.loading')} {quoteAsset}
            </div>
          </label>
        )}

        <label style={styles.label}>
          <span style={styles.qtyLabelRow}>
            {t('trade.quantity')}
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
              {t('futures.availableMargin')}: {availableMargin.toFixed(2)} {quoteAsset}
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
            placeholder="0.00000"
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

        <label style={styles.reduceOnlyRow}>
          <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />
          {t('futures.reduceOnly')}
        </label>

        <div style={styles.total}>
          <span style={{ color: 'var(--text-secondary)' }}>{t('futures.margin')}</span>
          <span className="mono">
            {requiredMargin.toFixed(2)} {quoteAsset}
          </span>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          style={{
            ...styles.submit,
            background: side === 'BUY' ? 'var(--buy)' : 'var(--sell)',
            boxShadow: side === 'BUY' ? '0 4px 16px rgba(0,214,143,0.3)' : '0 4px 16px rgba(255,77,106,0.3)',
          }}
        >
          {submitting ? t('auth.wait') : side === 'BUY' ? t('futures.buyLong') : t('futures.sellShort')}
        </button>
      </form>

      {showLeverageConfirm && (
        <HighLeverageConfirmModal
          leverage={leverage}
          onCancel={() => setShowLeverageConfirm(false)}
          onConfirm={() => {
            setShowLeverageConfirm(false);
            submitOrder();
          }}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  sideTabs: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    padding: 8,
    gap: 8,
  },
  sideTab: {
    padding: '10px 0',
    background: 'var(--panel-alt)',
    border: 'none',
    borderRadius: 8,
    color: 'var(--text-secondary)',
    fontWeight: 700,
    fontSize: 13,
  },
  sideTabBuy: { color: 'var(--on-accent)', background: 'var(--buy)' },
  sideTabSell: { color: 'var(--on-accent)', background: 'var(--sell)' },
  typeTabs: {
    display: 'flex',
    gap: 16,
    padding: '0 14px 10px',
    borderBottom: '1px solid var(--border)',
  },
  typeTab: {
    background: 'transparent',
    border: 'none',
    padding: '2px 0',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
  },
  typeTabActive: { color: 'var(--accent)' },
  form: {
    padding: '14px 14px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  qtyLabelRow: { display: 'flex', justifyContent: 'space-between', fontSize: 11 },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  percentRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 8,
  },
  percentBtn: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '6px 0',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 600,
  },
  percentBtnActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: 'var(--on-accent)',
  },
  reduceOnlyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: 'var(--text-secondary)',
  },
  total: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    padding: '6px 0',
  },
  error: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '6px 10px',
    borderRadius: 6,
    fontSize: 11,
  },
  submit: {
    border: 'none',
    borderRadius: 24,
    padding: '14px 0',
    color: 'var(--on-accent)',
    fontWeight: 800,
    fontSize: 14,
    letterSpacing: '0.01em',
  },
};
