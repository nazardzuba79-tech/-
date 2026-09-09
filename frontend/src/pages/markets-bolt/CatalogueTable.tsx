import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Star } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { CryptoIcon } from '../../components/CryptoIcon';
import {
  defaultTradingPair,
  filterAndSortAssets,
  useCatalogue,
  type CatalogueSortKey,
} from '../../lib/catalogueStore';
import type { CanonicalAsset } from '../../lib/api';
import './CatalogueTable.css';

/**
 * The crypto catalogue table — VOLTEX's full market browser.
 *
 * ── The one rule this component exists to enforce ────────────────────
 *
 * The catalogue is ~750 assets of market-wide reference data. The VOLTEX
 * tradable set is a few dozen pairs. A row is only ever offered a Trade
 * action when `asset.tradable` is true AND `defaultTradingPair` resolves
 * to a real listed pair; everything else is explicitly labelled "data
 * only". No pair is ever constructed by appending "/USDT" to a ticker —
 * that would link to a market that may not exist.
 *
 * ── Performance ──────────────────────────────────────────────────────
 *
 * The whole catalogue arrives in ONE request (see lib/catalogueStore) and
 * every interaction after that — search, sort, filter, paging — is a pure
 * function over memory. So:
 *
 *   - typing in the search box issues no request,
 *   - sorting issues no request,
 *   - there is no per-row request, timer or subscription,
 *   - and only one page of rows (50) is ever mounted, so 750 assets do not
 *     become 750 live components.
 *
 * ── Honesty ──────────────────────────────────────────────────────────
 *
 * Prices here are MARKET-WIDE (CoinGecko), which the source line states.
 * They are not VOLTEX execution prices — those live in the terminals. A
 * figure the provider did not report is `null` and renders as a dash; a
 * genuine zero renders as zero.
 */

const PER_PAGE = 50;
const DASH = '—';

export type TradableFilter = 'all' | 'tradable' | 'favorites';

interface Column {
  key: CatalogueSortKey;
  labelKey: 'catalogue.asset' | 'catalogue.name' | 'markets.price' | 'markets.change24h' | 'catalogue.marketCap' | 'markets.volume24h';
  numeric: boolean;
  /** Hidden below this viewport width, so mobile keeps the fields that
   *  matter rather than squeezing six desktop columns into 390px. */
  hideBelow?: 'md' | 'lg';
}

const COLUMNS: Column[] = [
  { key: 'symbol', labelKey: 'catalogue.asset', numeric: false },
  { key: 'name', labelKey: 'catalogue.name', numeric: false, hideBelow: 'lg' },
  { key: 'price', labelKey: 'markets.price', numeric: true },
  { key: 'change24h', labelKey: 'markets.change24h', numeric: true },
  { key: 'marketCap', labelKey: 'catalogue.marketCap', numeric: true, hideBelow: 'md' },
  { key: 'volume24h', labelKey: 'markets.volume24h', numeric: true, hideBelow: 'md' },
];

