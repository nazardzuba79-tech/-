import { useLanguage } from '../lib/i18n';

/**
 * Informational only — there's no real OTC desk, dark-pool matching, or
 * dedicated account-manager workflow behind this app. Rather than fake a
 * trading interface for something that doesn't exist, this states the
 * real eligibility bar and points to support, same honesty pattern as
 * the disabled Withdraw action and the Card waitlist elsewhere in the app.
 */
export function OtcPanel() {
  const { t } = useLanguage();

  return (
    <div style={styles.wrap}>
      <div style={styles.icon}>◆</div>
      <div style={styles.title}>{t('trade.otcTitle')}</div>
      <p style={styles.text}>{t('trade.otcDisclaimer')}</p>
      <p style={styles.hint}>{t('trade.otcContact')}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '32px 20px',
    gap: 10,
  },
  icon: {
    fontSize: 22,
    color: 'var(--accent)',
    marginBottom: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: 800,
    color: 'var(--text-primary)',
  },
  text: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    margin: 0,
    maxWidth: 260,
  },
  hint: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    margin: 0,
    maxWidth: 260,
    lineHeight: 1.4,
  },
};
