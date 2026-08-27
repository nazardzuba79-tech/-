import type { CSSProperties } from 'react';
import { styles } from './adminStyles';
import { ArrowUpRightIcon, ArrowDownRightIcon } from './AdminIcons';

type Accent = 'brand' | 'buy' | 'warning';

const ACCENT_STYLE: Record<Accent, CSSProperties> = {
  brand: { color: 'var(--admin-brand)', background: 'var(--admin-brand-dim)' },
  buy: { color: 'var(--buy)', background: 'var(--buy-dim)' },
  warning: { color: 'var(--accent)', background: 'var(--accent-dim)' },
};

export function AdminStatCard({
  label,
  value,
  sub,
  trend,
  icon: Icon,
  accent = 'brand',
}: {
  label: string;
  value: string;
  sub: string;
  trend?: 'up' | 'down';
  icon: (p: { size?: number }) => JSX.Element;
  accent?: Accent;
}) {
  return (
    <div className="admin-card-hover" style={styles.statCard}>
      <div style={{ ...styles.statIcon, ...ACCENT_STYLE[accent] }}>
        <Icon size={16} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={styles.statLabel}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={styles.statValue}>{value}</span>
          {trend && (
            <span style={{ display: 'inline-flex', alignItems: 'center', color: trend === 'up' ? 'var(--buy)' : 'var(--sell)' }}>
              {trend === 'up' ? <ArrowUpRightIcon size={13} /> : <ArrowDownRightIcon size={13} />}
            </span>
          )}
        </div>
        <div style={styles.statSub}>{sub}</div>
      </div>
    </div>
  );
}
