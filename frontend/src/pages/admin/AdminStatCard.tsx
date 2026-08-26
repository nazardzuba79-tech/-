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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ ...styles.statIcon, ...ACCENT_STYLE[accent] }}>
          <Icon size={18} />
        </div>
        {trend && (
          <span style={{ display: 'inline-flex', alignItems: 'center', color: trend === 'up' ? 'var(--buy)' : 'var(--sell)' }}>
            {trend === 'up' ? <ArrowUpRightIcon size={14} /> : <ArrowDownRightIcon size={14} />}
          </span>
        )}
      </div>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statSub}>{sub}</div>
    </div>
  );
}
