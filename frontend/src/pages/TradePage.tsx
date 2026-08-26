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
import { CfdInstrumentList } from '../components/CfdInstrumentList';
import { CfdPricePanel } from '../components/CfdPricePanel';
import { CfdOrderForm } from '../components/CfdOrderForm';
import { CfdPositionsPanel } from '../components/CfdPositionsPanel';
import { useCfdTickers } from '../lib/useCfdTickers';
import type { CfdTickerRow } from '../components/CfdInstrumentList';

type BottomTab = 'open' | 'orderHistory' | 'tradeHistory' | 'assets';
type MarketType = 'spot' | 'cfd';
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
  // Deep-linked from the nav's Trading hover dropdown (?market=cfd) — see
  // Nav.tsx's TradeMenu.
  const [marketType, setMarketType] = useState<MarketType>(searchParams.get('market') === 'cfd' ? 'cfd' : 'spot');
  const [cfdSymbol, setCfdSymbol] = useState('XAUUSD');
  const { tickers: cfdTickers, configured: cfdConfigured, loadError: cfdLoadError, reload: reloadCfd } = useCfdTickers();
  const cfdTicker = cfdTickers.find((t) => t.symbol === cfdSymbol);

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
    <div className="page-mesh trading-page" style={styles.page}>
      <Nav active="/trade" middle={<BotsComingSoon />} />
      <ConnectionBanner />
      <TopGainersTicker onSelect={setPair} />

      <div className="trading-content" style={styles.content}>
        {marketType === 'spot' && (
          <div style={styles.tickerCard}>
            <TickerBar pair={pair} />
          </div>
        )}

        <main className="trading-grid" style={styles.grid}>
          <div className="trading-col trading-col-pairlist" style={styles.pairListColumn}>
            {marketType === 'spot' ? (
              <PairListSidebar pair={pair} onChange={setPair} />
            ) : (
              <CfdInstrumentList
                symbol={cfdSymbol}
                onChange={setCfdSymbol}
                tickers={cfdTickers}
                configured={cfdConfigured}
                loadError={cfdLoadError}
                onRetry={reloadCfd}
              />
            )}
          </div>

          <div className="trading-col trading-col-chart" style={styles.chartColumn}>
            {marketType === 'spot' ? (
              <PriceChart pair={pair} />
            ) : (
              <CfdPricePanel ticker={cfdTicker} loading={cfdTickers.length === 0 && !cfdLoadError && cfdConfigured} />
            )}
          </div>

          <div className="trading-col trading-col-book" style={styles.bookColumn}>
            {marketType === 'spot' ? (
              <>
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
              </>
            ) : (
              <CfdSpreadPanel ticker={cfdTicker} configured={cfdConfigured} />
            )}
          </div>

          <div className="trading-col trading-col-form" style={styles.formColumn}>
            {marketType === 'spot' ? (
              <OrderForm pair={pair} onPlaced={handleOrderPlaced} />
            ) : (
              <CfdOrderForm symbol={cfdSymbol} ticker={cfdTicker} configured={cfdConfigured} onPlaced={handleOrderPlaced} />
            )}
          </div>
        </main>

        <div className="trading-orders-row" style={styles.ordersRow}>
          {marketType === 'cfd' ? (
            <CfdPositionsPanel refreshKey={ordersRefreshKey} />
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Stands in for the order-book column in CFD mode — a real broker-style
// bid/ask spread (0.02% either side of the live mark price), not a fake
// multi-level depth chart claiming liquidity that doesn't exist. Real CFD
// brokers show exactly this, not a public order book, since there isn't
// one for an OTC instrument like gold or an index.
function CfdSpreadPanel({ ticker, configured }: { ticker: CfdTickerRow | undefined; configured: boolean }) {
  const { t } = useLanguage();
  if (!ticker) {
    return (
      <div style={spreadStyles.wrap}>
        <p style={spreadStyles.hint}>{configured ? t('trade.loading') : t('trade.cfdUnavailable')}</p>
      </div>
    );
  }
  const price = parseFloat(ticker.price);
  const spread = price * 0.0002;
  return (
    <div style={spreadStyles.wrap}>
      <div style={spreadStyles.row}>
        <span style={spreadStyles.label}>{t('trade.bid')}</span>
        <span className="mono text-sell" style={spreadStyles.value}>
          {(price - spread).toFixed(2)}
        </span>
      </div>
      <div style={spreadStyles.divider} />
      <div style={spreadStyles.row}>
        <span style={spreadStyles.label}>{t('trade.ask')}</span>
        <span className="mono text-buy" style={spreadStyles.value}>
          {(price + spread).toFixed(2)}
        </span>
      </div>
      <p style={spreadStyles.hint}>{t('trade.cfdBookUnavailable')}</p>
    </div>
  );
}

const spreadStyles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 4, padding: 16 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 4px' },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  value: { fontSize: 16, fontWeight: 800 },
  divider: { height: 1, background: 'var(--border)', margin: '2px 0' },
  hint: { fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 10 },
};

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
  marketTypeTabs: {
    display: 'flex',
    gap: 6,
    flexShrink: 0,
  },
  marketTypeTab: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '7px 18px',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  marketTypeTabActive: {
    color: 'var(--on-accent)',
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
  },
  cfdNotice: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 8,
    padding: '32px 20px',
    margin: 'auto',
  },
  cfdNoticeIcon: { fontSize: 22, color: 'var(--accent)' },
  cfdNoticeTitle: { fontSize: 14, fontWeight: 800, margin: 0 },
  cfdNoticeText: { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
  cfdNoticeHint: { fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6, margin: 0 },
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
