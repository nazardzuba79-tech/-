import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { TickerBar } from '../components/TickerBar';
import { PairSelector } from '../components/PairSelector';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { RecentTradesPanel } from '../components/RecentTradesPanel';
import { OrderForm } from '../components/OrderForm';
import { DepositModal } from '../components/DepositModal';
import { TradingViewChart } from '../components/TradingViewChart';
import { OpenOrdersPanel } from '../components/OpenOrdersPanel';

export function TradePage() {
  const { t, lang } = useLanguage();
  const [pair, setPair] = useState('BTC/USDT');
  const [book, setBook] = useState<{ bids: any[]; asks: any[] }>({ bids: [], asks: [] });
  const [bookTab, setBookTab] = useState<'book' | 'trades'>('book');
  const [showDeposit, setShowDeposit] = useState(false);
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);

  // The visible order book mirrors Kraken's real depth for a live, populated
  // look — actual order matching always happens on our own internal book
  // (see OrderForm), this is display only.
  const refreshBook = useCallback(() => {
    api
      .getExternalOrderBook(pair)
      .then((res) => setBook({ bids: res.bids, asks: res.asks }))
      .catch(() => {});
  }, [pair]);

  useEffect(() => {
    refreshBook();
    const interval = setInterval(refreshBook, 2000);
    return () => clearInterval(interval);
  }, [refreshBook]);

  function handleOrderPlaced() {
    refreshBook();
    setOrdersRefreshKey((k) => k + 1);
  }

  return (
    <div style={styles.page}>
      <Nav
        active="/trade"
        middle={<PairSelector pair={pair} onChange={setPair} />}
        rightExtra={
          <button onClick={() => setShowDeposit(true)} style={styles.depositBtn}>
            {t('nav.deposit')}
          </button>
        }
      />
      <TickerBar pair={pair} />

      <main style={styles.grid}>
        <div style={styles.bookColumn}>
          <div style={styles.bookTabs}>
            <button
              onClick={() => setBookTab('book')}
              style={{ ...styles.bookTab, ...(bookTab === 'book' ? styles.bookTabActive : {}) }}
            >
              {t('trade.orderBook')}
            </button>
            <button
              onClick={() => setBookTab('trades')}
              style={{ ...styles.bookTab, ...(bookTab === 'trades' ? styles.bookTabActive : {}) }}
            >
              {t('trade.trades')}
            </button>
          </div>
          {bookTab === 'book' ? (
            <OrderBookPanel bids={book.bids} asks={book.asks} />
          ) : (
            <RecentTradesPanel pair={pair} />
          )}
        </div>

        <div style={styles.chartColumn}>
          <TradingViewChart pair={pair} locale={lang} />
        </div>

        <div style={styles.formColumn}>
          <OrderForm pair={pair} onPlaced={handleOrderPlaced} />
        </div>
      </main>

      <div style={styles.ordersRow}>
        <OpenOrdersPanel pair={pair} refreshKey={ordersRefreshKey} />
      </div>

      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
  },
  depositBtn: {
    background: 'var(--accent)',
    color: '#0b0e11',
    border: 'none',
    borderRadius: 4,
    padding: '8px 16px',
    fontWeight: 700,
    fontSize: 12,
  },
  grid: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '300px 1fr 300px',
    gap: 1,
    background: 'var(--border)',
    padding: 1,
    minHeight: 0,
  },
  bookColumn: {
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
  },
  bookTabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border)',
  },
  bookTab: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    padding: '10px 0',
    fontSize: 12,
    color: 'var(--text-secondary)',
  },
  bookTabActive: {
    color: 'var(--text-primary)',
    boxShadow: 'inset 0 -2px 0 var(--accent)',
  },
  chartColumn: {
    background: 'var(--bg)',
    display: 'flex',
  },
  formColumn: {
    background: 'var(--bg)',
  },
  ordersRow: {
    padding: '1px 1px 16px',
    background: 'var(--bg)',
  },
};
