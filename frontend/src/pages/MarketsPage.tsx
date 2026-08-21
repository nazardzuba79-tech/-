import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { BalanceStrip } from '../components/BalanceStrip';
import { OrderBookPanel } from '../components/OrderBookPanel';

interface Ticker {
  pair: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  changePercent24h: string;
}

/**
 * Read-only mirror of Bybit spot market data: every tradable pair, its live
 * price, and (for the pair you select) live order book depth. Purely
 * informational — nothing here touches our own matching engine or Bybit
 * itself, see BybitMarketDataService for the source.
 */
export function MarketsPage() {
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
          setSelectedPair((current) => current ?? res.tickers[0]?.pair ?? null);
        })
        .catch(() => setError('Не вдалось завантажити дані з Bybit'));
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
    () => tickers.filter((t) => t.pair.toLowerCase().includes(search.toLowerCase())),
    [tickers, search]
  );

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <div style={styles.logo}>
          EXCHANGE<span style={{ color: 'var(--accent)' }}>.</span>
        </div>
        <Link to="/trade" style={styles.navLink}>
          Торгівля
        </Link>
        <Link to="/markets" style={{ ...styles.navLink, color: 'var(--text-primary)' }}>
          Ринки
        </Link>
        <Link to="/products" style={styles.navLink}>
          Товари
        </Link>
        <div style={{ marginLeft: 'auto' }}>
          <BalanceStrip />
        </div>
      </nav>

      <main style={styles.main}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>Ринки (дзеркало Bybit)</h1>
          <input
            placeholder="Пошук пари, напр. BTC"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.search}
          />
        </div>

        {error && <div style={styles.banner}>{error}</div>}

        <div style={styles.grid}>
          <div style={styles.listPanel}>
            <div style={styles.listHeader}>
              <span>Пара</span>
              <span style={{ textAlign: 'right' }}>Ціна</span>
              <span style={{ textAlign: 'right' }}>24г %</span>
            </div>
            <div style={styles.listBody}>
              {filtered.map((t) => {
                const change = parseFloat(t.changePercent24h) * 100;
                const positive = change >= 0;
                return (
                  <div
                    key={t.pair}
                    onClick={() => setSelectedPair(t.pair)}
                    style={{
                      ...styles.listRow,
                      background: t.pair === selectedPair ? 'var(--panel-alt)' : 'transparent',
                    }}
                  >
                    <span>{t.pair}</span>
                    <span className="mono" style={{ textAlign: 'right' }}>
                      {parseFloat(t.lastPrice)}
                    </span>
                    <span
                      className={positive ? 'text-buy' : 'text-sell'}
                      style={{ textAlign: 'right' }}
                    >
                      {positive ? '+' : ''}
                      {change.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
              {filtered.length === 0 && tickers.length > 0 && (
                <p style={{ padding: 14, color: 'var(--text-tertiary)' }}>Нічого не знайдено.</p>
              )}
              {tickers.length === 0 && !error && (
                <p style={{ padding: 14, color: 'var(--text-tertiary)' }}>Завантаження...</p>
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
              <p style={{ color: 'var(--text-tertiary)' }}>Обери пару зі списку</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)' },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    padding: '0 20px',
    height: 56,
    borderBottom: '1px solid var(--border)',
    background: 'var(--panel)',
  },
  logo: { fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, letterSpacing: '0.05em' },
  navLink: { fontSize: 13, color: 'var(--text-secondary)' },
  main: { padding: 32, maxWidth: 1100, margin: '0 auto' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16 },
  title: { fontSize: 20, margin: 0 },
  search: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '8px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    width: 220,
  },
  banner: {
    padding: '10px 14px',
    borderRadius: 4,
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
    gridTemplateColumns: '1fr 1fr 1fr',
    padding: '10px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    borderBottom: '1px solid var(--border)',
  },
  listBody: { maxHeight: 560, overflowY: 'auto' },
  listRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    padding: '10px 14px',
    fontSize: 13,
    cursor: 'pointer',
    borderBottom: '1px solid var(--border)',
  },
  bookColumn: { display: 'flex', flexDirection: 'column', gap: 8 },
  selectedPair: { fontSize: 14, fontWeight: 700, padding: '0 4px' },
};
