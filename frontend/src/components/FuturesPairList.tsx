import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { SearchInput } from './SearchInput';
import { CryptoIcon } from './CryptoIcon';
import { SkeletonRow } from './Skeleton';
import { PriceCell } from './PriceCell';
import { parseChangePercent } from '../lib/priceChange';

/**
 * Futures' equivalent of the spot page's PairListSidebar — same search box
 * and live price/24h% list, scoped to FUTURES_SYMBOLS (the only markets a
 * real futures position can actually be opened on; see
 * config/futuresConfig.ts on the backend). Kept as its own component rather
 * than reusing PairListSidebar as-is because the quote/category filter
 * chips and favorites star there are meaningless over a 3-symbol list.
 */
export function FuturesPairList({
  symbols,
  symbol,
  onChange,
}: {
  symbols: string[];
  symbol: string;
  onChange: (symbol: string) => void;
}) {
  const { t } = useLanguage();
  const [tickers, setTickers] = useState<Record<string, { lastPrice: string; changePercent24h: string }>>({});
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [sortByChange, setSortByChange] = useState(false);
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  function toggleChangeSort() {
    if (!sortByChange) {
      setSortByChange(true);
      setSortDir(-1);
    } else {
      setSortDir((d) => (d === -1 ? 1 : -1));
    }
  }

  useEffect(() => {
    function load() {
      api
        .getExternalTickers()
        .then((res) => {
          const bySymbol: Record<string, { lastPrice: string; changePercent24h: string }> = {};
          for (const tk of res.tickers) {
            if (symbols.includes(tk.pair)) bySymbol[tk.pair] = tk;
          }
          setTickers(bySymbol);
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    }
    load();
    const poll = window.setInterval(load, 4000);
    return () => window.clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')]);

  const filtered = symbols
    .filter((s) => s.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (!sortByChange) return 0; // keep the caller's original (config) order
      const changeA = tickers[a] ? parseChangePercent(tickers[a].changePercent24h, a) : -Infinity;
      const changeB = tickers[b] ? parseChangePercent(tickers[b].changePercent24h, b) : -Infinity;
      return (changeA - changeB) * sortDir;
    });

  return (
    <div style={styles.panel}>
      <SearchInput value={search} onChange={setSearch} placeholder={t('trade.searchPair')} style={styles.search} />

      <div style={styles.columns}>
        <span>{t('markets.pair')}</span>
        <span style={{ textAlign: 'right' }}>{t('markets.price')}</span>
        <button onClick={toggleChangeSort} style={styles.sortableHeader}>
          {t('markets.change24h')}
          {sortByChange && <span style={{ fontSize: 9 }}>{sortDir === -1 ? '▼' : '▲'}</span>}
        </button>
      </div>

      <div style={styles.list}>
        {filtered.map((s) => {
          const tk = tickers[s];
          const change = tk ? parseChangePercent(tk.changePercent24h, s) : 0;
          const positive = change >= 0;
          return (
            <button
              key={s}
              onClick={() => onChange(s)}
              className="row-hover"
              style={{ ...styles.option, ...(s === symbol ? styles.optionActive : {}) }}
            >
              <span style={styles.optionLeft}>
                <CryptoIcon symbol={s.split('/')[0]} size={18} />
                <span className="mono" style={styles.optionPair}>
                  {s}
                </span>
              </span>
              {tk ? (
                <>
                  <PriceCell value={parseFloat(tk.lastPrice)} className="mono" style={{ textAlign: 'right', fontSize: 12 }} />
                  <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={{ textAlign: 'right', fontSize: 12 }}>
                    {positive ? '+' : ''}
                    {change.toFixed(2)}%
                  </span>
                </>
              ) : (
                <>
                  <span style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-tertiary)' }}>—</span>
                  <span style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-tertiary)' }}>—</span>
                </>
              )}
            </button>
          );
        })}

        {!loaded && Array.from({ length: symbols.length }).map((_, i) => <SkeletonRow key={i} columns={[3, 1, 1]} />)}
        {loaded && filtered.length === 0 && <p style={styles.hint}>{t('trade.nothingFound')}</p>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--panel)' },
  search: { borderRadius: 0, border: 'none', borderBottom: '1px solid var(--border)', padding: '0 12px', flexShrink: 0 },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1.6fr 1fr 1fr',
    padding: '8px 12px',
    fontSize: 10,
    color: 'var(--text-tertiary)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  sortableHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: 10,
    color: 'inherit',
    width: '100%',
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
};
