import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';

const PERCENT_STOPS = [0, 25, 50, 75, 100];

export function OrderForm({ pair, onPlaced }: { pair: string; onPlaced: () => void }) {
  const { t } = useLanguage();
  const [baseAsset, quoteAsset] = pair.split('/');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [type, setType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [percent, setPercent] = useState(0);
  const [available, setAvailable] = useState<{ base: number; quote: number }>({ base: 0, quote: 0 });
  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .getBalances()
      .then((balances) => {
        const base = balances.find((b) => b.asset === baseAsset);
        const quote = balances.find((b) => b.asset === quoteAsset);
        setAvailable({ base: base ? parseFloat(base.available) : 0, quote: quote ? parseFloat(quote.available) : 0 });
      })
      .catch(() => {});
  }, [baseAsset, quoteAsset, side]);

  // MARKET orders don't take a price from the user — a reference price
  // (from the same Kraken mirror the trade page already uses) is only for
  // sizing the % slider and showing an estimated total, not for what the
  // order actually executes at.
  useEffect(() => {
    if (type !== 'MARKET') return;
    let cancelled = false;
    function load() {
      api
        .getExternalTicker(pair)
        .then((res) => !cancelled && setMarketPrice(parseFloat(res.ticker.lastPrice)))
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [type, pair]);

  const effectivePrice = type === 'LIMIT' ? parseFloat(price) : marketPrice ?? 0;
  const total = effectivePrice && quantity ? (effectivePrice * parseFloat(quantity)).toFixed(2) : '0.00';

  // % slider spends a share of whichever balance funds this side of the
  // trade — quote balance (e.g. USDT) for a buy, base balance (e.g. BTC)
  // for a sell — same idea as the slider on a real exchange's order form,
  // just driven by our own real balances instead of a fake number.
  function applyPercent(pct: number) {
    setPercent(pct);
    if (side === 'BUY') {
      if (!effectivePrice || effectivePrice <= 0) return;
      setQuantity(((available.quote * (pct / 100)) / effectivePrice).toFixed(8));
    } else {
      setQuantity((available.base * (pct / 100)).toFixed(8));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.placeOrder({ pair, side, type, price: type === 'LIMIT' ? price : undefined, quantity });
      setPrice('');
      setQuantity('');
      setPercent(0);
      onPlaced();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('trade.placeOrderError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.panel}>
      <div style={styles.sideTabs}>
        <button
          type="button"
          onClick={() => setSide('BUY')}
          style={{ ...styles.sideTab, ...(side === 'BUY' ? styles.sideTabBuy : {}) }}
        >
          {t('trade.buy')}
        </button>
        <button
          type="button"
          onClick={() => setSide('SELL')}
          style={{ ...styles.sideTab, ...(side === 'SELL' ? styles.sideTabSell : {}) }}
        >
          {t('trade.sell')}
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
            {t('trade.price')}
            <div style={{ ...styles.input, color: 'var(--text-tertiary)' }} className="mono">
              {marketPrice !== null ? `≈ ${marketPrice}` : t('trade.loading')} {quoteAsset}
            </div>
          </label>
        )}
        <label style={styles.label}>
          <span style={styles.qtyLabelRow}>
            {t('trade.quantity')}
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
              {t('trade.available')}: {(side === 'BUY' ? available.quote : available.base).toFixed(side === 'BUY' ? 2 : 6)}{' '}
              {side === 'BUY' ? quoteAsset : baseAsset}
            </span>
          </span>
          <div style={styles.qtyInputRow}>
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
              style={{ ...styles.input, flex: 1 }}
              placeholder="0.00000"
            />
            <span style={styles.qtyAsset}>{baseAsset}</span>
          </div>
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

        <div style={styles.total}>
          <span style={{ color: 'var(--text-secondary)' }}>{t('trade.total')}</span>
          <span className="mono">
            {total} {quoteAsset}
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
          {submitting
            ? t('auth.wait')
            : `${side === 'BUY' ? t('trade.buy') : t('trade.sell')} ${baseAsset}`}
        </button>
      </form>
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
  sideTabBuy: {
    color: 'var(--on-accent)',
    background: 'var(--buy)',
  },
  sideTabSell: {
    color: 'var(--on-accent)',
    background: 'var(--sell)',
  },
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
  typeTabActive: {
    color: 'var(--accent)',
  },
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
  qtyInputRow: { display: 'flex', alignItems: 'center', gap: 8 },
  qtyAsset: {
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-secondary)',
    padding: '0 4px',
  },
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
