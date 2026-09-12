import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { TickerBar } from '../components/TickerBar';
import { PairListSidebar, PairListHandle } from '../components/PairListSidebar';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { OrderForm, PickedPrice } from '../components/OrderForm';
import { TradingViewAdvancedChart as PriceChart } from '../components/TradingViewAdvancedChart';
import { OpenOrdersPanel, OpenOrdersHandle } from '../components/OpenOrdersPanel';
import { OrderHistoryPanel } from '../components/OrderHistoryPanel';
import { AssetsPanel } from '../components/AssetsPanel';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { krakenSocket } from '../lib/krakenSocket';
import { CfdInstrumentList } from '../components/CfdInstrumentList';
import { CfdTickerBar } from '../components/CfdTickerBar';
import { resolveCfdSymbol } from '../lib/cfdPresentation';
import './trade-terminal/CfdTerminal.css';
import { CfdChart } from '../components/CfdChart';
import { CfdOrderForm } from '../components/CfdOrderForm';
import { CfdPositionsPanel } from '../components/CfdPositionsPanel';
import { useCfdTickers } from '../lib/useCfdTickers';
import { rememberTradingMode } from '../lib/tradingMode';
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
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
  // Same reason as marketType below: this page is not remounted when only
  // the query string changes, so the initializer alone would leave the
  // previously selected pair active on a second deep-link into /trade (and
  // on browser back/forward between two ?pair URLs). This only fires when
  // the URL itself changes, so picking a pair in the sidebar — which
  // doesn't touch the URL — is never clobbered by it.
  useEffect(() => {
    const next = searchParams.get('pair');
    if (next && PAIR_PATTERN.test(next)) setPair(next);
  }, [searchParams]);
  const [book, setBook] = useState<{ pair: string; bids: any[]; asks: any[] }>({ pair, bids: [], asks: [] });
  // Effects run after render: never expose the previous instrument's depth
  // during that first new-pair render or initialize grouping from its prices.
  const visibleBook = book.pair === pair ? book : { bids: [], asks: [] };
  const [bottomTab, setBottomTab] = useState<BottomTab>('open');
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  // Reference chrome: the tab badge and the Cancel All action both need the
  // open-order count, which only the panel knows; the panel reports it up.
  const [openOrderCount, setOpenOrderCount] = useState(0);
  const [pickedPrice, setPickedPrice] = useState<PickedPrice | null>(null);
  const openOrdersRef = useRef<OpenOrdersHandle>(null);
  const pairListRef = useRef<PairListHandle>(null);
  const [marketPanelWidth, setMarketPanelWidth] = useState(258);
  const [marketPanelCollapsed, setMarketPanelCollapsed] = useState(false);
  const [orderBookCollapsed, setOrderBookCollapsed] = useState(false);
  const [ordersHeight, setOrdersHeight] = useState(172);
  const bookPairRef = useRef(pair);
  const bookGenerationRef = useRef(0);
  const bookRequestRef = useRef(0);
  const bookWsVersionRef = useRef(0);
  const bookPendingRef = useRef<{ generation: number; request: number } | null>(null);
  bookPairRef.current = pair;
  const marketResizeStart = useRef({ x: 0, width: 258 });
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
  // Landing here is the signal that spot is this user's current trading
  // mode — see lib/tradingMode.
  useEffect(() => rememberTradingMode('spot'), []);
  // ?symbol= alongside ?market=cfd, so a CFD row on the homepage or in the
  // market overview opens the instrument it names rather than always
  // landing on gold. Validated against the instruments the backend
  // actually lists (below) — an unknown symbol falls back rather than
  // selecting an instrument that does not exist.
  const [cfdSymbol, setCfdSymbol] = useState(searchParams.get('symbol')?.toUpperCase() || 'XAUUSD');
  const { tickers: cfdTickers, configured: cfdConfigured, loadError: cfdLoadError, reload: reloadCfd } = useCfdTickers();
  // Same reason as marketType above: this page is not remounted when only
  // the query string changes, so a second CFD deep-link would otherwise
  // leave the previously selected instrument active.
  useEffect(() => {
    const requested = searchParams.get('symbol')?.toUpperCase();
    setCfdSymbol(requested || 'XAUUSD');
  }, [searchParams]);
  const selectedCfdSymbol = resolveCfdSymbol(cfdSymbol, cfdTickers);
  const cfdTicker = cfdTickers.find((t) => t.symbol === selectedCfdSymbol);

  // The visible order book mirrors Kraken's real depth for a live, populated
  // look — actual order matching always happens on our own internal book
  // (see OrderForm), this is display only.
  const refreshBook = useCallback(() => {
    if (bookPairRef.current !== pair) return;
    const generation = bookGenerationRef.current;
    // A slow fallback must finish instead of being invalidated by every 2s
    // poll. A new pair/generation can still start immediately while its old
    // request settles; that old promise may not unlock the newer request.
    if (bookPendingRef.current?.generation === generation) return;
    const request = ++bookRequestRef.current;
    const pending = { generation, request };
    bookPendingRef.current = pending;
    const wsVersion = bookWsVersionRef.current;
    api
      .getExternalOrderBook(pair)
      .then((res) => {
        if (bookPairRef.current === pair && generation === bookGenerationRef.current && request === bookRequestRef.current && wsVersion === bookWsVersionRef.current) {
          setBook({ pair, bids: res.bids, asks: res.asks });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (bookPendingRef.current === pending) bookPendingRef.current = null;
      });
  }, [pair]);

  // Primary source is Kraken's WebSocket for real live updates (see
  // krakenSocket.ts). If it hasn't delivered anything within a few
  // seconds — connection blocked, schema drift, whatever — fall back to
  // the old 2s REST poll instead of leaving the book frozen.
  useEffect(() => {
    const generation = ++bookGenerationRef.current;
    setBook({ pair, bids: [], asks: [] });
    setPickedPrice(null);
    let lastWsData = 0;

    const unsubscribe = krakenSocket.subscribeBook(pair, (snapshot) => {
      if (bookPairRef.current !== pair || generation !== bookGenerationRef.current) return;
      lastWsData = Date.now();
      bookWsVersionRef.current += 1;
      setBook({ pair, bids: snapshot.bids, asks: snapshot.asks });
    });

    refreshBook();
    // Re-enter REST fallback after a later WS interruption as well as on
    // initial connection failure. Never let delayed REST overwrite newer WS.
    const fallbackTimer = window.setInterval(() => {
      if (Date.now() - lastWsData >= WS_FALLBACK_TIMEOUT_MS) refreshBook();
    }, 2000);

    return () => {
      unsubscribe();
      bookGenerationRef.current += 1;
      clearInterval(fallbackTimer);
    };
  }, [pair, refreshBook]);

  function handleOrderPlaced() {
    refreshBook();
    setOrdersRefreshKey((k) => k + 1);
  }

  function handleMarketResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    marketResizeStart.current = { x: event.clientX, width: marketPanelWidth };
    event.currentTarget.setPointerCapture(event.pointerId);

    function move(moveEvent: PointerEvent) {
      const nextWidth = marketResizeStart.current.width + moveEvent.clientX - marketResizeStart.current.x;
      setMarketPanelWidth(Math.min(340, Math.max(240, nextWidth)));
    }

    function stop() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  function resizeOrders(delta: number) {
    setOrdersHeight(height => Math.min(360, Math.max(136, height + delta)));
  }

  function startOrdersResize(event: React.PointerEvent<HTMLDivElement>) {
    const startY = event.clientY;
    const startHeight = ordersHeight;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setOrdersHeight(Math.min(360, Math.max(136, startHeight + startY - e.clientY)));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  // CFD uses the same shell, with three columns and deliberately no order book.
  if (marketType === 'cfd') {
    return (
      <div className="trade-terminal cfd-terminal">
        <Nav active="/trade" onTickerSelect={setPair} staticTicker tickerFitToWidth />
        <ConnectionBanner />
        <div className="terminal">
          <CfdTickerBar symbol={selectedCfdSymbol} ticker={cfdTicker} />
          <main className="cfd-workspace">
            <aside className="cfd-instruments-area" aria-label={t('trade.cfdInstrument')}>
              <CfdInstrumentList symbol={selectedCfdSymbol} onChange={setCfdSymbol}
                tickers={cfdTickers} configured={cfdConfigured} loadError={cfdLoadError} onRetry={reloadCfd} />
            </aside>
            <section className="cfd-chart-area" aria-label={selectedCfdSymbol}>
              <CfdChart symbol={selectedCfdSymbol} />
            </section>
            <section className="cfd-form-area" aria-label={t('trade.market')}>
              <CfdOrderForm symbol={selectedCfdSymbol} ticker={cfdTicker} configured={cfdConfigured} onPlaced={handleOrderPlaced} />
            </section>
          </main>
          <div className="cfd-bottom-panel">
            <CfdPositionsPanel refreshKey={ordersRefreshKey} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="trade-terminal spot-terminal">
      <Nav active="/trade" onTickerSelect={setPair} staticTicker tickerFitToWidth />
      <ConnectionBanner />

      <div className="terminal">
        <TickerBar key={pair} pair={pair} spotPrecision onSelectPair={() => {
          setMarketPanelCollapsed(false);
          requestAnimationFrame(() => pairListRef.current?.focusSearch());
        }} />
        {(marketPanelCollapsed || orderBookCollapsed) && <div className="terminal-panel-restores" aria-label="Панели терминала">
          {marketPanelCollapsed && <button onClick={() => setMarketPanelCollapsed(false)} aria-label="Открыть рынки"><PanelLeftOpen size={16} />Рынки</button>}
          {orderBookCollapsed && <button onClick={() => setOrderBookCollapsed(false)} aria-label="Открыть стакан"><PanelRightOpen size={16} />Стакан</button>}
        </div>}

        {/* Left to right: search/pair list, chart, order book, order-entry
            form — the reference had the form under the chart and the pair
            list on the far right; this is the requested reorder, done via
            grid-column placement in TradeTerminal.css, not by moving
            anything with absolute positioning or transforms. */}
        <div
          className={`main-grid${marketPanelCollapsed ? ' market-panel-collapsed' : ''}${orderBookCollapsed ? ' orderbook-collapsed' : ''}`}
          style={{ '--market-panel-width': `${marketPanelWidth}px` } as React.CSSProperties}
        >
          <div className="left-panel">
            <PairListSidebar
              ref={pairListRef}
              pair={pair}
              onChange={setPair}
              onCollapse={() => setMarketPanelCollapsed(true)}
              onResizeStart={handleMarketResizeStart}
              onResizeBy={(delta) => setMarketPanelWidth(width => Math.min(340, Math.max(240, width + delta)))}
              marketWidth={marketPanelWidth}
            />
          </div>

          <div className="chart-area">
            <PriceChart pair={pair} chrome="terminal" drawingTools market="spot" />
          </div>

          <div className="orderbook-area">
            <OrderBookPanel
              bids={visibleBook.bids}
              asks={visibleBook.asks}
              pair={pair}
              spotPrecision
              onPickPrice={(value) => setPickedPrice((prev) => ({ value, pair, seq: (prev?.seq ?? 0) + 1 }))}
              onCollapse={() => setOrderBookCollapsed(true)}
            />
          </div>

          <div className="order-form-area">
            <OrderForm key={pair} pair={pair} onPlaced={handleOrderPlaced} pickedPrice={pickedPrice} refreshKey={ordersRefreshKey} />
          </div>
        </div>

        <div className="bottom-panel" style={{ '--orders-height': `${ordersHeight}px` } as React.CSSProperties}>
          <div className="orders-resize-handle" role="separator" tabIndex={0} aria-label="Высота панели ордеров" aria-orientation="horizontal" aria-valuemin={136} aria-valuemax={360} aria-valuenow={ordersHeight} onPointerDown={startOrdersResize} onKeyDown={event => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); resizeOrders(event.key === 'ArrowUp' ? 24 : -24); }
          }} />
          <div className="bottom-tabs" role="tablist" aria-label="Ордера и активы">
            {BOTTOM_TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                id={`spot-tab-${tab.id}`}
                aria-selected={bottomTab === tab.id}
                aria-controls="spot-bottom-content"
                className={`bottom-tab ${bottomTab === tab.id ? 'active' : ''}`}
                onClick={() => setBottomTab(tab.id)}
              >
                {t(tab.labelKey)}
                {tab.id === 'open' && <span className="badge">{openOrderCount}</span>}
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

          <div className="bottom-content" id="spot-bottom-content" role="tabpanel" aria-labelledby={`spot-tab-${bottomTab}`}>
            {bottomTab === 'open' && (
              <OpenOrdersPanel ref={openOrdersRef} pair={pair} refreshKey={ordersRefreshKey} onCount={setOpenOrderCount} />
            )}
            {bottomTab === 'orderHistory' && <OrderHistoryPanel pair={pair} refreshKey={ordersRefreshKey} />}
            {bottomTab === 'assets' && <AssetsPanel compact refreshKey={ordersRefreshKey} />}
          </div>
        </div>
      </div>
    </div>
  );
}