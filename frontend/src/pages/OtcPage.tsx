import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { useLanguage } from '../lib/i18n';

/**
 * Informational only — there's no real OTC desk, dark-pool matching, or
 * dedicated account-manager workflow behind this app. Rather than fake a
 * trading interface for something that doesn't exist, this states the
 * real eligibility bar and points to support, same honesty pattern as
 * the disabled Withdraw action and the Card waitlist elsewhere in the app.
 * A standalone top-nav page (not a sub-tab of the order book) so it reads
 * as a real, separate product rather than something bolted onto the trade
 * screen.
 */
export function OtcPage() {
  const { t } = useLanguage();

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav active="/otc" />
      <main style={styles.main}>
        <div className="accent-edge surface-raised" style={styles.card}>
          <div style={styles.icon}>◆</div>
          <h1 style={styles.title}>{t('trade.otcTitle')}</h1>
          <p style={styles.text}>{t('trade.otcDisclaimer')}</p>
          <p style={styles.hint}>{t('trade.otcContact')}</p>
        </div>
        <Footer />
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  main: { padding: 32, maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 },
  card: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '48px 32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 12,
  },
  icon: { fontSize: 30, color: 'var(--accent)' },
  title: { fontSize: 22, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  text: { fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, maxWidth: 420 },
  hint: { fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, margin: 0, maxWidth: 420 },
};
