import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { Nav } from '../components/Nav';
import { TickerBar } from '../components/TickerBar';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { OrderForm } from '../components/OrderForm';
import { DepositModal } from '../components/DepositModal';
import { PriceChart } from '../components/PriceChart';
import { OpenOrdersPanel } from '../components/OpenOrdersPanel';

const PAIR = 'BTC/USDT';

export function TradePage() {
  const [book, setBook] = useState<{ bids: any[]; asks: any[] }>({ bids: [], asks: [] });
  const [showDeposit, setShowDeposit] = useState(false);
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);

  const refreshBook = useCallback(() => {
    api
      .getOrderBook(PAIR)
      .then((res) => setBook({ bids: res.bids, asks: res.asks }))
      .catch(() => {});
  }, []);

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
        rightExtra={
          <button onClick={() => setShowDeposit(true)} style={styles.depositBtn}>
            Поповнити
          </button>
        }
      />
      <TickerBar pair={PAIR} />

      <main style={styles.grid}>
        <div style={styles.bookColumn}>
          <OrderBookPanel bids={book.bids} asks={book.asks} />
        </div>

        <div style={styles.chartColumn}>
          <PriceChart pair={PAIR} />
        </div>

        <div style={styles.formColumn}>
          <OrderForm pair={PAIR} onPlaced={handleOrderPlaced} />
        </div>
      </main>

      <div style={styles.ordersRow}>
        <OpenOrdersPanel pair={PAIR} refreshKey={ordersRefreshKey} />
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
    overflow: 'auto',
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
