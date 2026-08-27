import { Fragment, ReactNode, useEffect, useRef, useState } from 'react';
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
  const [tradeMenuOpen, setTradeMenuOpen] = useState(false);
  const tradeMenuCloseTimer = useRef<number | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Ordered to match a real exchange's own nav (Markets, then Trade, then
  // Futures right after the primary deposit CTA), with the rest following.
  const LINKS = [
    { to: '/markets', label: t('nav.markets') },
    { to: '/trade', label: t('nav.trade') },
    { to: '/futures', label: t('nav.futures') },
    { to: '/wallet', label: t('nav.wallet') },
    { to: '/copy-trading', label: t('nav.copyTrading') },
    { to: '/arbitrage', label: t('nav.arbitrage') },
  ];

  useEffect(() => {
    return () => {
      if (tradeMenuCloseTimer.current) window.clearTimeout(tradeMenuCloseTimer.current);
    };
  }, []);

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

  useEffect(() => {
    if (!profileMenuOpen) return;
    function handler(e: MouseEvent) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) setProfileMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileMenuOpen]);

  function handleLogout() {
    clearToken();
    navigate('/');
  }

  return (
    <>
    <nav className="top-nav-bar" style={styles.nav}>
      <Link to="/trade" style={styles.logo}>
        <Logo />
      </Link>
      <span className="top-nav-divider" aria-hidden="true" />

      <div className="nav-desktop-links" style={styles.desktopLinks}>
        <button onClick={() => setShowDeposit(true)} className="top-nav-fund-btn" style={styles.navDepositBtn}>
          <span>{t('wallet.deposit')}</span>
          <ArrowUpRightIcon />
        </button>
        {LINKS.map((l) =>
          l.to === '/trade' ? (
            <div
              key={l.to}
              style={styles.tradeMenuWrap}
              onMouseEnter={() => {
                if (tradeMenuCloseTimer.current) window.clearTimeout(tradeMenuCloseTimer.current);
                setTradeMenuOpen(true);
              }}
              onMouseLeave={() => {
                // A short grace period, not an instant close — without it,
                // crossing the small gap between the link and the panel
                // below (or just not moving in a perfectly straight line)
                // reads as "left the menu" and closes it before the pointer
                // ever reaches CFD.
                tradeMenuCloseTimer.current = window.setTimeout(() => setTradeMenuOpen(false), 250);
              }}
            >
              <Link
                to={l.to}
                className={`top-nav-link${active === l.to ? ' is-active' : ''}`}
                style={{ ...styles.link, ...styles.tradeMenuTrigger }}
              >
                {l.label}
                <ChevronIcon />
              </Link>
              {tradeMenuOpen && (
                <div style={styles.tradeMenu}>
                  <Link to="/trade" style={styles.tradeMenuItem} className="row-hover">
                    <span style={styles.tradeMenuItemTitle}>{t('trade.spotTab')}</span>
                    <span style={styles.tradeMenuItemDesc}>{t('nav.tradeSpotDesc')}</span>
                  </Link>
                  <Link to="/trade?market=cfd" style={styles.tradeMenuItem} className="row-hover">
                    <span style={styles.tradeMenuItemTitle}>{t('trade.cfdTab')}</span>
                    <span style={styles.tradeMenuItemDesc}>{t('nav.tradeCfdDesc')}</span>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <Link
              key={l.to}
              to={l.to}
              className={`top-nav-link${active === l.to ? ' is-active' : ''}`}
              style={styles.link}
            >
              {l.label}
            </Link>
          )
        )}
        <Link
          to="/card"
          className={`top-nav-link${active === '/card' ? ' is-active' : ''}`}
          style={{ ...styles.link, ...styles.cardLink }}
        >
          <CardIcon active={active === '/card'} />
          {t('nav.card')}
        </Link>
        <Link to="/otc" className={`top-nav-link${active === '/otc' ? ' is-active' : ''}`} style={styles.link}>
          {t('nav.otc')}
        </Link>
        {isAdmin && (
          <Link to="/admin" style={{ ...styles.adminBadge, ...(active === '/admin' ? styles.adminBadgeActive : {}) }}>
            <ShieldIcon admin />
            {t('nav.admin')}
          </Link>
        )}
        {middle}
      </div>

      <div className="nav-desktop-right" style={styles.right}>
        {rightExtra}
        <LanguageSwitcher variant="pill" />
        {/* Settings/Profile is one destination (SettingsPage's own Profile
            tab is already its default tab), entered through the name
            itself; logout lives in the same dropdown instead of its own
            always-visible button. */}
        <div className="top-nav-profile-wrap" ref={profileMenuRef}>
          <button
            type="button"
            className="top-nav-profile-btn"
            onClick={() => setProfileMenuOpen((o) => !o)}
            aria-expanded={profileMenuOpen}
          >
            <span className="top-nav-profile-avatar">
              <UserIcon active={active === '/settings'} />
            </span>
            <span>{displayName || t('nav.profile')}</span>
            <ChevronIcon />
          </button>
          {profileMenuOpen && (
            <div className="top-nav-profile-menu">
              <Link to="/settings" onClick={() => setProfileMenuOpen(false)}>
                {t('nav.profile')}
              </Link>
              <button type="button" onClick={handleLogout}>
                <LogOutIcon /> {t('nav.logout')}
              </button>
            </div>
          )}
        </div>
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
          <Fragment key={l.to}>
            <Link
              to={l.to}
              style={{ ...styles.mobileLink, ...(active === l.to ? styles.linkActive : {}) }}
            >
              {l.label}
            </Link>
            {l.to === '/trade' && (
              <Link to="/trade?market=cfd" style={{ ...styles.mobileLink, paddingLeft: 20, fontSize: 13 }}>
                {t('trade.cfdTab')}
              </Link>
            )}
          </Fragment>
        ))}
        <Link to="/card" style={{ ...styles.mobileLink, ...styles.cardLink, ...(active === '/card' ? styles.linkActive : {}) }}>
          <CardIcon active={active === '/card'} />
          {t('nav.card')}
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

        <div style={styles.mobileDivider} />

        <Link
          to="/settings"
          style={{ ...styles.mobileLink, ...styles.cardLink, ...(active === '/settings' ? styles.linkActive : {}) }}
        >
          <UserIcon active={active === '/settings'} />
          {displayName || t('nav.profile')}
        </Link>

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

