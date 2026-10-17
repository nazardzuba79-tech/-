import type { StockCandle, StockInstrument } from '../../lib/stocks';
import { useLanguage, type Key } from '../../lib/i18n';
import { countryName, exchangeName, formatStockPrice, formatStockTime, formatStockVolume } from './stockFormat';

interface Props {
  instrument: StockInstrument;
  latest: StockCandle | null;
  adjustmentMode?: string;
  widgetMode?: boolean;
}

/**
 * Only what the catalogue and the latest closed candle actually say. The
 * candle's high and low are that candle's, labelled as such — never a session
 * range — and nothing is filled in where the service has no value.
 */
export function StockFacts({ instrument, latest, adjustmentMode, widgetMode }: Props) {
  const { t, lang } = useLanguage();
  const row = (label: Key, value: string) => value ? <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div> : null;
  const zone = instrument.exchangeTimeZone;
  return (
    <div className="vxs-facts">
      <dl>
        {row('stocks.exchange', exchangeName(instrument.exchange))}
        {row('stocks.country', countryName(instrument.country, lang))}
        {row('stocks.currency', instrument.currency)}
        {row('stocks.type', t(instrument.type === 'index' ? 'stocks.typeIndex' : 'stocks.typeStock'))}
        {row('stocks.timeZone', zone)}
        {row('stocks.instrumentId', widgetMode ? instrument.symbol : instrument.instrumentId)}
      </dl>
      {!widgetMode && <>
      <h3>{t('stocks.lastCandle')}</h3>
      {latest ? <dl>
        {row('stocks.open', formatStockPrice(latest.open, instrument.currency))}
        {row('stocks.high', formatStockPrice(latest.high, instrument.currency))}
        {row('stocks.low', formatStockPrice(latest.low, instrument.currency))}
        {row('stocks.closePrice', formatStockPrice(latest.close, instrument.currency))}
        {latest.volume !== null && row('stocks.volume', formatStockVolume(latest.volume))}
        {row('stocks.candleClosed', formatStockTime(latest.closeTimeUtc, lang, zone))}
        {row('stocks.fetched', formatStockTime(latest.fetchedAt, lang, zone))}
      </dl> : <p className="vxs-muted">{t('stocks.empty')}</p>}
      <h3>{t('stocks.history')}</h3>
      <dl>
        {row('stocks.interval', t('stocks.intervalValue'))}
        {row('stocks.refresh', t('stocks.refreshValue'))}
        {adjustmentMode === 'unadjusted' && row('stocks.adjustment', t('stocks.unadjusted'))}
      </dl>
      <p className="vxs-note">{t('stocks.priceNote')}</p>
      </>}
    </div>
  );
}
