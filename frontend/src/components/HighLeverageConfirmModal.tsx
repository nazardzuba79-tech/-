import { useLanguage } from '../lib/i18n';

/** Shown before submitting an order at leverage above the warning
 * threshold — a deliberate extra step between "moved the slider" and
 * "actually opened the position". */
export function HighLeverageConfirmModal({
  leverage,
  onConfirm,
  onCancel,
}: {
  leverage: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div className="modal-liquid-glass" style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.title}>{t('futures.leverageWarningTitle')}</h3>
        <p style={styles.body}>{t('futures.leverageWarningBody', { leverage })}</p>
        <div style={styles.actions}>
          <button type="button" onClick={onCancel} style={styles.cancelBtn}>
            {t('futures.cancel')}
          </button>
          <button type="button" onClick={onConfirm} style={styles.confirmBtn}>
            {t('futures.confirm')}
          </button>
        </div>
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
    zIndex: 150,
  },
  modal: {
    width: 400,
    border: '1px solid var(--sell)',
    borderRadius: 10,
    padding: 22,
  },
  title: { fontSize: 15, margin: '0 0 10px', color: 'var(--sell)' },
  body: { fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', margin: '0 0 18px' },
  actions: { display: 'flex', gap: 10 },
  cancelBtn: {
    flex: 1,
    border: '1px solid var(--border)',
    background: 'transparent',
    borderRadius: 20,
    padding: '10px 0',
    color: 'var(--text-secondary)',
    fontWeight: 700,
    fontSize: 13,
  },
  confirmBtn: {
    flex: 1,
    border: 'none',
    background: 'var(--sell)',
    borderRadius: 20,
    padding: '10px 0',
    color: 'var(--on-accent)',
    fontWeight: 800,
    fontSize: 13,
  },
};