// Small down-chevron next to "Торговля" — the only signal (besides
// discovering it by accident) that hovering opens a menu instead of just
// being a plain link like its neighbors.
function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function UserIcon({ active }: { active: boolean }) {
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
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
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
      stroke={admin ? '#a5b4fc' : active ? 'var(--text-primary)' : 'var(--text-secondary)'}
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
    gap: 18,
    padding: '0 28px',
    height: 70,
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
    gap: 2,
    marginLeft: 4,
  },
  tradeMenuWrap: {
    position: 'relative',
  },
  tradeMenuTrigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  },
  tradeMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 8,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: '0 16px 32px rgba(0,0,0,0.35)',
    padding: 6,
    width: 220,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    zIndex: 20,
  },
  tradeMenuItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '10px 12px',
    borderRadius: 8,
  },
  tradeMenuItemTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  tradeMenuItemDesc: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
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
    top: 70,
    left: 0,
    right: 0,
    flexDirection: 'column',
    gap: 4,
    padding: 16,
    background: '#0c1116',
    borderBottom: '1px solid rgba(151,168,185,0.14)',
    boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
    maxHeight: 'calc(100vh - 70px)',
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
  // Color/hover/underline now live in the .top-nav-link CSS class (needs a
  // real :hover pseudo-class + ::after underline bar, which inline styles
  // can't express) — this only carries layout.
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minHeight: 70,
    padding: '0 9px',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    whiteSpace: 'nowrap',
  },
  // Still used by the mobile drawer, which doesn't use .top-nav-link.
  linkActive: {
    color: '#65def7',
  },
  cardLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  // Fixed, non-theme colors on purpose — this button has to stay legible
  // regardless of which page's accent color is active, since it's the one
  // link on the whole site that opens a privileged, money-moving area.
  // Indigo (not red) to match the admin panel's own brand color, and to
  // read as "special access" rather than a warning/error.
  adminBadge: {
    display: 'flex',
    alignItems: 'center',
    minHeight: 34,
    gap: 7,
    background: 'rgba(79,70,229,0.14)',
    border: '1px solid rgba(129,140,248,0.5)',
    borderRadius: 8,
    padding: '0 11px',
    fontSize: 12,
    fontWeight: 650,
    color: '#a5b4fc',
  },
  adminBadgeActive: {
    background: 'rgba(79,70,229,0.28)',
    borderColor: '#818cf8',
    color: '#c7d2fe',
  },
  right: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  // Deliberately the one filled/glowing button among plain text nav links —
  // same idea as a real exchange's "Buy crypto" nav CTA: it's the
  // highest-value action, so it should read as a button, not a link.
  // Cyan, matching the reference top-nav design (not the site's own
  // gold --accent) — scoped to just this component, see .top-nav-bar above.
  navDepositBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    minHeight: 36,
    background: '#5edbf4',
    color: '#071217',
    border: '1px solid rgba(139,239,255,0.75)',
    borderRadius: 9,
    padding: '0 13px 0 15px',
    fontWeight: 750,
    fontSize: 12,
    letterSpacing: '0.01em',
    boxShadow: '0 0 0 1px rgba(57,185,218,0.08), 0 5px 16px rgba(35,161,192,0.12)',
  },
  // Only used by the mobile drawer now — the desktop logout lives inside
  // the profile dropdown menu (.top-nav-profile-menu).
  logoutBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 12,
  },
};
