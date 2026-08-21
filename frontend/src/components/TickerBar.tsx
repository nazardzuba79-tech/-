import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';

interface Stats {
  lastPrice: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

/** Bybit-style stats strip: last price + 24h change/high/low/volume, mirrored from Kraken (real market data — our own internal trade history is too thin for this). */
export function TickerBar({ pair }: { pair: string }) {
  const { t } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalCandles(pair, '1h', 24)
        .then((res) => {
          if (cancelled) return;
          if (res.candles.length === 0) return setStats(null);
          const first = res.candles[0];
          const last = res.candles[res.candles.length - 1];
          setStats({
            lastPrice: last.close,
            changePercent: first.open === 0 ? 0 : ((last.close - first.open) / first.open) * 100,
            high24h: Math.max(...res.candles.map((c) => c.high)),
            low24h: Math.min(...res.candles.map((c) => c.low)),
            volume24h: res.candles.reduce((sum, c) => sum + c.volume, 0),
          });
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pair]);

  const positive = (stats?.changePercent ?? 0) >= 0;

  return (
    <div style={styles.bar}>
      <div style={styles.pairBlock}>
        <span style={styles.pairName} className="mono">
          {pair}
        </span>
        <span
          className={`mono ${positive ? 'text-buy' : 'text-sell'}`}
          style={styles.lastPrice}
        >
          {stats ? stats.lastPrice.toFixed(2) : '—'}
        </span>
      </div>

      <Stat label={t('trade.change24h')} value={stats ? `${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%` : '—'} color={stats ? (positive ? 'var(--buy)' : 'var(--sell)') : undefined} />
      <Stat label={t('trade.high24h')} value={stats ? stats.high24h.toFixed(2) : '—'} />
      <Stat label={t('trade.low24h')} value={stats ? stats.low24h.toFixed(2) : '—'} />
      <Stat label={t('trade.volume24h')} value={stats ? stats.volume24h.toFixed(4) : '—'} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={styles.stat}>
      <span style={styles.statLabel}>{label}</span>
      <span className="mono" style={{ fontSize: 13, color: color ?? 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 36,
    padding: '10px 20px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--panel)',
    flexShrink: 0,
    overflowX: 'auto',
  },
  pairBlock: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 14,
  },
  pairName: { fontSize: 15, fontWeight: 700 },
  lastPrice: { fontSize: 18, fontWeight: 700 },
  stat: { display: 'flex', flexDirection: 'column', gap: 2, whiteSpace: 'nowrap' },
  statLabel: { fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em' },
};
