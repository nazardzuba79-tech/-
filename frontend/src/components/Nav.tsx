import { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearToken } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { BalanceStrip } from './BalanceStrip';
import { Logo } from './Logo';

/**
 * Shared top navigation, used on every page after login. `middle` renders
 * extra content right after the nav links (e.g. the trade page's pair
 * label); `rightExtra` renders a button before the balance/settings/logout
 * cluster (e.g. the trade page's deposit button).
 */
export function Nav({
  active,
  middle,
  rightExtra,
}: {
  active: string;
  middle?: ReactNode;
  rightExtra?: ReactNode;
}) {
  const navigate = useNavigate();
  const { t, lang, setLang } = useLanguage();

  const LINKS = [
    { to: '/trade', label: t('nav.trade') },
    { to: '/markets', label: t('nav.markets') },
    { to: '/products', label: t('nav.products') },
  ];

  function handleLogout() {
    clearToken();
    navigate('/');
  }

  return (
    <nav style={styles.nav}>
      <Link to="/trade" style={styles.logo}>
        <Logo />
      </Link>
      {LINKS.map((l) => (
        <Link key={l.to} to={l.to} style={{ ...styles.link, ...(active === l.to ? styles.linkActive : {}) }}>
          {l.label}
        </Link>
      ))}
      <Link
        to="/card"
        style={{ ...styles.link, ...styles.cardLink, ...(active === '/card' ? styles.linkActive : {}) }}
      >
        <CardIcon active={active === '/card'} />
        {t('nav.card')}
      </Link>
      {middle}
      <div style={styles.right}>
        <BalanceStrip />
        {rightExtra}
        <div style={styles.langSwitch}>
          <button
            onClick={() => setLang('ru')}
            style={{ ...styles.langBtn, ...(lang === 'ru' ? styles.langBtnActive : {}) }}
          >
            RU
          </button>
          <button
            onClick={() => setLang('en')}
            style={{ ...styles.langBtn, ...(lang === 'en' ? styles.langBtnActive : {}) }}
          >
            EN
          </button>
        </div>
        <Link to="/settings" style={styles.settingsLink} title={t('nav.settings')} aria-label={t('nav.settings')}>
          <GearIcon active={active === '/settings'} />
        </Link>
        <button onClick={handleLogout} style={styles.logoutBtn}>
          {t('nav.logout')}
        </button>
      </div>
    </nav>
  );
}

function CardIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? 'var(--text-primary)' : 'var(--text-secondary)'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

function GearIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? 'var(--text-primary)' : 'var(--text-secondary)'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    padding: '0 20px',
    height: 56,
    borderBottom: '1px solid var(--border)',
    background: 'var(--panel)',
    flexShrink: 0,
  },
  logo: {
    fontFamily: 'var(--font-mono)',
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: '0.05em',
  },
  link: {
    fontSize: 13,
    color: 'var(--text-secondary)',
  },
  linkActive: {
    color: 'var(--text-primary)',
  },
  cardLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  right: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 18,
  },
  langSwitch: {
    display: 'flex',
    gap: 2,
    background: 'var(--panel-alt)',
    borderRadius: 4,
    padding: 2,
  },
  langBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    borderRadius: 3,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 700,
  },
  langBtnActive: {
    background: 'var(--panel)',
    color: 'var(--text-primary)',
  },
  settingsLink: {
    display: 'flex',
    alignItems: 'center',
  },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 4,
    padding: '8px 16px',
    fontSize: 12,
  },
};
