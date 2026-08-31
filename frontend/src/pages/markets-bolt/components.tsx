import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Nav } from '../../components/Nav';
import { Footer } from '../../components/Footer';
import { CryptoIcon } from '../../components/CryptoIcon';
import { parseChangePercent } from '../../lib/priceChange';
import { CATEGORIES, type CoinCategory, loadFavorites, saveFavorites } from '../../lib/pairList';
import {
  type Ticker,
  type CoinRanking,
  FUTURES_SYMBOLS,
  formatPrice,
  formatCompactUsd,
  deriveQuoteList,
  computeSentiment,
  computeVolumeSummary,
  computeSectorSummaries,
  topMovers,
  topLosers,
  mostPopular,
  sparklineFor,
  baseOf,
  quoteOf,
} from './markets';
import './MarketsBolt.css';

type SortKey = 'price' | 'change' | 'high' | 'low' | 'volume';
type MarketKind = 'Spot' | 'Futures' | 'Options';
type CategoryTab = 'Cryptocurrency' | 'Favorites' | 'TradFi';

const PER_PAGE = 10;
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

function Sparkline({ points, positive }: { points: number[]; positive: boolean }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = points.length > 1 ? 94 / (points.length - 1) : 0;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${index * step} ${28 - ((point - min) / range) * 23}`).join(' ');
  return (
    <svg className={`sparkline ${positive ? 'sparkline-positive' : 'sparkline-negative'}`} viewBox="0 0 94 30" preserveAspectRatio="none" aria-hidden="true">
      <path className="sparkline-fill" d={`${path} L 94 30 L 0 30 Z`} />
      <path className="sparkline-line" d={path} />
    </svg>
  );
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
  const [error, setError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<CategoryTab>('Cryptocurrency');
  const [activeKind, setActiveKind] = useState<MarketKind>('Spot');
  const [activeQuote, setActiveQuote] = useState('All');
  const [activeSector, setActiveSector] = useState<'All' | 'Favorites' | CoinCategory>('All');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    function refreshTickers() {
      api
        .getExternalTickers()
        .then((res) => {
          setTickers(res.tickers);
          setError(null);
        })
        .catch(() => setError('Не удалось загрузить рыночные данные'));
    }
    refreshTickers();
    const interval = setInterval(refreshTickers, 5000);
    return () => clearInterval(interval);
  }, []);

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
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => setPage(1), [activeCategory, activeKind, activeQuote, activeSector, search]);

  function toggleFavorite(pair: string) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(pair)) next.delete(pair);
      else next.add(pair);
      saveFavorites(next);
      return next;
    });
  }

  function goToTrade(pair: string) {
    if (activeKind === 'Futures' && FUTURES_SYMBOLS.includes(pair)) {
      navigate(`/futures?pair=${encodeURIComponent(pair)}`);
    } else {
      navigate(`/trade?pair=${encodeURIComponent(pair)}`);
    }
  }

  const quotes = useMemo(() => deriveQuoteList(tickers), [tickers]);

  const kindTickers = useMemo(() => {
    if (activeKind === 'Options') return [];
    if (activeKind === 'Futures') return tickers.filter((tk) => FUTURES_SYMBOLS.includes(tk.pair));
    return tickers;
  }, [tickers, activeKind]);

  const filteredMarkets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = kindTickers.filter((tk) => {
      const base = baseOf(tk.pair);
      const name = rankByBase?.get(base)?.name ?? '';
      const matchesSearch = !query || `${tk.pair} ${name}`.toLowerCase().includes(query);
      const matchesQuote = activeQuote === 'All' || quoteOf(tk.pair) === activeQuote;
      const matchesSector =
        activeSector === 'All' ||
        (activeSector === 'Favorites' ? favorites.has(tk.pair) : rankByBase?.get(base)?.categories.includes(activeSector) ?? false);
      const matchesCategory = activeCategory !== 'Favorites' || favorites.has(tk.pair);
      return matchesSearch && matchesQuote && matchesSector && matchesCategory;
    });
    return result.sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'price':
          return (parseFloat(a.lastPrice) - parseFloat(b.lastPrice)) * dir;
        case 'change':
          return (parseChangePercent(a.changePercent24h, a.pair) - parseChangePercent(b.changePercent24h, b.pair)) * dir;
        case 'high':
          return (parseFloat(a.high24h) - parseFloat(b.high24h)) * dir;
        case 'low':
          return (parseFloat(a.low24h) - parseFloat(b.low24h)) * dir;
        default:
          return (parseFloat(a.quoteVolume24h || '0') - parseFloat(b.quoteVolume24h || '0')) * dir;
      }
    });
  }, [kindTickers, search, activeQuote, activeSector, activeCategory, favorites, rankByBase, sortKey, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filteredMarkets.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visibleMarkets = filteredMarkets.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDirection('desc');
    }
  }

  function resetFilters() {
    setSearch('');
    setActiveQuote('All');
    setActiveSector('All');
  }

  function jumpToSort(key: SortKey, dir: 'asc' | 'desc') {
    setSortKey(key);
    setSortDirection(dir);
    document.getElementById('markets-table-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const sentiment = useMemo(() => computeSentiment(tickers), [tickers]);
  const volumeSummary = useMemo(() => computeVolumeSummary(tickers), [tickers]);
  const sectorSummaries = useMemo(
    () => (rankByBase ? computeSectorSummaries(rankByBase, SECTOR_CARD_CATEGORIES) : []),
    [rankByBase]
  );
  const hasActiveFilters = search !== '' || activeQuote !== 'All' || activeSector !== 'All';

  return (
    <div className="markets-bolt-root">
      <Nav active="/markets" />

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
            <div className="card-heading"><span>Настроение рынка</span></div>
            <div className="sentiment-content">
              <div className="gauge">
                <div className="gauge-track" />
                <div className="gauge-value">{sentiment.score}</div>
                <span>{sentiment.label}</span>
              </div>
              <div className="sentiment-side">
                <div className="score-label"><strong>{sentiment.label}</strong></div>
                <div className="progress-track"><span style={{ width: `${sentiment.score}%` }} /></div>
                <div className="long-short">
                  <span><i className="dot-green" /> Растут <b>{sentiment.longPct}%</b></span>
                  <span><i className="dot-red" /> Падают <b>{sentiment.shortPct}%</b></span>
                </div>
              </div>
            </div>
          </article>
          <article className="overview-card volume-card">
            <div className="card-heading"><span>Рыночные данные</span><span className="card-heading-tag">24ч</span></div>
            <div className="metric-line">
              <div>
                <span className="muted-label">Объём торгов (спот)</span>
                <strong>{formatCompactUsd(volumeSummary.totalVolume)}</strong>
              </div>
            </div>
            <div className="volume-footer">
              <span>Торговых пар <b>{volumeSummary.pairCount}</b></span>
              <span>Избранное <b>{favorites.size}</b></span>
            </div>
          </article>
          <article className="overview-card sectors-card">
            <div className="card-heading"><span>Популярные секторы</span></div>
            <div className="sector-list">
              {sectorSummaries.length === 0 && <div className="sector-row sector-row-empty">Загрузка данных...</div>}
              {sectorSummaries.map((s) => (
                <div className="sector-row" key={s.category}>
                  <span>{CATEGORY_LABEL_RU[s.category]}</span>
                  <strong className={s.avgChange >= 0 ? 'positive' : 'negative'}>
                    {s.avgChange >= 0 ? '+' : ''}
                    {s.avgChange.toFixed(2)}%
                  </strong>
                  <em>
                    {s.leaderSymbol ? `${s.leaderSymbol} ${(s.leaderChange ?? 0) >= 0 ? '+' : ''}${(s.leaderChange ?? 0).toFixed(2)}%` : '—'}
                  </em>
                </div>
              ))}
            </div>
          </article>
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
            {(['Spot', 'Futures', 'Options'] as MarketKind[]).map((kind) => (
              <button key={kind} className={activeKind === kind ? 'tab-active' : ''} onClick={() => setActiveKind(kind)}>
                {kind === 'Spot' ? 'Спот' : kind === 'Futures' ? 'Фьючерсы' : 'Опционы'}
              </button>
            ))}
          </div>

          {activeCategory === 'TradFi' ? (
            <div className="empty-state-panel">
              <strong>TradFi скоро появится</strong>
              <span>Торговля традиционными активами станет доступна в одном из следующих обновлений.</span>
            </div>
          ) : activeKind === 'Options' ? (
            <div className="empty-state-panel">
              <strong>Опционы скоро появятся</strong>
              <span>Мы работаем над запуском опционов. Пока доступны спот и фьючерсы.</span>
            </div>
          ) : (
            <>
              <div className="highlights-grid">
                <HighlightColumn title="Лидеры роста" tickers={topMovers(kindTickers, 3)} rankByBase={rankByBase} onTrade={goToTrade} onViewAll={() => jumpToSort('change', 'desc')} />
                <HighlightColumn title="Лидеры падения" tickers={topLosers(kindTickers, 3)} rankByBase={rankByBase} onTrade={goToTrade} onViewAll={() => jumpToSort('change', 'asc')} />
                <HighlightColumn title="Популярное" tickers={mostPopular(kindTickers, 3)} rankByBase={rankByBase} onTrade={goToTrade} onViewAll={() => jumpToSort('volume', 'desc')} />
              </div>

              <div className="filter-bar">
                <div className="filter-group">
                  <span className="filter-label">Валюта</span>
                  <button className={activeQuote === 'All' ? 'filter-active' : ''} onClick={() => setActiveQuote('All')}>Все</button>
                  {quotes.map((quote) => (
                    <button key={quote} className={activeQuote === quote ? 'filter-active' : ''} onClick={() => setActiveQuote(quote)}>{quote}</button>
                  ))}
                </div>
                <div className="filter-group sector-filter">
                  <span className="filter-label">Сектор</span>
                  <button className={activeSector === 'All' ? 'filter-active' : ''} onClick={() => setActiveSector('All')}>Все</button>
                  <button className={activeSector === 'Favorites' ? 'filter-active' : ''} onClick={() => setActiveSector('Favorites')}>
                    <Star size={12} fill="currentColor" /> Избранное
                  </button>
                  {CATEGORIES.map((category) => (
                    <button key={category} className={activeSector === category ? 'filter-active' : ''} onClick={() => setActiveSector(category)}>
                      {CATEGORY_LABEL_RU[category]}
                    </button>
                  ))}
                </div>
                {hasActiveFilters && (
                  <button className="filter-more" onClick={resetFilters}><SlidersHorizontal size={15} /> Сбросить</button>
                )}
              </div>

              <div id="markets-table-anchor" className="table-caption">
                <div>
                  <h3>Все рынки <span>{filteredMarkets.length}</span></h3>
                  <p>Данные приведены в справочных целях и обновляются в реальном времени.</p>
                </div>
                <button className="density-button" onClick={() => setCompact((c) => !c)}>{compact ? 'Обычный вид' : 'Компактный вид'}</button>
              </div>

              <div className={`markets-table-wrap ${compact ? 'markets-table-compact' : ''}`}>
                <table className="markets-table">
                  <thead>
                    <tr>
                      <th>Пара</th>
                      <th><button onClick={() => handleSort('price')} className="sort-button">Цена <SortIcon active={sortKey === 'price'} direction={sortDirection} /></button></th>
                      <th><button onClick={() => handleSort('change')} className="sort-button">24ч изм. <SortIcon active={sortKey === 'change'} direction={sortDirection} /></button></th>
                      <th><button onClick={() => handleSort('high')} className="sort-button">24ч макс. <SortIcon active={sortKey === 'high'} direction={sortDirection} /></button></th>
                      <th><button onClick={() => handleSort('low')} className="sort-button">24ч мин. <SortIcon active={sortKey === 'low'} direction={sortDirection} /></button></th>
                      <th><button onClick={() => handleSort('volume')} className="sort-button">Объём 24ч <SortIcon active={sortKey === 'volume'} direction={sortDirection} /></button></th>
                      <th>График</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tickers.length === 0 && !error ? (
                      <tr><td className="table-state" colSpan={8}><div className="loading-spinner" /> Загрузка рынков</td></tr>
                    ) : visibleMarkets.length === 0 ? (
                      <tr><td className="table-state" colSpan={8}><Search size={20} /><strong>Ничего не найдено</strong><span>Попробуйте изменить поиск или фильтры.</span></td></tr>
                    ) : (
                      visibleMarkets.map((tk) => (
                        <MarketRow
                          key={tk.pair}
                          ticker={tk}
                          ranking={rankByBase?.get(baseOf(tk.pair)) ?? null}
                          favorite={favorites.has(tk.pair)}
                          onFavorite={toggleFavorite}
                          onTrade={goToTrade}
                        />
                      ))
                    )}
                  </tbody>
                </table>
                <div className="mobile-market-list">
                  {visibleMarkets.map((tk) => (
                    <MobileMarketRow
                      key={`mobile-${tk.pair}`}
                      ticker={tk}
                      ranking={rankByBase?.get(baseOf(tk.pair)) ?? null}
                      favorite={favorites.has(tk.pair)}
                      onFavorite={toggleFavorite}
                      onTrade={goToTrade}
                    />
                  ))}
                </div>
              </div>

              <div className="pagination">
                <span className="pagination-info">
                  Показано {filteredMarkets.length ? (currentPage - 1) * PER_PAGE + 1 : 0}–{Math.min(currentPage * PER_PAGE, filteredMarkets.length)} из {filteredMarkets.length}
                </span>
                <div className="page-controls">
                  <button onClick={() => setPage((c) => Math.max(1, c - 1))} disabled={currentPage === 1} aria-label="Предыдущая страница"><ArrowLeft size={15} /></button>
                  {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => i + 1).map((n) => (
                    <button key={n} className={currentPage === n ? 'page-active' : ''} onClick={() => setPage(n)}>{n}</button>
                  ))}
                  {pageCount > 5 && <span>...</span>}
                  <button onClick={() => setPage((c) => Math.min(pageCount, c + 1))} disabled={currentPage === pageCount} aria-label="Следующая страница"><ArrowRight size={15} /></button>
                </div>
              </div>
            </>
          )}
        </section>

        <Footer />
      </main>
    </div>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' }) {
  if (!active) return <ArrowUp size={12} className="sort-muted" />;
  return direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
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

function MarketRow({
  ticker,
  ranking,
  favorite,
  onFavorite,
  onTrade,
}: {
  ticker: Ticker;
  ranking: CoinRanking | null;
  favorite: boolean;
  onFavorite: (pair: string) => void;
  onTrade: (pair: string) => void;
}) {
  const change = parseChangePercent(ticker.changePercent24h, ticker.pair);
  const points = sparklineFor(ranking, parseFloat(ticker.lastPrice));
  return (
    <tr>
      <td>
        <div className="table-pair">
          <button className={`star-button ${favorite ? 'starred' : ''}`} onClick={() => onFavorite(ticker.pair)} aria-label={`${favorite ? 'Убрать из' : 'Добавить в'} избранное ${ticker.pair}`}>
            <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
          </button>
          <CryptoIcon symbol={baseOf(ticker.pair)} size={24} />
          <span><strong>{baseOf(ticker.pair)}<small>/ {quoteOf(ticker.pair)}</small></strong><em>{ranking?.name ?? baseOf(ticker.pair)}</em></span>
        </div>
      </td>
      <td className="numeric strong-number">{formatPrice(parseFloat(ticker.lastPrice))}</td>
      <td className={`numeric ${change >= 0 ? 'positive' : 'negative'}`}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</td>
      <td className="numeric">{formatPrice(parseFloat(ticker.high24h))}</td>
      <td className="numeric">{formatPrice(parseFloat(ticker.low24h))}</td>
      <td className="numeric">{formatPrice(parseFloat(ticker.quoteVolume24h))} <small className="volume-quote">{quoteOf(ticker.pair)}</small></td>
      <td><Sparkline points={points} positive={change >= 0} /></td>
      <td><button className="trade-button" onClick={() => onTrade(ticker.pair)}>Торговать</button></td>
    </tr>
  );
}

function MobileMarketRow({
  ticker,
  ranking,
  favorite,
  onFavorite,
  onTrade,
}: {
  ticker: Ticker;
  ranking: CoinRanking | null;
  favorite: boolean;
  onFavorite: (pair: string) => void;
  onTrade: (pair: string) => void;
}) {
  const change = parseChangePercent(ticker.changePercent24h, ticker.pair);
  const points = sparklineFor(ranking, parseFloat(ticker.lastPrice));
  return (
    <div className="mobile-market-row">
      <div className="mobile-market-main">
        <button className={`star-button ${favorite ? 'starred' : ''}`} onClick={() => onFavorite(ticker.pair)} aria-label="Избранное"><Star size={14} fill={favorite ? 'currentColor' : 'none'} /></button>
        <CryptoIcon symbol={baseOf(ticker.pair)} size={26} />
        <span><strong>{ticker.pair}</strong><small>{ranking?.name ?? baseOf(ticker.pair)}</small></span>
        <span className="mobile-price">
          <strong>{formatPrice(parseFloat(ticker.lastPrice))}</strong>
          <small className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</small>
        </span>
        <button className="trade-button" onClick={() => onTrade(ticker.pair)}>Торг.</button>
      </div>
      <div className="mobile-market-details">
        <span>Макс. <b>{formatPrice(parseFloat(ticker.high24h))}</b></span>
        <span>Мин. <b>{formatPrice(parseFloat(ticker.low24h))}</b></span>
        <span>Объём <b>{formatPrice(parseFloat(ticker.quoteVolume24h))}</b></span>
        <Sparkline points={points} positive={change >= 0} />
      </div>
    </div>
  );
}
