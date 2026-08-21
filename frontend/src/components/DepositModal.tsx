import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';

export function DepositModal({ onClose }: { onClose: () => void }) {
  const [chain] = useState('ethereum');
  const [address, setAddress] = useState<string | null>(null);
  const [assets, setAssets] = useState<string[]>([]);
  const [asset, setAsset] = useState('');
  const [txHash, setTxHash] = useState('');
  const [result, setResult] = useState<{ status: string; amount: string; confirmations: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .getDepositAddress(chain)
      .then((res) => {
        setAddress(res.address);
        setAssets(res.supportedAssets);
        setAsset(res.supportedAssets[0] ?? '');
      })
      .catch(() => setError('Не вдалось завантажити адресу для депозиту'));
  }, [chain]);

  async function handleCopy() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleClaim(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.claimDeposit(chain, txHash, asset);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалось перевірити депозит');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.headerRow}>
          <h2 style={styles.title}>Поповнення</h2>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Закрити">
            ✕
          </button>
        </div>

        <p style={styles.hint}>
          Надішли крипту на адресу нижче зі свого гаманця (MetaMask тощо), потім встав хеш транзакції — баланс
          зарахується автоматично, після перевірки в мережі.
        </p>

        <div style={styles.addressBox}>
          <span className="mono" style={styles.address}>
            {address ?? 'Завантаження...'}
          </span>
          <button onClick={handleCopy} style={styles.copyBtn} type="button" disabled={!address}>
            {copied ? 'Скопійовано' : 'Копіювати'}
          </button>
        </div>

        <form onSubmit={handleClaim} style={styles.form}>
          <label style={styles.label}>
            Актив
            <select value={asset} onChange={(e) => setAsset(e.target.value)} style={styles.input}>
              {assets.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            Хеш транзакції
            <input
              className="mono"
              type="text"
              required
              placeholder="0x..."
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              style={styles.input}
            />
          </label>

          {error && <div style={styles.error}>{error}</div>}
          {result && (
            <div style={styles.success}>
              {result.status === 'CREDITED'
                ? `Зараховано ${result.amount} ${asset}`
                : `Знайдено, очікує підтверджень (${result.confirmations})`}
            </div>
          )}

          <button type="submit" disabled={submitting || !address} style={styles.submit}>
            {submitting ? 'Перевіряємо...' : 'Перевірити і зарахувати'}
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
    width: 420,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 24,
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    margin: 0,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 16,
  },
  hint: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    marginBottom: 16,
  },
  addressBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '10px 12px',
    marginBottom: 20,
  },
  address: {
    flex: 1,
    fontSize: 12,
    wordBreak: 'break-all',
  },
  copyBtn: {
    background: 'var(--accent)',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 4,
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
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
  error: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '8px 10px',
    borderRadius: 4,
    fontSize: 12,
  },
  success: {
    background: 'var(--buy-dim)',
    color: 'var(--buy)',
    padding: '8px 10px',
    borderRadius: 4,
    fontSize: 12,
  },
  submit: {
    background: 'var(--accent)',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 4,
    padding: '11px 0',
    fontWeight: 700,
    fontSize: 14,
  },
};
