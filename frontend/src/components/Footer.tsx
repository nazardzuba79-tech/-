import { Link } from 'react-router-dom';
import { useLanguage } from '../lib/i18n';
import { Logo } from './Logo';

/** Legal/trust footer — About, Terms, Privacy, Risk Disclosure, Support
 * plus a short risk disclaimer, the way any real exchange grounds its UI
 * in something accountable instead of just a logo and a copyright line.
 *
 * The social row is deliberately non-interactive: VOLTEX has no real
 * Twitter/Telegram/Discord accounts to link to, and a footer full of
 * fake social URLs would be worse than none — same "coming soon" honesty
 * as the AI-bots teaser elsewhere in the app (see BotsComingSoon). */
export function Footer() {
  const { t } = useLanguage();

  return (
    <footer style={styles.footer}>
      <div style={styles.top}>
        <Logo />
        <nav style={styles.links}>
          <Link to="/legal/about" style={styles.link}>
            {t('footer.about')}
          </Link>
          <Link to="/legal/terms" style={styles.link}>
            {t('footer.terms')}
          </Link>
          <Link to="/legal/privacy" style={styles.link}>
            {t('footer.privacy')}
          </Link>
          <Link to="/legal/risk" style={styles.link}>
            {t('footer.risk')}
          </Link>
          <Link to="/legal/support" style={styles.link}>
            {t('footer.support')}
          </Link>
        </nav>
        <SocialRow label={t('footer.social')} soon={t('nav.botsSoon')} />
      </div>
      <p style={styles.disclaimer}>{t('footer.riskWarning')}</p>
      <p style={styles.copyright}>{t('footer.rights')}</p>
    </footer>
  );
}

function SocialRow({ label, soon }: { label: string; soon: string }) {
  return (
    <div style={styles.social} title={`${label} — ${soon}`}>
      <SocialIcon>
        <path d="M22 5.8c-.7.3-1.5.5-2.3.6.8-.5 1.5-1.3 1.8-2.3-.8.5-1.6.8-2.5 1a4 4 0 0 0-6.8 3.6A11.3 11.3 0 0 1 3.9 4.6a4 4 0 0 0 1.2 5.3c-.6 0-1.2-.2-1.7-.5v.1a4 4 0 0 0 3.2 3.9c-.6.2-1.2.2-1.8.1a4 4 0 0 0 3.7 2.8A8 8 0 0 1 2 17.9a11.3 11.3 0 0 0 6.1 1.8c7.3 0 11.3-6.1 11.3-11.3v-.5c.8-.6 1.4-1.3 1.9-2.1z" />
      </SocialIcon>
      <SocialIcon>
        <path d="M21.9 4.6 18.7 20c-.2 1.1-.9 1.3-1.8.8l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.3-8.4c.4-.4-.1-.6-.6-.2L6 12.8l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6l19-7.4c.9-.3 1.7.2 1.6 1.3z" />
      </SocialIcon>
      <SocialIcon>
        <path d="M9 19c-4.4 1.2-4.4-2.1-6-2.5m12 4.5v-3.2c0-.9.3-1.5.7-1.8-2.5-.3-5.1-1.2-5.1-5.5 0-1.2.4-2.2 1.2-3-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3 0 4.3-2.6 5.2-5.1 5.5.4.4.8 1 .8 2.1V21" />
      </SocialIcon>
    </div>
  );
}

function SocialIcon({ children }: { children: React.ReactNode }) {
  return (
    <span style={styles.socialIcon}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
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
  links: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  link: { fontSize: 12, color: 'var(--text-secondary)' },
  social: { display: 'flex', gap: 8, cursor: 'default' },
  socialIcon: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: '1px solid var(--border)',
    color: 'var(--text-tertiary)',
    opacity: 0.5,
  },
  disclaimer: { fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6, maxWidth: 720, margin: 0 },
  copyright: { fontSize: 11, color: 'var(--text-tertiary)', margin: 0 },
};
