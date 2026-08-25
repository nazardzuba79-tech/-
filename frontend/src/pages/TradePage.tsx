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
import { OrderForm } from '../components/OrderForm';
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
  const [bookTab, setBookTab] = useState<'book' | 'trades'>('book');
  const [bottomTab, setBottomTab] = useState<BottomTab>('open');
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
      <Nav active="/trade" middle={<BotsComingSoon />} />
      <ConnectionBanner />
      <TopGainersTicker onSelect={setPair} />

      <div style={styles.content}>
        <div style={styles.tickerCard}>
          <TickerBar pair={pair} />
        </div>

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
            </div>
            {bookTab === 'book' && <OrderBookPanel bids={book.bids} asks={book.asks} />}
            {bookTab === 'trades' && <RecentTradesPanel pair={pair} />}
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
      </div>
    </div>
  );
}

// v0-designed palette (see the "VOLTEX" v0 export the owner supplied),
// scoped to just this page the same way FuturesPage/MarketsPage re-theme
// themselves — every existing var(--panel)/var(--border)/var(--text-*)
// rule below (and in the shared Nav rendered above) picks this up
// automatically. Cyan accent replaces the site's default amber.
const TRADE_V0_VARS = {
  ['--bg' as any]: '#080b12',
  ['--panel' as any]: '#121925',
  ['--panel-alt' as any]: '#0e131d',
  ['--panel-alt-hover' as any]: '#172131',
  ['--border' as any]: '#1c2735',
  ['--text-primary' as any]: '#f5f7fa',
  ['--text-secondary' as any]: '#8b96a8',
  ['--text-tertiary' as any]: '#6b7789',
  ['--buy' as any]: '#19d98b',
  ['--buy-dim' as any]: 'rgba(25,217,139,0.14)',
  ['--sell' as any]: '#ff4d67',
  ['--sell-dim' as any]: 'rgba(255,77,103,0.14)',
  ['--accent' as any]: '#18c8ff',
  ['--accent-hover' as any]: '#3fd4ff',
  ['--accent-dim' as any]: 'rgba(24,200,255,0.14)',
  ['--on-accent' as any]: '#04121b',
} as React.CSSProperties;

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    ...TRADE_V0_VARS,
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '12px 16px 16px',
    minHeight: 0,
    overflow: 'hidden',
  },
  tickerCard: {
    flexShrink: 0,
    borderRadius: 12,
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  grid: {
    flex: 1,
    display: 'flex',
    gap: 12,
    minHeight: 0,
  },
  pairListColumn: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 250px',
    minHeight: 0,
    overflow: 'hidden',
  },
  chartColumn: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    display: 'flex',
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
  },
  bookColumn: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
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
    flex: '0 0 300px',
    overflowY: 'auto',
  },
  ordersRow: {
    flex: '0 0 260px',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    minHeight: 0,
    overflow: 'hidden',
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
