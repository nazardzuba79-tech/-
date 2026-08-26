import { useLanguage } from '../lib/i18n';
import { SkeletonRow } from './Skeleton';
import { PriceCell } from './PriceCell';
import { parseChangePercent } from '../lib/priceChange';

export interface CfdTickerRow {
  symbol: string;
  name: string;
  price: string;
  changePercent24h: string;
}

// Fixed emoji badge per instrument — same spirit as PairListSidebar's
// CryptoIcon, just without needing per-symbol artwork for a 7-item list.
export const CFD_ICON_BY_SYMBOL: Record<string, string> = {
  XAUUSD: '🥇',
  XAGUSD: '🥈',
  USOUSD: '🛢️',
  NAS100: '💻',
  US500: '📈',
  US30: '🏛️',
  EURUSD: '💶',
};

/**
 * Live CFD reference prices (gold, oil, major indices, EUR/USD) from
 * Twelve Data — same row layout as PairListSidebar's crypto pair list, so
 * switching "Spot / CFD" on the Trade page feels like the same product,
 * not a bolted-on widget. See CfdMarketDataService's doc comment for what
 * "live reference price" does and doesn't mean here.
 */
export function CfdInstrumentList({
  symbol,
  onChange,
  tickers,
  configured,
  loadError,
  onRetry,
}: {
  symbol: string;
  onChange: (symbol: string) => void;
  tickers: CfdTickerRow[];
  configured: boolean;
  loadError: boolean;
  onRetry: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div style={styles.panel}>
      <div style={styles.columns}>
        <span>{t('trade.cfdInstrument')}</span>
        <span style={{ textAlign: 'right' }}>{t('markets.price')}</span>
        <span style={{ textAlign: 'right' }}>{t('markets.change24h')}</span>
      </div>

      <div style={styles.list}>
        {tickers.map((tk) => {
          const change = parseChangePercent(tk.changePercent24h, tk.symbol);
          const positive = change >= 0;
          return (
            <button
              key={tk.symbol}
              onClick={() => onChange(tk.symbol)}
              className="row-hover"
              style={{ ...styles.option, ...(tk.symbol === symbol ? styles.optionActive : {}) }}
            >
              <span style={styles.optionLeft}>
                <span style={{ fontSize: 16 }}>{CFD_ICON_BY_SYMBOL[tk.symbol] ?? '◆'}</span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span className="mono" style={styles.optionSymbol}>
                    {tk.symbol}
                  </span>
                  <span style={styles.optionName}>{tk.name}</span>
                </span>
              </span>
              <PriceCell value={parseFloat(tk.price)} className="mono" style={{ textAlign: 'right', fontSize: 12 }} />
              <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={{ textAlign: 'right', fontSize: 12 }}>
                {positive ? '+' : ''}
                {change.toFixed(2)}%
              </span>
            </button>
          );
        })}

        {tickers.length === 0 && !configured && !loadError && <p style={styles.hint}>{t('trade.cfdUnavailable')}</p>}
        {tickers.length === 0 && configured && !loadError && Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} columns={[3, 1, 1]} />)}
        {tickers.length === 0 && loadError && (
          <button onClick={onRetry} style={styles.retryButton}>
            {t('trade.loadPairsError')}
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--panel)' },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1.6fr 1fr 1fr',
    padding: '8px 12px',
    fontSize: 10,
    color: 'var(--text-tertiary)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  list: { overflowY: 'auto', flex: 1, minHeight: 0 },
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
  optionLeft: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  optionSymbol: { fontSize: 12, fontWeight: 700 },
  optionName: { fontSize: 10, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  optionActive: { background: 'var(--panel-alt)' },
  hint: { padding: 14, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5 },
  retryButton: {
    width: '100%',
    padding: 14,
    background: 'transparent',
    border: 'none',
    color: 'var(--accent)',
    fontSize: 12,
    cursor: 'pointer',
  },
};
