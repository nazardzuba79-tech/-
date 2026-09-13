import type { ReactNode } from 'react';
import { useLanguage } from '../../lib/i18n';
import { DASH, FreshnessTag } from './presentation';

export function Panel({ title, subtitle, children, tools, className = '', section }: {
  title: string; subtitle?: string; children: ReactNode; tools?: ReactNode; className?: string;
  section?: { available: boolean; stale?: boolean; fetchedAt?: number };
}) {
  return <section className={'ap-panel ' + className}>
    <header className="ap-panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <div className="ap-tools">{section?.available && <FreshnessTag stale={section.stale} fetchedAt={section.fetchedAt} />}{tools}</div>
    </header><div className="ap-panel-body">{children}</div>
  </section>;
}
export function StatRow({ label, value, tone }: { label: string; value?: ReactNode; tone?: string }) {
  return <div className="ap-stat"><span>{label}</span><strong className={tone}>{value ?? DASH}</strong></div>;
}
export function Empty() { return <div className="ap-empty" role="status">{DASH}</div>; }
export function SectionLabel({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return <div className="ap-section-label"><h2>{children}</h2>{note && <span>{note}</span>}</div>;
}
export function Segmented<T extends string | number>({ values, selected, onChange, label, suffix = '' }: {
  values: T[]; selected: T | null; onChange: (value: T) => void; label: string; suffix?: string;
}) {
  return <div className="ap-segmented" role="group" aria-label={label}>{values.map(value =>
    <button key={value} type="button" aria-pressed={selected === value} onClick={() => onChange(value)}>{value}{suffix}</button>)}</div>;
}
export function Tone({ value, children }: { value: number | null | undefined; children: ReactNode }) {
  return <span className={value == null || !Number.isFinite(value) || value === 0 ? '' : value > 0 ? 'ap-positive' : 'ap-negative'}>{children}</span>;
}
export function useCopy() {
  const { lang } = useLanguage();
  return lang === 'ru' ? RU : EN;
}
const EN = {
  observed: 'Observed liquidations', distribution: 'Executed liquidations by price', recent: 'Recent liquidations',
  partial: 'Partial period', total: 'Total', largest: 'Largest liquidation', price: 'Price', time: 'Time',
  notional: 'Value (USD)', side: 'Side', context: 'Market context', snapshot: 'Market snapshot',
  collected: 'Observed period', noEvents: 'No liquidations recorded in this period', priceHistory: 'Price & open interest',
  priceSeries: 'Price · 1h', currentOi: 'Current open interest', aggregate: 'Covered contracts', contract: 'Contract',
  annualized: 'Annualized', expiry: 'Expiry', basis: 'Basis', reference: 'Reference price', summary: 'Key readings',
  volatility: 'Volatility', funding: 'Funding', neutral: 'Neutral', fear: 'Fear', greed: 'Greed',
  structure: 'Market structure', rates: 'Funding rates', range: 'Price range', observedOnly: 'Executed events',
  change: '24h change', high: '24h high', low: '24h low', oiHistory: 'Open interest history',
  portfolio: 'Market relationships', index: 'Volatility index', sourcePeriod: 'Period',
};
const RU: typeof EN = {
  observed: 'Наблюдаемые ликвидации', distribution: 'Исполненные ликвидации по цене', recent: 'Последние ликвидации',
  partial: 'Неполный период', total: 'Всего', largest: 'Крупнейшая ликвидация', price: 'Цена', time: 'Время',
  notional: 'Объём (USD)', side: 'Сторона', context: 'Контекст рынка', snapshot: 'Состояние рынка',
  collected: 'Период наблюдений', noEvents: 'За этот период ликвидации не зафиксированы', priceHistory: 'Цена и открытый интерес',
  priceSeries: 'Цена · 1ч', currentOi: 'Текущий открытый интерес', aggregate: 'Охваченные контракты', contract: 'Контракт',
  annualized: 'В годовом выражении', expiry: 'Экспирация', basis: 'Базис', reference: 'Справочная цена', summary: 'Ключевые показатели',
  volatility: 'Волатильность', funding: 'Фандинг', neutral: 'Нейтрально', fear: 'Страх', greed: 'Жадность',
  structure: 'Структура рынка', rates: 'Ставки финансирования', range: 'Ценовой диапазон', observedOnly: 'Исполненные события',
  change: 'Изменение 24ч', high: 'Максимум 24ч', low: 'Минимум 24ч', oiHistory: 'История открытого интереса',
  portfolio: 'Взаимосвязи рынка', index: 'Индекс волатильности', sourcePeriod: 'Период',
};
