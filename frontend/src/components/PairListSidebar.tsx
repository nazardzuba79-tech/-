import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, Key } from '../lib/i18n';
import { SearchInput } from './SearchInput';
import { CryptoIcon } from './CryptoIcon';
import { SkeletonRow } from './Skeleton';
import { PriceCell } from './PriceCell';
import {
  QUOTE_PRIORITY,
  CATEGORIES,
  CoinCategory,
  CoinRanking,
  loadFavorites,
  saveFavorites,
  filterAndSortPairs,
  TickerRow,
} from '../lib/pairList';
import { parseChangePercent } from '../lib/priceChange';

const CATEGORY_LABEL_KEY: Record<CoinCategory, Key> = {
  DEFI: 'markets.category.defi',
  LAYER_1: 'markets.category.layer1',
  MEME: 'markets.category.meme',
  STABLECOIN: 'markets.category.stablecoin',
};

/**
 * Persistent pair list docked to the left of the trade-page chart —
 * Binance/Bybit-style, always visible rather than a dropdown you have to
 * open. This is the only pair picker on the trade page (the nav used to
 * also have a dropdown pair selector, but it was redundant with this).
 */
export function PairListSidebar({ pair, onChange }: { pair: string; onChange: (pair: string) => void }) {
  const { t } = useLanguage();
  const [tickers, setTickers] = useState<TickerRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [quoteFilter, setQuoteFilter] = useState<string | null>('USDT');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [categoryFilter, setCategoryFilter] = useState<CoinCategory | null>(null);
  const [rankByBase, setRankByBase] = useState<Map<string, CoinRanking> | null>(null);

  function loadTickers() {
    setLoadError(false);
    api
      .getExternalTickers()
      .then((res) => setTickers(res.tickers))
      .catch(() => setLoadError(true));
  }

  useEffect(() => {
    loadTickers();
    const poll = window.setInterval(loadTickers, 4000);
    return () => window.clearInterval(poll);
  }, []);

  // Market-cap rank + category tags — a separate, slower-changing fetch
  // from the live ticker poll above. Backend caches this for 5 minutes, so
  // polling here is cheap; the real reason to poll rather than fetch once
  // is resilience — a single failed attempt (CoinGecko rate-limited right
  // as our cache expired, a cold-start blip) used to leave the category
  // chips permanently disabled for the rest of the session with nothing to
  // retry it. A transient failure now just keeps the previous map (or
  // null, before the first success) until the next tick succeeds.
  useEffect(() => {
    function loadRankings() {
      api
        .getExternalRankings()
        .then((res) => {
          const map = new Map<string, CoinRanking>();
          for (const r of res.rankings) map.set(r.symbol, r as CoinRanking);
          setRankByBase(map);
        })
        .catch(() => {});
    }
    loadRankings();
    const poll = window.setInterval(loadRankings, 60_000);
    return () => window.clearInterval(poll);
  }, []);

  const quoteChips = useMemo(() => {
    const present = new Set(tickers.map((tk) => tk.pair.split('/')[1]));
    return QUOTE_PRIORITY.filter((q) => present.has(q));
  }, [tickers]);

  function toggleFavorite(p: string, e: React.MouseEvent) {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      saveFavorites(next);
      return next;
    });
  }

  const filtered = filterAndSortPairs(tickers, {
    search,
    quoteFilter,
    favoritesOnly,
    favorites,
    categoryFilter,
    rankByBase: rankByBase ?? undefined,
    sortByRank: categoryFilter !== null,
  });

  return (
    <div style={styles.panel}>
      <SearchInput value={search} onChange={setSearch} placeholder={t('trade.searchPair')} style={styles.search} />

      <div style={styles.chipsRow}>
        <button
          onClick={() => setFavoritesOnly((v) => !v)}
          className="row-hover"
          style={{ ...styles.chip, ...(favoritesOnly ? styles.chipActive : {}) }}
        >
          ★
        </button>
        <button
          onClick={() => setQuoteFilter(null)}
          className="row-hover"
          style={{ ...styles.chip, ...(quoteFilter === null ? styles.chipActive : {}) }}
        >
          {t('trade.allPairs')}
        </button>
        {quoteChips.map((q) => (
          <button
            key={q}
            onClick={() => setQuoteFilter(q)}
            className="row-hover"
            style={{ ...styles.chip, ...(quoteFilter === q ? styles.chipActive : {}) }}
          >
            {q}
          </button>
        ))}
      </div>

      <div style={styles.chipsRow}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            disabled={!rankByBase}
            onClick={() => setCategoryFilter((prev) => (prev === c ? null : c))}
            className="row-hover"
            style={{
              ...styles.chip,
              ...(categoryFilter === c ? styles.chipActive : {}),
              opacity: rankByBase ? 1 : 0.5,
            }}
            title={!rankByBase ? t('markets.rankingsUnavailable') : undefined}
          >
            {t(CATEGORY_LABEL_KEY[c])}
          </button>
        ))}
      </div>

      <div style={styles.columns}>
        <span>{t('markets.pair')}</span>
        <span style={{ textAlign: 'right' }}>{t('markets.price')}</span>
        <span style={{ textAlign: 'right' }}>{t('markets.change24h')}</span>
      </div>

      <div style={styles.list}>
        {filtered.map((tk) => {
          const change = parseChangePercent(tk.changePercent24h, tk.pair);
          const positive = change >= 0;
          return (
            <button
              key={tk.pair}
              onClick={() => onChange(tk.pair)}
              className="row-hover"
              style={{ ...styles.option, ...(tk.pair === pair ? styles.optionActive : {}) }}
            >
              <span style={styles.optionLeft}>
                <span
                  onClick={(e) => toggleFavorite(tk.pair, e)}
                  style={{ color: favorites.has(tk.pair) ? 'var(--accent)' : 'var(--text-tertiary)', fontSize: 12 }}
                >
                  ★
                </span>
                <CryptoIcon symbol={tk.pair.split('/')[0]} size={18} />
                <span className="mono" style={styles.optionPair}>
                  {tk.pair}
                </span>
              </span>
              <PriceCell value={parseFloat(tk.lastPrice)} className="mono" style={{ textAlign: 'right', fontSize: 12 }} />

              <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={{ textAlign: 'right', fontSize: 12 }}>
                {positive ? '+' : ''}
                {change.toFixed(2)}%
              </span>
            </button>
          );
        })}

        {tickers.length === 0 && loadError && (
          <button onClick={loadTickers} style={styles.retryButton}>
            {t('trade.loadPairsError')}
          </button>
        )}
        {tickers.length === 0 &&
          !loadError &&
          Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} columns={[3, 1, 1]} />)}
        {tickers.length > 0 && filtered.length === 0 && <p style={styles.hint}>{t('trade.nothingFound')}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    background: 'var(--panel)',
  },
  search: { borderRadius: 0, border: 'none', borderBottom: '1px solid var(--border)', padding: '0 12px', flexShrink: 0 },
  chipsRow: {
    display: 'flex',
    gap: 6,
    padding: '10px 10px',
    borderBottom: '1px solid var(--border)',
    overflowX: 'auto',
    flexShrink: 0,
  },
  chip: {
    flexShrink: 0,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-secondary)',
  },
  chipActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: 'var(--on-accent)',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1.6fr 1fr 1fr',
    padding: '8px 12px',
    fontSize: 10,
    color: 'var(--text-tertiary)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  list: { flex: 1, overflowY: 'auto', minHeight: 0 },
  option: {
    display: 'grid',
    gridTemplateColumns: '1.6fr 1fr 1fr',
    alignItems: 'center',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: '8px 12px',
    color: 'var(--text-primary)',
  },
  optionLeft: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  optionPair: { fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  optionActive: { background: 'var(--panel-alt)' },
  hint: { padding: 14, color: 'var(--text-secondary)', fontSize: 12 },
  retryButton: {
    display: 'block',
    width: 'calc(100% - 24px)',
    margin: 12,
    padding: '10px 12px',
    background: 'var(--sell-dim)',
    color: 'var(--sell)',
    border: '1px solid var(--sell)',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    textAlign: 'center',
  },
};
