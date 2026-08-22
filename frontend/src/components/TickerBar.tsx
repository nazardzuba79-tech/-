import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf, Lang } from '../lib/i18n';
import { CryptoIcon } from './CryptoIcon';
import { Badge } from './Badge';

interface Stats {
  lastPrice: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
}

/** Bybit/Binance-style stats strip: live Kraken ticker data (real 24h high/low/volume/turnover, not something we approximate from our own thin trade history). */
export function TickerBar({ pair }: { pair: string }) {
  const { t, lang } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [baseAsset, quoteAsset] = pair.split('/');

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalTicker(pair)
        .then((res) => {
          if (cancelled) return;
          const tk = res.ticker;
          setStats({
            lastPrice: parseFloat(tk.lastPrice),
            changePercent: parseFloat(tk.changePercent24h),
            high24h: parseFloat(tk.high24h),
            low24h: parseFloat(tk.low24h),
            volume24h: parseFloat(tk.volume24h),
            quoteVolume24h: parseFloat(tk.quoteVolume24h),
          });
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pair]);

  const positive = (stats?.changePercent ?? 0) >= 0;

  return (
    <div style={styles.bar}>
      <div style={styles.pairBlock}>
        <CryptoIcon symbol={baseAsset} size={28} />
        <span style={styles.pairName} className="mono">
          {pair}
        </span>
        <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.lastPrice}>
          {stats ? stats.lastPrice.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 }) : '—'}
        </span>
        {stats && (
          <Badge
            text={`${positive ? '+' : ''}${stats.changePercent.toFixed(2)}%`}
            color={positive ? 'var(--buy)' : 'var(--sell)'}
            bg={positive ? 'var(--buy-dim)' : 'var(--sell-dim)'}
          />
        )}
      </div>

      <div style={styles.divider} />

      <Stat label={t('trade.high24h')} value={stats ? stats.high24h.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 }) : '—'} />
      <Stat label={t('trade.low24h')} value={stats ? stats.low24h.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 }) : '—'} />
      <Stat label={`${t('trade.volume24h')} (${baseAsset})`} value={stats ? stats.volume24h.toLocaleString(localeOf(lang), { maximumFractionDigits: 2 }) : '—'} />
      <Stat
        label={`${t('trade.turnover24h')} (${quoteAsset})`}
        value={stats ? formatCompact(stats.quoteVolume24h, lang) : '—'}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.stat}>
      <span style={styles.statLabel}>{label}</span>
      <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

function formatCompact(n: number, lang: Lang): string {
  return n.toLocaleString(localeOf(lang), { notation: 'compact', maximumFractionDigits: 2 });
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 28,
    padding: '12px 20px',
    borderBottom: '1px solid var(--border)',
    background: 'linear-gradient(180deg, var(--panel) 0%, var(--panel-alt) 100%)',
    flexShrink: 0,
    overflowX: 'auto',
  },
  pairBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  divider: {
    width: 1,
    height: 28,
    background: 'var(--border)',
    flexShrink: 0,
  },
  pairName: { fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-display)' },
  lastPrice: { fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' },
  stat: { display: 'flex', flexDirection: 'column', gap: 3, whiteSpace: 'nowrap' },
  statLabel: { fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
};
