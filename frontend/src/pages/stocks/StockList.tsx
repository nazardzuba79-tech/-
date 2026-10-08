import { useEffect, useMemo, useRef, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, Search, Star } from 'lucide-react';
import type { StockInstrument } from '../../lib/stocks';
import { useLanguage, type Key } from '../../lib/i18n';
import { formatStockPrice } from './stockFormat';
import { EMPTY_FILTERS, filterInstruments, STOCK_TABS, type StockFilters } from './stockModel';
import { FavoriteStar, StockChange, StockLogo } from './StockParts';

export type ListFilter = Pick<StockFilters, 'tab' | 'query'>;

interface Props {
  items: readonly StockInstrument[];
  status: 'loading' | 'ready' | 'error';
  onRetry: () => void;
  selectedId?: string;
  favorites: ReadonlySet<string>;
  onToggleFavorite: (id: string) => void;
  filter: ListFilter;
  onFilter: (filter: ListFilter) => void;
  onPick?: () => void;
  searchRef?: Ref<HTMLInputElement>;
}

const TAB_LABEL: Record<StockFilters['tab'], Key> = {
  all: 'stocks.all', USA: 'stocks.USA', Russia: 'stocks.Russia', Asia: 'stocks.Asia', index: 'stocks.index', favorites: 'stocks.favorites',
};

/** The panel's compact list: logo, ticker, last available price and change. No charts per row. */
export function StockList({ items, status, onRetry, selectedId, favorites, onToggleFavorite, filter, onFilter, onPick, searchRef }: Props) {
  const { t } = useLanguage();
  const scroller = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => filterInstruments(items, { ...EMPTY_FILTERS, ...filter }, favorites), [items, filter, favorites]);

  // Keep the open instrument visible in the list without scrolling the page.
  useEffect(() => {
    const box = scroller.current, row = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !row) return;
    if (row.offsetTop < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2);
    }
  }, [selectedId, status]);

  return (
    <div className="vxs-list">
      <label className="vxs-search">
        <Search size={14} aria-hidden="true" />
        <input ref={searchRef} type="search" value={filter.query} placeholder={t('stocks.search')} aria-label={t('stocks.search')}
          onChange={event => onFilter({ ...filter, query: event.target.value.slice(0, 64) })} />
      </label>
      <div className="vxs-tabs" role="group" aria-label={t('stocks.filters')}>
        {STOCK_TABS.map(tab => (
          <button key={tab} type="button" aria-pressed={filter.tab === tab} onClick={() => onFilter({ ...filter, tab })}
            aria-label={tab === 'favorites' ? t(TAB_LABEL[tab]) : undefined} title={tab === 'favorites' ? t(TAB_LABEL[tab]) : undefined}>
            {tab === 'favorites' ? <Star size={13} aria-hidden="true" /> : t(TAB_LABEL[tab])}
            {tab === 'favorites' && favorites.size > 0 ? <span className="vxs-count" aria-hidden="true">{favorites.size}</span> : null}
          </button>
        ))}
      </div>
      <div className="vxs-list-columns" aria-hidden="true"><span>{t('stocks.instrument')}</span><span>{t('stocks.price')} / {t('stocks.change')}</span></div>
      <div className="vxs-list-rows" ref={scroller}>
        {status === 'error' && !items.length ? <div className="vxs-list-state" role="status">
          <p>{t('stocks.unavailable')}</p>
          <button type="button" className="vxs-retry" onClick={onRetry}><RotateCcw size={14} aria-hidden="true" />{t('stocks.retry')}</button>
        </div> : status === 'loading' && !items.length ? Array.from({ length: 10 }, (_, n) => <div key={n} className="vxs-row is-skeleton" aria-hidden="true" />)
        : shown.length ? <ul>
          {shown.map(item => {
            const active = item.instrumentId === selectedId;
            return (
              <li key={item.instrumentId} className={`vxs-row${active ? ' is-active' : ''}`}>
                <FavoriteStar instrument={item} active={favorites.has(item.instrumentId)} onToggle={onToggleFavorite} size={14} />
                <Link to={`/stocks/${encodeURIComponent(item.instrumentId)}`} aria-current={active ? 'page' : undefined} onClick={onPick}>
                  <StockLogo instrument={item} size={24} />
                  <span className="vxs-row-id"><strong>{item.symbol}</strong><small>{item.name}</small></span>
                  <span className="vxs-row-quote">
                    <span className="vxs-row-price">{formatStockPrice(item.latest?.close, item.currency)} <small>{item.currency}</small></span>
                    <StockChange value={item.sessionChange} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul> : <p className="vxs-list-state">{t(filter.tab === 'favorites' && !filter.query ? 'stocks.favoritesEmpty' : 'stocks.nothingFound')}</p>}
      </div>
    </div>
  );
}
