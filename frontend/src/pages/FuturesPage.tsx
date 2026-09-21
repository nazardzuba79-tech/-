import { useNativeDemo } from './private-trading/useNativeDemo';
import { NativeDemoDialogs } from './private-trading/NativeDemoControls';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, API_BASE } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { PrivateTradingEntry } from '../components/PrivateTradingEntry';
import { FuturesTickerBar } from '../components/FuturesTickerBar';
import { FuturesCalculator, type CalculatorDraft } from '../components/FuturesCalculator';
import { FuturesTerminalStatus } from '../components/FuturesTerminalStatus';
import { ArchiveAccountActivity } from '../components/ArchiveTerminalDetails';
import { Calculator } from 'lucide-react';
import { ArchiveTopAssets } from '../components/ArchiveTopAssets';
import { FuturesPairList, FuturesPairListHandle } from '../components/FuturesPairList';
import { TerminalChart as PriceChart } from '../components/TerminalChart';
import type { ChartPositionLine } from '../lib/chartTrading';
import { FuturesReferenceBook } from '../components/FuturesReferenceBook';
import { FuturesOrderForm } from '../components/FuturesOrderForm';
import { FuturesPositionsPanel } from '../components/FuturesPositionsPanel';
import { FuturesOrdersPanel } from '../components/FuturesOrdersPanel';
import { useFuturesAccount } from '../lib/useFuturesAccount';
import { FuturesExecutionProvider, REAL_FUTURES_EXECUTION } from '../lib/futuresExecution';
import { FuturesAccountSourceContext } from '../lib/futuresAccountSource';
import { useNativeFuturesExecution } from '../lib/useNativeFuturesExecution';
import type { FuturesCloseTicket } from '../lib/nativeReduceTarget';
import { nativeDemoApi } from '../lib/nativeDemoApi';
import { pairToNativeSymbol } from '../lib/nativeFuturesAdapter';
import type { FuturesContractRules } from '../lib/futuresMath';
import { ChartTradingMenu, type ChartMenuAnchor } from '../components/ChartTradingMenu';
import { FuturesTransferModal } from '../components/FuturesTransferModal';
import { AssetsPanel } from '../components/AssetsPanel';
import { AccountPanelToggle } from '../components/AccountPanelToggle';
import { useCompactAccountPanel } from '../lib/useCompactAccountPanel';
import { isVerifiedEmptyAccountResource } from '../lib/terminalAccountPanel';
import { subscribeFuturesDepth, setFuturesDepthFallbackBase, type FuturesTrade, type FuturesDepthStatus } from '../lib/futuresDepth';

import { useFuturesReference } from '../lib/useFuturesReference';
import { rememberTradingMode } from '../lib/tradingMode';
import { useFuturesConfig } from '../lib/futuresConfigStore';
import { discoverFuturesSymbols, type FuturesUniverse } from '../lib/futuresDiscovery';
import { readFuturesSymbolCache, writeFuturesSymbolCache } from '../lib/terminalWarmCache';
import './trade-terminal/TradeTerminal.css';
import './trade-terminal/FuturesTerminal.css';
import './trade-terminal/ProfessionalTerminal.css';
import './trade-terminal/ApprovedFuturesTerminal.css';
import './trade-terminal/ReferenceFuturesTerminal.css';
import './trade-terminal/TerminalPresentationPolish.css';
import './trade-terminal/FuturesStudio.css';
import './trade-terminal/FuturesDesignVariants.css';
import './trade-terminal/TerminalStudio.css';
import './trade-terminal/TerminalAccountPanel.css';
import './trade-terminal/TerminalPremium.css';
import './trade-terminal/ArchiveTerminalPreview.css';
import './trade-terminal/FuturesMobile.css';

// Hard fallback only for a browser that has never loaded Futures before.
// Returning visitors paint the last real discovered universe immediately
// from localStorage and then reconcile it with the same network calls that
// already existed — no extra request is introduced.
const CORE_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

// Orders and their history share /futures/orders/me with different filters.
type BottomTab = 'orders' | 'positions' | 'orderHistory' | 'positionHistory' | 'assets';
const BOTTOM_TABS: { id: BottomTab; labelKey: 'trade.tabOpenOrders' | 'trade.tabOrderHistory' | 'futures.positions' | 'futures.positionHistory' | 'trade.tabAssets' }[] = [
  { id: 'orders', labelKey: 'trade.tabOpenOrders' },
  { id: 'positions', labelKey: 'futures.positions' },
  { id: 'orderHistory', labelKey: 'trade.tabOrderHistory' },
  { id: 'positionHistory', labelKey: 'futures.positionHistory' },
  { id: 'assets', labelKey: 'trade.tabAssets' },
];

