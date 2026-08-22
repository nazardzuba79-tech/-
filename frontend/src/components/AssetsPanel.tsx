import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { SkeletonRow } from './Skeleton';

interface Balance {
  asset: string;
  available: string;
  locked: string;
}

export function AssetsPanel({ refreshKey }: { refreshKey: number }) {
  const { t } = useLanguage();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .getBalances()
      .then(setBalances)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  return (
    <div style={styles.panel}>
      <div style={styles.columns}>
        <span>{t('trade.asset')}</span>
        <span style={{ textAlign: 'right' }}>{t('trade.available')}</span>
        <span style={{ textAlign: 'right' }}>{t('trade.locked')}</span>
      </div>
      <div style={styles.rows}>
        {balances.map((b) => (
          <div key={b.asset} style={styles.row}>
            <span className="mono" style={{ fontWeight: 600 }}>{b.asset}</span>
            <span className="mono" style={{ textAlign: 'right' }}>{parseFloat(b.available).toFixed(6)}</span>
            <span className="mono" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
              {parseFloat(b.locked).toFixed(6)}
            </span>
          </div>
        ))}
        {loading && balances.length === 0 && [1, 2, 3].map((i) => <SkeletonRow key={i} columns={[1, 1, 1]} />)}
        {!loading && balances.length === 0 && (
          <p style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>{t('trade.noAssets')}</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    flexShrink: 0,
  },
  rows: { display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    padding: '7px 14px',
    fontSize: 12,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
  },
};
