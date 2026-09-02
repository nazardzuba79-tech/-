import { Fragment, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, CreditCard, Landmark, LogOut, Menu, UserRound, X } from 'lucide-react';
import { api, clearToken, getToken } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { useAdminAlertSound } from '../lib/useAdminAlerts';
import { Logo } from './Logo';
import { LanguageSwitcher } from './LanguageSwitcher';
import { BottomNav } from './BottomNav';
import { DepositModal } from './DepositModal';
import { TopGainersTicker } from './TopGainersTicker';

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
  onTickerSelect,
  hideTicker,
  staticTicker,
}: {
  active: string;
  middle?: ReactNode;
  rightExtra?: ReactNode;
  onTickerSelect?: (pair: string) => void;
  /** The Trade page's own terminal already surfaces live market data, so
   * the marquee would be pure duplication there — every other page keeps it. */
  hideTicker?: boolean;
  /** Renders the strip without the marquee — see TopGainersTicker. */
  staticTicker?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
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
        setAvatarUrl(me.avatarUrl);
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
    <header className="global-header top-nav-bar" style={styles.nav}>
      <div className="header-left">
        <button
          className="mobile-menu nav-burger"
          style={styles.burgerBtn}
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={t('nav.menu')}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        <Link to="/trade" className="header-brand" style={styles.logo}>
          <Logo />
        </Link>
        <span className="brand-separator top-nav-divider" aria-hidden="true" />

        <nav className="main-nav nav-desktop-links" style={styles.desktopLinks} aria-label={t('nav.menu')}>
        {LINKS.map((l) =>
          l.to === '/trade' ? (
            <div
              key={l.to}
              className="nav-item-wrap"
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
                className={`nav-item top-nav-link${active === l.to ? ' nav-active is-active' : ''}`}
                style={{ ...styles.link, ...styles.tradeMenuTrigger }}
                aria-haspopup="menu"
                aria-expanded={tradeMenuOpen}
              >
                {l.label}
                <ChevronDown size={12} className={`nav-chevron${tradeMenuOpen ? ' nav-chevron-open' : ''}`} />
              </Link>
              {tradeMenuOpen && (
                <div className="nav-dropdown" style={styles.tradeMenu} role="menu">
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
              className={`nav-item top-nav-link${active === l.to ? ' nav-active is-active' : ''}`}
              style={styles.link}
            >
              {l.label}
            </Link>
          )
        )}
        <Link
          to="/card"
          className={`nav-item nav-secondary top-nav-link${active === '/card' ? ' nav-active is-active' : ''}`}
          style={{ ...styles.link, ...styles.cardLink }}
        >
          <CreditCard size={14} />
          {t('nav.card')}
        </Link>
        <Link to="/otc" className={`nav-item nav-secondary top-nav-link${active === '/otc' ? ' nav-active is-active' : ''}`} style={styles.link}>
          {t('nav.otc')}
        </Link>
        {isAdmin && (
          <Link
            to="/admin"
            className={`nav-item nav-admin${active === '/admin' ? ' nav-active' : ''}`}
            style={{ ...styles.adminBadge, ...(active === '/admin' ? styles.adminBadgeActive : {}) }}
          >
            <Landmark size={14} />
            {t('nav.admin')}
          </Link>
        )}
        {middle}
        </nav>
      </div>

      <div className="header-actions nav-desktop-right" style={styles.right}>
        <button onClick={() => setShowDeposit(true)} className="deposit-button top-nav-fund-btn" style={styles.navDepositBtn}>
          <span>{t('wallet.deposit')}</span>
          <ArrowUpRight size={14} />
        </button>
        {rightExtra && <div className="header-extra-action">{rightExtra}</div>}
        <LanguageSwitcher variant="pill" />
        {/* Settings/Profile is one destination (SettingsPage's own Profile
            tab is already its default tab), entered through the name
            itself; logout lives in the same dropdown instead of its own
            always-visible button. */}
        <div className="top-nav-profile-wrap" ref={profileMenuRef}>
          <button
            type="button"
            className="header-icon profile-control top-nav-profile-btn"
            onClick={() => setProfileMenuOpen((o) => !o)}
            aria-expanded={profileMenuOpen}
          >
            <span className="top-nav-profile-avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <UserRound size={13} />}
            </span>
            <span>{t('nav.profile')}</span>
            <ChevronDown size={11} className={`nav-chevron${profileMenuOpen ? ' nav-chevron-open' : ''}`} />
          </button>
          {profileMenuOpen && (
            <div className="top-nav-profile-menu">
              <Link to="/settings" onClick={() => setProfileMenuOpen(false)}>
                {t('nav.profile')}
              </Link>
              <button type="button" onClick={handleLogout}>
                <LogOut size={14} /> {t('nav.logout')}
              </button>
            </div>
          )}
        </div>
      </div>

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
          <CreditCard size={14} />
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
            <Landmark size={14} />
            {t('nav.admin')}
          </Link>
        )}

        <div style={styles.mobileDivider} />

        <Link
          to="/settings"
          style={{ ...styles.mobileLink, ...styles.cardLink, ...(active === '/settings' ? styles.linkActive : {}) }}
        >
          <UserRound size={15} />
          {t('nav.profile')}
        </Link>

        {rightExtra && <div style={styles.mobileRightExtra}>{rightExtra}</div>}
        <div style={styles.mobileLangRow}>
          <LanguageSwitcher />
        </div>
        <button onClick={handleLogout} style={{ ...styles.logoutBtn, width: '100%' }}>
          <LogOut size={14} /> {t('nav.logout')}
        </button>
      </div>
    </header>
    {!hideTicker && <TopGainersTicker onSelect={onTickerSelect} staticStrip={staticTicker} />}
    {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
    <BottomNav />
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 0,
    padding: '0 28px',
    height: 64,
    position: 'sticky',
    top: 0,
    zIndex: 20,
    flexShrink: 0,
  },
  logo: {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'var(--font-display)',
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: '0.02em',
  },
  desktopLinks: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 2,
    height: '100%',
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
    marginTop: 0,
    background: '#11161f',
    border: '1px solid #232c3a',
    borderRadius: 8,
    boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
    padding: '12px 14px',
    width: 224,
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
    marginRight: 8,
    background: 'transparent',
    border: 'none',
    padding: 0,
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
    padding: '10px 16px 14px',
    background: '#0c1018',
    borderBottom: '1px solid #1c2330',
    boxShadow: '0 12px 28px rgba(0,0,0,0.3)',
    maxHeight: 'calc(100vh - 64px)',
    overflowY: 'auto',
  },
  mobileLink: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 13.5,
    fontWeight: 500,
    color: '#d8dce6',
    padding: '11px 12px',
    borderRadius: 6,
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
  // Colour, hover and — importantly — padding and type size live in the
  // .top-nav-link CSS class rather than here. An inline style beats a
  // media query no matter how specific the selector, so anything the
  // responsive tiers need to shrink cannot be set from this object.
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 11px',
    fontSize: 13.5,
    fontWeight: 500,
    letterSpacing: 0,
    whiteSpace: 'nowrap',
  },
  // Still used by the mobile drawer, which doesn't use .top-nav-link.
  linkActive: {
    color: '#ffffff',
    background: 'rgba(240,196,63,0.06)',
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
    gap: 6,
    background: 'transparent',
    border: 0,
    borderRadius: 6,
    padding: '0 11px',
    fontSize: 13,
    fontWeight: 500,
    color: '#8b8af6',
  },
  adminBadgeActive: {
    background: 'rgba(139,138,246,0.08)',
    color: '#b6b5ff',
  },
  right: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
  },
  navDepositBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    background: 'linear-gradient(135deg, #f0c43f, #e6b830)',
    color: '#1a1410',
    border: 0,
    borderRadius: 6,
    padding: '0 14px',
    fontWeight: 700,
    fontSize: 12.5,
    letterSpacing: '0.01em',
    boxShadow: '0 2px 8px rgba(240,196,63,0.18)',
  },
  // Only used by the mobile drawer now — the desktop logout lives inside
  // the profile dropdown menu (.top-nav-profile-menu).
  logoutBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 12,
  },
};
