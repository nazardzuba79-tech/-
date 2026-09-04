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
  tickerHrefFor,
  hideTicker,
  staticTicker,
  tickerSymbols,
  tickerFitToWidth,
}: {
  active: string;
  middle?: ReactNode;
  rightExtra?: ReactNode;
  onTickerSelect?: (pair: string) => void;
  /** Makes each ticker symbol a link to that pair's trading page — for
   * pages that navigate away rather than switching pair in place. See
   * TopGainersTicker for why this is a link and onTickerSelect a button. */
  tickerHrefFor?: (pair: string) => string;
  /** The Trade page's own terminal already surfaces live market data, so
   * the marquee would be pure duplication there — every other page keeps it. */
  hideTicker?: boolean;
  /** Renders the strip without the marquee — see TopGainersTicker. */
  staticTicker?: boolean;
  /** Narrows the strip to a specific market universe (the futures terminal
   *  passes its listed perpetuals) — see TopGainersTicker. */
  tickerSymbols?: string[];
  /** Shows only the instruments that fit the width, instead of scrolling. */
  tickerFitToWidth?: boolean;
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
  // `adminOnly` entries are filtered out below for everyone else — hiding
  // the link is cosmetic, the route's own guard is what closes it.
  const ALL_LINKS: { to: string; label: string; adminOnly?: boolean }[] = [
    { to: '/markets', label: t('nav.markets') },
    { to: '/trade', label: t('nav.trade') },
    { to: '/futures', label: t('nav.futures') },
    { to: '/analytics', label: t('nav.analytics'), adminOnly: true },
    { to: '/wallet', label: t('nav.wallet') },
    { to: '/copy-trading', label: t('nav.copyTrading') },
    { to: '/arbitrage', label: t('nav.arbitrage') },
  ];
  const LINKS = ALL_LINKS.filter((l) => !l.adminOnly || isAdmin);

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
    <header className="global-header top-nav-bar">
      <div className="header-left">
        <button
          className="mobile-menu nav-burger"
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

        <nav className="main-nav nav-desktop-links" aria-label={t('nav.menu')}>
        {LINKS.map((l) =>
          l.to === '/trade' ? (
            <div
              key={l.to}
              className="nav-item-wrap"
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
                aria-haspopup="menu"
                aria-expanded={tradeMenuOpen}
              >
                {l.label}
                <ChevronDown size={12} className={`nav-chevron${tradeMenuOpen ? ' nav-chevron-open' : ''}`} />
              </Link>
              {tradeMenuOpen && (
                <div className="nav-dropdown" role="menu">
                  <Link to="/trade" style={styles.tradeMenuItem}>
                    <span style={styles.tradeMenuItemTitle}>{t('trade.spotTab')}</span>
                    <span style={styles.tradeMenuItemDesc}>{t('nav.tradeSpotDesc')}</span>
                  </Link>
                  <Link to="/trade?market=cfd" style={styles.tradeMenuItem}>
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
            >
              {l.label}
            </Link>
          )
        )}
        <Link
          to="/card"
          className={`nav-item nav-secondary top-nav-link${active === '/card' ? ' nav-active is-active' : ''}`}
        >
          <CreditCard size={14} />
          {t('nav.card')}
        </Link>
        <Link to="/otc" className={`nav-item nav-secondary top-nav-link${active === '/otc' ? ' nav-active is-active' : ''}`}>
          {t('nav.otc')}
        </Link>
        {isAdmin && (
          <Link to="/admin" className={`nav-item nav-admin${active === '/admin' ? ' nav-active' : ''}`}>
            <Landmark size={14} />
            {t('nav.admin')}
          </Link>
        )}
        {middle}
        </nav>
      </div>

      <div className="header-actions nav-desktop-right">
        {/* No balance figure here. The header already carries Кошелёк in
            the nav and Пополнить right below, and the wallet page is where
            balances belong; a third control repeating them only crowded
            the row. WalletBalanceControl itself still exists and is still
            used by the homepage header. */}
        <button onClick={() => setShowDeposit(true)} className="deposit-button top-nav-fund-btn">
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

      <div className={`nav-mobile-menu${mobileOpen ? ' open' : ''}`}>
        <button
          className="deposit-button"
          onClick={() => {
            setShowDeposit(true);
            setMobileOpen(false);
          }}
          style={{ justifyContent: 'center', marginBottom: 4 }}
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
    {!hideTicker && (
      <TopGainersTicker
        onSelect={onTickerSelect}
        hrefFor={tickerHrefFor}
        staticStrip={staticTicker}
        symbols={tickerSymbols}
        fitToWidth={tickerFitToWidth}
      />
    )}
    {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
    <BottomNav />
    </>
  );
}

/* Only what the CSS can't own: the mobile drawer's per-item styling (the
   drawer is VOLTEX's own element, not the reference's re-flowed <nav>) and
   the trade dropdown's two-line item. Everything the desktop header renders
   is styled from index.css instead — see the note on .global-header there
   for why an inline style is the wrong place for any of it. */
const styles: Record<string, React.CSSProperties> = {
  logo: {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'var(--font-display)',
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: '0.02em',
  },
  tradeMenuItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '7px 8px',
    borderRadius: 5,
  },
  tradeMenuItemTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e8ecf3',
  },
  tradeMenuItemDesc: {
    fontSize: 12,
    color: 'var(--h-text-3)',
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
