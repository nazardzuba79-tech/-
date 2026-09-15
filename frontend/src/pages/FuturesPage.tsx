import { useNativeDemo } from './private-trading/useNativeDemo';
import { NativeDemoDialogs } from './private-trading/NativeDemoControls';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { PrivateTradingEntry } from '../components/PrivateTradingEntry';
import { FuturesTickerBar } from '../components/FuturesTickerBar';
import { FuturesPairList, FuturesPairListHandle } from '../components/FuturesPairList';
import { TerminalChart as PriceChart } from '../components/TerminalChart';
import { FuturesReferenceBook } from '../components/FuturesReferenceBook';
import { FuturesOrderForm } from '../components/FuturesOrderForm';
import { FuturesPositionsPanel } from '../components/FuturesPositionsPanel';
import { FuturesOrdersPanel } from '../components/FuturesOrdersPanel';
import { useFuturesAccount } from '../lib/useFuturesAccount';
import { FuturesExecutionProvider, REAL_FUTURES_EXECUTION } from '../lib/futuresExecution';
import { FuturesAccountSourceContext } from '../lib/futuresAccountSource';
import { useNativeFuturesExecution } from '../lib/useNativeFuturesExecution';
import { nativeDemoApi } from '../lib/nativeDemoApi';
import { pairToNativeSymbol } from '../lib/nativeFuturesAdapter';
import type { FuturesContractRules } from '../lib/futuresMath';
import { ChartTradingToggle } from '../components/ChartTradingToggle';
import { FuturesTransferModal } from '../components/FuturesTransferModal';
import { AssetsPanel } from '../components/AssetsPanel';
import { AccountPanelToggle } from '../components/AccountPanelToggle';
import { useCompactAccountPanel } from '../lib/useCompactAccountPanel';
import { isVerifiedEmptyAccountResource } from '../lib/terminalAccountPanel';
import { subscribeFuturesDepth, type FuturesTrade } from '../lib/futuresDepth';

import { useFuturesReference } from '../lib/useFuturesReference';
import { rememberTradingMode } from '../lib/tradingMode';
import { useFuturesConfig } from '../lib/futuresConfigStore';
import { discoverFuturesSymbols, type FuturesUniverse } from '../lib/futuresDiscovery';
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

