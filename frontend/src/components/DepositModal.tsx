import { useState } from 'react';
import { useDepositOptions } from '../lib/useDepositOptions';
import { useLanguage, localeOf } from '../lib/i18n';

/**
 * Deposit is now purely "here's the address" — no tx-hash entry. An admin
 * credits it manually from the Settings → Deposits feed (real on-chain
 * data, re-verified at credit time), so the client never needs to find and
 * paste anything. See src/pages/SettingsPage.tsx's DepositsTab.
 */
export function DepositModal({ onClose }: { onClose: () => void }) {
  const { t, lang } = useLanguage();
  const CHAIN_LABEL: Record<string, string> = {
    bitcoin: t('deposit.chain.bitcoin'),
    tron: t('deposit.chain.tron'),
    ethereum: t('deposit.chain.ethereum'),
    bsc: t('deposit.chain.bsc'),
    solana: t('deposit.chain.solana'),
    ton: t('deposit.chain.ton'),
  };
  const { chains, chainsLoaded, chain, setChain, address, assets, asset, setAsset,
    error: loadError, minDepositUsd, minEquivalent, stable } = useDepositOptions(true);
  const error = loadError ? t(loadError === 'chains' ? 'deposit.loadChainsError' : 'deposit.loadAddressError') : null;
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div className="modal-liquid-glass" style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.headerRow}>
          <h2 style={styles.title}>{t('deposit.title')}</h2>
          <button onClick={onClose} style={styles.closeBtn} aria-label={t('deposit.close')}>
            ✕
          </button>
        </div>

        <div style={styles.minBadge}>
          {minDepositUsd === null ? t('trade.loading') : asset && minEquivalent !== null && !stable
            ? t('deposit.minAmountEquivalent', {
                amount: minDepositUsd,
                equivalent: minEquivalent.toLocaleString(localeOf(lang), {
                  maximumFractionDigits: minEquivalent < 1 ? 8 : 2,
                }),
                asset,
              })
            : t('deposit.minAmountHint', { amount: minDepositUsd })}
        </div>

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

            {assets.length > 0 && (
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
            )}

            <div style={styles.success}>{t('deposit.manualCreditNote')}</div>
          </>
        )}

        {error && <div style={styles.error}>{error}</div>}
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
    maxWidth: 'calc(100vw - 24px)',
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
  addressBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    marginTop: 16,
    marginBottom: 12,
  },
  address: {
    flex: 1,
    fontSize: 12,
    wordBreak: 'break-all',
  },
  copyBtn: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 16,
    padding: '6px 12px',
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  warning: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 11,
    lineHeight: 1.5,
    marginBottom: 8,
  },
  minBadge: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--accent)',
    marginBottom: 12,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  input: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '9px 10px',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
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
};
