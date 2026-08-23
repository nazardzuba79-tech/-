import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { TickerBar } from '../components/TickerBar';
import { BotsComingSoon } from '../components/BotsComingSoon';
import { PairListSidebar } from '../components/PairListSidebar';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { RecentTradesPanel } from '../components/RecentTradesPanel';
import { OtcPanel } from '../components/OtcPanel';
import { OrderForm } from '../components/OrderForm';
import { DepositModal } from '../components/DepositModal';
import { PriceChart } from '../components/PriceChart';
import { OpenOrdersPanel } from '../components/OpenOrdersPanel';
import { OrderHistoryPanel } from '../components/OrderHistoryPanel';
import { TradeHistoryPanel } from '../components/TradeHistoryPanel';
import { AssetsPanel } from '../components/AssetsPanel';
import { TopGainersTicker } from '../components/TopGainersTicker';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { krakenSocket } from '../lib/krakenSocket';

type BottomTab = 'open' | 'orderHistory' | 'tradeHistory' | 'assets';
const WS_FALLBACK_TIMEOUT_MS = 4000;
const PAIR_PATTERN = /^[A-Z0-9]+\/[A-Z0-9]+$/;

export function TradePage() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  // Lets other pages (e.g. the Wallet page's "Buy" action on a zero-balance
  // asset) deep-link straight into a specific pair via ?pair=SOL/USDT —
  // validated so a malformed value just falls back to the default instead
  // of rendering a broken pair.
  const requestedPair = searchParams.get('pair');
  const [pair, setPair] = useState(requestedPair && PAIR_PATTERN.test(requestedPair) ? requestedPair : 'BTC/USDT');
  const [book, setBook] = useState<{ bids: any[]; asks: any[] }>({ bids: [], asks: [] });
  const [bookTab, setBookTab] = useState<'book' | 'trades' | 'otc'>('book');
  const [bottomTab, setBottomTab] = useState<BottomTab>('open');
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

  // Primary source is Kraken's WebSocket for real live updates (see
  // krakenSocket.ts). If it hasn't delivered anything within a few
  // seconds — connection blocked, schema drift, whatever — fall back to
  // the old 2s REST poll instead of leaving the book frozen.
  useEffect(() => {
    let gotWsData = false;
    let restInterval: number | null = null;

    const unsubscribe = krakenSocket.subscribeBook(pair, (snapshot) => {
      gotWsData = true;
      if (restInterval !== null) {
        clearInterval(restInterval);
        restInterval = null;
      }
      setBook(snapshot);
    });

    refreshBook();
    const fallbackTimer = window.setTimeout(() => {
      if (!gotWsData) restInterval = window.setInterval(refreshBook, 2000);
    }, WS_FALLBACK_TIMEOUT_MS);

    return () => {
      unsubscribe();
      clearTimeout(fallbackTimer);
      if (restInterval !== null) clearInterval(restInterval);
    };
  }, [pair, refreshBook]);

  function handleOrderPlaced() {
    refreshBook();
    setOrdersRefreshKey((k) => k + 1);
  }

  return (
    <div className="page-mesh" style={styles.page}>
      <Nav
        active="/trade"
        middle={<BotsComingSoon />}
        rightExtra={
          <button onClick={() => setShowDeposit(true)} style={styles.depositBtn}>
            {t('nav.deposit')}
          </button>
        }
      />
      <ConnectionBanner />
      <TopGainersTicker />
      <TickerBar pair={pair} />

      <main style={styles.grid}>
        <div style={styles.pairListColumn}>
          <PairListSidebar pair={pair} onChange={setPair} />
        </div>

        <div style={styles.chartColumn}>
          <PriceChart pair={pair} />
        </div>

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
            <button
              onClick={() => setBookTab('otc')}
              style={{ ...styles.bookTab, ...(bookTab === 'otc' ? styles.bookTabActive : {}) }}
            >
              {t('trade.otc')}
            </button>
          </div>
          {bookTab === 'book' && <OrderBookPanel bids={book.bids} asks={book.asks} />}
          {bookTab === 'trades' && <RecentTradesPanel pair={pair} />}
          {bookTab === 'otc' && <OtcPanel />}
        </div>

        <div style={styles.formColumn}>
          <OrderForm pair={pair} onPlaced={handleOrderPlaced} />
        </div>
      </main>

      <div style={styles.ordersRow}>
        <div style={styles.bottomTabs}>
          <button
            onClick={() => setBottomTab('open')}
            style={{ ...styles.bottomTab, ...(bottomTab === 'open' ? styles.bottomTabActive : {}) }}
          >
            {t('trade.tabOpenOrders')}
          </button>
          <button
            onClick={() => setBottomTab('orderHistory')}
            style={{ ...styles.bottomTab, ...(bottomTab === 'orderHistory' ? styles.bottomTabActive : {}) }}
          >
            {t('trade.tabOrderHistory')}
          </button>
          <button
            onClick={() => setBottomTab('tradeHistory')}
            style={{ ...styles.bottomTab, ...(bottomTab === 'tradeHistory' ? styles.bottomTabActive : {}) }}
          >
            {t('trade.tabTradeHistory')}
          </button>
          <button
            onClick={() => setBottomTab('assets')}
            style={{ ...styles.bottomTab, ...(bottomTab === 'assets' ? styles.bottomTabActive : {}) }}
          >
            {t('trade.tabAssets')}
          </button>
        </div>
        {bottomTab === 'open' && <OpenOrdersPanel pair={pair} refreshKey={ordersRefreshKey} />}
        {bottomTab === 'orderHistory' && <OrderHistoryPanel pair={pair} refreshKey={ordersRefreshKey} />}
        {bottomTab === 'tradeHistory' && <TradeHistoryPanel pair={pair} refreshKey={ordersRefreshKey} />}
        {bottomTab === 'assets' && <AssetsPanel refreshKey={ordersRefreshKey} />}
      </div>

      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  depositBtn: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: 'none',
    borderRadius: 18,
    padding: '8px 16px',
    fontWeight: 800,
    fontSize: 12,
    boxShadow: '0 2px 10px rgba(247,166,0,0.3)',
  },
  grid: {
    flex: 1,
    display: 'flex',
    gap: 1,
    background: 'var(--border)',
    padding: 1,
    minHeight: 0,
  },
  pairListColumn: {
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 250px',
    minHeight: 0,
  },
  chartColumn: {
    background: 'var(--bg)',
    display: 'flex',
    flex: '1 1 auto',
    minWidth: 0,
  },
  bookColumn: {
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 300px',
    minHeight: 0,
    overflow: 'hidden',
  },
  bookTabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
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
  formColumn: {
    background: 'var(--bg)',
    flex: '0 0 300px',
    overflowY: 'auto',
  },
  ordersRow: {
    flex: '0 0 260px',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--panel)',
    borderTop: '1px solid var(--border)',
    minHeight: 0,
  },
  bottomTabs: {
    display: 'flex',
    gap: 4,
    padding: '0 14px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  bottomTab: {
    background: 'transparent',
    border: 'none',
    padding: '12px 6px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  bottomTabActive: {
    color: 'var(--text-primary)',
    boxShadow: 'inset 0 -2px 0 var(--accent)',
  },
};
