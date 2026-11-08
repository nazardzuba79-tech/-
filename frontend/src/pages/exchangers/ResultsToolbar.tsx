import { ChevronDown, Search, X } from 'lucide-react';
import { SORT_OPTIONS, isSortKey, type OfferFilters, type SortKey } from './model';

const FILTER_TOGGLES: { key: Exclude<keyof OfferFilters, 'search'>; label: string; hint: string }[] = [
  { key: 'fitsAmount', label: 'Подходит под сумму', hint: 'Только если лимиты и резерв обменника подтверждены для этой суммы' },
  { key: 'withReviews', label: 'Есть отзывы', hint: 'Только обменники с отзывами на BestChange' },
  {
    key: 'noManualCheck',
    label: 'Без ручной проверки и верификации',
    hint: 'По отметкам BestChange. Обменник может запросить проверку и без отметки',
  },
];

interface Props {
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
  filters: OfferFilters;
  onFiltersChange: (filters: OfferFilters) => void;
}

/** Search, sort and filter row (v0 results-toolbar) with native controls. */
export function ResultsToolbar({ sort, onSortChange, filters, onFiltersChange }: Props) {
  return (
    <div className="vx-ex-card vx-ex-toolbar">
      <div className="vx-ex-toolbar-row">
        <div className="vx-ex-search">
          <label htmlFor="vx-ex-search" className="vx-ex-sr">Поиск по названию обменника</label>
          <Search size={16} aria-hidden="true" className="vx-ex-search-icon" />
          <input
            id="vx-ex-search"
            type="search"
            value={filters.search}
            maxLength={80}
            placeholder="Поиск по названию"
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          />
          {filters.search && (
            <button type="button" className="vx-ex-search-clear" aria-label="Очистить поиск" onClick={() => onFiltersChange({ ...filters, search: '' })}>
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="vx-ex-sort">
          <label htmlFor="vx-ex-sort">Сортировка</label>
          <div className="vx-ex-select">
            <select id="vx-ex-sort" value={sort} onChange={(e) => isSortKey(e.target.value) && onSortChange(e.target.value)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" className="vx-ex-select-chevron" />
          </div>
        </div>
      </div>
      <div className="vx-ex-filters" role="group" aria-label="Фильтры">
        {FILTER_TOGGLES.map(({ key, label, hint }) => (
          <button
            key={key}
            type="button"
            aria-pressed={filters[key]}
            title={hint}
            className={filters[key] ? 'is-on' : undefined}
            onClick={() => onFiltersChange({ ...filters, [key]: !filters[key] })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
