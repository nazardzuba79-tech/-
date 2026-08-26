import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { CryptoIcon, assetColor } from './CryptoIcon';
import { Sparkline } from './Sparkline';
import { parseChangePercent } from '../lib/priceChange';
import { useCfdTickers } from '../lib/useCfdTickers';
import { CFD_ICON_BY_SYMBOL } from './CfdInstrumentList';

const OVERVIEW_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'TRX/USDT', 'DOGE/USDT'];
const TICKER_STRIP_PAIRS = [...OVERVIEW_PAIRS];

type Ticker = Awaited<ReturnType<typeof api.getExternalTickers>>['tickers'][number];

/** Live ticker strip + "trending / CFD / popular markets" dashboard cards —
 * originally built for the marketing homepage, extracted here so the same
 * real-data section can drop into any other page (e.g. under the login
 * form's card banner) without duplicating the fetch/state logic or JSX. */
export function CfdMarketsSection({ id }: { id?: string }) {
  const { t, lang } = useLanguage();
  const [tickers, setTickers] = useState<Map<string, Ticker>>(new Map());
  const [history, setHistory] = useState<Map<string, number[]>>(new Map());
  const [popularTab, setPopularTab] = useState<'crypto' | 'cfd'>('crypto');
  const { tickers: cfdTickers } = useCfdTickers();

  useEffect(() => {
    function load() {
      api
        .getExternalTickers()
        .then((res) => {
          const map = new Map<string, Ticker>();
          for (const tk of res.tickers) map.set(tk.pair, tk);
          setTickers(map);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  // Lightweight in-browser price trail for the sparkline — no dedicated
  // history endpoint for this; sampling the live ticker every few seconds
  // is enough to draw a real (if short) recent trend instead of a static line.
  useEffect(() => {
    const interval = setInterval(() => {
      setHistory((prev) => {
        const next = new Map(prev);
        for (const pair of OVERVIEW_PAIRS) {
          const tk = tickers.get(pair);
          if (!tk) continue;
          const points = next.get(pair) ?? [];
          next.set(pair, [...points, parseFloat(tk.lastPrice)].slice(-20));
        }
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [tickers]);

  const fmt = (n: number) => n.toLocaleString(localeOf(lang), { maximumFractionDigits: n < 1 ? 6 : 2 });
  const fmtCompact = (n: number) => n.toLocaleString(localeOf(lang), { notation: 'compact', maximumFractionDigits: 2 });

  // Biggest 24h mover among the pairs already on screen — for the "trending"
  // card. Real data, just picked rather than fetched separately (no
  // dedicated "top movers" endpoint).
  const trendingPair = OVERVIEW_PAIRS.reduce<{ pair: string; change: number } | null>((best, pair) => {
    const tk = tickers.get(pair);
    if (!tk) return best;
    const change = Math.abs(parseChangePercent(tk.changePercent24h, pair));
    if (!best || change > best.change) return { pair, change };
    return best;
  }, null);

  return (
    <section id={id} style={styles.overview}>
      <div style={styles.tickerStrip}>
        {TICKER_STRIP_PAIRS.map((pair) => {
          const tk = tickers.get(pair);
          const change = tk ? parseChangePercent(tk.changePercent24h, pair) : 0;
          return (
            <div key={pair} style={styles.tickerStripItem}>
              <span style={{ fontWeight: 700 }}>{pair.split('/')[0]}</span>
              <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                {tk ? fmt(parseFloat(tk.lastPrice)) : '—'}
              </span>
              <span className={change >= 0 ? 'text-buy' : 'text-sell'}>
                {tk ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : ''}
              </span>
            </div>
          );
        })}
        {cfdTickers.slice(0, 4).map((tk) => {
          const change = parseChangePercent(tk.changePercent24h, tk.symbol);
          return (
            <div key={tk.symbol} style={styles.tickerStripItem}>
              <span style={{ fontWeight: 700 }}>{CFD_ICON_BY_SYMBOL[tk.symbol] ?? '◆'} {tk.symbol}</span>
              <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                {tk.price}
              </span>
              <span className={change >= 0 ? 'text-buy' : 'text-sell'}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>

      <div style={styles.dashboardTopGrid}>
        <div className="accent-edge surface-raised" style={styles.dashboardCard}>
          <h3 style={styles.dashboardCardHeading}>
            <span style={styles.flameIcon}>🔥</span> {t('marketing.trending')}
          </h3>
          {trendingPair &&
            (() => {
              const tk = tickers.get(trendingPair.pair);
              const change = tk ? parseChangePercent(tk.changePercent24h, trendingPair.pair) : 0;
              const points = history.get(trendingPair.pair) ?? [];
              const positive = change >= 0;
              return (
                <Link to="/login" style={styles.dashboardFeaturedLink} className="row-hover">
                  <div style={styles.dashboardFeaturedAsset}>
                    <CryptoIcon symbol={trendingPair.pair.split('/')[0]} size={36} />
                    <strong>{trendingPair.pair}</strong>
                  </div>
                  <div style={styles.dashboardFeaturedPrice}>
                    <strong className="mono">{tk ? fmt(parseFloat(tk.lastPrice)) : '—'}</strong>
                    <span className={positive ? 'text-buy' : 'text-sell'}>
                      {tk ? `${positive ? '+' : ''}${change.toFixed(2)}%` : ''}
                    </span>
                  </div>
                  {points.length > 1 && <Sparkline points={points} width={400} height={90} />}
                </Link>
              );
            })()}
        </div>

        <div className="accent-edge surface-raised" style={styles.dashboardCard}>
          <span style={styles.cfdTrendBadge}>CFD</span>
          <div style={styles.dashboardRowList}>
            {cfdTickers.slice(0, 3).map((tk) => {
              const change = parseChangePercent(tk.changePercent24h, tk.symbol);
              const positive = change >= 0;
              return (
                <Link key={tk.symbol} to="/trade" style={styles.dashboardRow} className="row-hover">
                  <span style={{ ...styles.dashboardCoin, background: assetColor(tk.symbol).solid }}>
                    {CFD_ICON_BY_SYMBOL[tk.symbol] ?? '◆'}
                  </span>
                  <span style={styles.dashboardRowLabel}>
                    <strong>{tk.symbol}</strong>
                    <small>{tk.name}</small>
                  </span>
                  <span className="mono" style={styles.dashboardRowPrice}>
                    {tk.price}
                  </span>
                  <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.dashboardRowChange}>
                    {positive ? '+' : ''}
                    {change.toFixed(2)}%
                  </span>
                </Link>
              );
            })}
            {cfdTickers.length === 0 && <p style={styles.hint}>{t('trade.cfdUnavailable')}</p>}
          </div>
        </div>
      </div>

      <div style={styles.overviewInner}>
        <div style={styles.dashboardTabsRow}>
          <button
            onClick={() => setPopularTab('crypto')}
            style={{ ...styles.dashboardTabBtn, ...(popularTab === 'crypto' ? styles.dashboardTabBtnActive : {}) }}
          >
            {t('marketing.popularPairs')}
          </button>
          <button
            onClick={() => setPopularTab('cfd')}
            style={{ ...styles.dashboardTabBtn, ...(popularTab === 'cfd' ? styles.dashboardTabBtnActive : {}) }}
          >
            {t('marketing.popularDerivatives')}
          </button>
          <Link to="/login" style={styles.viewAllLink}>
            {t('marketing.viewAllMarkets')} <ArrowIcon />
          </Link>
        </div>

        <div className="accent-edge surface-raised" style={styles.dashboardPopularCard}>
          <div style={styles.dashboardRowList}>
            {popularTab === 'crypto' &&
              OVERVIEW_PAIRS.map((pair) => {
                const tk = tickers.get(pair);
                const change = tk ? parseChangePercent(tk.changePercent24h, pair) : 0;
                const base = pair.split('/')[0];
                const positive = change >= 0;
                return (
                  <Link key={pair} to="/login" style={styles.dashboardRow} className="row-hover">
                    <CryptoIcon symbol={base} size={36} />
                    <span style={styles.dashboardRowLabel}>
                      <strong>{pair}</strong>
                      <small>{tk ? `Vol ${fmtCompact(parseFloat(tk.quoteVolume24h))}` : ''}</small>
                    </span>
                    <span className="mono" style={styles.dashboardRowPrice}>
                      {tk ? fmt(parseFloat(tk.lastPrice)) : '—'}
                    </span>
                    <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.dashboardRowChange}>
                      {tk ? `${positive ? '+' : ''}${change.toFixed(2)}%` : ''}
                    </span>
                  </Link>
                );
              })}

            {popularTab === 'cfd' &&
              cfdTickers.map((tk) => {
                const change = parseChangePercent(tk.changePercent24h, tk.symbol);
                const positive = change >= 0;
                return (
                  <Link key={tk.symbol} to="/trade" style={styles.dashboardRow} className="row-hover">
                    <span style={{ ...styles.dashboardCoin, background: assetColor(tk.symbol).solid }}>
                      {CFD_ICON_BY_SYMBOL[tk.symbol] ?? '◆'}
                    </span>
                    <span style={styles.dashboardRowLabel}>
                      <strong>{tk.symbol}</strong>
                      <small>{tk.name}</small>
                    </span>
                    <span className="mono" style={styles.dashboardRowPrice}>
                      {tk.price}
                    </span>
                    <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.dashboardRowChange}>
                      {positive ? '+' : ''}
                      {change.toFixed(2)}%
                    </span>
                  </Link>
                );
              })}
            {popularTab === 'cfd' && cfdTickers.length === 0 && <p style={styles.hint}>{t('trade.cfdUnavailable')}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function ArrowIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overview: { borderTop: '1px solid var(--border)', background: 'var(--panel-alt)' },
  tickerStrip: { display: 'flex', gap: 28, overflowX: 'auto', padding: '12px 20px', borderBottom: '1px solid var(--border)' },
  tickerStripItem: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 },
  overviewInner: { maxWidth: 1280, margin: '0 auto', padding: '56px 20px' },
  viewAllLink: { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 14, fontWeight: 700 },
  hint: { padding: 14, color: 'var(--text-secondary)', fontSize: 12 },
  dashboardTopGrid: {
    maxWidth: 1280,
    margin: '0 auto',
    padding: '28px 20px 0',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
  },
  dashboardCard: { borderRadius: 20, padding: 26, background: 'var(--panel)', border: '1px solid var(--border)' },
  dashboardCardHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '0 0 20px',
    fontSize: 15,
    fontWeight: 700,
  },
  flameIcon: { fontSize: 18 },
  dashboardFeaturedLink: { display: 'flex', flexDirection: 'column', gap: 14, borderRadius: 12, margin: -8, padding: 8 },
  dashboardFeaturedAsset: { display: 'flex', alignItems: 'center', gap: 12 },
  dashboardFeaturedPrice: { display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 15, fontWeight: 700 },
  cfdTrendBadge: {
    alignSelf: 'flex-start',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.04em',
    borderRadius: 6,
    padding: '4px 10px',
    marginBottom: 14,
  },
  dashboardRowList: { display: 'flex', flexDirection: 'column', gap: 4 },
  dashboardRow: {
    display: 'grid',
    gridTemplateColumns: '36px 1fr auto auto',
    alignItems: 'center',
    gap: 12,
    padding: '10px 10px',
    borderRadius: 12,
  },
  dashboardCoin: {
    width: 36,
    height: 36,
    borderRadius: '50% / 40%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 15,
    color: '#fff',
    flexShrink: 0,
  },
  dashboardRowLabel: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  dashboardRowPrice: { fontSize: 14, fontWeight: 700, textAlign: 'right' },
  dashboardRowChange: { fontSize: 13, fontWeight: 700, textAlign: 'right' },
  dashboardTabsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    marginBottom: 16,
  },
  dashboardTabBtn: {
    background: 'transparent',
    border: 'none',
    padding: '0 0 4px',
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--text-tertiary)',
    borderBottom: '2px solid transparent',
  },
  dashboardTabBtnActive: { color: 'var(--text-primary)', borderBottomColor: 'var(--accent)' },
  dashboardPopularCard: { borderRadius: 20, padding: '18px 24px', background: 'var(--panel)', border: '1px solid var(--border)' },
};
