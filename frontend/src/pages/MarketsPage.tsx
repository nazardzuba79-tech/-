import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, localeOf } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { SearchInput } from '../components/SearchInput';
import { CryptoIcon } from '../components/CryptoIcon';
import { Footer } from '../components/Footer';

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
        // Most-traded first — the raw API order is roughly alphabetical,
        // which otherwise puts thin, barely-liquid pairs at the top.
        .sort((a, b) => parseFloat(b.quoteVolume24h || '0') - parseFloat(a.quoteVolume24h || '0')),
    [tickers, search]
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

        <div style={styles.grid}>
          <div style={styles.listPanel}>
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
                const change = parseFloat(tk.changePercent24h) * 100;
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
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CryptoIcon symbol={tk.pair.split('/')[0]} size={20} />
                      {tk.pair}
                    </span>
                    <span className="mono" style={{ textAlign: 'right' }}>
                      {parseFloat(tk.lastPrice)}
                    </span>
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
              {tickers.length === 0 && !error && (
                <p style={{ padding: 14, color: 'var(--text-tertiary)' }}>{t('markets.loading')}</p>
              )}
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
  bookColumn: { display: 'flex', flexDirection: 'column', gap: 8 },
  selectedPair: { fontSize: 14, fontWeight: 700, padding: '0 4px' },
};
