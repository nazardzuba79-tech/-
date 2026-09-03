import { useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { isAdminAlertSoundEnabled, setAdminAlertSoundEnabled } from '../../lib/useAdminAlerts';
import { useAdminGate } from '../../lib/useAdminGate';
import { LogoMark } from '../../components/Logo';
import { styles } from './adminStyles';
import {
  WalletIcon,
  UsersIcon,
  ShieldCheckIcon,
  ArrowUpCircleIcon,
  ArrowDownCircleIcon,
  BoxesIcon,
  ScrollTextIcon,
  BellIcon,
  MenuIcon,
  XIcon,
  ChevronRightIcon,
} from './AdminIcons';

const SECTIONS = [
  { to: '/admin/users', label: 'Пользователи', icon: UsersIcon },
  { to: '/admin/wallets', label: 'Кошельки', icon: WalletIcon },
  { to: '/admin/kyc', label: 'Верификация', icon: ShieldCheckIcon },
  { to: '/admin/withdrawals', label: 'Выводы', icon: ArrowUpCircleIcon },
  { to: '/admin/deposits', label: 'Пополнения', icon: ArrowDownCircleIcon },
  { to: '/admin/products', label: 'Товары', icon: BoxesIcon },
  { to: '/admin/audit-log', label: 'Журнал действий', icon: ScrollTextIcon },
];

/**
 * Gate for everything under /admin, via the shared useAdminGate hook — see
 * its own note for why the check is against `role` from GET /me and why
 * nothing here is trusted on its own. Deliberately not linked from anywhere
 * in the normal UI: reached only by a direct visit to /admin.
 */
export function AdminLayout() {
  const { status, me } = useAdminGate();
  const [soundOn, setSoundOn] = useState(isAdminAlertSoundEnabled);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  if (status === 'loading') return <div style={styles.loadingScreen} />;
  if (status === 'denied') return <Navigate to="/" replace />;

  const activeSection = SECTIONS.find((s) => location.pathname.startsWith(s.to));
  const identity = me?.displayName || me?.email?.split('@')[0] || 'Admin';
  const initials = identity
    .split(/[\s._-]+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={styles.page} className="admin-page-grid">
      {mobileOpen && (
        <div
          className="admin-fade-in admin-mobile-backdrop"
          style={{ position: 'fixed', inset: 0, zIndex: 39, background: 'rgba(15,17,21,0.4)' }}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside style={styles.sidebar} className={`admin-mobile-sidebar${mobileOpen ? ' mobile-open' : ''}`}>
        <div style={styles.sidebarBrandRow}>
          <LogoMark size={26} />
          <div>
            <div style={styles.sidebarTitle}>VOLTEX</div>
            <div style={styles.sidebarSubtitle}>Admin Panel</div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="admin-mobile-close admin-nav-link"
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'none', padding: 6, borderRadius: 8 }}
            aria-label="Закрыть меню"
          >
            <XIcon size={18} />
          </button>
        </div>

        <Link to="/" className="admin-nav-link" style={styles.backToExchange}>
          ← На биржу
        </Link>
        <nav style={styles.nav}>
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <NavLink
                key={s.to}
                to={s.to}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}
                style={({ isActive }) => ({ ...styles.navItem, ...(isActive ? styles.navItemActive : {}) })}
              >
                <Icon size={17} />
                <span>{s.label}</span>
                {location.pathname.startsWith(s.to) && <span style={styles.navItemPip} />}
              </NavLink>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 12px 12px' }}>
            <span style={{ ...styles.avatarCircle, background: 'var(--admin-brand)' }}>{initials || 'AD'}</span>
            <div style={{ minWidth: 0, lineHeight: 1.25 }}>
              <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>
                {identity}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--buy)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--buy)' }} />
                Online
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main style={styles.main} className="admin-main">
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginBottom: 24,
          }}
        >
          <button
            onClick={() => setMobileOpen(true)}
            className="admin-mobile-menu-btn admin-nav-link"
            style={{ display: 'none', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}
            aria-label="Открыть меню"
          >
            <MenuIcon size={17} />
          </button>
          <nav style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Админ-панель</span>
            {activeSection && (
              <>
                <ChevronRightIcon size={13} />
                <span style={{ fontWeight: 700 }}>{activeSection.label}</span>
              </>
            )}
          </nav>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                setAdminAlertSoundEnabled(next);
              }}
              className="admin-nav-link"
              style={{
                position: 'relative',
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--panel)',
                color: soundOn ? 'var(--admin-brand)' : 'var(--text-tertiary)',
                cursor: 'pointer',
              }}
              title={soundOn ? 'Звук новых событий включён' : 'Звук новых событий выключен'}
              aria-label="Переключить звук новых событий"
            >
              <BellIcon size={17} />
              {soundOn && (
                <span
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--buy)',
                    boxShadow: '0 0 0 2px var(--panel)',
                  }}
                />
              )}
            </button>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '5px 10px 5px 5px',
              }}
            >
              <span style={{ ...styles.avatarCircle, width: 28, height: 28, fontSize: 11, background: 'var(--admin-brand)' }}>{initials || 'AD'}</span>
              <div style={{ lineHeight: 1.2 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{identity}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Administrator</div>
              </div>
            </div>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}
