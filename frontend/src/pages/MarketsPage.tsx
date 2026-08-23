import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf, Key } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { SearchInput } from '../components/SearchInput';
import { CryptoIcon } from '../components/CryptoIcon';
import { PriceCell } from '../components/PriceCell';
import { Footer } from '../components/Footer';
import { SkeletonRow } from '../components/Skeleton';
import { parseChangePercent } from '../lib/priceChange';
import { CATEGORIES, CoinCategory, CoinRanking } from '../lib/pairList';

const CATEGORY_LABEL_KEY: Record<CoinCategory, Key> = {
  DEFI: 'markets.category.defi',
  LAYER_1: 'markets.category.layer1',
  MEME: 'markets.category.meme',
  STABLECOIN: 'markets.category.stablecoin',
};

interface Ticker {
  pair: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  quoteVolume24h: string;
  changePercent24h: string;
}

/**
 * Read-only mirror of Kraken spot market data: every tradable pair, its live
 * price, and (for the pair you select) live order book depth. Purely
 * informational — nothing here touches our own matching engine or Kraken
 * itself, see KrakenMarketDataService for the source.
 */
export function MarketsPage() {
  const { t, lang } = useLanguage();
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [search, setSearch] = useState('');
  const [selectedPair, setSelectedPair] = useState<string | null>(null);
  const [book, setBook] = useState<{ bids: any[]; asks: any[] }>({ bids: [], asks: [] });
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CoinCategory | null>(null);
  const [rankByBase, setRankByBase] = useState<Map<string, CoinRanking> | null>(null);

  useEffect(() => {
    api
      .getExternalRankings()
      .then((res) => {
        const map = new Map<string, CoinRanking>();
        for (const r of res.rankings) map.set(r.symbol, r as CoinRanking);
        setRankByBase(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function refreshTickers() {
      api
        .getExternalTickers()
        .then((res) => {
          setTickers(res.tickers);
          setError(null);
          setSelectedPair((current) => {
            if (current) return current;
            const mostLiquid = [...res.tickers].sort(
              (a, b) => parseFloat(b.quoteVolume24h || '0') - parseFloat(a.quoteVolume24h || '0')
            )[0];
            return mostLiquid?.pair ?? null;
          });
        })
        .catch(() => setError(t('markets.loadError')));
    }
    refreshTickers();
    const interval = setInterval(refreshTickers, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedPair) return;
    function refreshBook() {
      api
        .getExternalOrderBook(selectedPair!)
        .then((res) =>
          setBook({
            bids: res.bids.map((l) => ({ ...l, orders: 0 })),
            asks: res.asks.map((l) => ({ ...l, orders: 0 })),
          })
        )
        .catch(() => {});
    }
    refreshBook();
    const interval = setInterval(refreshBook, 2000);
    return () => clearInterval(interval);
  }, [selectedPair]);

  const filtered = useMemo(
    () =>
      tickers
        .filter((t) => t.pair.toLowerCase().includes(search.toLowerCase()))
        .filter((t) => {
          if (!categoryFilter) return true;
          const ranking = rankByBase?.get(t.pair.split('/')[0]);
          return ranking?.categories.includes(categoryFilter) ?? false;
        })
        .sort((a, b) => {
          // Browsing a category is browsing by market-cap rank within it —
          // only kicks in once real CoinGecko data is actually loaded.
          if (categoryFilter && rankByBase) {
            const rankA = rankByBase.get(a.pair.split('/')[0])?.rank ?? Infinity;
            const rankB = rankByBase.get(b.pair.split('/')[0])?.rank ?? Infinity;
            if (rankA !== rankB) return rankA - rankB;
          }
          // Most-traded first — the raw API order is roughly alphabetical,
          // which otherwise puts thin, barely-liquid pairs at the top.
          return parseFloat(b.quoteVolume24h || '0') - parseFloat(a.quoteVolume24h || '0');
        }),
    [tickers, search, categoryFilter, rankByBase]
  );

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav active="/markets" />

      <main style={styles.main}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>{t('markets.title')}</h1>
          <SearchInput value={search} onChange={setSearch} placeholder={t('markets.searchPair')} style={{ width: 220 }} />
        </div>

        {error && <div style={styles.banner}>{error}</div>}

        <div style={styles.chipsRow}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              disabled={!rankByBase}
              onClick={() => setCategoryFilter((prev) => (prev === c ? null : c))}
              className="row-hover"
              style={{
                ...styles.chip,
                ...(categoryFilter === c ? styles.chipActive : {}),
                opacity: rankByBase ? 1 : 0.5,
              }}
              title={!rankByBase ? t('markets.rankingsUnavailable') : undefined}
            >
              {t(CATEGORY_LABEL_KEY[c])}
            </button>
          ))}
        </div>

        <div style={styles.grid}>
          <div className="surface-raised" style={styles.listPanel}>
            <div style={styles.listHeader}>
              <span>{t('markets.pair')}</span>
              <span style={{ textAlign: 'right' }}>{t('markets.price')}</span>
              <span style={{ textAlign: 'right' }}>{t('markets.change24h')}</span>
              <span style={{ textAlign: 'right' }}>{t('markets.high24h')}</span>
              <span style={{ textAlign: 'right' }}>{t('markets.low24h')}</span>
              <span style={{ textAlign: 'right' }}>{t('markets.volume24h')}</span>
            </div>
            <div style={styles.listBody}>
              {filtered.map((tk) => {
                const change = parseChangePercent(tk.changePercent24h, tk.pair);
                const positive = change >= 0;
                return (
                  <div
                    key={tk.pair}
                    onClick={() => setSelectedPair(tk.pair)}
                    className="row-hover"
                    style={{
                      ...styles.listRow,
                      background: tk.pair === selectedPair ? 'var(--panel-alt)' : 'transparent',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <CryptoIcon symbol={tk.pair.split('/')[0]} size={20} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.pair}</span>
                      {rankByBase?.get(tk.pair.split('/')[0])?.rank !== undefined && (
                        <span style={styles.rankBadge}>#{rankByBase!.get(tk.pair.split('/')[0])!.rank}</span>
                      )}
                    </span>
                    <PriceCell value={parseFloat(tk.lastPrice)} className="mono" style={{ textAlign: 'right' }} />
                    <span
                      className={positive ? 'text-buy' : 'text-sell'}
                      style={{ textAlign: 'right' }}
                    >
                      {positive ? '+' : ''}
                      {change.toFixed(2)}%
                    </span>
                    <span className="mono" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {parseFloat(tk.high24h)}
                    </span>
                    <span className="mono" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {parseFloat(tk.low24h)}
                    </span>
                    <span className="mono" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {parseFloat(tk.volume24h).toLocaleString(localeOf(lang), { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                );
              })}
              {filtered.length === 0 && tickers.length > 0 && (
                <p style={{ padding: 14, color: 'var(--text-tertiary)' }}>{t('markets.nothingFound')}</p>
              )}
              {tickers.length === 0 &&
                !error &&
                Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} columns={[2, 1, 0.8, 1, 1, 1]} />)}
            </div>
          </div>

          <div style={styles.bookColumn}>
            {selectedPair ? (
              <>
                <div style={styles.selectedPair} className="mono">
                  {selectedPair}
                </div>
                <OrderBookPanel bids={book.bids} asks={book.asks} />
              </>
            ) : (
              <p style={{ color: 'var(--text-tertiary)' }}>{t('markets.selectPair')}</p>
            )}
          </div>
        </div>

        <Footer />
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' },
  main: { padding: 32, maxWidth: 1100, margin: '0 auto', width: '100%' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16 },
  title: { fontSize: 22, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, letterSpacing: '-0.01em' },
  banner: {
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 20,
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
  },
  chipsRow: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  chip: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  chipActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--on-accent)' },
  rankBadge: {
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--text-tertiary)',
    background: 'var(--panel-alt)',
    borderRadius: 999,
    padding: '2px 6px',
  },
  grid: { display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' },
  listPanel: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  listHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 0.8fr 1fr 1fr 1fr',
    padding: '10px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    borderBottom: '1px solid var(--border)',
    gap: 8,
  },
  listBody: { maxHeight: 560, overflowY: 'auto' },
  listRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 0.8fr 1fr 1fr 1fr',
    padding: '10px 14px',
    fontSize: 13,
    cursor: 'pointer',
    borderBottom: '1px solid var(--border)',
    gap: 8,
  },
  bookColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 12,
    boxShadow: 'var(--shadow-sm)',
  },
  selectedPair: { fontSize: 14, fontWeight: 700, padding: '0 4px', fontFamily: 'var(--font-display)', letterSpacing: '0.01em' },
};