/** Compact USD. `null` in, `null` out — never "$0". */
function usd(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

/** A price with enough precision that a small real number does not round
 *  away to "0.00". */
function price(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function changePct(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function ageLabel(fetchedAt: number, t: (k: any) => string): string {
  const seconds = Math.max(0, Math.round((Date.now() - fetchedAt) / 1000));
  if (seconds < 90) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

export function CatalogueTable({
  search,
  favorites,
  onToggleFavorite,
  onTrade,
  /** When set, the table is scoped to assets carrying one of these VOLTEX
   *  markets — used by the Futures tab, which is a real subset of the
   *  tradable set rather than an invented category. */
  restrictToPairs,
  /** Which slice the table opens on. The page's own category tabs drive
   *  this (its "Favorites" tab opens the favorites slice); the chips below
   *  stay usable afterwards, so this selects a starting point rather than
   *  locking the filter. */
  defaultFilter = 'all',
}: {
  search: string;
  favorites: Set<string>;
  onToggleFavorite: (pair: string) => void;
  onTrade: (pair: string) => void;
  restrictToPairs?: string[];
  defaultFilter?: TradableFilter;
}) {
  const { t } = useLanguage();
  const { assets, catalogueTotal, tradableCount, status, loaded, meta, metadataComplete, refresh } = useCatalogue();

  const [filter, setFilter] = useState<TradableFilter>(defaultFilter);
  const [sort, setSort] = useState<CatalogueSortKey>('rank');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // Any change to what is being shown returns to page 1 — otherwise a
  // narrower filter can leave the view stranded on a page that no longer
  // exists.
  useEffect(() => setPage(1), [search, filter, sort, direction, restrictToPairs?.join(',')]);

  // Follow the page's category tabs when they move.
  useEffect(() => setFilter(defaultFilter), [defaultFilter]);

  const scoped = useMemo(() => {
    if (!restrictToPairs) return assets;
    const allowed = new Set(restrictToPairs);
    return assets.filter((a) => a.tradingPairs.some((p) => allowed.has(p)));
  }, [assets, restrictToPairs]);

  const rows = useMemo(
    () =>
      filterAndSortAssets(scoped, {
        search,
        tradableOnly: filter === 'tradable',
        favoritesOnly: filter === 'favorites',
        favorites,
        sort,
        direction,
      }),
    [scoped, search, filter, favorites, sort, direction]
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  // Only these are mounted — 50 rows, never 750.
  const visible = rows.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  function toggleSort(key: CatalogueSortKey) {
    if (sort === key) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSort(key);
    // Text sorts read best A-Z; figures read best largest-first.
    setDirection(key === 'symbol' || key === 'name' ? 'asc' : 'desc');
  }

  if (!loaded) {
    return (
      <div className="vx-cat-state" role="status">
        <span className="vx-cat-spinner" aria-hidden />
        {t('catalogue.loading')}
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <div className="vx-cat-state is-error" role="status">
        <strong>{t('catalogue.unavailable')}</strong>
        <span>{t('catalogue.unavailableHint')}</span>
        <button type="button" className="vx-cat-retry" onClick={refresh}>
          {t('catalogue.retry')}
        </button>
      </div>
    );
  }

  return (
    <section className="vx-catalogue" aria-label={t('catalogue.title')}>
      <header className="vx-cat-head">
        <div>
          <h3>
            {t('catalogue.title')} <span className="vx-cat-count">{catalogueTotal}</span>
          </h3>
          <p>{t('catalogue.subtitle')}</p>
        </div>

        <div className="vx-cat-filters" role="group" aria-label={t('catalogue.title')}>
          <button type="button" aria-pressed={filter === 'all'} className={filter === 'all' ? 'is-active' : undefined} onClick={() => setFilter('all')}>
            {t('catalogue.filterAll')}
          </button>
          <button type="button" aria-pressed={filter === 'tradable'} className={filter === 'tradable' ? 'is-active' : undefined} onClick={() => setFilter('tradable')}>
            {t('catalogue.filterTradable')} <span className="vx-cat-badge-count">{tradableCount}</span>
          </button>
          <button type="button" aria-pressed={filter === 'favorites'} className={filter === 'favorites' ? 'is-active' : undefined} onClick={() => setFilter('favorites')}>
            <Star size={12} fill={filter === 'favorites' ? 'currentColor' : 'none'} /> {t('catalogue.filterFavorites')}
          </button>
        </div>
      </header>

      {/* One compact freshness line for the whole table. It says HOW OLD
          the data is and nothing about where it came from — the payload's
          `source` is still there for logs and admin diagnostics. */}
      {meta ? (
        <p className={`vx-cat-source${meta.stale ? ' is-stale' : ''}`}>
          <span className="vx-cat-dot" aria-hidden />
          {t('catalogue.sourceLine')} ·{' '}
          {meta.stale ? t('catalogue.stale') : ageLabel(meta.fetchedAt, t)}
          {!metadataComplete ? <span className="vx-cat-partial"> · {t('catalogue.partial')}</span> : null}
          {status === 'error' ? <span className="vx-cat-partial"> · {t('markets.loadError')}</span> : null}
        </p>
      ) : null}

      <div className="vx-cat-scroll">
        <table className="vx-cat-table">
          <thead>
            <tr>
              <th className="vx-cat-star" scope="col" />
              <th className="vx-cat-rank" scope="col">
                {t('markets.rank')}
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={[col.numeric ? 'vx-cat-num' : '', col.hideBelow ? `vx-cat-hide-${col.hideBelow}` : ''].filter(Boolean).join(' ')}
                >
                  <button type="button" onClick={() => toggleSort(col.key)} aria-label={t(col.labelKey)}>
                    {t(col.labelKey)}
                    <SortIcon active={sort === col.key} direction={direction} />
                  </button>
                </th>
              ))}
              <th className="vx-cat-action" scope="col" />
            </tr>
          </thead>
          <tbody>
            {visible.map((asset) => (
              <CatalogueRow
                key={asset.id}
                asset={asset}
                favorites={favorites}
                onToggleFavorite={onToggleFavorite}
                onTrade={onTrade}
              />
            ))}
          </tbody>
        </table>

        {rows.length === 0 ? (
          <div className="vx-cat-state" role="status">
            <strong>{filter === 'tradable' ? t('catalogue.noTradable') : t('catalogue.noResults')}</strong>
            <span>{t('catalogue.noResultsHint')}</span>
          </div>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="vx-cat-pagination">
          <span className="vx-cat-showing">
            {t('catalogue.showing')} {(currentPage - 1) * PER_PAGE + 1}–{Math.min(currentPage * PER_PAGE, rows.length)}{' '}
            {t('catalogue.of')} {rows.length}
            {rows.length !== catalogueTotal ? <span className="vx-cat-subset"> / {catalogueTotal}</span> : null}
          </span>
          <div className="vx-cat-pages">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} aria-label={t('catalogue.prevPage')}>
              <ArrowLeft size={14} />
            </button>
            {pageWindow(currentPage, pageCount).map((n) => (
              <button key={n} type="button" className={n === currentPage ? 'is-active' : undefined} onClick={() => setPage(n)}>
                {n}
              </button>
            ))}
            <button type="button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={currentPage === pageCount} aria-label={t('catalogue.nextPage')}>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** A sliding window of page numbers, so 15 pages do not render 15 buttons. */
function pageWindow(current: number, total: number): number[] {
  const size = Math.min(5, total);
  let start = Math.max(1, current - 2);
  if (start + size - 1 > total) start = Math.max(1, total - size + 1);
  return Array.from({ length: size }, (_, i) => start + i);
}

function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' }) {
  if (!active) return <ArrowUp size={11} className="vx-cat-sort-muted" />;
  return direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
}

function CatalogueRow({
  asset,
  favorites,
  onToggleFavorite,
  onTrade,
}: {
  asset: CanonicalAsset;
  favorites: Set<string>;
  onToggleFavorite: (pair: string) => void;
  onTrade: (pair: string) => void;
}) {
  const { t } = useLanguage();
  // The single gate on the Trade action. `tradable` alone is not enough:
  // the pair has to actually resolve, and it resolves only from the
  // asset's REAL listed pairs.
  const pair = asset.tradable ? defaultTradingPair(asset) : null;
  // Favourites are keyed by PAIR across this app — the spot pair list, the
  // futures pair list and the homepage table all star "BTC/USDT" in one
  // shared localStorage set. Starring a bare ticker here would write a key
  // none of them recognise, so the catalogue stars the asset's default
  // market and shows no star for an asset that has none to star.
  const starred = pair !== null && favorites.has(pair);

  const change = asset.market?.changePercent24h ?? null;
  const changeText = changePct(change);

  return (
    <tr className={asset.tradable ? 'is-tradable' : undefined}>
      <td className="vx-cat-star">
        {pair ? (
          <button
            type="button"
            aria-pressed={starred}
            aria-label={pair}
            className={starred ? 'is-starred' : undefined}
            onClick={() => onToggleFavorite(pair)}
          >
            <Star size={13} fill={starred ? 'currentColor' : 'none'} />
          </button>
        ) : null}
      </td>
      <td className="vx-cat-rank">{asset.rank ?? DASH}</td>
      <td>
        <span className="vx-cat-asset">
          {/* Logo comes from the batched registry metadata inside
              CryptoIcon — never one request per row. */}
          <CryptoIcon symbol={asset.symbol} size={22} imageUrl={asset.logoUrl} />
          <span className="vx-cat-symbol">
            {asset.symbol}
            {asset.ambiguous ? (
              <abbr className="vx-cat-ambiguous" title={t('catalogue.ambiguous')}>
                *
              </abbr>
            ) : null}
          </span>
          <span className="vx-cat-name-inline">{asset.name}</span>
        </span>
      </td>
      <td className="vx-cat-hide-lg">{asset.name}</td>
      <td className="vx-cat-num">{price(asset.market?.priceUsd) ?? DASH}</td>
      <td className={`vx-cat-num ${changeText === null ? '' : change! >= 0 ? 'is-up' : 'is-down'}`}>
        {changeText ?? DASH}
      </td>
      <td className="vx-cat-num vx-cat-hide-md">{usd(asset.market?.marketCapUsd) ?? DASH}</td>
      <td className="vx-cat-num vx-cat-hide-md">{usd(asset.market?.volume24hUsd) ?? DASH}</td>
      <td className="vx-cat-action">
        {pair ? (
          <button type="button" className="vx-cat-trade" onClick={() => onTrade(pair)}>
            {t('catalogue.trade')}
          </button>
        ) : (
          // Not a disabled button: there is no market here, and a greyed
          // Trade control would imply there might be one.
          <span className="vx-cat-dataonly">{t('catalogue.dataOnly')}</span>
        )}
      </td>
    </tr>
  );
}
