import { ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api, clearToken, getToken } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useAdminAlertSound } from '../lib/useAdminAlerts';
import { Logo } from './Logo';
import { LanguageSwitcher } from './LanguageSwitcher';
import { BottomNav } from './BottomNav';
import { DepositModal } from './DepositModal';

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
  const [isAdmin, setIsAdmin] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);

  // Ordered to match a real exchange's own nav (Markets, then Trade, then
  // Futures right after the primary deposit CTA), with the rest following.
  const LINKS = [
    { to: '/markets', label: t('nav.markets') },
    { to: '/trade', label: t('nav.trade') },
    { to: '/futures', label: t('nav.futures') },
    { to: '/dashboard', label: t('nav.dashboard') },
    { to: '/wallet', label: t('nav.wallet') },
    { to: '/copy-trading', label: t('nav.copyTrading') },
    { to: '/arbitrage', label: t('nav.arbitrage') },
  ];

  // A stale open drawer surviving a navigation (tap a link, land on the new
  // page with the menu still up) would look broken — close it on every route
  // change instead of trusting each link to remember to do it itself.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Just a UX convenience for showing/hiding the tab — the real gate is
  // AdminLayout re-checking role ADMIN against the server on every visit,
  // and every /admin/* API call independently re-checking it too.
  useEffect(() => {
    if (!getToken()) return;
    api
      .getMe()
      .then((me) => {
        setIsAdmin(me.isAdmin);
        setDisplayName(me.displayName);
      })
      .catch(() => {});
  }, []);

  // Chimes on a brand-new deposit/withdrawal/KYC submission, from anywhere
  // in the app — not just while sitting on /admin. See useAdminAlerts.ts.
  useAdminAlertSound(isAdmin);

  function handleLogout() {
    clearToken();
    navigate('/');
  }

  return (
    <>
    <nav className="glass-panel nav-liquid-glass" style={styles.nav}>
      <Link to="/trade" style={styles.logo}>
        <Logo />
      </Link>

      <div className="nav-desktop-links" style={styles.desktopLinks}>
        <button onClick={() => setShowDeposit(true)} style={styles.navDepositBtn}>
          {t('wallet.deposit')}
        </button>
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
        <Link to="/otc" style={{ ...styles.link, ...(active === '/otc' ? styles.linkActive : {}) }}>
          {t('nav.otc')}
        </Link>
        {isAdmin && (
          <Link to="/admin" style={{ ...styles.adminBadge, ...(active === '/admin' ? styles.adminBadgeActive : {}) }}>
            <ShieldIcon admin />
            {t('nav.admin')}
          </Link>
        )}
        {isAdmin && (
          <Link to="/demo" style={{ ...styles.link, ...(active === '/demo' ? styles.linkActive : {}) }}>
            Demo
          </Link>
        )}
        {middle}
      </div>

      <div className="nav-desktop-right" style={styles.right}>
        {displayName && <span style={styles.displayName}>{displayName}</span>}
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
        <button
          onClick={() => {
            setShowDeposit(true);
            setMobileOpen(false);
          }}
          style={{ ...styles.navDepositBtn, width: '100%', marginBottom: 4 }}
        >
          {t('wallet.deposit')}
        </button>
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
        <Link to="/otc" style={{ ...styles.mobileLink, ...(active === '/otc' ? styles.linkActive : {}) }}>
          {t('nav.otc')}
        </Link>
        {isAdmin && (
          <Link
            to="/admin"
            style={{ ...styles.mobileLink, ...styles.adminBadge, ...(active === '/admin' ? styles.adminBadgeActive : {}) }}
          >
            <ShieldIcon admin />
            {t('nav.admin')}
          </Link>
        )}
        {isAdmin && (
          <Link to="/demo" style={{ ...styles.mobileLink, ...(active === '/demo' ? styles.linkActive : {}) }}>
            Demo
          </Link>
        )}

        <div style={styles.mobileDivider} />

        {rightExtra && <div style={styles.mobileRightExtra}>{rightExtra}</div>}
        <div style={styles.mobileLangRow}>
          <LanguageSwitcher />
        </div>
        <button onClick={handleLogout} style={{ ...styles.logoutBtn, width: '100%' }}>
          {t('nav.logout')}
        </button>
      </div>
    </nav>
    {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
    <BottomNav />
    </>
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

let cardIconGradientSeq = 0;

// Its own gradient + glow, unlike the plain currentColor nav icons — the
// card page is a real product to sell, so its nav entry should read as a
// small preview of that card rather than blend in with Settings/gear.
function CardIcon({ active }: { active: boolean }) {
  const gradientId = useState(() => `nav-card-gradient-${cardIconGradientSeq++}`)[0];
  return (
    <svg
      className="nav-card-icon"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ filter: active ? 'drop-shadow(0 0 5px rgba(139,92,246,0.65))' : undefined }}
    >
      <defs>
        <linearGradient id={gradientId} x1="2" y1="5" x2="22" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <rect x="2" y="5" width="20" height="14" rx="2" stroke={`url(#${gradientId})`} />
      <line x1="2" y1="10" x2="22" y2="10" stroke={`url(#${gradientId})`} />
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

function ShieldIcon({ active, admin }: { active?: boolean; admin?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={admin ? '#fca5a5' : active ? 'var(--text-primary)' : 'var(--text-secondary)'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    padding: '0 20px',
    height: 64,
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
    top: 64,
    left: 0,
    right: 0,
    flexDirection: 'column',
    gap: 4,
    padding: 16,
    background: 'var(--panel)',
    borderBottom: '1px solid var(--border)',
    boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
    maxHeight: 'calc(100vh - 64px)',
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
  // Fixed, non-theme colors on purpose — this button has to stay legible
  // regardless of which page's accent color is active, since it's the one
  // link on the whole site that opens a privileged, money-moving area.
  adminBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    background: 'rgba(239,68,68,0.14)',
    border: '1px solid rgba(248,113,113,0.5)',
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 700,
    color: '#fca5a5',
  },
  adminBadgeActive: {
    background: 'rgba(239,68,68,0.28)',
    borderColor: '#f87171',
    color: '#fecaca',
  },
  right: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  displayName: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  // Deliberately the one filled/glowing button among plain text nav links —
  // same idea as a real exchange's "Buy crypto" nav CTA: it's the
  // highest-value action, so it should read as a button, not a link.
  navDepositBtn: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 10,
    padding: '9px 18px',
    fontWeight: 800,
    fontSize: 13,
    letterSpacing: '0.01em',
    boxShadow: '0 4px 16px -2px var(--accent-dim), inset 0 1px 0 rgba(255,255,255,0.18)',
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
