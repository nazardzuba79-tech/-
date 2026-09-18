import { useState } from 'react';
import { useDepositWallets } from '../lib/useDepositOptions';
import { useLanguage } from '../lib/i18n';

/**
 * Deposit is now purely "here's the address" — no tx-hash entry. An admin
 * credits it manually from the Settings → Deposits feed (real on-chain
 * data, re-verified at credit time), so the client never needs to find and
 * paste anything. See src/pages/SettingsPage.tsx's DepositsTab.
 *
 * Every configured wallet is listed at once rather than hidden behind a
 * network picker: the addresses are the whole point of the screen, and one
 * of them is what the user has to reach. Each card names the exact assets
 * that chain will credit, because the address alone does not say that.
 */
export function DepositModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const CHAIN_LABEL: Record<string, string> = {
    bitcoin: t('deposit.chain.bitcoin'),
    tron: t('deposit.chain.tron'),
    ethereum: t('deposit.chain.ethereum'),
    bsc: t('deposit.chain.bsc'),
    solana: t('deposit.chain.solana'),
    ton: t('deposit.chain.ton'),
  };
  // The bare network name, for the sentence that already names the asset.
  // The card heading can say «USDT (TRC-20)»; the warning under it must not
  // read "only USDT on the USDT (TRC-20) network".
  const NETWORK_NAME: Record<string, string> = {
    bitcoin: t('deposit.network.bitcoin'),
    tron: t('deposit.network.tron'),
    ethereum: t('deposit.network.ethereum'),
    bsc: t('deposit.network.bsc'),
    solana: t('deposit.network.solana'),
    ton: t('deposit.network.ton'),
  };
  const { loaded, wallets, minDepositUsd, error: loadError } = useDepositWallets(true);
  const error = loadError ? t(loadError === 'chains' ? 'deposit.loadChainsError' : 'deposit.loadAddressError') : null;
  // Which card was copied, not a bare flag — six Copy buttons share this.
  const [copied, setCopied] = useState<string | null>(null);

  async function handleCopy(chain: string, address: string) {
    await navigator.clipboard.writeText(address);
    setCopied(chain);
    setTimeout(() => setCopied((current) => (current === chain ? null : current)), 1500);
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

        {/* Shown only once the real threshold has arrived — never a placeholder
            figure, and never a spinner left behind by a failed load. */}
        {minDepositUsd !== null && (
          <div style={styles.minBadge}>{t('deposit.minAmountHint', { amount: minDepositUsd })}</div>
        )}

        {!loaded && !error && (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('deposit.loadingNetworks')}</p>
        )}

        {loaded && wallets.length === 0 && !error && (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 12, lineHeight: 1.6 }}>{t('deposit.noneConfigured')}</p>
        )}

        {wallets.length > 0 && (
          <>
            <div style={styles.walletList}>
              {wallets.map((wallet) => (
                <div style={styles.wallet} key={wallet.chain}>
                  <div style={styles.walletHead}>
                    <span style={styles.walletChain}>{CHAIN_LABEL[wallet.chain] ?? wallet.chain}</span>
                    <span style={styles.walletAssets}>{wallet.assets.join(' · ')}</span>
                  </div>
                  <div style={styles.addressBox}>
                    <span className="mono" style={styles.address}>
                      {wallet.address}
                    </span>
                    <button
                      onClick={() => handleCopy(wallet.chain, wallet.address)}
                      style={styles.copyBtn}
                      type="button"
                      aria-label={`${t('deposit.copy')} — ${CHAIN_LABEL[wallet.chain] ?? wallet.chain}`}
                    >
                      {copied === wallet.chain ? t('deposit.copied') : t('deposit.copy')}
                    </button>
                  </div>
                  {/* Under the address it belongs to, naming that wallet's own
                      assets and network — an amber caution, not an alarm. */}
                  <p style={styles.warning}>
                    {t('deposit.warningAddress', {
                      assets: wallet.assets.join(' / '),
                      chain: NETWORK_NAME[wallet.chain] ?? wallet.chain,
                    })}
                  </p>
                </div>
              ))}
            </div>

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
  walletList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginBottom: 12,
  },
  wallet: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
  },
  walletHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  walletChain: {
    fontSize: 12,
    fontWeight: 700,
  },
  walletAssets: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    textAlign: 'right',
    wordBreak: 'break-word',
  },
  addressBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
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
  // Amber, not red. Red is the colour this app uses for a loss or a
  // failure; sending to the right address is the normal case, and a red
  // block over every wallet reads as "something is wrong here".
  warning: {
    background: 'rgba(233, 173, 53, 0.10)',
    border: '1px solid rgba(233, 173, 53, 0.30)',
    color: '#e3b45c',
    padding: '7px 9px',
    borderRadius: 8,
    fontSize: 11,
    lineHeight: 1.45,
    margin: '8px 0 0',
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
  success: {
    background: 'var(--buy-dim)',
    color: 'var(--buy)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12,
  },
  error: {
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 12,
    marginTop: 8,
  },
};
