import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet } from 'react-router-dom';
import { api, getToken } from '../../lib/api';
import { isAdminAlertSoundEnabled, setAdminAlertSoundEnabled } from '../../lib/useAdminAlerts';
import { styles } from './adminStyles';

const SECTIONS = [
  { to: '/admin/wallets', label: 'Кошельки' },
  { to: '/admin/users', label: 'Пользователи' },
  { to: '/admin/kyc', label: 'Верификация' },
  { to: '/admin/withdrawals', label: 'Выводы' },
  { to: '/admin/deposits', label: 'Пополнения' },
  { to: '/admin/products', label: 'Товары' },
  { to: '/admin/audit-log', label: 'Журнал действий' },
];

/**
 * Gate for everything under /admin. This is a UX convenience only — every
 * request the pages below make is independently re-checked for role ADMIN
 * on the server (see requireAdmin middleware); nothing here is trusted.
 * The check is against `role` as reported by GET /me, never against an
 * email address — the backend is the only place that email is ever
 * compared. Deliberately not linked from anywhere in the normal UI: reached
 * only by a direct visit to /admin.
 */
export function AdminLayout() {
  const [status, setStatus] = useState<'loading' | 'denied' | 'ok'>('loading');
  const [soundOn, setSoundOn] = useState(isAdminAlertSoundEnabled);

  useEffect(() => {
    if (!getToken()) {
      setStatus('denied');
      return;
    }
    api
      .getMe()
      .then((me) => setStatus(me.isAdmin ? 'ok' : 'denied'))
      .catch(() => setStatus('denied'));
  }, []);

  if (status === 'loading') return <div style={styles.loadingScreen} />;
  if (status === 'denied') return <Navigate to="/" replace />;

  return (
    <div style={styles.page}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarTitle}>Админ-панель</div>
        <Link to="/" className="row-hover-alt" style={styles.backToExchange}>
          ← На биржу
        </Link>
        <nav style={styles.nav}>
          {SECTIONS.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              className="row-hover-alt"
              style={({ isActive }) => ({ ...styles.navItem, ...(isActive ? styles.navItemActive : {}) })}
            >
              {s.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 'auto' }}>
          {/* Toggles the chime in useAdminAlerts.ts — fires anywhere in the
              app on a brand-new deposit/withdrawal/KYC submission, not just
              while sitting on this page. */}
          <label style={styles.soundToggle}>
            <input
              type="checkbox"
              checked={soundOn}
              onChange={(e) => {
                setSoundOn(e.target.checked);
                setAdminAlertSoundEnabled(e.target.checked);
              }}
            />
            🔔 Звук новых событий
          </label>
        </div>
      </aside>
      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
