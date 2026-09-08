import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useMarketData, useMarketTickers } from '../../lib/useMarketData';
import { Nav } from '../../components/Nav';
import { Footer } from '../../components/Footer';
import { CryptoIcon } from '../../components/CryptoIcon';
import { CfdMarketsSection } from '../../components/CfdMarketsSection';
import { CatalogueTable } from './CatalogueTable';
import { parseChangePercent } from '../../lib/priceChange';
import { type CoinCategory } from '../../lib/pairList';
import { useFavorites } from '../../lib/useFavorites';
import {
  type Ticker,
  type CoinRanking,
  CORE_FUTURES_SYMBOLS,
  formatPrice,
  formatCompactUsd,
  computeBreadth,
  fearGreedLabelRu,
  computeVolumeSummary,
  computeSectorSummaries,
  topMovers,
  topLosers,
  mostPopular,
  baseOf,
} from './markets';
import './MarketsBolt.css';

// Mirrors api.getGlobalMarket's payload — market-WIDE figures, not this
// exchange's own turnover (see markets.ts's computeVolumeSummary).
type GlobalMarket = {
  totalVolume24hUsd: number;
  totalMarketCapUsd: number;
  btcDominancePercent: number | null;
  ethDominancePercent: number | null;
  marketCapChangePercent24h: number | null;
};
type FearGreedReading = { value: number; classification: string; updatedAt: number };

// The three instrument types this exchange actually trades. "Options" used
// to sit in this slot as a permanent coming-soon panel; CFD replaces it
// because CFD is a real, live product here (CfdMarketDataService and the
// /trade?market=cfd terminal), so the tab is a working discovery path
// rather than a dead one.
type MarketKind = 'Spot' | 'Futures' | 'CFD';
type CategoryTab = 'Cryptocurrency' | 'Favorites' | 'TradFi';

const SECTOR_CARD_CATEGORIES: CoinCategory[] = ['LAYER_1', 'DEFI', 'AI', 'RWA'];

const CATEGORY_LABEL_RU: Record<CoinCategory, string> = {
  DEFI: 'DeFi',
  LAYER_1: 'Layer 1',
  MEME: 'Мемы',
  STABLECOIN: 'Стейблкоины',
  AI: 'ИИ',
  GAMING: 'Гейминг',
  RWA: 'RWA',
};

/** Semicircular Fear & Greed dial: a grey track, a red-to-green progress
 * arc filled to the reading, and a marker where it lands — the shape every
 * tracker draws this index in. Replaces the ported archive's trick of a
 * full circle with two coloured borders rotated 45deg and clipped, which
 * read as a broken ring rather than a gauge once the card grew. */
function GaugeArc({ value }: { value: number | null }) {
  const ARC = 'M 20 100 A 80 80 0 0 1 180 100';
  const LENGTH = Math.PI * 80;
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value)) / 100;
  const angle = Math.PI * (1 - pct);
  return (
    <svg className="gauge-arc" viewBox="0 0 200 112" aria-hidden="true">
      <defs>
        <linearGradient id="fear-greed-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f6465d" />
          <stop offset="50%" stopColor="#f7a600" />
          <stop offset="100%" stopColor="#00a870" />
        </linearGradient>
      </defs>
      <path d={ARC} fill="none" stroke="var(--gauge-track)" strokeWidth="12" strokeLinecap="round" />
      <path
        d={ARC}
        fill="none"
        stroke="url(#fear-greed-arc)"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={LENGTH}
        strokeDashoffset={LENGTH * (1 - pct)}
      />
      {value !== null && (
        <circle
          cx={100 + 80 * Math.cos(angle)}
          cy={100 - 80 * Math.sin(angle)}
          r="6.5"
          fill="var(--bg-card-1)"
          stroke={zoneColor(value)}
          strokeWidth="3"
        />
      )}
    </svg>
  );
}

/** The index's own colour bands, same split as its Extreme Fear / Fear /
 * Neutral / Greed / Extreme Greed buckets. */
function zoneColor(value: number): string {
  if (value < 45) return '#f6465d';
  if (value < 55) return '#f7a600';
  return '#00a870';
}

