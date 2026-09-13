import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { FuturesTickerBar } from '../components/FuturesTickerBar';
import { FuturesPairList, FuturesPairListHandle } from '../components/FuturesPairList';
import { TerminalChart as PriceChart } from '../components/TerminalChart';
import { FuturesReferenceBook } from '../components/FuturesReferenceBook';
import { FuturesOrderForm } from '../components/FuturesOrderForm';
import { FuturesPositionsPanel } from '../components/FuturesPositionsPanel';
import { FuturesOrdersPanel } from '../components/FuturesOrdersPanel';
import { useFuturesAccount } from '../lib/useFuturesAccount';
import { FuturesTransferModal } from '../components/FuturesTransferModal';
import { AssetsPanel } from '../components/AssetsPanel';
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
  const account = useFuturesAccount({ orders: 5000, positions: 4000 });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedDesign = searchParams.get('terminalDesign');
  const design = ['studio', 'graphite', 'focus'].includes(requestedDesign ?? '') ? requestedDesign : 'studio';
  const studio = design !== null;
  // Discover all real USDT perpetuals; execution remains restricted by config.
  const [symbols, setSymbols] = useState<string[]>(CORE_SYMBOLS);
  const [universe, setUniverse] = useState<FuturesUniverse | null>(null);
  const [symbol, setSymbol] = useState(() => searchParams.get('pair') || 'BTC/USDT');
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('positions');
  const [book, setBook] = useState<{ symbol: string; bids: any[]; asks: any[] }>({ symbol, bids: [], asks: [] });
  const [tape, setTape] = useState<{symbol:string;rows:FuturesTrade[]}>({symbol,rows:[]});
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
        onTickerSelect={handleTickerSelect}
        staticTicker
        tickerSymbols={symbols}
        tickerFitToWidth
        futuresReference={reference}
      />

      <div className="terminal">
        <FuturesTickerBar symbol={symbol} onSelectSymbol={openMarkets} />

        <div className="main-grid">
          {desktopMarkets && <aside className="left-panel reference-market-sidebar" aria-label={t('nav.markets')}>
            {studio && <h2 className="studio-market-heading">{t('nav.markets')}</h2>}
            <FuturesPairList ref={pairListRef} symbols={symbols} symbol={symbol} onChange={setSymbol} />
          </aside>}
          <div className="chart-area" role="region" aria-label={t('futures.chart')}>
            <PriceChart pair={symbol} chrome="terminal" drawingTools market="futures" compactTools={studio} />
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
              executionEnabled={futuresConfig?.symbols.includes(symbol) ?? false}
              onPlaced={handleOrderPlaced}
              onOpenTransfer={() => setShowTransfer(true)}
              pickedPrice={pickedPrice?.symbol === symbol ? pickedPrice.value : undefined}
              pickedPriceSequence={pickedPrice?.symbol === symbol ? pickedPrice.seq : undefined}
            />
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
                {tab.id === 'positions' && <span className="reference-tab-count">({account.positions.data?.length ?? '—'})</span>}
                {tab.id === 'orders' && <span className="reference-tab-count">({account.orders.data?.length ?? '—'})</span>}
              </button>
            ))}
          </div>

          <div className="bottom-content">
            {bottomTab === 'positions' && (
              <FuturesPositionsPanel refreshKey={positionsRefreshKey} tab="open" />
            )}
            {bottomTab === 'positionHistory' && <FuturesPositionsPanel refreshKey={positionsRefreshKey} tab="history" />}
            {bottomTab === 'orders' && <FuturesOrdersPanel refreshKey={positionsRefreshKey} />}
            {bottomTab === 'orderHistory' && <FuturesOrdersPanel history refreshKey={positionsRefreshKey} />}
            {bottomTab === 'assets' && <AssetsPanel wallet="futures" refreshKey={positionsRefreshKey} />}
          </div>
        </div>
      </div>

      {!desktopMarkets && <dialog className="reference-market-dialog" ref={marketDialogRef} aria-label={t('nav.markets')}
        onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="reference-market-heading"><strong>{t('nav.markets')}</strong>
          <button type="button" aria-label={t('deposit.close')} onClick={() => marketDialogRef.current?.close()}>×</button>
        </div>
        <div className="left-panel">
          <FuturesPairList ref={pairListRef} symbols={symbols} symbol={symbol} onChange={next => { setSymbol(next); marketDialogRef.current?.close(); }} />
        </div>
      </dialog>}
      {showTransfer && <FuturesTransferModal onClose={() => setShowTransfer(false)} />}
    </div>
  );
}
