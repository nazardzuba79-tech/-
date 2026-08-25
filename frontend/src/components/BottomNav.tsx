import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../lib/i18n';

/** Fixed mobile tab bar (v0-derived) — shown only below the same 860px
 * breakpoint the burger menu already uses (see .bottom-nav in index.css).
 * The burger menu still covers every route; this is a faster-access
 * shortcut for the five most-used ones, same role as v0's BottomNav. */
export function BottomNav() {
  const location = useLocation();
  const { t } = useLanguage();

  const ITEMS = [
    { to: '/dashboard', label: t('nav.dashboard'), icon: HomeIcon },
    { to: '/markets', label: t('nav.markets'), icon: MarketsIcon },
    { to: '/trade', label: t('nav.trade'), icon: TradeIcon },
    { to: '/wallet', label: t('nav.wallet'), icon: WalletIcon },
    { to: '/settings', label: t('nav.settings'), icon: ProfileIcon },
  ];

  return (
    <nav className="bottom-nav" style={styles.nav}>
      {ITEMS.map(({ to, label, icon: Icon }) => {
        const active = location.pathname === to;
        return (
          <Link key={to} to={to} style={{ ...styles.item, color: active ? 'var(--accent)' : 'var(--text-tertiary)' }}>
            <Icon active={active} />
            <span style={styles.label}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    position: 'fixed',
    insetInline: 0,
    bottom: 0,
    zIndex: 90,
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    background: 'var(--panel)',
    borderTop: '1px solid var(--border)',
    backdropFilter: 'blur(12px)',
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    padding: '9px 0 8px',
    textDecoration: 'none',
  },
  label: { fontSize: 10, fontWeight: 600 },
};

function iconProps(active: boolean) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: active ? 2.4 : 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function MarketsIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M4 20V10M11 20V4M18 20v-6" />
    </svg>
  );
}

function TradeIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M4 6h4v6H4zM10 3h4v13h-4zM16 9h4v5h-4z" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  );
}

function WalletIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.5-4 5-6 7-6s5.5 2 7 6" />
    </svg>
  );
}
