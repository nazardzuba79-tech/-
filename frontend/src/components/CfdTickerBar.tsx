import { useLanguage } from '../lib/i18n';
import { formatCfdPrice } from '../lib/cfdPresentation';
import { parseChangePercent } from '../lib/priceChange';
import { PriceCell } from './PriceCell';
import type { CfdTickerRow } from './CfdInstrumentList';

/** Only the actual reference-feed fields: no volume, funding or depth. */
export function CfdTickerBar({ symbol, ticker }: { symbol: string; ticker?: CfdTickerRow }) {
  const { t } = useLanguage();
  const change = ticker ? parseChangePercent(ticker.changePercent24h, symbol) : null;
  return (
    <header className="cfd-ticker-bar">
      <div className="cfd-selected-instrument">
        <span className="cfd-symbol mono">{symbol}</span><span className="cfd-product-badge">CFD</span>
        <span className="cfd-instrument-name">{ticker?.name ?? '—'}</span>
      </div>
      <div className="cfd-ticker-metric">
        <span>{t('trade.cfdMarketPrice')}</span>
        {ticker ? <PriceCell key={symbol} className="mono cfd-ticker-price" value={Number(ticker.price)} format={v => formatCfdPrice(v, symbol)} />
          : <span className="mono cfd-ticker-price">—</span>}
      </div>
      <div className="cfd-ticker-metric">
        <span>{t('markets.change24h')}</span>
        <span className={`mono cfd-ticker-change ${change === null ? '' : change >= 0 ? 'text-buy' : 'text-sell'}`}>
          {change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
        </span>
      </div>
    </header>
  );
}
