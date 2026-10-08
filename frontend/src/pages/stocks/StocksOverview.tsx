import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Minus, RotateCcw, Search, SearchX, SlidersHorizontal, Star, X } from 'lucide-react';
import type { StockCatalogue, StockInstrument, StockRead } from '../../lib/stocks';
import { localeOf, useLanguage, type Key } from '../../lib/i18n';
import { countryName, exchangeName, formatStockPrice, formatStockTime } from './stockFormat';
import {
  ASIA_MARKETS, EMPTY_FILTERS, filterInstruments, filtersFromParams, filtersToParams, hasActiveFilters, newestClose, readLastInstrument,
  sortInstruments, STOCK_TABS, tabInstruments, writeOverviewQuery, type SortKey, type StockFilters, type StockSort,
} from './stockModel';
import { FavoriteStar, StaleNotice, StockChange, StockLogo, ViewSwitch } from './StockParts';
import './stocksOverview.css';

interface Props {
  widgetMode?: boolean;
  catalogue: StockRead<StockCatalogue>;
  favorites: ReadonlySet<string>;
  onToggleFavorite: (id: string) => void;
}

const TAB_LABEL: Record<StockFilters['tab'], Key> = {
  all: 'stocks.all', USA: 'stocks.USA', Russia: 'stocks.Russia', Asia: 'stocks.Asia', index: 'stocks.index', favorites: 'stocks.favorites',
};
const SORTS = ['name-asc', 'name-desc', 'change-desc', 'change-asc'] as const;
const CATALOGUE_ORDER: StockSort = { key: 'catalogue', dir: 'asc' };
const instrumentPath = (item: StockInstrument) => `/stocks/${encodeURIComponent(item.instrumentId)}`;

function sortFromParams(params: URLSearchParams): StockSort {
  const value = params.get('sort');
  if (!SORTS.includes(value as typeof SORTS[number])) return CATALOGUE_ORDER;
  const [key, dir] = value!.split('-') as [SortKey, 'asc' | 'desc'];
  return { key, dir };
}

