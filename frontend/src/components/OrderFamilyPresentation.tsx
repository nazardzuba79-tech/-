import { useState } from 'react';
import { useLanguage } from '../lib/i18n';

export type OrderFamily = 'LIMIT' | 'MARKET' | 'STOP' | 'TAKE_PROFIT' | 'OCO';
const families = [
  ['LIMIT', 'trade.limitOrder'], ['MARKET', 'trade.marketOrder'],
  ['STOP', 'trade.stopOrder'], ['TAKE_PROFIT', 'trade.takeProfitOrder'], ['OCO', 'trade.ocoOrder'],
] as const;

/**
 * The order families, as tabs — or, on a phone (`compact`), as ONE native
 * select with exactly the same options and the same `onChange`, so every
 * supported type stays reachable without four or five cramped tabs. One or
 * the other is rendered, never both.
 */
export function OrderFamilyTabs({ value, onChange, archive = false, compact = false }: { value: OrderFamily; onChange: (value: OrderFamily) => void; archive?: boolean; compact?: boolean }) {
  const { t } = useLanguage();
  const options = families.filter(([family]) => !archive || family !== 'OCO').map(([family, label]) => ({ family,
    text: archive ? family === 'TAKE_PROFIT' ? 'Take Profit' : family === 'LIMIT' ? t('futures.closeLimit') : family === 'MARKET' ? t('futures.closeMarket') : t(label) : t(label) }));
  if (compact) return <label className="order-family-select">
    <span className="order-family-select-label">{t('trade.orderType')}</span>
    <select value={value} aria-label={t('trade.orderType')} onChange={event => {
      const next = options.find(option => option.family === event.target.value);
      if (next) onChange(next.family);
    }}>{options.map(option => <option key={option.family} value={option.family}>{option.text}</option>)}</select>
  </label>;
  return <div className="order-family-tabs" role="tablist" aria-label={t('nav.trade')}>
    {options.map(({ family, text }) => <button key={family} type="button" role="tab"
      aria-selected={value === family} className={value === family ? 'active' : ''}
      onClick={() => onChange(family)}>{text}</button>)}
  </div>;
}

/** Presentation fields only: these values are never serialized into an order. */
export function OrderFamilyFields({ family, quote, includeLimit = false }: { family: OrderFamily; quote: string; includeLimit?: boolean }) {
  const { t } = useLanguage();
  const [execution, setExecution] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const conditional = family === 'STOP' || family === 'TAKE_PROFIT';
  const fields = family === 'OCO' ? ['trade.takeProfitPrice', 'trade.stopTriggerPrice', 'trade.stopLimitPrice'] as const
    : conditional ? execution === 'LIMIT' ? ['trade.triggerPrice', 'trade.limitExecutionPrice'] as const : ['trade.triggerPrice'] as const
    : family === 'LIMIT' && includeLimit ? ['trade.price'] as const : [];
  return <div className="order-family-fields">
    {conditional && <div className="order-family-execution">
      {(['LIMIT', 'MARKET'] as const).map(kind => <button key={kind} type="button" aria-pressed={execution === kind}
        onClick={() => setExecution(kind)}>{t(kind === 'LIMIT' ? 'trade.limitOrder' : 'trade.marketOrder')}</button>)}
    </div>}
    {fields.map(label => <label key={`${family}-${label}`} className="order-family-label">
      {t(label)}<span className="order-family-input"><input type="number" min="0" step="any" inputMode="decimal" placeholder="0.00" /><span>{quote}</span></span>
    </label>)}
  </div>;
}
