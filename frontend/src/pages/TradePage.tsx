import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, clearToken } from '../lib/api';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { OrderForm } from '../components/OrderForm';
import { DepositModal } from '../components/DepositModal';
import { PriceChart } from '../components/PriceChart';
import { BalanceStrip } from '../components/BalanceStrip';

const PAIR = 'BTC/USDT';

export function TradePage() {
  const [book, setBook] = useState<{ bids: any[]; asks: any[] }>({ bids: [], asks: [] });
  const [showDeposit, setShowDeposit] = useState(false);
  const navigate = useNavigate();

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

  function handleLogout() {
    clearToken();
    navigate('/');
  }

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <div style={styles.logo}>
          EXCHANGE<span style={{ color: 'var(--accent)' }}>.</span>
        </div>
        <div style={styles.pair}>
          <span className="mono" style={{ fontWeight: 700 }}>
            {PAIR}
          </span>
        </div>
        <Link to="/markets" style={styles.navLink}>
          Ринки
        </Link>
        <Link to="/products" style={styles.navLink}>
          Товари
        </Link>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 20 }}>
          <BalanceStrip />
          <button onClick={() => setShowDeposit(true)} style={styles.depositBtn}>
            Поповнити
          </button>
          <button onClick={handleLogout} style={styles.logoutBtn}>
            Вийти
          </button>
        </div>
      </nav>

      <main style={styles.grid}>
        <div style={styles.bookColumn}>
          <OrderBookPanel bids={book.bids} asks={book.asks} />
        </div>

        <div style={styles.chartColumn}>
          <PriceChart pair={PAIR} />
        </div>

        <div style={styles.formColumn}>
          <OrderForm pair={PAIR} onPlaced={refreshBook} />
        </div>
      </main>

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
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    padding: '0 20px',
    height: 56,
    borderBottom: '1px solid var(--border)',
    background: 'var(--panel)',
  },
  logo: {
    fontFamily: 'var(--font-mono)',
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: '0.05em',
  },
  pair: {
    fontSize: 14,
  },
  navLink: {
    fontSize: 13,
    color: 'var(--text-secondary)',
  },
  navRight: {
    marginLeft: 'auto',
    display: 'flex',
    gap: 10,
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
  logoutBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    borderRadius: 4,
    padding: '8px 16px',
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
  chartPlaceholder: {
    flex: 1,
    margin: 0,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    textAlign: 'center',
  },
  formColumn: {
    background: 'var(--bg)',
  },
};
