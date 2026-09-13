import { useLanguage } from '../lib/i18n';
import { SkeletonRow } from './Skeleton';
import { formatCfdPrice } from '../lib/cfdPresentation';
import { PriceCell } from './PriceCell';
import { parseChangePercentOrNull } from '../lib/priceChange';

export interface CfdTickerRow {
  symbol: string;
  name: string;
  price: string | null;
  status?: string;
  stale?: boolean;
  executionAllowed?: boolean;
  providerTimestamp?: number | null;
  fetchedAt?: number | null;
  maxQuoteAgeMs?: number;
  /** Display-only benchmarks keep their source, observation date and basis. */
  referenceLabel?: string;
  referenceKind?: 'indicative' | 'daily_reference';
  referenceValidUntil?: number;
  observationDate?: string | null;
  displayOnly?: boolean;
  /** Unknown change is omitted, never fabricated as 0.00%. */
  changePercent24h?: string;
}

export const CFD_ICON_BY_SYMBOL: Record<string, string> = {
  XAUUSD: '🥇', EURUSD: '💶', GBPUSD: '💷', USDJPY: '💴', AUDUSD: '🇦🇺', USDCAD: '🇨🇦',
};

/** A reference price is not permission to trade. Same original terminal layout. */
export function CfdInstrumentList({
  symbol, onChange, tickers, configured, loadError, onRetry,
}: {
  symbol: string; onChange: (symbol: string) => void; tickers: CfdTickerRow[];
  configured: boolean; loadError: boolean; onRetry: () => void;
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
          const change = tk.displayOnly ? null : parseChangePercentOrNull(tk.changePercent24h, tk.symbol);
          const positive = (change ?? 0) >= 0;
          return (
            <button key={tk.symbol} onClick={() => onChange(tk.symbol)}
              className={`cfd-option${tk.symbol === symbol ? ' active' : ''}`} aria-pressed={tk.symbol === symbol}>
              <span className="cfd-optionLeft">
                <span className="cfd-icon">{CFD_ICON_BY_SYMBOL[tk.symbol] ?? '◆'}</span>
                <span className="cfd-optionTitle">
                  <span className="mono cfd-optionSymbol">{tk.symbol}</span>
                  <span className="cfd-optionName">{tk.name}</span>
                  {tk.referenceLabel ? <span className="cfd-optionName" title={tk.referenceLabel}>{tk.referenceLabel}</span>
                    : tk.status !== 'live' && <span className="cfd-optionName">{t('trade.cfdUnavailable')}</span>}
                </span>
              </span>
              {tk.price === null ? <span className="mono cfd-price">—</span> : <PriceCell value={Number(tk.price)} className="mono cfd-price" format={(value) => formatCfdPrice(value, tk.symbol, tk.displayOnly)} />}
              <span className={`mono cfd-change ${change === null ? '' : positive ? 'text-buy' : 'text-sell'}`}>
                {change === null ? '—' : `${positive ? '+' : ''}${change.toFixed(2)}%`}
              </span>
            </button>
          );
        })}
        {tickers.length === 0 && !configured && !loadError && <p className="cfd-hint">{t('trade.cfdUnavailable')}</p>}
        {tickers.length === 0 && configured && !loadError && Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} columns={[3, 1, 1]} />)}
        {tickers.length === 0 && loadError && <button onClick={onRetry} className="cfd-retryButton">{t('trade.loadPairsError')}</button>}
      </div>
    </div>
  );
}
