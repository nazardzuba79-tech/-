import { useId, useState } from 'react';
import { OrderFamilyTabs, type OrderFamily } from '../../components/OrderFamilyPresentation';
import { useLanguage } from '../../lib/i18n';
import type { StockInstrument } from '../../lib/stocks';
import './stockOrderPanel.css';

/** Presentation only. No account hooks, quote extraction, sizing or submission. */
export function StockOrderPanel({ instrument }: { instrument: StockInstrument }) {
  const { t } = useLanguage();
  const notice = useId();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [family, setFamily] = useState<OrderFamily>('LIMIT');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  return <section className="vxs-order-panel" aria-label={t('nav.trade')}>
    <h2 className="vxs-order-heading">{t('nav.trade')}</h2>
    <div className="vxs-order-content">
      <div className="vxs-side-tabs" role="tablist" aria-label={t('nav.trade')}>
        {(['BUY', 'SELL'] as const).map(value => <button key={value} type="button" role="tab"
          aria-selected={side === value} className={`${value.toLowerCase()}${side === value ? ' active' : ''}`}
          onClick={() => setSide(value)}>{t(value === 'BUY' ? 'trade.buy' : 'trade.sell')}</button>)}
      </div>
      <OrderFamilyTabs value={family} onChange={setFamily} archive allowedFamilies={['LIMIT', 'MARKET']} />
      <div className="vxs-order-available"><span>{t('trade.available')}</span><span>— {instrument.currency}</span></div>
      <form className="vxs-order-form" onSubmit={event => event.preventDefault()} aria-describedby={notice}>
        <label className="vxs-order-field"><span>{t('trade.price')}</span>
          <div><input aria-label={t('trade.price')} inputMode="decimal" autoComplete="off"
            value={family === 'MARKET' ? '' : price} placeholder={family === 'MARKET' ? t('futures.closeMarket') : '—'}
            readOnly={family === 'MARKET'} onChange={event => setPrice(event.target.value)} /><span>{instrument.currency}</span></div>
        </label>
        <label className="vxs-order-field"><span>{t('trade.quantity')}</span>
          <div><input aria-label={t('trade.quantity')} inputMode="decimal" autoComplete="off" value={amount}
            placeholder="—" onChange={event => setAmount(event.target.value)} /><span>{instrument.symbol}</span></div>
        </label>
        <label className="vxs-order-field"><span>{t('trade.total')}</span>
          <div><input aria-label={t('trade.total')} readOnly value="" placeholder="—" /><span>{instrument.currency}</span></div>
        </label>
        <button type="submit" className={`vxs-order-submit ${side.toLowerCase()}`} disabled aria-describedby={notice}>
          {t(side === 'BUY' ? 'trade.buy' : 'trade.sell')} {instrument.symbol}
        </button>
        <p id={notice} className="vxs-order-notice">{t('stocks.tradingUnavailable')}</p>
      </form>
    </div>
  </section>;
}
