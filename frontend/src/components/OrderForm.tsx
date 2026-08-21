import { useState, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';

export function OrderForm({ pair, onPlaced }: { pair: string; onPlaced: () => void }) {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = price && quantity ? (parseFloat(price) * parseFloat(quantity)).toFixed(2) : '0.00';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.placeOrder({ pair, side, price, quantity });
      setPrice('');
      setQuantity('');
      onPlaced();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалось розмістити ордер');
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
          Купити
        </button>
        <button
          type="button"
          onClick={() => setSide('SELL')}
          style={{ ...styles.sideTab, ...(side === 'SELL' ? styles.sideTabSell : {}) }}
        >
          Продати
        </button>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          Ціна
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
        <label style={styles.label}>
          Кількість
          <input
            className="mono"
            type="number"
            step="any"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={styles.input}
            placeholder="0.00000"
          />
        </label>

        <div style={styles.total}>
          <span style={{ color: 'var(--text-secondary)' }}>Разом</span>
          <span className="mono">{total}</span>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          style={{
            ...styles.submit,
            background: side === 'BUY' ? 'var(--buy)' : 'var(--sell)',
          }}
        >
          {submitting ? 'Зачекай...' : side === 'BUY' ? 'Купити' : 'Продати'}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 6,
  },
  sideTabs: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
  },
  sideTab: {
    padding: '12px 0',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid var(--border)',
    color: 'var(--text-secondary)',
    fontWeight: 600,
    fontSize: 13,
  },
  sideTabBuy: {
    color: 'var(--buy)',
    borderBottom: '2px solid var(--buy)',
  },
  sideTabSell: {
    color: 'var(--sell)',
    borderBottom: '2px solid var(--sell)',
  },
  form: {
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '9px 10px',
    color: 'var(--text-primary)',
    fontSize: 13,
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
    borderRadius: 4,
    fontSize: 11,
  },
  submit: {
    border: 'none',
    borderRadius: 4,
    padding: '12px 0',
    color: '#0b0e11',
    fontWeight: 700,
    fontSize: 14,
  },
};