/**
 * Integration of the uploaded Bolt.new Markets archive into the real
 * Voltex app, same approach as copy-trading-bolt: the archive's own
 * placeholder header/theme-picker/trading-placeholder are dropped in favor
 * of this app's real Nav/Footer and real Trade/Futures pages; every stat,
 * filter, sort, and chart the archive rendered from a hand-written seed
 * array is rebuilt here on the live tickers + CoinGecko rankings the old
 * MarketsPage.tsx already fetched — see markets.ts for exactly which
 * figures are real vs (a small few, documented there) honestly dropped
 * rather than faked.
 */
export function MarketsBoltPage() {
  const navigate = useNavigate();
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [rankByBase, setRankByBase] = useState<Map<string, CoinRanking> | null>(null);
  const [globalMarket, setGlobalMarket] = useState<GlobalMarket | null>(null);
  const [fearGreed, setFearGreed] = useState<FearGreedReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<CategoryTab>('Cryptocurrency');
  const [activeKind, setActiveKind] = useState<MarketKind>('Spot');
  const [search, setSearch] = useState('');
  // Shared store — see lib/useFavorites; the terminals and the homepage
  // table read the same set, live.
  const { favorites, toggle: toggleFavorite } = useFavorites();
  // The listed perpetuals, from the backend rather than a copy kept in sync
  // by hand — see CORE_FUTURES_SYMBOLS for why the initial value exists.
  const [futuresSymbols, setFuturesSymbols] = useState<string[]>(CORE_FUTURES_SYMBOLS);

  useEffect(() => {
    let cancelled = false;
    api
      .getFuturesConfig()
      .then((cfg) => {
        if (!cancelled && cfg.symbols.length > 0) setFuturesSymbols(cfg.symbols);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Prices and the market-wide overview both come from the shared
  // market-data store: one poll and one request for the whole tab,
  // replacing this page's separate 5s ticker loop and 60s global loop.
  // Cadence is unchanged (5s) and so is every rendered figure.
  // `stale` is available on this hook for a view that wants to dim a
  // last-good figure; Markets renders it normally today, so it is not
  // destructured here rather than being read and ignored.
  const { tickers: tickerMap, error: tickerError } = useMarketTickers(5000);
  const { overview: sharedOverview, sentiment: sharedSentiment } = useMarketData(5000);

  useEffect(() => {
    if (tickerMap.size > 0) {
      setTickers(Array.from(tickerMap.values()));
      setError(null);
      return;
    }
    // Only surface the error state when nothing has ever loaded — a
    // transient failure must not wipe a table the user is reading.
    if (tickerError) setError('Не удалось загрузить рыночные данные');
  }, [tickerMap, tickerError]);

  useEffect(() => {
    // An unavailable section stays null, so the headline renders a dash
    // rather than a market cap of zero dollars.
    if (sharedOverview) setGlobalMarket(sharedOverview);
    if (sharedSentiment) setFearGreed({ ...sharedSentiment, updatedAt: Date.now() });
  }, [sharedOverview, sharedSentiment]);

  useEffect(() => {
    function load() {
      api
        .getExternalRankings()
        .then((res) => {
          const map = new Map<string, CoinRanking>();
          for (const r of res.rankings) map.set(r.symbol, r as CoinRanking);
          setRankByBase(map);
        })
        .catch(() => {});
    }
    load();
    // 5 minutes, not 10 seconds. This is descriptive catalogue metadata
    // (rank, market cap, 7d/30d change, sparkline) whose server-side cache
    // refreshes hourly — a 10s poll could never see fresher data, it only
    // cost VOLTEX ~30 requests a minute per open Markets tab. The poll
    // remains so a rate-limited first load still recovers on its own.
    const interval = setInterval(load, 5 * 60_000);
    return () => clearInterval(interval);
  }, []);


  function goToTrade(pair: string) {
    if (activeKind === 'Futures' && futuresSymbols.includes(pair)) {
      navigate(`/futures?pair=${encodeURIComponent(pair)}`);
    } else {
      navigate(`/trade?pair=${encodeURIComponent(pair)}`);
    }
  }

  const kindTickers = useMemo(() => {
    if (activeKind === 'CFD') return [];
    if (activeKind === 'Futures') return tickers.filter((tk) => futuresSymbols.includes(tk.pair));
    return tickers;
  }, [tickers, activeKind, futuresSymbols]);

  /** The highlight columns' "view all" links used to drive the removed
   *  pair table's sort state. The catalogue table owns its own sorting,
   *  so they now simply bring it into view. */
  function scrollToCatalogue() {
    document.getElementById('markets-table-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const breadth = useMemo(() => computeBreadth(tickers), [tickers]);
  const volumeSummary = useMemo(() => computeVolumeSummary(tickers), [tickers]);
  const sectorSummaries = useMemo(
    () => (rankByBase ? computeSectorSummaries(rankByBase, SECTOR_CARD_CATEGORIES) : []),
    [rankByBase]
  );

  return (
    <div className="markets-bolt-root">
      {/* Every symbol in the strip links straight into that pair's terminal.
          The strip is fed by api.getExternalTickers — this exchange's spot
          ticker mirror, filtered to /USDT markets (see TopGainersTicker) —
          so every item in it is a spot market by construction and the spot
          route is the correct destination for all of them; nothing here
          guesses a market type from the symbol string. The URL is the
          app's existing deep-link (TradePage reads and validates ?pair=),
          not a second scheme. */}
      <Nav active="/markets" tickerHrefFor={(pair) => `/trade?pair=${encodeURIComponent(pair)}`} />

      <main className="markets-page">
        <div className="page-intro">
          <div>
            <p className="eyebrow">Аналитика рынка</p>
            <h1>Рынки</h1>
            <p className="intro-copy">Следите за пульсом крипторынка и находите новые возможности.</p>
          </div>
          <div className="market-status">
            <span className="status-dot" /> Рынки в реальном времени <span className="status-divider" /> Обновлено только что
          </div>
        </div>

        {error && <div className="markets-error-banner">{error}</div>}

        <section className="overview-grid">
          <article className="overview-card sentiment-card">
            <div className="card-heading"><span>Индекс страха и жадности</span><span className="card-heading-tag">Крипторынок</span></div>
            <div className="sentiment-content">
              <div className="gauge">
                <GaugeArc value={fearGreed ? fearGreed.value : null} />
                <div className="gauge-value" style={fearGreed ? { color: zoneColor(fearGreed.value) } : undefined}>
                  {fearGreed ? fearGreed.value : '—'}
                </div>
                <span style={fearGreed ? { color: zoneColor(fearGreed.value) } : undefined}>
                  {fearGreed ? fearGreedLabelRu(fearGreed.classification) : 'Нет данных'}
                </span>
              </div>
              {/* The distribution sits under the gauge rather than beside
                  it: the state label was previously printed twice (once
                  under the gauge, once here), and stacking lets the gauge
                  itself be the card's focal point. */}
              <div className="sentiment-side">
                <div className="score-label">
                  <span className="muted-label">Настроение рынка</span>
                  <strong style={fearGreed ? { color: zoneColor(fearGreed.value) } : undefined}>
                    {fearGreed ? `${fearGreed.value} · ${fearGreedLabelRu(fearGreed.classification)}` : 'Нет данных'}
                  </strong>
                </div>
                <div className="progress-track"><span style={{ width: `${fearGreed ? fearGreed.value : 0}%` }} /></div>
                <div className="long-short">
                  <span><i className="dot-green" /> Растут <b>{breadth.longPct}%</b></span>
                  <span><i className="dot-red" /> Падают <b>{breadth.shortPct}%</b></span>
                </div>
              </div>
            </div>
          </article>
          <article className="overview-card volume-card">
            <div className="card-heading"><span>Рыночные данные</span><span className="card-heading-tag">24ч</span></div>
            {/* Total Market Cap is the headline figure, matching the
                reference's card hierarchy — both totalMarketCapUsd and its
                own 24h change come from the same real CoinGecko /global
                response as everything else on this card. The reference
                also draws a sparkline under this headline from a
                hand-written array ([40, 38, 42, ...]) with no real
                counterpart in this app; that figure is fabricated for
                visual parity and is deliberately NOT reproduced here. */}
            <div className="metric-primary">
              <span className="muted-label">Общая капитализация</span>
              <strong>{globalMarket ? formatCompactUsd(globalMarket.totalMarketCapUsd) : '—'}</strong>
              <span className={(globalMarket?.marketCapChangePercent24h ?? 0) >= 0 ? 'positive' : 'negative'}>
                {globalMarket?.marketCapChangePercent24h != null
                  ? `${globalMarket.marketCapChangePercent24h >= 0 ? '+' : ''}${globalMarket.marketCapChangePercent24h.toFixed(2)}%`
                  : '—'}{' '}
                <span className="muted-label inline">24ч</span>
              </span>
            </div>
            {/* ETH dominance comes from the same CoinGecko /global response
                that already supplied BTC dominance — the field was simply
                not being read through. */}
            <div className="metric-grid">
              <div>
                <span className="muted-label">Объём торгов</span>
                <b>{globalMarket ? formatCompactUsd(globalMarket.totalVolume24hUsd) : '—'}</b>
              </div>
              <div>
                <span className="muted-label">Доминация BTC</span>
                <b>{globalMarket?.btcDominancePercent != null ? `${globalMarket.btcDominancePercent.toFixed(1)}%` : '—'}</b>
              </div>
              <div>
                <span className="muted-label">Доминация ETH</span>
                <b>{globalMarket?.ethDominancePercent != null ? `${globalMarket.ethDominancePercent.toFixed(1)}%` : '—'}</b>
              </div>
            </div>
          </article>
          <article className="overview-card sectors-card">
            <div className="card-heading"><span>Популярные секторы</span></div>
            {/* Four labelled columns rather than a row of loose values, so
                the card scans like the small analytics table it is. A
                sector with no ranked members yet reports no leader and no
                average — shown as "—" rather than a fabricated 0.00%. */}
            <div className="sector-list">
              <div className="sector-row sector-row-head">
                <span>Сектор</span>
                <span>24ч</span>
                <span>Лидер</span>
                <span>Изм. лидера</span>
              </div>
              {sectorSummaries.length === 0 && <div className="sector-row sector-row-empty">Загрузка данных...</div>}
              {sectorSummaries.map((s) => {
                const hasData = s.leaderSymbol !== null;
                return (
                  <div className="sector-row" key={s.category}>
                    <span>{CATEGORY_LABEL_RU[s.category]}</span>
                    <strong className={!hasData ? 'muted-value' : s.avgChange >= 0 ? 'positive' : 'negative'}>
                      {hasData ? `${s.avgChange >= 0 ? '+' : ''}${s.avgChange.toFixed(2)}%` : '—'}
                    </strong>
                    <em>{s.leaderSymbol ?? '—'}</em>
                    <b className={!hasData ? 'muted-value' : (s.leaderChange ?? 0) >= 0 ? 'positive' : 'negative'}>
                      {hasData ? `${(s.leaderChange ?? 0) >= 0 ? '+' : ''}${(s.leaderChange ?? 0).toFixed(2)}%` : '—'}
                    </b>
                  </div>
                );
              })}
            </div>
          </article>
        </section>

        {/* Market pulse. Deliberately about THIS exchange's own book rather
            than repeating the market-wide cap/volume/dominance figures the
            card above already carries: how many of the pairs listed here
            are up vs down right now, over how many pairs, and the turnover
            across them. All four come straight from the same live tickers
            the table below renders. */}
        <section className="pulse-strip" aria-label="Пульс рынка">
          <div className="pulse-item">
            <span className="muted-label">Растут</span>
            <strong className="positive">{breadth.advancing}</strong>
          </div>
          <div className="pulse-item">
            <span className="muted-label">Падают</span>
            <strong className="negative">{breadth.declining}</strong>
          </div>
          <div className="pulse-item">
            <span className="muted-label">Пар в обзоре</span>
            <strong>{volumeSummary.pairCount}</strong>
          </div>
          <div className="pulse-item">
            <span className="muted-label">Объём по нашим парам</span>
            <strong>{formatCompactUsd(volumeSummary.totalVolume)}</strong>
          </div>
          <div className="pulse-bar" role="presentation">
            <span className="pulse-bar-up" style={{ width: `${breadth.longPct}%` }} />
            <span className="pulse-bar-down" style={{ width: `${breadth.shortPct}%` }} />
          </div>
        </section>

        <section className="market-section">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Обзор рынка</p>
              <h2>Обзор крипторынка</h2>
            </div>
            <label className="search-box">
              <Search size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по рынкам" />
              {search && <button onClick={() => setSearch('')} aria-label="Очистить поиск"><X size={14} /></button>}
            </label>
          </div>

          <div className="tab-row category-tabs">
            {(['Cryptocurrency', 'Favorites', 'TradFi'] as CategoryTab[]).map((category) => (
              <button key={category} className={activeCategory === category ? 'tab-active' : ''} onClick={() => setActiveCategory(category)}>
                {category === 'Cryptocurrency' ? 'Криптовалюта' : category === 'Favorites' ? 'Избранное' : 'TradFi'}
                {category === 'Favorites' && <span className="tab-count">{favorites.size}</span>}
              </button>
            ))}
          </div>
          <div className="tab-row type-tabs">
            {(['Spot', 'Futures', 'CFD'] as MarketKind[]).map((kind) => (
              <button key={kind} className={activeKind === kind ? 'tab-active' : ''} onClick={() => setActiveKind(kind)}>
                {kind === 'Spot' ? 'Спот' : kind === 'Futures' ? 'Фьючерсы' : 'CFD'}
              </button>
            ))}
          </div>

          {activeCategory === 'TradFi' ? (
            <div className="empty-state-panel">
              <strong>TradFi скоро появится</strong>
              <span>Торговля традиционными активами станет доступна в одном из следующих обновлений.</span>
            </div>
          ) : activeKind === 'CFD' ? (
            <CfdMarketsSection />
          ) : (
            <>
              <div className="highlights-grid">
                <HighlightColumn title="Лидеры роста" tickers={topMovers(kindTickers, 4)} rankByBase={rankByBase} onTrade={goToTrade} onViewAll={scrollToCatalogue} />
                <HighlightColumn title="Лидеры падения" tickers={topLosers(kindTickers, 4)} rankByBase={rankByBase} onTrade={goToTrade} onViewAll={scrollToCatalogue} />
                <HighlightColumn title="Популярное" tickers={mostPopular(kindTickers, 4)} rankByBase={rankByBase} onTrade={goToTrade} onViewAll={scrollToCatalogue} />
              </div>

              {/* The primary table is the CATALOGUE, not the pair list.
                  ~750 assets of market-wide reference data, of which only
                  the VOLTEX-tradable ones carry a Trade action — see
                  CatalogueTable, which is where that rule is enforced.

                  Under the Futures tab it is scoped to assets carrying a
                  listed futures contract: a real subset of the tradable
                  set, not an invented category. */}
              <div id="markets-table-anchor" />
              <CatalogueTable
                search={search}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                onTrade={goToTrade}
                restrictToPairs={activeKind === 'Futures' ? futuresSymbols : undefined}
                defaultFilter={activeCategory === 'Favorites' ? 'favorites' : 'all'}
              />
            </>
          )}
        </section>

        <Footer />
      </main>
    </div>
  );
}

function HighlightColumn({
  title,
  tickers,
  rankByBase,
  onTrade,
  onViewAll,
}: {
  title: string;
  tickers: Ticker[];
  rankByBase: Map<string, CoinRanking> | null;
  onTrade: (pair: string) => void;
  onViewAll: () => void;
}) {
  return (
    <article className="highlight-column">
      <div className="highlight-heading">
        <h3>{title}</h3>
        <button onClick={onViewAll}>Все</button>
      </div>
      <div className="highlight-head"><span>Пара</span><span>Цена</span><span>24ч</span></div>
      {tickers.map((tk) => {
        const change = parseChangePercent(tk.changePercent24h, tk.pair);
        const name = rankByBase?.get(baseOf(tk.pair))?.name;
        return (
          <button className="highlight-row" key={`${title}-${tk.pair}`} onClick={() => onTrade(tk.pair)}>
            <span className="pair-cell">
              <CryptoIcon symbol={baseOf(tk.pair)} size={22} />
              <span><strong>{tk.pair}</strong><small>{name ?? baseOf(tk.pair)}</small></span>
            </span>
            <strong className="highlight-price">{formatPrice(parseFloat(tk.lastPrice))}</strong>
            <strong className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</strong>
          </button>
        );
      })}
      {tickers.length === 0 && <p className="highlight-empty">Нет данных</p>}
    </article>
  );
}
