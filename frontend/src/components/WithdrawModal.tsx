import { useEffect, useState, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage, localeOf, Key } from '../lib/i18n';

interface HeldBalance {
  asset: string;
  available: string;
}

const STATUS_KEY: Record<string, Key> = {
  PENDING: 'wallet.withdrawStatus.PENDING',
  APPROVED: 'wallet.withdrawStatus.APPROVED',
  SENT: 'wallet.withdrawStatus.SENT',
  // Legacy status value from before the two-step approve/mark-sent flow —
  // kept so any pre-existing rows still render a sensible label.
  COMPLETED: 'wallet.withdrawStatus.SENT',
  REJECTED: 'wallet.withdrawStatus.REJECTED',
};

/**
 * Client-facing withdrawal request — no automated broadcast. Submitting
 * immediately locks the amount out of `available` (see WithdrawalService),
 * then an admin reviews and approves it, sends the crypto by hand from the
 * treasury wallet, and marks the request sent (with its txid) from the
 * admin panel. That manual step is why this shows a note about turnaround
 * time instead of a progress bar — there's no on-chain status to poll until
 * the admin has actually acted.
 */
export function WithdrawModal({ asset, onClose }: { asset: string; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const [balances, setBalances] = useState<HeldBalance[]>([]);
  const [selectedAsset, setSelectedAsset] = useState(asset);
  const [network, setNetwork] = useState('');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.getMyWithdrawals>>>([]);

  useEffect(() => {
    api
      .getBalances()
      .then((res) => setBalances(res.filter((b) => parseFloat(b.available) > 0)))
      .catch(() => {});
    reloadHistory();
  }, []);

  function reloadHistory() {
    api.getMyWithdrawals().then(setHistory).catch(() => {});
  }

  const selectedBalance = balances.find((b) => b.asset === selectedAsset);

  function handleMax() {
    if (selectedBalance) setAmount(selectedBalance.available);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await api.requestWithdrawal({ asset: selectedAsset, network, toAddress: address, amount });
      setSuccess(true);
      setAmount('');
      setAddress('');
      setNetwork('');
      reloadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('wallet.withdrawError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div className="modal-liquid-glass" style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.headerRow}>
          <h2 style={styles.title}>{t('wallet.withdrawTitle')}</h2>
          <button onClick={onClose} style={styles.closeBtn} aria-label={t('deposit.close')}>
            ✕
          </button>
        </div>

        {balances.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('wallet.withdrawNoBalances')}</p>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <label style={styles.label}>
              {t('wallet.withdrawAsset')}
              <select value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)} style={styles.input}>
                {balances.map((b) => (
                  <option key={b.asset} value={b.asset}>
                    {b.asset} — {b.available}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.label}>
              {t('wallet.withdrawNetwork')}
              <input
                type="text"
                required
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                placeholder={t('wallet.withdrawNetworkPlaceholder')}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              {t('wallet.withdrawAddress')}
              <input
                type="text"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t('wallet.withdrawAddressPlaceholder')}
                style={styles.input}
                className="mono"
              />
            </label>

            <label style={styles.label}>
              {t('wallet.withdrawAmount')}
              <div style={styles.amountRow}>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ ...styles.input, flex: 1 }}
                  className="mono"
                />
                <button type="button" onClick={handleMax} style={styles.maxBtn}>
                  {t('wallet.withdrawMax')}
                </button>
              </div>
              {selectedBalance && (
                <span style={styles.hint}>
                  {t('wallet.available')}: {selectedBalance.available} {selectedBalance.asset}
                </span>
              )}
            </label>

            {error && <div style={styles.error}>{error}</div>}
            {success && <div style={styles.success}>{t('wallet.withdrawRequested')}</div>}

            <button type="submit" disabled={submitting} style={styles.submitBtn}>
              {submitting ? t('auth.wait') : t('wallet.withdrawSubmit')}
            </button>
          </form>
        )}

        <p style={styles.manualNote}>{t('wallet.withdrawManualNote')}</p>

        {history.length > 0 && (
          <div style={styles.historySection}>
            <h3 style={styles.historyTitle}>{t('wallet.withdrawHistoryTitle')}</h3>
            {history.map((w) => (
              <div key={w.id} style={styles.historyRow}>
                <span className="mono" style={{ fontWeight: 700 }}>
                  {w.amount} {w.asset}
                </span>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                  {new Date(w.createdAt).toLocaleString(localeOf(lang))}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color:
                      w.status === 'SENT' || w.status === 'COMPLETED'
                        ? 'var(--buy)'
                        : w.status === 'REJECTED'
                          ? 'var(--sell)'
                          : 'var(--accent)',
                  }}
                >
                  {t(STATUS_KEY[w.status] ?? 'wallet.withdrawStatus.PENDING')}
                </span>
              </div>
            ))}
          </div>
        )}
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
    width: 460,
    borderRadius: 8,
    padding: 24,
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 16, margin: 0 },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 16,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, color: 'var(--text-secondary)' },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '9px 10px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  amountRow: { display: 'flex', gap: 8 },
  maxBtn: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 14px',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--accent)',
  },
  hint: { fontSize: 11, color: 'var(--text-tertiary)' },
  error: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12,
  },
  success: {
    background: 'var(--buy-dim)',
    color: 'var(--buy)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12,
  },
  submitBtn: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 24,
    padding: '11px 0',
    fontWeight: 800,
    fontSize: 14,
    boxShadow: '0 4px 16px rgba(247,166,0,0.3)',
  },
  manualNote: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    lineHeight: 1.5,
    marginTop: 16,
    marginBottom: 0,
  },
  historySection: {
    marginTop: 16,
    paddingTop: 16,
    borderTop: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  historyTitle: { fontSize: 12, margin: '0 0 4px', color: 'var(--text-secondary)' },
  historyRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.4fr 0.8fr',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
  },
};
