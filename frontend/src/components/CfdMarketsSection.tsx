import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { CryptoIcon } from './CryptoIcon';
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

      <section className="market-dashboard">
        <div className="market-dashboard__pattern" />
        <div className="market-dashboard__shell">
          <div className="market-dashboard__top-grid">
            <article className="market-dashboard__card market-dashboard__trending-card">
              <h3 className="market-dashboard__heading">
                <FlameIcon /> {t('marketing.trending')}
              </h3>
              {trendingPair &&
                (() => {
                  const tk = tickers.get(trendingPair.pair);
                  const change = tk ? parseChangePercent(tk.changePercent24h, trendingPair.pair) : 0;
                  const sampledPoints = history.get(trendingPair.pair) ?? [];
                  const current = tk ? parseFloat(tk.lastPrice) : 0;
                  const open = current && change !== -100 ? current / (1 + change / 100) : current;
                  const high = tk ? parseFloat(tk.high24h) : current;
                  const low = tk ? parseFloat(tk.low24h) : current;
                  const summaryPoints = [open, high, low, (low + current) / 2, current].filter(Number.isFinite);
                  const points = sampledPoints.length >= 5 ? sampledPoints : summaryPoints;
                  const positive = change >= 0;
                  return (
                    <Link to="/login" className="market-dashboard__featured-link">
                      <div className="market-dashboard__featured-asset">
                        <CryptoIcon symbol={trendingPair.pair.split('/')[0]} size={50} />
                        <strong>{trendingPair.pair}</strong>
                      </div>
                      <div className="market-dashboard__featured-price">
                        <strong>{tk ? fmt(parseFloat(tk.lastPrice)) : '—'}</strong>
                        <span className={positive ? 'market-dashboard__positive' : 'market-dashboard__negative'}>
                          {tk ? `${positive ? '+' : ''}${change.toFixed(2)}%` : ''}
                        </span>
                      </div>
                      <PerformanceChart points={points} />
                      <div className="market-dashboard__months">
                        {monthLabels.map((m, i) => (
                          <span key={i}>{m}</span>
                        ))}
                      </div>
                    </Link>
                  );
                })()}
            </article>

            <article className="market-dashboard__card market-dashboard__cfd-card">
              <span className="market-dashboard__cfd-badge">CFD</span>
              <div className="market-dashboard__cfd-list">
                {cfdTickers.slice(0, 3).map((tk) => {
                  const change = parseChangePercent(tk.changePercent24h, tk.symbol);
                  const positive = change >= 0;
                  return (
                    <Link key={tk.symbol} to="/trade" className="market-dashboard__row market-dashboard__cfd-row">
                      <CfdMark symbol={tk.symbol} />
                      <span className="market-dashboard__row-label">
                        <strong>{tk.symbol}</strong>
                        <small>{tk.name}</small>
                      </span>
                      <span className="market-dashboard__cfd-value">
                        <strong className="mono">{tk.price}</strong>
                        <small className={positive ? 'market-dashboard__positive' : 'market-dashboard__negative'}>
                          {positive ? '+' : ''}
                          {change.toFixed(2)}%
                        </small>
                      </span>
                    </Link>
                  );
                })}
                {cfdTickers.length === 0 && <p style={styles.hint}>{t('trade.cfdUnavailable')}</p>}
              </div>
            </article>
          </div>

          <article className="market-dashboard__card market-dashboard__popular-card">
            <div className="market-dashboard__tabs-row">
              <button
                onClick={() => setPopularTab('crypto')}
                className={`market-dashboard__tab${popularTab === 'crypto' ? ' is-active' : ''}`}
              >
                {t('marketing.popularPairs')}
              </button>
              <button
                onClick={() => setPopularTab('cfd')}
                className={`market-dashboard__tab${popularTab === 'cfd' ? ' is-active' : ''}`}
              >
                {t('marketing.popularDerivatives')}
              </button>
              <Link to="/login" className="market-dashboard__view-all">
                {t('marketing.viewAllMarkets')}
              </Link>
            </div>

            <div className="market-dashboard__popular-list">
              {popularTab === 'crypto' &&
                OVERVIEW_PAIRS.slice(0, 4).map((pair) => {
                  const tk = tickers.get(pair);
                  const change = tk ? parseChangePercent(tk.changePercent24h, pair) : 0;
                  const base = pair.split('/')[0];
                  const positive = change >= 0;
                  return (
                    <Link key={pair} to="/login" className="market-dashboard__row market-dashboard__popular-row">
                      <CryptoIcon symbol={base} size={40} />
                      <span className="market-dashboard__row-label market-dashboard__popular-label">
                        <strong>{pair.replace('/', '')}</strong>
                        <small>{tk ? `Vol ${fmtCompact(parseFloat(tk.quoteVolume24h))}` : ''}</small>
                      </span>
                      <span className="mono market-dashboard__row-price">
                        {tk ? fmt(parseFloat(tk.lastPrice)) : '—'}
                      </span>
                      <span className={positive ? 'market-dashboard__positive' : 'market-dashboard__negative'}>
                        {tk ? `${positive ? '+' : ''}${change.toFixed(2)}%` : ''}
                      </span>
                    </Link>
                  );
                })}

              {popularTab === 'cfd' &&
                cfdTickers.slice(0, 4).map((tk) => {
                  const change = parseChangePercent(tk.changePercent24h, tk.symbol);
                  const positive = change >= 0;
                  return (
                    <Link key={tk.symbol} to="/trade" className="market-dashboard__row market-dashboard__popular-row">
                      <CfdMark symbol={tk.symbol} />
                      <span className="market-dashboard__row-label market-dashboard__popular-label">
                        <strong>{tk.symbol}</strong>
                        <small>{tk.name}</small>
                      </span>
                      <span className="mono market-dashboard__row-price">
                        {tk.price}
                      </span>
                      <span className={positive ? 'market-dashboard__positive' : 'market-dashboard__negative'}>
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
    <svg width={29} height={29} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function PerformanceChart({ points }: { points: number[] }) {
  const safePoints = points.length > 1 ? points : [0, 0, 0, 0, 0];
  const min = Math.min(...safePoints);
  const max = Math.max(...safePoints);
  const range = max - min || 1;
  const width = 376;
  const height = 104;
  const padY = 8;
  const coords = safePoints.map((point, index) => {
    const x = (index / Math.max(safePoints.length - 1, 1)) * width;
    const y = height - padY - ((point - min) / range) * (height - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg className="market-dashboard__chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <filter id="market-chart-glow" x="-20%" y="-30%" width="140%" height="160%">
          <feGaussianBlur stdDeviation="4.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <polyline className="market-dashboard__chart-glow" points={coords.join(' ')} />
      <polyline className="market-dashboard__chart-line" points={coords.join(' ')} />
    </svg>
  );
}

function CfdMark({ symbol }: { symbol: string }) {
  const upper = symbol.toUpperCase();
  const mark = upper.startsWith('XAU')
    ? { glyph: '◆', color: '#e4a900' }
    : upper.startsWith('EUR')
      ? { glyph: '€', color: '#1749a8' }
      : upper.startsWith('GBP')
        ? { glyph: '£', color: '#8b2635' }
        : upper.includes('JPY')
          ? { glyph: '¥', color: '#b8303a' }
          : { glyph: '$', color: '#22262c' };
  return (
    <span className="market-dashboard__coin" style={{ background: mark.color }} aria-hidden="true">
      {mark.glyph}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overview: { borderTop: '1px solid var(--border)', background: 'var(--panel-alt)' },
  tickerStrip: { display: 'flex', gap: 28, overflowX: 'auto', padding: '12px 20px', borderBottom: '1px solid var(--border)' },
  tickerStripItem: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 },
  hint: { padding: 14, color: 'var(--text-secondary)', fontSize: 12 },
};
