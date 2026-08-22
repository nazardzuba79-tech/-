import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { parseChangePercent } from '../lib/priceChange';
import { TOP_COINS } from '../lib/topCoins';

interface Item {
  pair: string;
  changePercent: number;
}

/** Scrolling marquee of major-coin 24h movers, Binance/Bybit-style —
 * restricted to TOP_COINS (see that file's comment on why it's a curated
 * allowlist rather than a live market-cap ranking) so this never surfaces
 * an obscure microcap next to BTC/ETH. */
export function TopGainersTicker() {
  const { lang } = useLanguage();
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalTickers()
        .then((res) => {
          if (cancelled) return;
          const filtered = res.tickers
            .filter((tk) => tk.pair.endsWith('/USDT') && TOP_COINS.has(tk.pair.split('/')[0]))
            .map((tk) => ({
              pair: tk.pair.replace('/', ''),
              changePercent: parseChangePercent(tk.changePercent24h, tk.pair),
              quoteVolume24h: parseFloat(tk.quoteVolume24h || '0'),
            }))
            .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
            .slice(0, 24);
          setItems(filtered);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [lang]);

  if (items.length === 0) return null;

  const hottest = items.reduce((max, it) => (Math.abs(it.changePercent) > Math.abs(max.changePercent) ? it : max), items[0]);
  // Duplicated once so the CSS marquee can loop seamlessly from -50%.
  const loop = [...items, ...items];

  return (
    <div style={styles.wrap}>
      <div className="ticker-track" style={styles.track}>
        {loop.map((it, i) => {
          const positive = it.changePercent >= 0;
          return (
            <span key={`${it.pair}-${i}`} style={styles.item}>
              <span style={styles.symbol}>{it.pair}</span>
              <span style={{ color: positive ? 'var(--buy)' : 'var(--sell)', fontWeight: 700 }}>
                {positive ? '+' : ''}
                {it.changePercent.toFixed(2)}%
              </span>
              {it.pair === hottest.pair && <span style={styles.hotBadge}>HOT</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    overflow: 'hidden',
    borderBottom: '1px solid var(--border)',
    background: 'var(--panel)',
    padding: '8px 0',
    flexShrink: 0,
  },
  track: {
    display: 'flex',
    width: 'max-content',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    padding: '0 18px',
    whiteSpace: 'nowrap',
  },
  symbol: { color: 'var(--text-primary)', fontWeight: 700 },
  hotBadge: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontSize: 9,
    fontWeight: 800,
    padding: '2px 6px',
    borderRadius: 4,
    letterSpacing: '0.02em',
  },
};
