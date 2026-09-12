import { useLanguage } from '../lib/i18n';
import { TradingViewAdvancedChart } from './TradingViewAdvancedChart';

/** Reference chart only. Quotes used for CFD execution still pass the existing server gates. */
export function CfdChart({ symbol }: { symbol: string }) {
  const { t } = useLanguage();
  return <div className="cfd-chart">
    <TradingViewAdvancedChart pair={symbol} market="cfd" chrome="terminal" drawingTools />
    <p className="cfd-disclaimer">{t('trade.cfdPriceDisclaimer')}</p>
  </div>;
}
