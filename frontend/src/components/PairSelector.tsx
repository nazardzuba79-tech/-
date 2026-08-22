import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { SearchInput } from './SearchInput';
import { CryptoIcon } from './CryptoIcon';
import { SkeletonRow } from './Skeleton';
import { QUOTE_PRIORITY, loadFavorites, saveFavorites, filterAndSortPairs, TickerRow } from '../lib/pairList';

/**
 * Trade-page pair picker — button showing the current pair, opens a
 * searchable dropdown of pairs with logos, live price, and 24h change,
 * plus quote-asset filter chips and starred favorites (Binance/Bybit
 * style). Reuses the Kraken symbol mirror (/market/external/tickers) as
 * the pair list — but trading itself only ever happens on our OWN
 * internal order book for that pair name, not on Kraken. A pair nobody
 * has traded here yet just starts with an empty book.
 */
export function PairSelector({ pair, onChange }: { pair: string; onChange: (pair: string) => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [tickers, setTickers] = useState<TickerRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  // Defaults to USDT (the most-traded quote asset here) rather than "all",
  // so the list opens on liquid, familiar pairs instead of a flat
  // alphabetical dump — "Все" is still one tap away via the chip row.
  const [quoteFilter, setQuoteFilter] = useState<string | null>('USDT');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const containerRef = useRef<HTMLDivElement>(null);

  function loadTickers() {
    setLoadError(false);
    api
      .getExternalTickers()
      .then((res) => setTickers(res.tickers))
      .catch(() => setLoadError(true));
  }

  useEffect(() => {
    if (!open || tickers.length > 0) return;
    loadTickers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tickers.length]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const filtered = filterAndSortPairs(tickers, { search, quoteFilter, favoritesOnly, favorites }).slice(0, 200);

  return (
    <div ref={containerRef} style={styles.container}>
      <button onClick={() => setOpen((o) => !o)} style={styles.button}>
        <CryptoIcon symbol={pair.split('/')[0]} size={18} />
        <span className="mono" style={{ fontWeight: 700 }}>
          {pair}
        </span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div style={styles.dropdown}>
          <SearchInput
            autoFocus
            value={search}
            onChange={setSearch}
            placeholder={t('trade.searchPair')}
            style={styles.search}
          />
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
          <div style={styles.columns}>
            <span>{t('markets.pair')}</span>
            <span style={{ textAlign: 'right' }}>{t('markets.price')}</span>
            <span style={{ textAlign: 'right' }}>{t('markets.change24h')}</span>
          </div>
          <div style={styles.list}>
            {filtered.map((tk) => {
              const change = parseFloat(tk.changePercent24h) * 100;
              const positive = change >= 0;
              return (
                <button
                  key={tk.pair}
                  onClick={() => {
                    onChange(tk.pair);
                    setOpen(false);
                    setSearch('');
                  }}
                  className="row-hover"
                  style={{ ...styles.option, ...(tk.pair === pair ? styles.optionActive : {}) }}
                >
                  <span style={styles.optionLeft}>
                    <span
                      onClick={(e) => toggleFavorite(tk.pair, e)}
                      style={{ color: favorites.has(tk.pair) ? 'var(--accent)' : 'var(--text-tertiary)', fontSize: 13 }}
                    >
                      ★
                    </span>
                    <CryptoIcon symbol={tk.pair.split('/')[0]} size={20} />
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {tk.pair}
                    </span>
                  </span>
                  <span className="mono" style={{ textAlign: 'right' }}>
                    {parseFloat(tk.lastPrice)}
                  </span>
                  <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={{ textAlign: 'right' }}>
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
              Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} columns={[3, 1, 1]} />)}
            {tickers.length > 0 && filtered.length === 0 && <p style={styles.hint}>{t('trade.nothingFound')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { position: 'relative' },
  button: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '7px 10px',
    fontSize: 14,
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    width: 360,
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
    zIndex: 50,
    overflow: 'hidden',
  },
  search: { borderRadius: 0, border: 'none', borderBottom: '1px solid var(--border)', padding: '0 12px' },
  chipsRow: {
    display: 'flex',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    overflowX: 'auto',
  },
  chip: {
    flexShrink: 0,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '4px 12px',
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
    padding: '8px 14px',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    borderBottom: '1px solid var(--border)',
  },
  list: { maxHeight: 340, overflowY: 'auto' },
  option: {
    display: 'grid',
    gridTemplateColumns: '1.6fr 1fr 1fr',
    alignItems: 'center',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: '9px 14px',
    fontSize: 13,
    color: 'var(--text-primary)',
  },
  optionLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  optionActive: { background: 'var(--panel-alt)' },
  hint: { padding: 14, color: 'var(--text-secondary)', fontSize: 12 },
  retryButton: {
    display: 'block',
    width: 'calc(100% - 28px)',
    margin: 16,
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
