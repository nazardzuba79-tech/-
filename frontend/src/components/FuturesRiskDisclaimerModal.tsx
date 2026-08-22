import { useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';

/** Mandatory risk disclaimer shown the first time a user enters the futures
 * section. The checkbox is a UX nicety — the real gate is server-side
 * (see requireRiskAck in api/routes/futures.ts): even if this modal were
 * somehow bypassed client-side, order placement would still be rejected. */
export function FuturesRiskDisclaimerModal({ onAccepted }: { onAccepted: () => void }) {
  const { t } = useLanguage();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleAccept() {
    setSubmitting(true);
    try {
      await api.acknowledgeFuturesRisk();
      onAccepted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h3 style={styles.title}>{t('futures.riskDisclaimerTitle')}</h3>
        <p style={styles.body}>{t('futures.riskDisclaimerBody')}</p>
        <label style={styles.checkboxRow}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {t('futures.riskDisclaimerCheckbox')}
        </label>
        <button type="button" disabled={!checked || submitting} onClick={handleAccept} style={styles.accept}>
          {t('futures.riskDisclaimerAccept')}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  modal: {
    width: 460,
    background: 'var(--panel)',
    border: '1px solid var(--sell)',
    borderRadius: 10,
    padding: 24,
    boxShadow: 'var(--shadow-lg)',
  },
  title: { fontSize: 17, margin: '0 0 12px', color: 'var(--sell)' },
  body: { fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', margin: '0 0 18px' },
  checkboxRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    fontSize: 12,
    color: 'var(--text-primary)',
    marginBottom: 18,
    cursor: 'pointer',
  },
  accept: {
    width: '100%',
    border: 'none',
    borderRadius: 24,
    padding: '13px 0',
    background: 'var(--sell)',
    color: 'var(--on-accent)',
    fontWeight: 800,
    fontSize: 14,
  },
};
