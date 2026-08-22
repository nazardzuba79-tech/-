import { Link } from 'react-router-dom';
import { useLanguage } from '../lib/i18n';
import { Logo } from './Logo';

/** Legal/trust footer — Terms, Privacy, Risk Disclosure plus a short risk
 * disclaimer, the way any real exchange grounds its UI in something
 * accountable instead of just a logo and a copyright line. */
export function Footer() {
  const { t } = useLanguage();

  return (
    <footer style={styles.footer}>
      <div style={styles.top}>
        <Logo />
        <nav style={styles.links}>
          <Link to="/legal/terms" style={styles.link}>
            {t('footer.terms')}
          </Link>
          <Link to="/legal/privacy" style={styles.link}>
            {t('footer.privacy')}
          </Link>
          <Link to="/legal/risk" style={styles.link}>
            {t('footer.risk')}
          </Link>
        </nav>
      </div>
      <p style={styles.disclaimer}>{t('footer.riskWarning')}</p>
      <p style={styles.copyright}>{t('footer.rights')}</p>
    </footer>
  );
}

const styles: Record<string, React.CSSProperties> = {
  footer: {
    marginTop: 48,
    paddingTop: 24,
    borderTop: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  top: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  links: { display: 'flex', gap: 20 },
  link: { fontSize: 12, color: 'var(--text-secondary)' },
  disclaimer: { fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6, maxWidth: 720, margin: 0 },
  copyright: { fontSize: 11, color: 'var(--text-tertiary)', margin: 0 },
};