// Until /futures/config answers. Deliberately the same three contracts the
// backend guarantees are always listed (CORE_FUTURES_SYMBOLS), so the first
// paint shows real markets rather than an empty panel — the full listing
// replaces this as soon as the request lands.
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
  const design = ['studio', 'graphite', 'focus'].includes(requestedDesign ?? '') ? requestedDesign : 'studio';
  const studio = design !== null;
  // Discover all real USDT perpetuals; execution remains restricted by config.
  const [symbols, setSymbols] = useState<string[]>(CORE_SYMBOLS);
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
  // SERVER's answer, not a query parameter: `native.requested` is the
  // access check's verdict, so the terminal stops polling as soon as it
  // arrives and an ordinary user keeps the unchanged intervals.
  const account = useFuturesAccount(nativeExecution?{}:{ orders: 5000, positions: 4000 });
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('positions');
  const accountPanel = useCompactAccountPanel(
    (bottomTab === 'orders' || bottomTab === 'positions')
      && isVerifiedEmptyAccountResource(account.orders)
      && isVerifiedEmptyAccountResource(account.positions),
    `futures:${bottomTab}`,
  );
  const [book, setBook] = useState<{ symbol: string; bids: any[]; asks: any[] }>({ symbol, bids: [], asks: [] });
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
  /** A reduce-only close the trader started from the positions table. The
   *  form fills itself from it; nothing is placed until they submit. */
  const [closeTicket, setCloseTicket] = useState<{ symbol: string; side: 'LONG' | 'SHORT'; size: string; seq: number } | null>(null);
  const [pickedPrice, setPickedPrice] = useState<{ symbol: string; value: string; seq: number } | null>(null);
  const pickedSeq = useRef(0);
  useEffect(() => setPickedPrice(null), [symbol]);
  const pairListRef = useRef<FuturesPairListHandle>(null);
  const marketDialogRef = useRef<HTMLDialogElement>(null);
  const [desktopMarkets, setDesktopMarkets] = useState(() => window.matchMedia('(min-width: 1025px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1025px)');
    const update = () => setDesktopMarkets(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  function openMarkets() {
    if (!desktopMarkets) marketDialogRef.current?.showModal();
    pairListRef.current?.focusSearch();
  }

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
    const listed = discoverFuturesSymbols(futuresConfig?.symbols ?? CORE_SYMBOLS, universe);
    setSymbols(listed);
    // Only a successfully loaded catalogue can invalidate a discovery deep link.
    if (universe?.available) setSymbol((current) => (listed.includes(current) ? current : listed[0]));
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

  useEffect(() => subscribeFuturesDepth(symbol, snapshot => setBook({ symbol, ...snapshot }), incoming => {
    setTape(previous => ({symbol,rows:incoming.length ? [...incoming,...(previous.symbol===symbol?previous.rows:[])]
      .filter((row,index,all)=>all.findIndex(other=>other.id===row.id)===index)
      .sort((a,b)=>b.time-a.time).slice(0,40) : []}));
  }), [symbol]);

  const handleOrderPlaced = useCallback(() => setPositionsRefreshKey((k) => k + 1), []);

  // A position can only ever be opened on a listed contract (the
  // order-placement route rejects anything else outright). Clicking a symbol
  // the strip shows but futures doesn't list sends the trader to spot
  // instead of pretending a futures market exists for it.
  function handleTickerSelect(pair: string) {
    if (symbols.includes(pair)) setSymbol(pair);
    else navigate(`/trade?pair=${encodeURIComponent(pair)}`);
  }

  return (
    <div className={`trade-terminal futures-terminal futures-reference terminal-studio${studio ? ' futures-studio' : ''}`} data-terminal-design={design ?? undefined}>
      {requestedDesign && <div className="terminal-design-review" role="group" aria-label="Вариант дизайна">
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
        rightExtra={nativeExecution?undefined:<PrivateTradingEntry/>}
        onTickerSelect={handleTickerSelect}
        staticTicker
        tickerSymbols={symbols}
        tickerFitToWidth
        futuresReference={reference}
      />

      <FuturesExecutionProvider value={execution}>
      <FuturesAccountSourceContext.Provider value={execution.account}>
      <div className="terminal" data-account-compact={accountPanel.compact}>
        <FuturesTickerBar symbol={symbol} onSelectSymbol={openMarkets} />

        <div className="main-grid">
          {desktopMarkets && <aside className="left-panel reference-market-sidebar" aria-label={t('nav.markets')}>
            {studio && <h2 className="studio-market-heading">{t('nav.markets')}</h2>}
            <FuturesPairList ref={pairListRef} symbols={symbols} symbol={symbol} onChange={setSymbol} />
          </aside>}
          <div className="chart-area" role="region" aria-label={t('futures.chart')}>
            {nativeExecution && <ChartTradingToggle
              enabled={chartTrading}
              onChange={next => {
                setChartTrading(next);
                // Turning the tools off discards an UNSENT historical
                // selection, so the next ordinary order cannot silently
                // open in the past. Positions, orders, balance and history
                // are account state and are not touched.
                if (!next) native.interaction.onCancelSelection();
              }}
              picking={native.interaction.selecting !== null}
              onPick={native.pickEntry}
            />}
            <PriceChart pair={symbol} chrome="terminal" drawingTools market="futures" compactTools={studio}
              privateTrading={nativeExecution&&chartTrading?native.interaction:undefined}
              candleLoader={nativeExecution?native.loader:undefined} />
          </div>

          <div className="orderbook-area repaired-futures-book">
            <FuturesReferenceBook
              key={symbol}
              lastPrice={reference.get(symbol)?.lastPrice ?? null}
              trades={tape.symbol===symbol?tape.rows:[]}

              bids={book.symbol === symbol ? book.bids : []}
              asks={book.symbol === symbol ? book.asks : []}
              pair={symbol}
              onPickPrice={(value) => {
                pickedSeq.current += 1;
                setPickedPrice({ symbol, value, seq: pickedSeq.current });
              }}
            />
          </div>

          <div className="order-form-area">
            <h2 className="reference-order-heading">{t('nav.trade')}</h2>
            <FuturesOrderForm
              key={symbol}
              symbol={symbol}
              /* The simulation engine lists every contract the terminal
                 discovers, so its universe is not the real engine's
                 execution whitelist. */
              executionEnabled={nativeExecution ? true : (futuresConfig?.symbols.includes(symbol) ?? false)}
              onPlaced={handleOrderPlaced}
              onOpenTransfer={nativeExecution ? undefined : () => setShowTransfer(true)}
              pickedPrice={pickedPrice?.symbol === symbol ? pickedPrice.value : undefined}
              pickedPriceSequence={pickedPrice?.symbol === symbol ? pickedPrice.seq : undefined}
              closeTicket={closeTicket?.symbol === symbol ? closeTicket : undefined}
            />
          </div>
        </div>

        <div className="bottom-panel" data-account-compact={accountPanel.compact}>
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
                onClick={() => { setBottomTab(tab.id); accountPanel.reveal(`futures:${tab.id}`); }}
              >
                {t(tab.labelKey)}
                {tab.id === 'positions' && <span className="reference-tab-count">({account.positions.data?.length ?? '—'})</span>}
                {tab.id === 'orders' && <span className="reference-tab-count">({account.orders.data?.length ?? '—'})</span>}
              </button>
            ))}
          </div>
          {accountPanel.canCompact && <AccountPanelToggle compact={accountPanel.compact} onToggle={accountPanel.toggle} controls="futures-bottom-content" />}
          </div>

          <div className="bottom-content" id="futures-bottom-content" role="tabpanel" aria-labelledby={`futures-tab-${bottomTab}`} hidden={accountPanel.compact}>
            {bottomTab === 'positions' && (
              <FuturesPositionsPanel
                refreshKey={positionsRefreshKey}
                tab="open"
                /* "Лимитный" hands the position to the ORDINARY order form
                   as a reduce-only ticket, priced at the level the trader
                   then types. It is the form that places it, so this is a
                   real limit close and not a second order path. */
                onLimitClose={(position) => {
                  setSymbol(position.symbol);
                  pickedSeq.current += 1;
                  setCloseTicket({ symbol: position.symbol, side: position.side, size: position.size, seq: pickedSeq.current });
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

      {!desktopMarkets && <dialog className="reference-market-dialog" ref={marketDialogRef} aria-label={t('nav.markets')}
        onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="reference-market-heading"><strong>{t('nav.markets')}</strong>
          <button type="button" aria-label={t('deposit.close')} onClick={() => marketDialogRef.current?.close()}>×</button>
        </div>
        <div className="left-panel">
          <FuturesPairList ref={pairListRef} symbols={symbols} symbol={symbol} onChange={next => { setSymbol(next); marketDialogRef.current?.close(); }} />
        </div>
      </dialog>}
      {nativeExecution&&<NativeDemoDialogs controller={native}/>}
      {showTransfer && <FuturesTransferModal onClose={() => setShowTransfer(false)} />}
    </div>
  );
}
