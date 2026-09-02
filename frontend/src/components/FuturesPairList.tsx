import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, Key } from '../lib/i18n';
import { CryptoIcon } from './CryptoIcon';
import { parseChangePercent } from '../lib/priceChange';
import { formatPrice } from '../lib/formatNumber';

interface Row {
  symbol: string;
  lastPrice: number;
  change: number;
  quoteVolume24h: number;
}

type SortField = 'volume' | 'price' | 'change' | 'symbol';

// Same seven modes and the same volume-descending default the spot pair
// list uses, so the two panels sort identically. Open interest is not among
// them: nothing in this exchange records it (see FuturesTickerBar's note),
// and a sort key with no data behind it would just be a dead control.
const SORT_MODES: { id: string; field: SortField; dir: 1 | -1; labelKey: Key }[] = [
  { id: 'volume_desc', field: 'volume', dir: -1, labelKey: 'trade.sortVolumeDesc' },
  { id: 'volume_asc', field: 'volume', dir: 1, labelKey: 'trade.sortVolumeAsc' },
  { id: 'change_desc', field: 'change', dir: -1, labelKey: 'trade.sortChangeDesc' },
  { id: 'change_asc', field: 'change', dir: 1, labelKey: 'trade.sortChangeAsc' },
  { id: 'price_desc', field: 'price', dir: -1, labelKey: 'trade.sortPriceDesc' },
  { id: 'price_asc', field: 'price', dir: 1, labelKey: 'trade.sortPriceAsc' },
  { id: 'symbol_asc', field: 'symbol', dir: 1, labelKey: 'trade.sortSymbolAsc' },
];

/**
 * The futures market list, on the spot terminal's own `.pair-row` grid so
 * both panels read as one system: star slot, logo, symbol, price, 24h %,
 * with the two numeric columns at fixed widths and tabular figures so live
 * updates cannot move them.
 *
 * Scoped to FUTURES_SYMBOLS — the only markets a position can actually be
 * opened on (config/futuresConfig.ts on the backend rejects anything else).
 * Prices and 24h figures come from the same live ticker feed the rest of
 * the app uses; nothing is ordered by a hardcoded list.
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
  const [tickers, setTickers] = useState<Record<string, { lastPrice: string; changePercent24h: string; quoteVolume24h: string }>>({});
  const [search, setSearch] = useState('');
  const [sortId, setSortId] = useState('volume_desc');
  const [coinIcons, setCoinIcons] = useState<Map<string, string>>(new Map());

  const sortMode = SORT_MODES.find((m) => m.id === sortId) ?? SORT_MODES[0];
  const { field: sortField, dir: sortDir } = sortMode;

  function toggleSort(field: SortField) {
    const wantDir: 1 | -1 = sortField === field && sortDir === -1 ? 1 : -1;
    const next = SORT_MODES.find((m) => m.field === field && m.dir === wantDir);
    if (next) setSortId(next.id);
  }

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .getExternalTickers()
        .then((res) => {
          if (cancelled) return;
          const bySymbol: Record<string, { lastPrice: string; changePercent24h: string; quoteVolume24h: string }> = {};
          for (const tk of res.tickers) if (symbols.includes(tk.pair)) bySymbol[tk.pair] = tk;
          setTickers(bySymbol);
        })
        .catch(() => {});
    }
    load();
    const poll = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')]);

  // Official asset artwork, same source the spot list uses.
  useEffect(() => {
    let cancelled = false;
    api
      .getExternalRankings()
      .then((res) => {
        if (cancelled) return;
        setCoinIcons(new Map(res.rankings.map((r) => [r.symbol, r.image])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: Row[] = useMemo(() => {
    const built = symbols
      .filter((s) => s.toLowerCase().replace('/', '').includes(search.trim().toLowerCase().replace('/', '')))
      .map((s) => {
        const tk = tickers[s];
        return {
          symbol: s,
          lastPrice: tk ? parseFloat(tk.lastPrice) || 0 : 0,
          change: tk ? Number(parseChangePercent(tk.changePercent24h, s).toFixed(2)) : 0,
          quoteVolume24h: tk ? parseFloat(tk.quoteVolume24h) || 0 : 0,
        };
      });
    return built.sort((a, b) => {
      if (sortField === 'symbol') return a.symbol.localeCompare(b.symbol) * sortDir;
      if (sortField === 'price') return (a.lastPrice - b.lastPrice) * sortDir;
      if (sortField === 'change') return (a.change - b.change) * sortDir;
      return (a.quoteVolume24h - b.quoteVolume24h) * sortDir;
    });
  }, [symbols, tickers, search, sortField, sortDir]);

  return (
    <>
      <div className="pairs-search">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('trade.searchPair')}
          aria-label={t('trade.searchPair')}
        />
      </div>

      <div className="pairs-col-headers">
        <select
          className={`pch-mode ${sortField === 'volume' || sortField === 'symbol' ? 'active' : ''}`}
          value={sortId}
          onChange={(e) => setSortId(e.target.value)}
          aria-label={t('trade.sortBy')}
        >
          {SORT_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.labelKey)}
            </option>
          ))}
        </select>
        <button className={`pch-sort ${sortField === 'price' ? 'active' : ''}`} onClick={() => toggleSort('price')}>
          {t('trade.price')}
          <SortArrow active={sortField === 'price'} dir={sortDir} />
        </button>
        <button className={`pch-sort ${sortField === 'change' ? 'active' : ''}`} onClick={() => toggleSort('change')}>
          {t('markets.change24h')}
          <SortArrow active={sortField === 'change'} dir={sortDir} />
        </button>
      </div>

      <div className="pairs-list">
        {rows.map((r) => {
          const up = r.change >= 0;
          const base = r.symbol.split('/')[0];
          return (
            <button
              key={r.symbol}
              className={`pair-row ${r.symbol === symbol ? 'active' : ''}`}
              onClick={() => onChange(r.symbol)}
            >
              <span className="p-star" aria-hidden="true" />
              <span className="p-icon">
                <CryptoIcon symbol={base} size={20} imageUrl={coinIcons.get(base)} />
              </span>
              <span className="p-name">{r.symbol}</span>
              <span className="p-price">{tickers[r.symbol] ? formatPrice(r.lastPrice) : '—'}</span>
              <span className={`p-change ${up ? 'up' : 'down'}`}>
                {tickers[r.symbol] ? `${up ? '▲' : '▼'} ${up ? '+' : ''}${r.change.toFixed(2)}%` : '—'}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  if (!active) return <span className="pch-arrow idle">⇅</span>;
  return <span className="pch-arrow">{dir === -1 ? '▼' : '▲'}</span>;
}
