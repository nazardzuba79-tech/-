import { useLanguage } from '../lib/i18n';
import { SkeletonRow } from './Skeleton';
import { formatCfdPrice } from '../lib/cfdPresentation';
import { PriceCell } from './PriceCell';
import { parseChangePercent } from '../lib/priceChange';

export interface CfdTickerRow {
  symbol: string;
  name: string;
  price: string;
  changePercent24h: string;
}

// Fixed emoji badge per instrument — same spirit as PairListSidebar's
// CryptoIcon, just without needing per-symbol artwork for a short list.
// Kept in sync with CfdMarketDataService's CFD_INSTRUMENTS — see that
// file's doc comment for why the list is gold + major forex only.
export const CFD_ICON_BY_SYMBOL: Record<string, string> = {
  XAUUSD: '🥇',
  EURUSD: '💶',
  GBPUSD: '💷',
  USDJPY: '💴',
  AUDUSD: '🇦🇺',
  USDCAD: '🇨🇦',
};

/**
 * Live CFD reference prices (gold + major forex pairs) from Twelve Data —
 * same row layout as PairListSidebar's crypto pair list, so
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
    <div className="cfd-instruments">
      <div className="cfd-columns">
        <span>{t('trade.cfdInstrument')}</span>
        <span className="cfd-align-right">{t('markets.price')}</span>
        <span className="cfd-align-right">{t('markets.change24h')}</span>
      </div>

      <div className="cfd-list">
        {tickers.map((tk) => {
          const change = parseChangePercent(tk.changePercent24h, tk.symbol);
          const positive = change >= 0;
          return (
            <button
              key={tk.symbol}
              onClick={() => onChange(tk.symbol)}
              className={`cfd-option${tk.symbol === symbol ? ' active' : ''}`}
              aria-pressed={tk.symbol === symbol}
            >
              <span className="cfd-optionLeft">
                <span className="cfd-icon">{CFD_ICON_BY_SYMBOL[tk.symbol] ?? '◆'}</span>
                <span className="cfd-optionTitle">
                  <span className="mono cfd-optionSymbol">
                    {tk.symbol}
                  </span>
                  <span className="cfd-optionName">{tk.name}</span>
                </span>
              </span>
              <PriceCell value={parseFloat(tk.price)} className="mono cfd-price" format={(value) => formatCfdPrice(value, tk.symbol)} />
              <span className={`mono cfd-change ${positive ? 'text-buy' : 'text-sell'}`} >
                {positive ? '+' : ''}
                {change.toFixed(2)}%
              </span>
            </button>
          );
        })}

        {tickers.length === 0 && !configured && !loadError && <p className="cfd-hint">{t('trade.cfdUnavailable')}</p>}
        {tickers.length === 0 && configured && !loadError && Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} columns={[3, 1, 1]} />)}
        {tickers.length === 0 && loadError && (
          <button onClick={onRetry} className="cfd-retryButton">
            {t('trade.loadPairsError')}
          </button>
        )}
      </div>
    </div>
  );
}