/** Light catalogue of the same data the panel reads; a row opens that instrument's panel. */
export default function StocksOverview({ catalogue, favorites, onToggleFavorite, widgetMode }: Props) {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const sort = sortFromParams(params);
  const [moreFilters, setMoreFilters] = useState(false);
  const items = catalogue.data?.instruments ?? [];
  const locale = localeOf(lang);

  useEffect(() => { writeOverviewQuery(params.toString()); }, [params]);

  // Built from the address bar, not this render: navigation commits in a
  // transition, so a click followed at once by typing would otherwise start
  // from the previous filters and drop the click.
  const update = (patch: Partial<StockFilters>, nextSort?: (current: StockSort) => StockSort) => {
    const current = new URLSearchParams(window.location.search);
    const next = filtersToParams({ ...filtersFromParams(current), ...patch });
    const order = nextSort ? nextSort(sortFromParams(current)) : sortFromParams(current);
    if (order.key !== 'catalogue') next.set('sort', `${order.key}-${order.dir}`);
    setParams(next, { replace: true });
  };
  const toggleSort = (key: SortKey) => update({}, current => current.key === key
    ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'name' ? 'asc' : 'desc' });

  const options = useMemo(() => {
    const scope = tabInstruments(items, filters, favorites);
    return {
      exchanges: [...new Set(scope.map(item => item.exchange))].sort(),
      currencies: [...new Set(scope.map(item => item.currency))].sort(),
    };
  }, [items, filters.tab, filters.asia, favorites]);
  const shown = useMemo(() => sortInstruments(filterInstruments(items, filters, favorites), sort, locale),
    [items, filters.tab, filters.query, filters.asia, filters.exchange, filters.currency, favorites, sort.key, sort.dir, locale]);
  const indices = useMemo(() => items.filter(item => item.type === 'index'), [items]);
  const last = readLastInstrument();
  const panelTo = last && items.some(item => item.instrumentId === last) ? `/stocks/${encodeURIComponent(last)}` : '/stocks';
  const active = hasActiveFilters(filters);

  const sortIcon = (key: SortKey) => sort.key !== key ? <Minus size={12} aria-hidden="true" className="vxo-sort-idle" />
    : sort.dir === 'asc' ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />;
  const ariaSort = (key: SortKey) => sort.key !== key ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending';

  return (
    <div className="vxo-page">
      <header className="vxo-head">
        <div>
          <h1>{t('stocks.title')}</h1>
          <p>{t(widgetMode ? 'stocks.widgetOnly' : 'stocks.closed')}</p>
        </div>
        <ViewSwitch view="overview" panelTo={panelTo} />
      </header>

      {catalogue.error && !catalogue.data && !catalogue.loading ? <div className="vxo-state" role="status">
        <p><strong>{t(catalogue.failure === 'invalid' ? 'stocks.invalidData' : 'stocks.unavailable')}</strong></p>
        <button type="button" className="vxo-gold" onClick={catalogue.retry}><RotateCcw size={14} aria-hidden="true" />{t('stocks.retry')}</button>
      </div> : <>
        {indices.length > 0 && <section className="vxo-indices" aria-label={t('stocks.index')}>
          <h2>{t('stocks.index')}</h2>
          <div className="vxo-index-row">
            {indices.map(item => (
              <Link key={item.instrumentId} to={instrumentPath(item)} className="vxo-index-card">
                <span className="vxo-index-top"><strong>{item.name}</strong><small>{exchangeName(item.exchange)}</small></span>
                <span className="vxo-index-value">{formatStockPrice(item.latest?.close, item.currency)} <small>{item.currency}</small></span>
                <span className="vxo-index-meta"><StockChange value={item.sessionChange} /><small>{countryName(item.country, lang)}</small></span>
              </Link>
            ))}
          </div>
        </section>}

        <div className="vxo-filters">
          <div className="vxo-tabs" role="group" aria-label={t('stocks.filters')}>
            {STOCK_TABS.map(tab => (
              <button key={tab} type="button" aria-pressed={filters.tab === tab}
                onClick={() => update({ tab, asia: 'all', exchange: 'all', currency: 'all' })}>
                {tab === 'favorites' && <Star size={13} aria-hidden="true" />}{t(TAB_LABEL[tab])}
                {tab === 'favorites' && favorites.size > 0 && <span className="vxo-count">{favorites.size}</span>}
              </button>
            ))}
          </div>
          {filters.tab === 'Asia' && <div className="vxo-subtabs" role="group" aria-label={t('stocks.Asia')}>
            {['all', ...ASIA_MARKETS].map(market => (
              <button key={market} type="button" aria-pressed={filters.asia === market} onClick={() => update({ asia: market, exchange: 'all', currency: 'all' })}>
                {market === 'all' ? t('stocks.allMarkets') : countryName(market, lang)}
              </button>
            ))}
          </div>}
          <div className="vxo-search-row">
            <label className="vxo-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" value={filters.query} placeholder={t('stocks.search')} aria-label={t('stocks.search')}
                onChange={event => update({ query: event.target.value.slice(0, 64) })} />
            </label>
            <button type="button" className="vxo-more" aria-expanded={moreFilters} onClick={() => setMoreFilters(open => !open)}>
              <SlidersHorizontal size={15} aria-hidden="true" />{t('stocks.filters')}
            </button>
            <div className={`vxo-selects${moreFilters ? ' is-open' : ''}`}>
              <label className="vxo-select"><span className="vxo-sr-only">{t('stocks.exchange')}</span>
                <select value={filters.exchange} onChange={event => update({ exchange: event.target.value })}>
                  <option value="all">{t('stocks.exchange')}: {t('stocks.all')}</option>
                  {options.exchanges.map(code => <option key={code} value={code}>{t('stocks.exchange')}: {exchangeName(code)}</option>)}
                </select><ChevronDown size={14} aria-hidden="true" />
              </label>
              <label className="vxo-select"><span className="vxo-sr-only">{t('stocks.currency')}</span>
                <select value={filters.currency} onChange={event => update({ currency: event.target.value })}>
                  <option value="all">{t('stocks.currency')}: {t('stocks.all')}</option>
                  {options.currencies.map(code => <option key={code} value={code}>{t('stocks.currency')}: {code}</option>)}
                </select><ChevronDown size={14} aria-hidden="true" />
              </label>
            </div>
          </div>
          {active && <div className="vxo-active">
            <button type="button" onClick={() => update({ ...EMPTY_FILTERS, tab: filters.tab })}><X size={14} aria-hidden="true" />{t('stocks.resetFilters')}</button>
          </div>}
        </div>

        {catalogue.error && catalogue.data && <StaleNotice failure={catalogue.failure} busy={catalogue.loading} onRetry={catalogue.retry}
          time={formatStockTime(newestClose(catalogue.data.instruments), lang)} />}
        {catalogue.data && <p className="vxo-found">{t('stocks.found', { count: shown.length })}</p>}

        {!catalogue.data ? <div className="vxo-table" aria-busy="true">
          {Array.from({ length: 8 }, (_, n) => <div key={n} className="vxo-row is-skeleton" aria-hidden="true" />)}
        </div> : shown.length ? <div className="vxo-table" role="table" aria-label={t('stocks.title')}>
          <div role="rowgroup" className="vxo-thead">
            <div role="row" className="vxo-row vxo-row-head">
              <span role="columnheader" className="vxo-cell-star"><span className="vxo-sr-only">{t('stocks.favorites')}</span></span>
              <span role="columnheader" aria-sort={ariaSort('name')}><button type="button" onClick={() => toggleSort('name')}>{t('stocks.instrument')}{sortIcon('name')}</button></span>
              <span role="columnheader" className="vxo-num">{t('stocks.price')}</span>
              <span role="columnheader" className="vxo-num" aria-sort={ariaSort('change')}><button type="button" onClick={() => toggleSort('change')}>{t('stocks.change')}{sortIcon('change')}</button></span>
              <span role="columnheader" className="vxo-num vxo-wide">{t('stocks.exchange')}</span>
              <span role="columnheader" className="vxo-num vxo-wide">{t('stocks.time')}</span>
            </div>
          </div>
          <div role="rowgroup">
            {shown.map(item => (
              <div role="row" key={item.instrumentId} className="vxo-row">
                <span role="cell" className="vxo-cell-star"><FavoriteStar instrument={item} active={favorites.has(item.instrumentId)} onToggle={onToggleFavorite} /></span>
                <span role="cell" className="vxo-cell-name">
                  <StockLogo instrument={item} size={34} />
                  <Link to={instrumentPath(item)} className="vxo-row-link"><strong>{item.name}</strong><small>{item.symbol} · {exchangeName(item.exchange)}</small></Link>
                </span>
                <span role="cell" className="vxo-num vxo-price">{formatStockPrice(item.latest?.close, item.currency)} <small>{item.currency}</small></span>
                <span role="cell" className="vxo-num"><StockChange value={item.sessionChange} /></span>
                <span role="cell" className="vxo-num vxo-wide vxo-muted">{item.exchange}</span>
                <span role="cell" className="vxo-num vxo-wide vxo-muted">{formatStockTime(item.latest?.closeTimeUtc, lang, item.exchangeTimeZone)}</span>
              </div>
            ))}
          </div>
        </div> : <div className="vxo-state">
          {filters.tab === 'favorites' && !active ? <><Star size={28} aria-hidden="true" /><p>{t('stocks.favoritesEmpty')}</p></>
            : <><SearchX size={28} aria-hidden="true" /><p><strong>{t('stocks.nothingFound')}</strong></p><p>{t('stocks.nothingFoundHint')}</p>
              {active && <button type="button" className="vxo-plain" onClick={() => update({ ...EMPTY_FILTERS, tab: filters.tab })}><RotateCcw size={14} aria-hidden="true" />{t('stocks.resetFilters')}</button>}</>}
        </div>}
        <p className="vxo-note">{t('stocks.priceNote')}</p>
      </>}
    </div>
  );
}