/**
 * The futures terminal. Same shell as the spot terminal — `.trade-terminal`
 * and its grid, surfaces, typography and densities — with futures business
 * logic inside it: mark/index price, funding, leverage, margin mode,
 * positions. Switching Торговля <-> Фьючерсы should feel like changing
 * instrument, not application, which is why this page no longer carries the
 * separate cyan/purple palette and rounded cards it used to.
 *
 * Public reference depth follows the selected linear perpetual. Our own
 * matching engine remains the authority for order execution.
 */
export function FuturesPage() {
  const { t } = useLanguage();
  const reference = useFuturesReference();
  const [initialParams] = useSearchParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedDesign = searchParams.get('terminalDesign');
  const archivePreview = requestedDesign === null || requestedDesign === 'archive';
  const [onlyCurrentPair, setOnlyCurrentPair] = useState(false);
  const design = ['studio', 'graphite', 'focus'].includes(requestedDesign ?? '') ? requestedDesign : 'studio';
  const studio = design !== null;
  // Discover all real USDT perpetuals; execution remains restricted by config.
  // A warm symbol list is display-only and cannot grant execution permission.
  const [symbols, setSymbols] = useState<string[]>(() => readFuturesSymbolCache() ?? CORE_SYMBOLS);
  const [universe, setUniverse] = useState<FuturesUniverse | null>(null);
  const [symbol, setSymbol] = useState(() => searchParams.get('pair') || 'BTC/USDT');
  const native = useNativeDemo(symbol,setSymbol);
  /**
   * The selected contract's quantity rules, from the engine that will
   * enforce them. Loaded once per symbol — they are static instrument
   * metadata, not a quote — and left null for a contract that has not
   * answered, which makes the order form fall back to nothing rather than
   * to a guessed step.
   */
  const [nativeContract, setNativeContract] = useState<FuturesContractRules | null>(null);
  useEffect(() => {
    if (!native.allowed) { setNativeContract(null); return; }
    let cancelled = false;
    const controller = new AbortController();
    setNativeContract(null);
    nativeDemoApi.contract(pairToNativeSymbol(symbol), controller.signal)
      .then(rules => { if (!cancelled) setNativeContract(rules); })
      .catch(() => { if (!cancelled) setNativeContract(null); });
    return () => { cancelled = true; controller.abort(); };
  }, [symbol, native.allowed]);
  /**
   * THE TERMINAL DOES NOT CHANGE — ITS ENGINE DOES.
   *
   * There is one order form, one positions table, one orders table and one
   * assets table on this page, and they are the same components for every
   * account. For the owner whose access verdict pins them to the
   * simulation engine, `useNativeFuturesExecution` supplies the account
   * state those components read and the commands their buttons send; for
   * everybody else it is null and the real execution is used, which is the
   * `api` call each component used to make inline. See lib/futuresExecution.
   */
  const nativeExecution = useNativeFuturesExecution(native, nativeContract);
  const execution = nativeExecution ?? REAL_FUTURES_EXECUTION;
  // The simulation account polls its own authoritative state, so the real
  // futures account store must not poll for it. What decides that is the
  // ENGINE SEAM itself, not a query parameter and not a second flag:
  // `nativeExecution` is non-null exactly while this account is bound to the
  // simulation engine — including while the server's verdict is still
  // 'unknown', which is deliberately fail-closed. An ordinary user's binding
  // resolves to 'ordinary', the seam goes null, and the unchanged intervals
  // resume.
  const account = useFuturesAccount(nativeExecution?{}:{ orders: 5000, positions: 4000 });
  /**
   * The tab strip sits in this component, one level ABOVE the replacement
   * account provider rendered below. Hooks in this component therefore see
   * the ordinary shared store even when the child terminal is native. That
   * is why the screenshot could show a real position row while the tab said
   * `Позиции (—)`: two different sources were being read on one screen.
   *
   * Use the engine's replacement account here when it exists; ordinary
   * accounts keep the exact shared-store object they used before.
   */
  const visibleAccount = nativeExecution?.account ?? account;
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chart' | 'trade' | 'positions'>('chart');
  const [mobileChartTab, setMobileChartTab] = useState<'chart' | 'book'>('chart');
  const mobileScroll = useRef<Record<string, number>>({});
  const mobileTabsRef = useRef<HTMLDivElement>(null);
  const [mobileViewport, setMobileViewport] = useState<{ height: number; inset: number } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      if (!window.matchMedia('(max-width: 900px)').matches) { setMobileViewport(null); return; }
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setMobileViewport({ height: viewport.height, inset: inset > 140 ? inset : 0 });
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  const selectMobileTab = useCallback((next: 'chart' | 'trade' | 'positions', resetScroll = false) => {
    if (!window.matchMedia('(max-width: 900px)').matches || (next === mobileTab && !resetScroll)) return;
    mobileScroll.current[mobileTab] = window.scrollY;
    setMobileTab(next);
    window.requestAnimationFrame(() => window.scrollTo({ top: resetScroll ? 0 : mobileScroll.current[next] ?? 0, behavior: 'instant' }));
  }, [mobileTab]);
  const [bottomTab, setBottomTab] = useState<BottomTab>('positions');
  const accountPanel = useCompactAccountPanel(
    (bottomTab === 'orders' || bottomTab === 'positions')
      && isVerifiedEmptyAccountResource(visibleAccount.orders)
      && isVerifiedEmptyAccountResource(visibleAccount.positions),
    `futures:${bottomTab}`,
  );
  // `status` rides with the levels so the panel can tell "this is the book"
  // from "this WAS the book" from "we do not know" — three different things
  // that all used to render as an empty table.
  // `asOf` rides along with them: it is the LOCAL arrival time of the
  // newest accepted frame, which is the only honest way to say how old the
  // numbers on screen are. The status line reads it; the book does not.
  const [book, setBook] = useState<{ symbol: string; bids: any[]; asks: any[]; status: FuturesDepthStatus; asOf: number | null }>(
    { symbol, bids: [], asks: [], status: 'connecting', asOf: null });
  const [tape, setTape] = useState<{symbol:string;rows:FuturesTrade[]}>({symbol,rows:[]});
  /**
   * "Торговля с графика" — a CHART TOOL switch, not an account switch.
   *
   * On: a bar can be picked and the pick prices the ordinary order form.
   * Off: the pickers are hidden and any unsent pick is dropped. Nothing
   * about the account, its positions, its orders or its history depends on
   * it, and it is not persisted anywhere — it is the state of a toolbar.
   */
  const [chartTrading, setChartTrading] = useState(false);
  useEffect(()=>{native.setHistoryDemand({positions:bottomTab==='positionHistory',orders:bottomTab==='orderHistory',chart:chartTrading});},[bottomTab,chartTrading,native.setHistoryDemand]);
  /**
   * Where the chart tool menu is open, or `null` for closed.
   *
   * It used to be a checkbox pinned above the chart in every session. A
   * double click on the chart opens the same controls at the pointer and
   * costs no vertical space when they are not wanted.
   */
  const [chartMenu, setChartMenu] = useState<ChartMenuAnchor | null>(null);
  const closeChartMenu = useCallback(() => setChartMenu(null), []);
  /**
   * Was the entry picker armed when the current pointer gesture began?
   *
   * A ref, not state: it must be true at the instant the second click of a
   * double click is handled, and a state update scheduled by the first
   * click is not guaranteed to have been rendered by then.
   */
  const pickingAtGestureStart = useRef(false);
  // A menu anchored to a point on one contract's chart means nothing on
  // another's, and must not survive leaving the page either.
  useEffect(() => { setChartMenu(null); }, [symbol]);
  useEffect(() => () => setChartMenu(null), []);
  /** A reduce-only close the trader started from the positions table. The
   *  form fills itself from it; nothing is placed until they submit. */
  const [closeTicket, setCloseTicket] = useState<FuturesCloseTicket | null>(null);
  /**
   * The calculator is a panel over the terminal, not a route: it is opened
   * to answer a question about the market already on screen, and closing it
   * must leave that market exactly as it was.
   */
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  /** The last hand-over from the calculator. An UNSENT draft — see the order form. */
  const [calculatorDraft, setCalculatorDraft] = useState<(CalculatorDraft & { seq: number }) | null>(null);
  const [pickedPrice, setPickedPrice] = useState<{ symbol: string; value: string; seq: number } | null>(null);
  const pickedSeq = useRef(0);
  useEffect(() => {
    setPickedPrice(null);
    setCloseTicket(current => current?.symbol === symbol ? current : null);
  }, [symbol]);
  const pairListRef = useRef<FuturesPairListHandle>(null);
  const marketDialogRef = useRef<HTMLDialogElement>(null);
  const [desktopMarkets, setDesktopMarkets] = useState(() => window.matchMedia('(min-width: 1025px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1025px)');
    const update = () => setDesktopMarkets(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  /**
   * The market chooser: one state, one handler, two buttons.
   *
   * Both entry points in the instrument row — the list glyph and the caret
   * on BTC/USDT — call this and nothing else, so there is no second code
   * path that could drift. On desktop it toggles a chooser anchored under
   * the pair selector; below 1025px there is no rail to anchor to and the
   * existing market dialog is used instead.
   *
   * Opening does no work. No request is made, nothing is fetched, no timer
   * or animation frame is waited on: the symbol universe is already in
   * memory, the chooser mounts with the list and its field, and the field's
   * `autoFocus` puts the caret there in the SAME React commit. Click and
   * the search is already typing-ready.
   */
  const [chooserOpen, setChooserOpen] = useState(false);
  const chooserRef = useRef<HTMLDivElement>(null);
  const openMarkets = useCallback(() => {
    if (desktopMarkets) { setChooserOpen(open => !open); return; }
    marketDialogRef.current?.showModal();
    // The mobile list is mounted with the dialog long before it is shown,
    // so its autoFocus has already fired and cannot fire again.
    pairListRef.current?.focusSearch();
  }, [desktopMarkets]);

  // Crossing the breakpoint with the chooser open would leave a desktop
  // layer over a mobile layout, and the dialog and the chooser each
  // thinking they own the same "markets are open". Only one exists at a
  // time, and the desktop one is dropped the moment desktop is.
  useEffect(() => { if (!desktopMarkets) setChooserOpen(false); }, [desktopMarkets]);

  useEffect(() => {
    if (!chooserOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setChooserOpen(false); };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (chooserRef.current?.contains(target as Node)) return;
      // The entry buttons are their own toggle. Without this the outside
      // handler closed the chooser on pointerdown and the button's own
      // click re-opened it a moment later, so it could never be closed
      // from the control that opened it.
      if (target?.closest?.('[data-market-entry]')) return;
      setChooserOpen(false);
    };
    // Attached from an effect, which runs after the click that opened the
    // chooser has finished dispatching — so that click cannot close what it
    // just opened, and no first click is ever swallowed.
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [chooserOpen]);

  // One shared read of /futures/config for the whole tab — this page, the
  // order form and the ticker bar used to fetch it independently on mount,
  // three requests for one static answer. See lib/futuresConfigStore.
  const { config: futuresConfig } = useFuturesConfig();

  useEffect(() => {
    let cancelled = false;
    const refresh = () => api.getFuturesUniverse().then(result => {
      if (!cancelled && result.available) setUniverse(result);
    }).catch(() => {});
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    const executable = futuresConfig?.symbols ?? CORE_SYMBOLS;

    if (!universe?.available) {
      // Do not replace a warm full catalogue with CORE_SYMBOLS while the
      // existing universe request is still in flight. If config arrives
      // first, only merge its executable symbols into what is already on
      // screen. Execution is STILL checked separately by FuturesOrderForm.
      if (futuresConfig) setSymbols(current => [...new Set([...executable, ...current])]);
      return;
    }

    const listed = discoverFuturesSymbols(executable, universe);
    setSymbols(listed);
    writeFuturesSymbolCache(listed);
    // Only a successfully loaded catalogue can invalidate a discovery deep link.
    setSymbol((current) => (listed.includes(current) ? current : listed[0]));
  }, [futuresConfig, universe]);

  // Same reason as the spot terminal: this page is not remounted when only
  // the query string changes, so without this a second deep-link into
  // /futures would leave the previous contract selected.
  useEffect(() => {
    const next = searchParams.get('pair');
    if (next) setSymbol(next);
  }, [searchParams]);

  // Landing here is itself the signal that futures is this user's current
  // trading mode — see lib/tradingMode.
  useEffect(() => rememberTradingMode('futures'), []);

  // The depth module stays free of `import.meta` so it can be tested outside
  // the bundler; the page hands it the API origin the rest of the app uses.
  useEffect(() => { setFuturesDepthFallbackBase(API_BASE); }, []);

  useEffect(() => subscribeFuturesDepth(symbol, snapshot => setBook({ symbol, ...snapshot }), incoming => {
    setTape(previous => ({symbol,rows:incoming.length ? [...incoming,...(previous.symbol===symbol?previous.rows:[])]
      .filter((row,index,all)=>all.findIndex(other=>other.id===row.id)===index)
      .sort((a,b)=>b.time-a.time).slice(0,40) : []}));
  }), [symbol]);

  /** Newest execution on the selected contract, or null while unknown. */
  const tapeLastPrice = useMemo(() => {
    if (tape.symbol !== symbol) return null;
    const value = Number(tape.rows[0]?.price);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [tape, symbol]);

  /**
   * The same price the ticker prints, as a string, for surfaces that hand
   * numbers back to the engine. Kept as text on purpose: the engine parses
   * decimal strings, and a round trip through a JS number is exactly where a
   * tick-sized figure loses its last digit.
   */
  const livePrice = useMemo(() => {
    const value = tapeLastPrice ?? reference.get(symbol)?.lastPrice ?? null;
    return value === null ? null : String(value);
  }, [tapeLastPrice, reference, symbol]);

  /**
   * The open positions the chart draws, and ONLY when the chart is not
   * already drawing them from somewhere else.
   *
   * `privateTrading` gives the chart the simulation transcript, which
   * already puts an entry line on every open trade and TP/SL/LIQ on the
   * selected one. Handing it this list as well would draw a second entry
   * line over the first for the same position — the duplicate the brief
   * explicitly rules out. So this is the REAL engine's equivalent of that
   * path, not a second copy of it.
   *
   * Every figure travels through untouched, as the server's own string:
   * parsing it here would round it once before the chart rounds it again.
   *
   * No status filtering is needed on the protection legs. /futures/positions
   * builds them with `activeProtectionByPosition`, which selects only the
   * ARMED statuses (PENDING, FAILED — which is re-armed — and TRIGGERING).
   * An executed or cancelled trigger never reaches this list, so a TP line
   * on the chart is always a trigger that is still standing.
   */
  const chartPositionLines = useMemo<ChartPositionLine[] | undefined>(() => {
    if (nativeExecution) return undefined;
    const rows = visibleAccount.positions.data;
    if (!rows?.length) return undefined;
    return rows.map(row => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      entryPrice: row.entryPrice,
      liquidationPrice: row.liquidationPrice,
      takeProfit: row.protection?.takeProfit?.triggerPrice ?? null,
      stopLoss: row.protection?.stopLoss?.triggerPrice ?? null,
    }));
  }, [nativeExecution, chartTrading, visibleAccount.positions.data]);

  const handleOrderPlaced = useCallback(() => {
    setCloseTicket(null);
    setPositionsRefreshKey((k) => k + 1);
  }, []);

  // A position can only ever be opened on a listed contract (the
  // order-placement route rejects anything else outright). Clicking a symbol
  // the strip shows but futures doesn't list sends the trader to spot
  // instead of pretending a futures market exists for it.
  function handleTickerSelect(pair: string) {
    if (symbols.includes(pair)) setSymbol(pair);
    else navigate(`/trade?pair=${encodeURIComponent(pair)}`);
  }

  return (
    <div id={archivePreview ? 'archive-terminal-preview' : undefined} className={`trade-terminal futures-terminal futures-reference terminal-studio${studio ? ' futures-studio' : ''}`} data-mobile-keyboard={Boolean(mobileViewport?.inset)}
      style={mobileViewport ? { '--mobile-viewport-height': `${mobileViewport.height}px`, '--mobile-keyboard-inset': `${mobileViewport.inset}px` } as React.CSSProperties : undefined}
      data-terminal-design={archivePreview ? 'archive' : design ?? undefined}>
      {requestedDesign && !archivePreview && <div className="terminal-design-review" role="group" aria-label="Вариант дизайна">
        {([['studio', 'A · Studio'], ['graphite', 'B · Graphite'], ['focus', 'C · Focus']] as const).map(([id, label]) =>
          <button key={id} type="button" aria-pressed={design === id} onClick={() => {
            const next = new URLSearchParams(searchParams); next.set('terminalDesign', id);
            navigate({ pathname: '/futures', search: next.toString() }, { replace: true });
          }}>{label}</button>)}
      </div>}
      {/* The strip carries this terminal's own listed perpetuals, held
          still, trimmed to what fits — and each one selects that contract
          in place through handleTickerSelect, the same path the market
          panel uses. The wallet-transfer button that used to sit in
          `rightExtra` is gone from the shared header: transfer is still
          reachable from the futures account summary in the order panel and
          from the Wallet page, neither of which costs permanent header
          space on every page of the site. */}
      <Nav
        active="/futures"
        rightExtra={archivePreview ? <>{!nativeExecution && <PrivateTradingEntry/>}<ArchiveAccountActivity positions={visibleAccount.positions.data?.length ?? null} orders={visibleAccount.orders.data?.length ?? null} /></> : nativeExecution ? undefined : <PrivateTradingEntry/>}
        quoteAsset={archivePreview ? symbol.split('/')[1] : undefined}
        onTickerSelect={handleTickerSelect}
        staticTicker
        tickerSymbols={symbols}
        tickerFitToWidth
        futuresReference={reference}
      />

      <FuturesExecutionProvider value={execution}>
      <FuturesAccountSourceContext.Provider value={execution.account}>
      <div className="terminal" data-account-compact={accountPanel.compact} data-mobile-tab={mobileTab} data-mobile-chart={mobileChartTab}>
        <FuturesTickerBar archive={archivePreview} symbol={symbol} onSelectSymbol={openMarkets} marketsOpen={chooserOpen} onOpenCalculator={archivePreview ? undefined : () => setCalculatorOpen(true)} />

        <div className="futures-mobile-tabs" ref={mobileTabsRef} role="tablist" aria-label={t('nav.futures')}>
          {([['chart', 'futures.chart'], ['trade', 'nav.trade'], ['positions', 'futures.positions']] as const).map(([id, label]) =>
            <button type="button" role="tab" key={id} id={`mobile-futures-${id}`}
              aria-selected={mobileTab === id} aria-controls={`mobile-futures-panel-${id}`}
              tabIndex={mobileTab === id ? 0 : -1}
              onKeyDown={event => {
                const tabs = ['chart', 'trade', 'positions'] as const;
                const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (!offset && event.key !== 'Home' && event.key !== 'End') return;
                event.preventDefault();
                const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(id) + offset + 3) % 3];
                selectMobileTab(next);
                if (next === 'positions') accountPanel.reveal();
                mobileTabsRef.current?.querySelector<HTMLButtonElement>(`#mobile-futures-${next}`)?.focus();
              }}
              onClick={() => { selectMobileTab(id); if (id === 'positions') accountPanel.reveal(); }}>
              {t(label)}{id === 'positions' && <span>{visibleAccount.positions.data?.length ?? '—'}</span>}
            </button>)}
        </div>
        <div className="futures-mobile-chart-tabs" role="group" aria-label={t('futures.chart')}>
          <button type="button" aria-pressed={mobileChartTab === 'chart'} onClick={() => setMobileChartTab('chart')}>{t('futures.chart')}</button>
          <button type="button" aria-pressed={mobileChartTab === 'book'} onClick={() => setMobileChartTab('book')}>{t('trade.orderBook')}</button>
        </div>

        <div className="main-grid">
          {/* NO PERMANENT MARKET RAIL.

              There were two ways to reach the same market list on this page:
              a 212px column standing open all day, and the chooser the two
              entry points in the instrument row open on demand. The column
              was the worse of the two — it showed a dozen of 771 markets,
              truncated their names to fit, and charged the chart 212px for
              the privilege — so it is gone and the chart has the width.

              The list glyph and the pair caret are now the only way in,
              which is why they are drawn to be seen (see .pair-markets-btn
              and .pair-arrow); losing the rail must not mean losing search.

              A LAYER, not a panel. The chooser keeps the far-left cell the
              rail used to hold, so it still opens directly under the
              instrument row and overlaps the chart rather than displacing
              it — nothing below it moves while it is open. */}
          {desktopMarkets && chooserOpen && (
            <div className="futures-market-chooser" ref={chooserRef} role="dialog" aria-modal="false" aria-label={t('nav.markets')}>
              <FuturesPairList
                searchable
                onDismiss={() => setChooserOpen(false)}
                symbols={symbols}
                symbol={symbol}
                onChange={next => { setSymbol(next); setChooserOpen(false); }}
              />
            </div>
          )}
          <div id="mobile-futures-panel-chart" className="chart-area" role="region" aria-label={t('futures.chart')}>
            {/* The double click is captured on this wrapper rather than on
                the chart itself: the chart owns no dblclick handler, so
                nothing is being overridden, and stopping it here keeps a
                stray second click from reaching a drawing tool. It opens a
                menu and does nothing else — no drawing, no zoom, no pick,
                and certainly no order. */}
            <div
              className="chart-surface"
              /* The picking state, readable from the DOM. The control that
                 arms it lives in a menu that is closed by the time a bar is
                 picked, so this is how anything outside the chart — a
                 cursor rule, a QA run — can tell that a click on the chart
                 is currently a selection rather than a pan. */
              data-chart-picking={nativeExecution && native.interaction.selecting !== null ? native.interaction.selecting : undefined}
              /* THE GESTURE IS JUDGED BY THE STATE IT STARTED IN.
                 Recorded on the first press, in capture, so a control
                 inside the chart that stops the event still cannot hide
                 the gesture from this guard. */
              onPointerDownCapture={nativeExecution ? (event) => {
                if (event.detail > 1) return;
                pickingAtGestureStart.current = native.interaction.selecting !== null;
              } : undefined}
              onDoubleClick={nativeExecution ? (event) => {
                // Controls inside the chart (the drawing rail, the interval
                // and indicator buttons) keep their own double-click
                // behaviour; only the chart surface opens the menu.
                if ((event.target as HTMLElement).closest('button,select,input,a,[role=button]')) return;
                // While a bar is being chosen, the chart owns the pointer.
                // A double click's FIRST click already reaches the chart and
                // picks — so opening the menu on the second one would both
                // steal the gesture and report a state that had just
                // changed underneath it. The control stays reachable: the
                // compact trigger appears for exactly as long as the picker
                // is armed (see .chart-tools-trigger), and Esc still cancels.
                //
                // This reads the state the GESTURE began in rather than
                // `selecting` as it stands now, because by now the
                // gesture's own first click has already picked a bar and
                // disarmed the picker. Deciding on the live value made the
                // same double click open the menu or not depending on
                // whether React had re-rendered between the two clicks —
                // under load it had not, and the gesture silently did
                // nothing.
                if (pickingAtGestureStart.current) return;
                event.preventDefault();
                event.stopPropagation();
                setChartMenu({ x: event.clientX, y: event.clientY });
              } : undefined}
            >
              <PriceChart pair={symbol} chrome="terminal" drawingTools market="futures" compactTools={studio}
                privateTrading={nativeExecution ? native.interaction : undefined}
                positionLines={chartPositionLines}
                candleLoader={nativeExecution?native.loader:undefined} />
              {nativeExecution && <button
                type="button"
                /* Touch has no double click. This is a compact control that
                   floats in the chart's own corner rather than a strip
                   above it, and CSS shows it only where the gesture is
                   unavailable. */
                className="chart-tools-trigger"
                aria-label={t('futures.chartTools')}
                aria-haspopup="menu"
                aria-expanded={chartMenu !== null}
                onClick={(event) => {
                  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  setChartMenu((open) => (open ? null : { x: box.left, y: box.bottom + 4 }));
                }}
              >
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M2 11.5 6 7l3 2.5L14 4" /><path d="M2 14h12" />
                </svg>
              </button>}
              {nativeExecution && <ChartTradingMenu
                anchor={chartMenu}
                enabled={chartTrading}
                picking={native.interaction.selecting !== null}
                onToggle={next => {
                  setChartTrading(next);
                  // Turning the tools off discards an UNSENT historical
                  // selection, so the next ordinary order cannot silently
                  // open in the past. Positions, orders, balance and history
                  // are account state and are not touched.
                  if (!next) native.interaction.onCancelSelection();
                }}
                onPick={native.pickEntry}
                onCancelPicking={native.interaction.onCancelSelection}
                onClose={closeChartMenu}
              />}
            </div>
          </div>

          <div className="orderbook-area repaired-futures-book">
            {/* No `key` here on purpose. Remounting on every contract switch
                threw away the trader's own choices — the Trades tab, the
                bids-only view, the grouping step — and forced a fresh DOM
                tree for a panel that already handles a pair change itself. */}
            <FuturesReferenceBook
              lastPrice={reference.get(symbol)?.lastPrice ?? null}
              trades={tape.symbol===symbol?tape.rows:[]}
              status={book.symbol === symbol ? book.status : 'connecting'}
              bids={book.symbol === symbol ? book.bids : []}
              asks={book.symbol === symbol ? book.asks : []}
              pair={symbol}
              onPickPrice={(value) => {
                pickedSeq.current += 1;
                setPickedPrice({ symbol, value, seq: pickedSeq.current });
                selectMobileTab('trade', true);
              }}
            />
          </div>

          <div id="mobile-futures-panel-trade" className="order-form-area">
            {archivePreview ? <div className="archive-trading-heading">
              <h2 className="reference-order-heading">{t('nav.trade')}</h2>
              <button type="button" className="archive-calculator-trigger" data-open-calculator="true" title={t('calc.title')} aria-label={t('calc.title')} onClick={() => setCalculatorOpen(true)}><Calculator size={19} /></button>
            </div> : <h2 className="reference-order-heading">{t('nav.trade')}</h2>}
            <FuturesTerminalStatus
              status={book.symbol === symbol ? book.status : 'connecting'}
              asOf={book.symbol === symbol ? book.asOf : null}
            />
            <FuturesOrderForm
              key={symbol}
              archive={archivePreview}
              symbol={symbol}
              /* The simulation engine lists every contract the terminal
                 discovers, so its universe is not the real engine's
                 execution whitelist. */
              executionEnabled={nativeExecution ? true : (futuresConfig?.symbols.includes(symbol) ?? false)}
              onPlaced={handleOrderPlaced}
              onOpenTransfer={nativeExecution ? undefined : () => setShowTransfer(true)}
              pickedPrice={pickedPrice?.symbol === symbol ? pickedPrice.value : undefined}
              pickedPriceSequence={pickedPrice?.symbol === symbol ? pickedPrice.seq : undefined}
              /* The LAST TRADED price, which is what the button beside the
                 Limit field says it fills. Mark price stays where it
                 belongs — valuing the position, not seeding an order.
                 The execution tape for THIS contract is preferred over the
                 shared ticker stream: it is the same quantity, arrives on
                 the connection the book is already using, and so is
                 available whenever the book is. */
              lastPrice={tapeLastPrice ?? reference.get(symbol)?.lastPrice ?? null}
              closeTicket={closeTicket?.symbol === symbol ? closeTicket : undefined}
              calculatorDraft={calculatorDraft ?? undefined}
              onOpenCalculator={() => setCalculatorOpen(true)}
            />
          </div>
        </div>

        <div id="mobile-futures-panel-positions" className="bottom-panel" data-account-compact={accountPanel.compact}>
          <div className="terminal-account-header">
          <div className="bottom-tabs" role="tablist" aria-label={t('futures.positions')}>
            {BOTTOM_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`futures-tab-${tab.id}`}
                aria-selected={bottomTab === tab.id}
                aria-controls="futures-bottom-content"
                className={`bottom-tab ${bottomTab === tab.id ? 'active' : ''}`}
                onClick={() => { setBottomTab(tab.id); accountPanel.reveal(); }}
              >
                {t(tab.labelKey)}
                {tab.id === 'positions' && <span className="reference-tab-count">{`(${visibleAccount.positions.data?.length ?? '—'})`}</span>}
                {tab.id === 'orders' && <span className="reference-tab-count">{`(${visibleAccount.orders.data?.length ?? '—'})`}</span>}
              </button>
            ))}
          </div>
          {archivePreview && <label className="archive-pair-filter"><input type="checkbox" checked={!onlyCurrentPair} onChange={e => setOnlyCurrentPair(!e.target.checked)} />{t('futures.allMarkets')}</label>}
          {accountPanel.canCompact && <AccountPanelToggle compact={accountPanel.compact} onToggle={accountPanel.toggle} controls="futures-bottom-content" />}
          </div>

          <div className="bottom-content" id="futures-bottom-content" role="tabpanel" aria-labelledby={`futures-tab-${bottomTab}`} hidden={accountPanel.compact}>
            {nativeExecution&&native.historyHasMore&&<button type="button" className="bottom-tab" onClick={native.loadMoreHistory}>{t('catalogue.nextPage')}</button>}
            {bottomTab === 'positions' && (
              <FuturesPositionsPanel
                archive={archivePreview}
                symbolFilter={archivePreview && onlyCurrentPair ? symbol : undefined}
                refreshKey={positionsRefreshKey}
                tab="open"
                leverageBusy={native.busy}
                onEditLeverage={nativeExecution?.ready ? (positionId) => {
                  const position = native.getState()?.positions.find(p => p.id === positionId && p.status === 'OPEN');
                  if (position && !native.busy) native.setDialog({ kind: 'leverage', position });
                } : undefined}
                /* "Лимитный" hands the position to the ORDINARY order form
                   as a reduce-only ticket, priced at the level the trader
                   then types. It is the form that places it, so this is a
                   real limit close and not a second order path. */
                onLimitClose={(position) => {
                  // Read that exact row from the same account source as the
                  // table. Never infer its bucket from the form's old mode.
                  const target = visibleAccount.positions.data?.find(p => p.id === position.id);
                  if (!target) return;
                  native.interaction.onCancelSelection();
                  setPickedPrice(null);
                  setSymbol(target.symbol);
                  pickedSeq.current += 1;
                  selectMobileTab('trade', true);
                  setCloseTicket({ id: target.id, symbol: target.symbol, side: target.side,
                    size: target.size, marginType: target.marginType, seq: pickedSeq.current });
                }}
              />
            )}
            {bottomTab === 'positionHistory' && <FuturesPositionsPanel refreshKey={positionsRefreshKey} tab="history" />}
            {bottomTab === 'orders' && <FuturesOrdersPanel refreshKey={positionsRefreshKey} />}
            {bottomTab === 'orderHistory' && <FuturesOrdersPanel history refreshKey={positionsRefreshKey} />}
            {bottomTab === 'assets' && <AssetsPanel wallet="futures" refreshKey={positionsRefreshKey} />}
          </div>
        </div>
      </div>
      </FuturesAccountSourceContext.Provider>
      </FuturesExecutionProvider>
      {archivePreview && <ArchiveTopAssets symbols={symbols} onSelect={setSymbol} />}

      {!desktopMarkets && <dialog className="reference-market-dialog" ref={marketDialogRef} aria-label={t('nav.markets')}
        onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="reference-market-heading"><strong>{t('nav.markets')}</strong>
          <button type="button" aria-label={t('deposit.close')} onClick={() => marketDialogRef.current?.close()}>×</button>
        </div>
        <div className="left-panel">
          <FuturesPairList ref={pairListRef} searchable onDismiss={() => marketDialogRef.current?.close()}
            symbols={symbols} symbol={symbol} onChange={next => { setSymbol(next); marketDialogRef.current?.close(); }} />
        </div>
      </dialog>}
      {nativeExecution&&<NativeDemoDialogs controller={native}/>}
      {showTransfer && <FuturesTransferModal onClose={() => setShowTransfer(false)} />}
      {/* The calculator sits at the page level, not inside the ticket, because
          it is the one surface that is allowed to know the whole terminal:
          the symbol on screen, the price the trader last clicked, the tape's
          last print. It hands back a DRAFT — `setCalculatorDraft` fills the
          order form's fields and nothing else; the trader still presses the
          order button. */}
      <FuturesCalculator
        open={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
        symbol={symbol}
        initial={{
          price: (pickedPrice?.symbol === symbol ? pickedPrice.value : undefined)
            ?? livePrice ?? undefined,
          markPrice: reference.get(symbol)?.markPrice?.toString() ?? null,
        }}
        onUseValues={draft => {
          pickedSeq.current += 1;
          setCalculatorDraft({ ...draft, seq: pickedSeq.current });
          setCalculatorOpen(false);
          selectMobileTab('trade', true);
        }}
      />
    </div>
  );
}
