import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { Nav } from '../components/Nav';
import { FuturesTickerBar } from '../components/FuturesTickerBar';
import { FuturesPairList } from '../components/FuturesPairList';
import { PriceChart } from '../components/PriceChart';
import { OrderBookPanel } from '../components/OrderBookPanel';
import { FuturesOrderForm } from '../components/FuturesOrderForm';
import { FuturesPositionsPanel } from '../components/FuturesPositionsPanel';
import { FuturesTransferModal } from '../components/FuturesTransferModal';
import { AssetsPanel } from '../components/AssetsPanel';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { krakenSocket } from '../lib/krakenSocket';
import { rememberTradingMode } from '../lib/tradingMode';
import './trade-terminal/TradeTerminal.css';

const FUTURES_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
const WS_FALLBACK_TIMEOUT_MS = 4000;

// Only tabs with a real endpoint behind them. Positions leads, because on a
// futures terminal the open position is the thing a trader watches. There is
// no separate futures order-history route, so no tab pretends there is.
type BottomTab = 'positions' | 'positionHistory' | 'assets';
const BOTTOM_TABS: { id: BottomTab; labelKey: 'futures.positions' | 'futures.positionHistory' | 'trade.tabAssets' }[] = [
  { id: 'positions', labelKey: 'futures.positions' },
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
 * The order book mirrors the same live external depth the spot terminal
 * shows for this instrument, for the same reason and with the same caveat
 * documented there: our own engine's book is where orders actually match,
 * this is the market's depth, shown for reference.
 */
export function FuturesPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [symbol, setSymbol] = useState(() => {
    const requested = searchParams.get('pair');
    return requested && FUTURES_SYMBOLS.includes(requested) ? requested : 'BTC/USDT';
  });
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('positions');
  const [book, setBook] = useState<{ bids: any[]; asks: any[] }>({ bids: [], asks: [] });
  const [pickedPrice, setPickedPrice] = useState<string | null>(null);
  const pickedSeq = useRef(0);

  // Same reason as the spot terminal: this page is not remounted when only
  // the query string changes, so without this a second deep-link into
  // /futures would leave the previous contract selected.
  useEffect(() => {
    const next = searchParams.get('pair');
    if (next && FUTURES_SYMBOLS.includes(next)) setSymbol(next);
  }, [searchParams]);

  // Landing here is itself the signal that futures is this user's current
  // trading mode — see lib/tradingMode.
  useEffect(() => rememberTradingMode('futures'), []);

  const refreshBook = useCallback(() => {
    api
      .getExternalOrderBook(symbol)
      .then((res) => setBook({ bids: res.bids, asks: res.asks }))
      .catch(() => {});
  }, [symbol]);

  useEffect(() => {
    let gotWsData = false;
    let restInterval: number | null = null;
    const unsubscribe = krakenSocket.subscribeBook(symbol, (snapshot) => {
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
  }, [symbol, refreshBook]);

  const handleOrderPlaced = useCallback(() => setPositionsRefreshKey((k) => k + 1), []);

  // A futures position can only ever be opened on FUTURES_SYMBOLS (the
  // order-placement route rejects anything else outright). Clicking a symbol
  // the strip shows but futures doesn't support sends the trader to spot
  // instead of pretending a futures market exists for it.
  function handleTickerSelect(pair: string) {
    if (FUTURES_SYMBOLS.includes(pair)) setSymbol(pair);
    else navigate(`/trade?pair=${encodeURIComponent(pair)}`);
  }

  return (
    <div className="trade-terminal">
      <Nav
        active="/futures"
        onTickerSelect={handleTickerSelect}
        staticTicker
        rightExtra={
          <button className="bottom-action-btn" onClick={() => setShowTransfer(true)}>
            {t('futures.transfer')}
          </button>
        }
      />
      <ConnectionBanner />

      <div className="terminal">
        <FuturesTickerBar symbol={symbol} />

        <div className="main-grid">
          <div className="left-panel">
            <FuturesPairList symbols={FUTURES_SYMBOLS} symbol={symbol} onChange={setSymbol} />
          </div>

          <div className="chart-area">
            <PriceChart pair={symbol} chrome="terminal" />
          </div>

          <div className="orderbook-area">
            <OrderBookPanel
              bids={book.bids}
              asks={book.asks}
              pair={symbol}
              onPickPrice={(value) => {
                pickedSeq.current += 1;
                setPickedPrice(value);
              }}
            />
          </div>

          <div className="order-form-area">
            <FuturesOrderForm
              symbol={symbol}
              onPlaced={handleOrderPlaced}
              onOpenTransfer={() => setShowTransfer(true)}
              pickedPrice={pickedPrice}
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
              </button>
            ))}
          </div>

          <div className="bottom-content">
            {bottomTab === 'positions' && <FuturesPositionsPanel refreshKey={positionsRefreshKey} tab="open" />}
            {bottomTab === 'positionHistory' && <FuturesPositionsPanel refreshKey={positionsRefreshKey} tab="history" />}
            {bottomTab === 'assets' && <AssetsPanel refreshKey={positionsRefreshKey} />}
          </div>
        </div>
      </div>

      {showTransfer && <FuturesTransferModal onClose={() => setShowTransfer(false)} />}
    </div>
  );
}
