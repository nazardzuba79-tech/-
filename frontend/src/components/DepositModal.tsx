import { useState, useEffect, FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useLanguage } from '../lib/i18n';

export function DepositModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const CHAIN_LABEL: Record<string, string> = {
    bitcoin: t('deposit.chain.bitcoin'),
    tron: t('deposit.chain.tron'),
  };
  const [chains, setChains] = useState<{ chain: string; nativeAsset: string; tokens: string[] }[]>([]);
  const [chainsLoaded, setChainsLoaded] = useState(false);
  const [chain, setChain] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [assets, setAssets] = useState<string[]>([]);
  const [asset, setAsset] = useState('');
  const [txHash, setTxHash] = useState('');
  const [result, setResult] = useState<{ status: string; amount: string; confirmations: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Only ever offer chains the backend has a treasury address configured
  // for — this is what stops someone from being shown a network/address
  // this deployment can't actually verify a deposit on.
  useEffect(() => {
    api
      .getDepositChains()
      .then((res) => {
        setChains(res);
        if (res.length > 0) setChain(res[0].chain);
      })
      .catch(() => setError(t('deposit.loadChainsError')))
      .finally(() => setChainsLoaded(true));
  }, []);

  useEffect(() => {
    if (!chain) return;
    setAddress(null);
    setTxHash('');
    setResult(null);
    api
      .getDepositAddress(chain)
      .then((res) => {
        setAddress(res.address);
        setAssets(res.supportedAssets);
        setAsset(res.supportedAssets[0] ?? '');
      })
      .catch(() => setError(t('deposit.loadAddressError')));
  }, [chain]);

  async function handleCopy() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleClaim(e: FormEvent) {
    e.preventDefault();
    if (!chain) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.claimDeposit(chain, txHash, asset);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('deposit.claimError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.headerRow}>
          <h2 style={styles.title}>{t('deposit.title')}</h2>
          <button onClick={onClose} style={styles.closeBtn} aria-label={t('deposit.close')}>
            ✕
          </button>
        </div>

        <p style={styles.hint}>{t('deposit.hint')}</p>

        {!chainsLoaded && !error && (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('deposit.loadingNetworks')}</p>
        )}

        {chainsLoaded && chains.length === 0 && !error && (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('deposit.noneConfigured')}</p>
        )}

        {chains.length > 0 && (
          <>
            <label style={styles.label}>
              {t('deposit.network')}
              <select value={chain ?? ''} onChange={(e) => setChain(e.target.value)} style={styles.input}>
                {chains.map((c) => (
                  <option key={c.chain} value={c.chain}>
                    {CHAIN_LABEL[c.chain] ?? c.chain}
                  </option>
                ))}
              </select>
            </label>

            <div style={styles.addressBox}>
              <span className="mono" style={styles.address}>
                {address ?? t('trade.loading')}
              </span>
              <button onClick={handleCopy} style={styles.copyBtn} type="button" disabled={!address}>
                {copied ? t('deposit.copied') : t('deposit.copy')}
              </button>
            </div>

            <div style={styles.warning}>
              {t('deposit.warning', {
                assets: assets.join(' / ') || t('deposit.supportedAssets'),
                chain: CHAIN_LABEL[chain ?? ''] ?? chain ?? '',
              })}
            </div>

            <form onSubmit={handleClaim} style={styles.form}>
              <label style={styles.label}>
                {t('deposit.asset')}
                <select value={asset} onChange={(e) => setAsset(e.target.value)} style={styles.input}>
                  {assets.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <label style={styles.label}>
                {t('deposit.txHash')}
                <input
                  className="mono"
                  type="text"
                  required
                  placeholder={t('deposit.txHashPlaceholder')}
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  style={styles.input}
                />
              </label>

              {error && <div style={styles.error}>{error}</div>}
              {result && (
                <div style={styles.success}>
                  {result.status === 'CREDITED'
                    ? t('deposit.credited', { amount: result.amount, asset })
                    : t('deposit.pending', { confirmations: result.confirmations })}
                </div>
              )}

              <button type="submit" disabled={submitting || !address} style={styles.submit}>
                {submitting ? t('deposit.checking') : t('deposit.checkAndCredit')}
              </button>
            </form>
          </>
        )}

        {chains.length === 0 && error && <div style={styles.error}>{error}</div>}
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
    width: 440,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 24,
    maxHeight: '90vh',
    overflowY: 'auto',
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
    marginTop: 14,
    marginBottom: 12,
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
  warning: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '8px 10px',
    borderRadius: 4,
    fontSize: 11,
    lineHeight: 1.5,
    marginBottom: 16,
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
