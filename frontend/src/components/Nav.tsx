import { ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { clearToken } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { BalanceStrip } from './BalanceStrip';
import { Logo } from './Logo';
import { LanguageSwitcher } from './LanguageSwitcher';

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
  const location = useLocation();
  const { t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);

  const LINKS = [
    { to: '/trade', label: t('nav.trade') },
    { to: '/futures', label: t('nav.futures') },
    { to: '/wallet', label: t('nav.wallet') },
    { to: '/markets', label: t('nav.markets') },
  ];

  // A stale open drawer surviving a navigation (tap a link, land on the new
  // page with the menu still up) would look broken — close it on every route
  // change instead of trusting each link to remember to do it itself.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  function handleLogout() {
    clearToken();
    navigate('/');
  }

  return (
    <nav className="glass-panel" style={styles.nav}>
      <Link to="/trade" style={styles.logo}>
        <Logo />
      </Link>

      <div className="nav-desktop-links" style={styles.desktopLinks}>
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
        <Link
          to="/settings"
          style={{ ...styles.link, ...styles.cardLink, ...(active === '/settings' ? styles.linkActive : {}) }}
        >
          <GearIcon active={active === '/settings'} />
          {t('nav.settings')}
        </Link>
        {middle}
      </div>

      <div className="nav-desktop-right" style={styles.right}>
        <BalanceStrip />
        {rightExtra}
        <LanguageSwitcher />
        <button onClick={handleLogout} style={styles.logoutBtn}>
          {t('nav.logout')}
        </button>
      </div>

      <button
        className="nav-burger"
        style={styles.burgerBtn}
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={t('nav.menu')}
        aria-expanded={mobileOpen}
      >
        <BurgerIcon open={mobileOpen} />
      </button>

      <div className={`nav-mobile-menu${mobileOpen ? ' open' : ''}`} style={styles.mobileMenu}>
        {LINKS.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            style={{ ...styles.mobileLink, ...(active === l.to ? styles.linkActive : {}) }}
          >
            {l.label}
          </Link>
        ))}
        <Link to="/card" style={{ ...styles.mobileLink, ...styles.cardLink, ...(active === '/card' ? styles.linkActive : {}) }}>
          <CardIcon active={active === '/card'} />
          {t('nav.card')}
        </Link>
        <Link
          to="/settings"
          style={{ ...styles.mobileLink, ...styles.cardLink, ...(active === '/settings' ? styles.linkActive : {}) }}
        >
          <GearIcon active={active === '/settings'} />
          {t('nav.settings')}
        </Link>

        <div style={styles.mobileDivider} />

        {rightExtra && <div style={styles.mobileRightExtra}>{rightExtra}</div>}
        <div style={styles.mobileBalanceRow}>
          <BalanceStrip />
        </div>
        <div style={styles.mobileLangRow}>
          <LanguageSwitcher />
        </div>
        <button onClick={handleLogout} style={{ ...styles.logoutBtn, width: '100%' }}>
          {t('nav.logout')}
        </button>
      </div>
    </nav>
  );
}

function BurgerIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round">
      {open ? (
        <>
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </>
      ) : (
        <>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </>
      )}
    </svg>
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
    boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
    position: 'sticky',
    top: 0,
    zIndex: 10,
    flexShrink: 0,
  },
  logo: {
    fontFamily: 'var(--font-display)',
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: '0.02em',
  },
  desktopLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
  },
  burgerBtn: {
    display: 'none',
    marginLeft: 'auto',
    background: 'transparent',
    border: 'none',
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileMenu: {
    display: 'none',
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    flexDirection: 'column',
    gap: 4,
    padding: 16,
    background: 'var(--panel)',
    borderBottom: '1px solid var(--border)',
    boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
    maxHeight: 'calc(100vh - 56px)',
    overflowY: 'auto',
  },
  mobileLink: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    padding: '12px 6px',
    borderBottom: '1px solid var(--border)',
  },
  mobileDivider: {
    height: 1,
    background: 'var(--border)',
    margin: '4px 0',
  },
  mobileRightExtra: {
    padding: '8px 0',
  },
  mobileBalanceRow: {
    padding: '10px 6px',
    borderBottom: '1px solid var(--border)',
  },
  mobileLangRow: {
    padding: '10px 6px',
  },
  link: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  linkActive: {
    color: 'var(--accent)',
  },
  cardLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  right: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 12,
  },
};
