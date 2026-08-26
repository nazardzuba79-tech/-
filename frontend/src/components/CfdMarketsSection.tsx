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

/** Live ticker strip + "trending / CFD / popular markets" dashboard —
 * a pixel-faithful port of the "TradingDashboard" block from the Bolt
 * reference the owner supplied (colors, spacing, badge, tab-underline,
 * background grid texture all copied from its CSS), wired to our own real
 * ticker/CFD data instead of the reference's hardcoded example numbers.
 * Extracted as its own component so both the marketing homepage and the
 * auth page can mount it without duplicating the fetch/state logic. */
export function CfdMarketsSection({ id }: { id?: string }) {
  const { t, lang } = useLanguage();
  const [tickers, setTickers] = useState<Map<string, Ticker>>(new Map());
  const [history, setHistory] = useState<Map<string, number[]>>(new Map());
  const [popularTab, setPopularTab] = useState<'crypto' | 'cfd'>('cfd');
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

  // The reference's trending card has a 5-month axis strip under the
  // sparkline. It's a decorative chart caption, not a claim about the data
  // (our sparkline only spans a short live sample) — so instead of copying
  // its 5 literal month strings we compute the real last 5 calendar months,
  // which keeps the same layout without asserting anything untrue.
  const monthLabels = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (4 - i));
    return d.toLocaleDateString(localeOf(lang), { month: 'short' }).toUpperCase().replace('.', '');
  });

  return (
    <>
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
      </section>

      <section style={styles.dashboardSection}>
        <div style={styles.dashboardPattern} />
        <div style={styles.dashboardShell}>
          <div style={styles.dashboardTopGrid}>
            <article style={{ ...styles.dashboardCard, ...styles.dashboardTrendingCard }}>
              <h3 style={styles.dashboardCardHeading}>
                <FlameIcon /> {t('marketing.trending')}
              </h3>
              {trendingPair &&
                (() => {
                  const tk = tickers.get(trendingPair.pair);
                  const change = tk ? parseChangePercent(tk.changePercent24h, trendingPair.pair) : 0;
                  const points = history.get(trendingPair.pair) ?? [];
                  const positive = change >= 0;
                  return (
                    <Link to="/login" style={styles.dashboardFeaturedLink}>
                      <div style={styles.dashboardFeaturedAsset}>
                        <CryptoIcon symbol={trendingPair.pair.split('/')[0]} size={36} />
                        <strong style={styles.dashboardFeaturedAssetName}>{trendingPair.pair}</strong>
                      </div>
                      <div style={styles.dashboardFeaturedPrice}>
                        <strong style={styles.dashboardFeaturedPriceValue}>{tk ? fmt(parseFloat(tk.lastPrice)) : '—'}</strong>
                        <span style={{ color: positive ? '#22c55e' : '#ef4444' }}>
                          {tk ? `${positive ? '+' : ''}${change.toFixed(2)}%` : ''}
                        </span>
                      </div>
                      {points.length > 1 && <Sparkline points={points} width={420} height={105} />}
                      <div style={styles.dashboardMonths}>
                        {monthLabels.map((m, i) => (
                          <span key={i} style={styles.dashboardMonthLabel}>
                            {m}
                          </span>
                        ))}
                      </div>
                    </Link>
                  );
                })()}
            </article>

            <article style={{ ...styles.dashboardCard, ...styles.dashboardCfdCard }}>
              <span style={styles.cfdBadge}>CFD</span>
              <div style={styles.dashboardCfdList}>
                {cfdTickers.slice(0, 3).map((tk) => {
                  const change = parseChangePercent(tk.changePercent24h, tk.symbol);
                  const positive = change >= 0;
                  return (
                    <Link key={tk.symbol} to="/trade" style={styles.dashboardRow} className="dashboard-row-hover">
                      <span style={{ ...styles.dashboardCoin, background: assetColor(tk.symbol).solid }}>
                        {CFD_ICON_BY_SYMBOL[tk.symbol] ?? '◆'}
                      </span>
                      <span style={styles.dashboardRowLabel}>
                        <strong style={styles.dashboardRowLabelStrong}>{tk.symbol}</strong>
                        <small style={styles.dashboardRowLabelSmall}>{tk.name}</small>
                      </span>
                      <span className="mono" style={styles.dashboardRowPrice}>
                        {tk.price}
                      </span>
                      <span style={positive ? styles.dashboardPositive : styles.dashboardNegative}>
                        {positive ? '+' : ''}
                        {change.toFixed(2)}%
                      </span>
                    </Link>
                  );
                })}
                {cfdTickers.length === 0 && <p style={styles.hint}>{t('trade.cfdUnavailable')}</p>}
              </div>
            </article>
          </div>

          <article style={{ ...styles.dashboardCard, ...styles.dashboardPopularCard }}>
            <div style={styles.dashboardTabsRow}>
              <button
                onClick={() => setPopularTab('crypto')}
                style={{ ...styles.dashboardTabBtn, ...(popularTab === 'crypto' ? styles.dashboardTabBtnActive : {}) }}
                className={popularTab === 'crypto' ? 'dashboard-tab-active' : undefined}
              >
                {t('marketing.popularPairs')}
              </button>
              <button
                onClick={() => setPopularTab('cfd')}
                style={{ ...styles.dashboardTabBtn, ...(popularTab === 'cfd' ? styles.dashboardTabBtnActive : {}) }}
                className={popularTab === 'cfd' ? 'dashboard-tab-active' : undefined}
              >
                {t('marketing.popularDerivatives')}
              </button>
              <Link to="/login" style={styles.viewAllLink}>
                {t('marketing.viewAllMarkets')} <ArrowIcon />
              </Link>
            </div>

            <div style={styles.dashboardPopularList}>
              {popularTab === 'crypto' &&
                OVERVIEW_PAIRS.map((pair) => {
                  const tk = tickers.get(pair);
                  const change = tk ? parseChangePercent(tk.changePercent24h, pair) : 0;
                  const base = pair.split('/')[0];
                  const positive = change >= 0;
                  return (
                    <Link key={pair} to="/login" style={styles.dashboardRow} className="dashboard-row-hover">
                      <CryptoIcon symbol={base} size={36} />
                      <span style={styles.dashboardRowLabel}>
                        <strong style={styles.dashboardRowLabelStrong}>{pair}</strong>
                        <small style={styles.dashboardRowLabelSmall}>{tk ? `Vol ${fmtCompact(parseFloat(tk.quoteVolume24h))}` : ''}</small>
                      </span>
                      <span className="mono" style={styles.dashboardRowPrice}>
                        {tk ? fmt(parseFloat(tk.lastPrice)) : '—'}
                      </span>
                      <span style={positive ? styles.dashboardPositive : styles.dashboardNegative}>
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
                    <Link key={tk.symbol} to="/trade" style={styles.dashboardRow} className="dashboard-row-hover">
                      <span style={{ ...styles.dashboardCoin, background: assetColor(tk.symbol).solid }}>
                        {CFD_ICON_BY_SYMBOL[tk.symbol] ?? '◆'}
                      </span>
                      <span style={styles.dashboardRowLabel}>
                        <strong style={styles.dashboardRowLabelStrong}>{tk.symbol}</strong>
                        <small style={styles.dashboardRowLabelSmall}>{tk.name}</small>
                      </span>
                      <span className="mono" style={styles.dashboardRowPrice}>
                        {tk.price}
                      </span>
                      <span style={positive ? styles.dashboardPositive : styles.dashboardNegative}>
                        {positive ? '+' : ''}
                        {change.toFixed(2)}%
                      </span>
                    </Link>
                  );
                })}
              {popularTab === 'cfd' && cfdTickers.length === 0 && <p style={styles.hint}>{t('trade.cfdUnavailable')}</p>}
            </div>
          </article>
        </div>
      </section>
    </>
  );
}

function FlameIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="#f97316" stroke="#f97316" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
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
  hint: { padding: 14, color: 'var(--text-secondary)', fontSize: 12 },
  viewAllLink: { display: 'inline-flex', alignItems: 'center', gap: 6, color: '#71717a', fontSize: 13, fontWeight: 500, marginLeft: 'auto' },

  dashboardSection: {
    position: 'relative',
    padding: '80px 24px 90px',
    background: '#0a0a0b',
    borderTop: '1px solid rgba(129, 120, 236, 0.07)',
    overflow: 'hidden',
  },
  dashboardPattern: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 520,
    height: 520,
    opacity: 0.04,
    backgroundImage:
      'linear-gradient(rgba(140, 140, 160, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(140, 140, 160, 0.5) 1px, transparent 1px)',
    backgroundSize: '48px 48px',
    WebkitMaskImage: 'radial-gradient(circle at bottom right, black, transparent 70%)',
    maskImage: 'radial-gradient(circle at bottom right, black, transparent 70%)',
    pointerEvents: 'none',
  },
  dashboardShell: { position: 'relative', zIndex: 2, maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 20 },
  dashboardCard: {
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: 20,
    background: '#141416',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4), 0 0 60px rgba(95, 95, 130, 0.04) inset',
  },
  dashboardTopGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 },
  dashboardTrendingCard: { padding: 28 },
  dashboardCardHeading: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 24px', fontSize: 16, fontWeight: 700, color: '#f4f4f5' },
  dashboardFeaturedLink: { display: 'flex', flexDirection: 'column', textDecoration: 'none' },
  dashboardFeaturedAsset: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
  dashboardFeaturedAssetName: { fontSize: 18, fontWeight: 700, color: '#fafafa', letterSpacing: '0.02em' },
  dashboardFeaturedPrice: { display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 18, fontSize: 15, fontWeight: 700 },
  dashboardFeaturedPriceValue: { fontSize: 32, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },
  dashboardMonths: { display: 'flex', justifyContent: 'space-between', marginTop: 12, padding: '0 2px' },
  dashboardMonthLabel: { fontSize: 11, color: '#71717a', fontWeight: 500, letterSpacing: '0.08em' },
  dashboardCfdCard: { padding: '24px 28px' },
  cfdBadge: {
    display: 'inline-block',
    padding: '5px 14px',
    marginBottom: 20,
    borderRadius: 8,
    background: '#1e3a8a',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
  },
  dashboardCfdList: { display: 'grid', gap: 6 },
  dashboardRow: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr auto auto',
    alignItems: 'center',
    gap: 14,
    padding: '12px 14px',
    borderRadius: 12,
    textAlign: 'left',
    color: '#f4f4f5',
    background: 'transparent',
    textDecoration: 'none',
  },
  dashboardCoin: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    color: '#fff',
    fontSize: 13,
    fontWeight: 800,
    boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.08) inset',
    flexShrink: 0,
  },
  dashboardRowLabel: { display: 'grid', gap: 3, minWidth: 0 },
  dashboardRowLabelStrong: { fontSize: 14, fontWeight: 700, color: '#fafafa' },
  dashboardRowLabelSmall: { fontSize: 11, color: '#71717a' },
  dashboardRowPrice: { fontSize: 14, fontWeight: 700, color: '#f4f4f5', textAlign: 'right' },
  dashboardPositive: { fontSize: 13, fontWeight: 600, color: '#22c55e', textAlign: 'right' },
  dashboardNegative: { fontSize: 13, fontWeight: 600, color: '#ef4444', textAlign: 'right' },
  dashboardPopularCard: { padding: '24px 28px' },
  dashboardTabsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 28,
    marginBottom: 18,
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    paddingBottom: 14,
  },
  dashboardTabBtn: { padding: 0, background: 'none', border: 'none', fontSize: 14, fontWeight: 600, color: '#71717a' },
  dashboardTabBtnActive: { color: '#fafafa', position: 'relative' },
  dashboardPopularList: { display: 'grid', gap: 4 },
};
