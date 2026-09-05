import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
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
import { rememberTradingMode } from '../lib/tradingMode';
import { ChevronDown, ChevronUp, PanelRightClose, PanelRightOpen, X, CandlestickChart, Layers3, ArrowRightLeft, ListOrdered } from 'lucide-react';
import { MarketSpine } from './trade-terminal/MarketSpine';
import { FlowContext, FlowDepth, FlowTape } from './trade-terminal/FlowContext';
import { workspacePreset, type TerminalWorkspace } from '../lib/terminalMarket';
import { formatTerminalQuote, type TerminalOrderDraft } from '../lib/terminalExecution';
import './trade-terminal/TradeTerminal.css';
import './trade-terminal/TerminalPremium.css';

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
  const [book, setBook] = useState<{ bids: any[]; asks: any[] }>({ bids: [], asks: [] });
  const [bottomTab, setBottomTab] = useState<BottomTab>('open');
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  // Reference chrome: the tab badge and the Cancel All action both need the
  // open-order count, which only the panel knows; the panel reports it up.
  const [openOrderCount, setOpenOrderCount] = useState(0);
  const [pickedPrice, setPickedPrice] = useState<PickedPrice | null>(null);
  const openOrdersRef = useRef<OpenOrdersHandle>(null);
  const pairListRef = useRef<PairListHandle>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [workspace, setWorkspace] = useState<TerminalWorkspace>('standard');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railTab, setRailTab] = useState<'order' | 'book' | 'depth' | 'tape'>('order');
  const [dockOpen, setDockOpen] = useState(true);
  const [draft, setDraft] = useState<TerminalOrderDraft | null>(null);
  const [guidePrice, setGuidePrice] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const selectorReturnFocus = useRef<HTMLElement | null>(null);
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
    if (!requested || cfdTickers.length === 0) return;
    if (cfdTickers.some((tk) => tk.symbol === requested)) setCfdSymbol(requested);
  }, [searchParams, cfdTickers]);
  const cfdTicker = cfdTickers.find((t) => t.symbol === cfdSymbol);

  // The visible order book mirrors Kraken's real depth for a live, populated
  // look — actual order matching always happens on our own internal book
  // (see OrderForm), this is display only.
  const activePair = useRef(pair);
  const bookVersion = useRef(0);
  activePair.current = pair;
  const refreshBook = useCallback(() => {
    const version = bookVersion.current;
    api
      .getExternalOrderBook(pair)
      .then((res) => { if (activePair.current === pair && bookVersion.current === version) setBook({ bids: res.bids, asks: res.asks }); })
      .catch(() => {});
  }, [pair]);

  // Primary source is Kraken's WebSocket for real live updates (see
  // krakenSocket.ts). If it hasn't delivered anything within a few
  // seconds — connection blocked, schema drift, whatever — fall back to
  // the old 2s REST poll instead of leaving the book frozen.
  useEffect(() => {
    let lastWsAt = 0;
    bookVersion.current += 1;
    setBook({ bids: [], asks: [] });
    setPickedPrice(null);
    setDraft(null);
    setGuidePrice(null);

    const unsubscribe = krakenSocket.subscribeBook(pair, (snapshot) => {
      lastWsAt = Date.now();
      if (activePair.current === pair) { bookVersion.current += 1; setBook(snapshot); }
    });

    refreshBook();
    // Keep the watchdog after the first snapshot, so a later socket failure
    // also resumes REST. A delayed REST response cannot overwrite newer WS data.
    const fallbackTimer = window.setInterval(() => {
      if (krakenSocket.getStatus() !== 'connected' || Date.now() - lastWsAt > WS_FALLBACK_TIMEOUT_MS) refreshBook();
    }, 2000);

    return () => {
      unsubscribe();
      bookVersion.current += 1;
      clearInterval(fallbackTimer);
    };
  }, [pair, refreshBook]);

  function handleOrderPlaced() {
    refreshBook();
    setOrdersRefreshKey((k) => k + 1);
  }

  const pickPrice = useCallback((value: string) => {
    setPickedPrice(prev => ({ value, seq: (prev?.seq ?? 0) + 1 }));
    setRailTab('order'); setRailCollapsed(false); setGuidePrice(null);
  }, []);

  const openMarkets = useCallback(() => {
    selectorReturnFocus.current = document.activeElement as HTMLElement | null;
    setSelectorOpen(true);
  }, []);
  const closeMarkets = useCallback(() => {
    setSelectorOpen(false);
    selectorReturnFocus.current?.focus();
  }, []);

  function applyWorkspace(next: TerminalWorkspace) {
    const preset = workspacePreset(next);
    setWorkspace(next); setRailCollapsed(preset.railCollapsed);
    setDockOpen(preset.dockOpen); setRailTab(preset.railTab); setGuidePrice(null);
  }

  useEffect(() => {
    if (selectorOpen) pairListRef.current?.focusSearch();
  }, [selectorOpen]);
  useEffect(() => {
    if (marketType !== 'spot') return;
    function onKey(event: KeyboardEvent) {
      const editing = (event.target as HTMLElement | null)?.closest('input,textarea,select,[contenteditable="true"]');
      if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !editing)) {
        event.preventDefault();
        if (selectorOpen) closeMarkets(); else openMarkets();
      }
      if (event.key === 'Escape' && selectorOpen) { event.preventDefault(); closeMarkets(); }
      if (event.key === 'Tab' && selectorOpen) {
        const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, a[href], [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [marketType, selectorOpen, openMarkets, closeMarkets]);

  // Spot renders the ported terminal; CFD keeps the page's previous layout,
  // because the supplied design covers a spot terminal only and its
  // instrument list, chart and position table have no slot in that grid.
  if (marketType === 'cfd') {
    return (
      <div className="page-mesh trading-page" style={styles.page}>
        <Nav active="/trade" onTickerSelect={setPair} staticTicker tickerFitToWidth />
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
    <div className="trade-terminal terminal-premium" data-workspace={workspace}>
      <Nav active="/trade" onTickerSelect={setPair} staticTicker tickerFitToWidth />
      <ConnectionBanner />

      <div className="terminal">
        <MarketSpine pair={pair} book={book} onOpenMarkets={openMarkets} workspace={workspace} onWorkspaceChange={applyWorkspace} />
        <div className={`signature-workspace${railCollapsed ? ' rail-collapsed' : ''}`}>
          <main className="chart-main">
            <div className="chart-area">
              <PriceChart pair={pair} chrome="terminal" appearance="premium" draft={draft?.pair === pair ? draft : null} guidePrice={guidePrice} />
            </div>
            <section className={`trading-dock bottom-panel${!dockOpen ? ' dock-collapsed' : ''}`} aria-label="Ордера и активы">
          <div className="dock-tabs bottom-tabs" role="tablist" aria-label="Ордера и активы">
            {BOTTOM_TABS.map((tab) => (
              <button
                key={tab.id}
                className={`bottom-tab ${bottomTab === tab.id ? 'active' : ''}`}
                role="tab" aria-selected={bottomTab === tab.id} aria-controls="terminal-dock-content"
                onClick={() => { setBottomTab(tab.id); setDockOpen(true); }}
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
            <button className="dock-toggle" aria-label={dockOpen ? 'Свернуть ордера' : 'Развернуть ордера'} aria-expanded={dockOpen} onClick={() => setDockOpen(v => !v)}>{dockOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
          </div>

          <div id="terminal-dock-content" className="dock-body bottom-content" hidden={!dockOpen}>
            {bottomTab === 'open' && (
              <OpenOrdersPanel ref={openOrdersRef} pair={pair} refreshKey={ordersRefreshKey} onCount={setOpenOrderCount} />
            )}
            {bottomTab === 'orderHistory' && <OrderHistoryPanel pair={pair} refreshKey={ordersRefreshKey} />}
            {bottomTab === 'assets' && <AssetsPanel refreshKey={ordersRefreshKey} />}
          </div>
            </section>
          </main>
          <aside className="flow-rail" aria-label="Flow Rail">
            <div className="flow-tabs" role="tablist" aria-label="Исполнение и поток">
              {([{ id: 'order', text: 'Ордер', icon: ListOrdered }, { id: 'book', text: 'Стакан', icon: Layers3 }, { id: 'depth', text: 'Глубина', icon: CandlestickChart }, { id: 'tape', text: 'Лента', icon: ArrowRightLeft }] as const).map(tab => <button key={tab.id} role="tab" aria-label={tab.text} aria-selected={railTab === tab.id} title={tab.text} onClick={() => { setRailTab(tab.id); setRailCollapsed(false); setGuidePrice(null); }} className={railTab === tab.id ? 'active' : ''}><tab.icon size={15}/><span>{tab.text}</span></button>)}
              <button className="rail-collapse" aria-label={railCollapsed ? 'Развернуть Flow Rail' : 'Свернуть Flow Rail'} aria-expanded={!railCollapsed} onClick={() => { setRailCollapsed(v => !v); setGuidePrice(null); }}>{railCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}</button>
            </div>
            <div className="flow-pane" hidden={railCollapsed || railTab !== 'order'}>
              <div className="order-form-area"><OrderForm compact key={pair} pair={pair} onPlaced={handleOrderPlaced} pickedPrice={pickedPrice} onDraftChange={setDraft} /></div>
              <FlowContext book={book} pair={pair} onPick={pickPrice} />
            </div>
            <div className="flow-pane orderbook-area" hidden={railCollapsed || railTab !== 'book'}>
              <OrderBookPanel bids={book.bids} asks={book.asks} pair={pair} onPickPrice={pickPrice} onHoverPrice={setGuidePrice} />
              <p className="flow-source">Kraken · наведение проецирует цену на график</p>
            </div>
            <div className="flow-pane" hidden={railCollapsed || railTab !== 'depth'}><FlowDepth book={book} pair={pair}/></div>
            <div className="flow-pane" hidden={railCollapsed || railTab !== 'tape'}>{railTab === 'tape' && !railCollapsed && <FlowTape pair={pair} onPick={pickPrice} onHover={setGuidePrice}/>}</div>
          </aside>
        </div>
      </div>
      {selectorOpen && <div className="market-dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeMarkets(); }}>
        <div className="market-dialog" role="dialog" aria-modal="true" aria-label="Рынки и команды" ref={dialogRef}>
          <div className="market-dialog-header"><strong>Рынки и команды</strong><button onClick={closeMarkets} aria-label="Закрыть рынки"><X size={18}/></button></div>
          <div className="market-commands" aria-label="Команды рабочего пространства">
            {(['standard', 'chart', 'flow'] as const).map(mode => <button key={mode} onClick={() => { applyWorkspace(mode); closeMarkets(); }}>{mode === 'standard' ? 'Standard' : mode === 'chart' ? 'Chart focus' : 'Flow'}</button>)}
            <button onClick={() => { setDockOpen(v => !v); closeMarkets(); }}>Ордера ↕</button>
          </div>
          <PairListSidebar priceFormatter={formatTerminalQuote} ref={pairListRef} pair={pair} onChange={next => { setPair(next); closeMarkets(); }} />
          <div className="market-dialog-hint"><kbd>Esc</kbd> Закрыть <span><kbd>Ctrl / ⌘ K</kbd> Команды</span></div>
        </div>
      </div>}
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
