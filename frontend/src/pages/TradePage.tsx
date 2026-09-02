import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { TickerBar } from '../components/TickerBar';
import { BotsComingSoon } from '../components/BotsComingSoon';
import { PairListSidebar, PairListHandle } from '../components/PairListSidebar';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { OrderForm, PickedPrice } from '../components/OrderForm';
import { PriceChart } from '../components/PriceChart';
import { OpenOrdersPanel, OpenOrdersHandle } from '../components/OpenOrdersPanel';
import { OrderHistoryPanel } from '../components/OrderHistoryPanel';
import { AssetsPanel } from '../components/AssetsPanel';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { krakenSocket } from '../lib/krakenSocket';
import { CfdInstrumentList } from '../components/CfdInstrumentList';
import { CfdChart } from '../components/CfdChart';
import { CfdOrderForm } from '../components/CfdOrderForm';
import { CfdPositionsPanel } from '../components/CfdPositionsPanel';
import { useCfdTickers } from '../lib/useCfdTickers';
import './trade-terminal/TradeTerminal.css';

// 'tradeHistory' ("История сделок") was dropped from this bottom-tab set
// on request — it duplicated the account's own fills, which the Wallet
// page already surfaces (via the same api.getMyTrades backend endpoint,
// untouched here), and cluttered this terminal. Open Orders/Order
// History/Assets are unaffected.
type BottomTab = 'open' | 'orderHistory' | 'assets';
type MarketType = 'spot' | 'cfd';
const WS_FALLBACK_TIMEOUT_MS = 4000;
const PAIR_PATTERN = /^[A-Z0-9]+\/[A-Z0-9]+$/;

const BOTTOM_TABS: { id: BottomTab; labelKey: 'trade.tabOpenOrders' | 'trade.tabOrderHistory' | 'trade.tabAssets' }[] = [
  { id: 'open', labelKey: 'trade.tabOpenOrders' },
  { id: 'orderHistory', labelKey: 'trade.tabOrderHistory' },
  { id: 'assets', labelKey: 'trade.tabAssets' },
];

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
  const [bottomTab, setBottomTab] = useState<BottomTab>('open');
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  // Reference chrome: the tab badge and the Cancel All action both need the
  // open-order count, which only the panel knows; the panel reports it up.
  const [openOrderCount, setOpenOrderCount] = useState(0);
  const [pickedPrice, setPickedPrice] = useState<PickedPrice | null>(null);
  const openOrdersRef = useRef<OpenOrdersHandle>(null);
  const pairListRef = useRef<PairListHandle>(null);
  // Deep-linked from the nav's Trading hover dropdown (?market=cfd) — see
  // Nav.tsx's TradeMenu. TradePage stays mounted across a /trade <-> /trade?market=cfd
  // navigation (same route, React Router doesn't remount it), so the
  // useState initializer alone only ever fires once; without this effect,
  // switching "CFD" -> "Спот" from the nav updates the URL but leaves
  // marketType — and the whole page — stuck on whatever it started as.
  const [marketType, setMarketType] = useState<MarketType>(searchParams.get('market') === 'cfd' ? 'cfd' : 'spot');
  useEffect(() => {
    setMarketType(searchParams.get('market') === 'cfd' ? 'cfd' : 'spot');
  }, [searchParams]);
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

  // Spot renders the ported terminal; CFD keeps the page's previous layout,
  // because the supplied design covers a spot terminal only and its
  // instrument list, chart and position table have no slot in that grid.
  if (marketType === 'cfd') {
    return (
      <div className="page-mesh trading-page" style={styles.page}>
        <Nav active="/trade" middle={<BotsComingSoon />} />
        <ConnectionBanner />

        <div className="trading-content" style={styles.content}>
          <main className="trading-grid" style={styles.grid}>
            <div className="trading-col trading-col-pairlist" style={styles.pairListColumn}>
              <CfdInstrumentList
                symbol={cfdSymbol}
                onChange={setCfdSymbol}
                tickers={cfdTickers}
                configured={cfdConfigured}
                loadError={cfdLoadError}
                onRetry={reloadCfd}
              />
            </div>

            <div className="trading-col trading-col-chart" style={styles.chartColumn}>
              <CfdChart symbol={cfdSymbol} ticker={cfdTicker} />
            </div>

            <div className="trading-col trading-col-form" style={styles.formColumn}>
              <CfdOrderForm symbol={cfdSymbol} ticker={cfdTicker} configured={cfdConfigured} onPlaced={handleOrderPlaced} />
            </div>
          </main>

          <div className="trading-orders-row" style={styles.ordersRow}>
            <CfdPositionsPanel refreshKey={ordersRefreshKey} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="trade-terminal">
      <Nav active="/trade" middle={<BotsComingSoon />} />
      <ConnectionBanner />

      <div className="terminal">
        <TickerBar pair={pair} onSelectPair={() => pairListRef.current?.focusSearch()} />

        {/* Left to right: search/pair list, chart, order book, order-entry
            form — the reference had the form under the chart and the pair
            list on the far right; this is the requested reorder, done via
            grid-column placement in TradeTerminal.css, not by moving
            anything with absolute positioning or transforms. */}
        <div className="main-grid">
          <div className="left-panel">
            <PairListSidebar ref={pairListRef} pair={pair} onChange={setPair} />
          </div>

          <div className="chart-area">
            <PriceChart pair={pair} chrome="terminal" />
          </div>

          <div className="orderbook-area">
            <OrderBookPanel
              bids={book.bids}
              asks={book.asks}
              onPickPrice={(value) => setPickedPrice((prev) => ({ value, seq: (prev?.seq ?? 0) + 1 }))}
            />
          </div>

          <div className="order-form-area">
            <OrderForm pair={pair} onPlaced={handleOrderPlaced} pickedPrice={pickedPrice} />
          </div>
        </div>

        <div className="bottom-panel">
          <div className="bottom-tabs">
            {BOTTOM_TABS.map((tab) => (
              <button
                key={tab.id}
                className={`bottom-tab ${bottomTab === tab.id ? 'active' : ''}`}
                onClick={() => setBottomTab(tab.id)}
              >
                {t(tab.labelKey)}
                {tab.id === 'open' && openOrderCount > 0 && <span className="badge">{openOrderCount}</span>}
              </button>
            ))}

            {bottomTab === 'open' && openOrderCount > 0 && (
              <div className="bottom-actions">
                <button className="bottom-action-btn" onClick={() => openOrdersRef.current?.cancelAll()}>
                  {t('trade.cancelAll')}
                </button>
              </div>
            )}
          </div>

          <div className="bottom-content">
            {bottomTab === 'open' && (
              <OpenOrdersPanel ref={openOrdersRef} pair={pair} refreshKey={ordersRefreshKey} onCount={setOpenOrderCount} />
            )}
            {bottomTab === 'orderHistory' && <OrderHistoryPanel pair={pair} refreshKey={ordersRefreshKey} />}
            {bottomTab === 'assets' && <AssetsPanel refreshKey={ordersRefreshKey} />}
          </div>
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
};
