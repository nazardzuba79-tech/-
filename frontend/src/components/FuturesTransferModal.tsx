import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';

/** Moves funds between the spot and futures wallets — the futures wallet
 * is a fully separate balance (see FuturesBalance's schema comment), so
 * without this there would be no way to actually get margin into it. */
export function FuturesTransferModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const [direction, setDirection] = useState<'TO_FUTURES' | 'TO_SPOT'>('TO_FUTURES');
  const [asset, setAsset] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [spotAvailable, setSpotAvailable] = useState(0);
  const [futuresAvailable, setFuturesAvailable] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function loadBalances() {
    api
      .getBalances()
      .then((balances) => setSpotAvailable(parseFloat(balances.find((b) => b.asset === asset)?.available ?? '0')))
      .catch(() => {});
    api
      .getFuturesBalances()
      .then((balances) => setFuturesAvailable(parseFloat(balances.find((b) => b.asset === asset)?.available ?? '0')))
      .catch(() => {});
  }

  useEffect(loadBalances, [asset]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.transferFuturesFunds(asset, amount, direction);
      setAmount('');
      setDone(true);
      loadBalances();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('futures.transferError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.headerRow}>
          <h3 style={styles.title}>{t('futures.transfer')}</h3>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.directionTabs}>
          <button
            type="button"
            onClick={() => setDirection('TO_FUTURES')}
            style={{ ...styles.dirTab, ...(direction === 'TO_FUTURES' ? styles.dirTabActive : {}) }}
          >
            {t('futures.transferToFutures')}
          </button>
          <button
            type="button"
            onClick={() => setDirection('TO_SPOT')}
            style={{ ...styles.dirTab, ...(direction === 'TO_SPOT' ? styles.dirTabActive : {}) }}
          >
            {t('futures.transferToSpot')}
          </button>
        </div>

        <div style={styles.balanceRow}>
          <span>{t('futures.spotWallet')}: <span className="mono">{spotAvailable.toFixed(2)} {asset}</span></span>
          <span>{t('futures.futuresWallet')}: <span className="mono">{futuresAvailable.toFixed(2)} {asset}</span></span>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <select value={asset} onChange={(e) => setAsset(e.target.value)} style={styles.input}>
            <option value="USDT">USDT</option>
          </select>
          <input
            className="mono"
            type="number"
            step="any"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('futures.amount')}
            style={styles.input}
          />

          {error && <div style={styles.error}>{error}</div>}
          {done && !error && <div style={styles.success}>✓</div>}

          <button type="submit" disabled={submitting} style={styles.submit}>
            {submitting ? t('auth.wait') : t('futures.confirm')}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: {
    width: 380,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 22,
    boxShadow: 'var(--shadow-lg)',
  },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 15, margin: 0 },
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 16 },
  directionTabs: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
    background: 'var(--panel-alt)',
    borderRadius: 8,
    padding: 3,
    marginBottom: 14,
  },
  dirTab: {
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    padding: '8px 0',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  dirTabActive: { background: 'var(--panel)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-sm)' },
  balanceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: 'var(--text-secondary)',
    marginBottom: 14,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 10 },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  error: { background: 'var(--sell-dim)', color: 'var(--sell)', padding: '6px 10px', borderRadius: 6, fontSize: 11 },
  success: { background: 'var(--buy-dim)', color: 'var(--buy)', padding: '6px 10px', borderRadius: 6, fontSize: 12, textAlign: 'center' },
  submit: {
    border: 'none',
    borderRadius: 24,
    padding: '12px 0',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontWeight: 800,
    fontSize: 13,
  },
};
