import { ArrowDownUp, ArrowRight, BarChart3, ShieldCheck, Triangle } from 'lucide-react';

export const STRATEGIES = [
  {
    id: 'exchange', title: 'Межбиржевой арбитраж', icon: ArrowDownUp,
    description: 'Сравнение стоимости одного актива на разных площадках.', scheme: 'Площадка A → Площадка B',
    risk: 'Разница цен может исчезнуть до завершения перевода.',
    steps: ['Сравните цену покупки на площадке A и цену продажи на площадке B.', 'Учтите комиссии обеих сторон, проскальзывание и дополнительные расходы.', 'Оцените итог: даже положительная разница цен может не покрыть расходы.'],
    note: 'Калькулятор на этой странице оценивает именно такой сценарий по заданным ценам. Бюджет включает комиссию покупки; дополнительные расходы вычитаются из итога продажи.',
  },
  {
    id: 'triangle', title: 'Треугольный арбитраж', icon: Triangle,
    description: 'Сопоставление трёх обменных курсов внутри одной площадки.', scheme: 'USDT → BTC → ETH → USDT',
    risk: 'Каждый из трёх обменов имеет свою комиссию и ликвидность.',
    steps: ['Рассмотрите замкнутый маршрут из трёх валютных пар.', 'Для каждого обмена нужны отдельный курс, направление сделки, комиссия и доступный объём.', 'Сопоставьте количество исходной валюты в начале и в конце маршрута.'],
    note: 'Это отдельная стратегия с тремя обменами. Межбиржевой калькулятор выше не рассчитывает её результат.',
  },
  {
    id: 'futures', title: 'Спот и фьючерсы', icon: BarChart3,
    description: 'Сопоставление спотовой цены и цены фьючерсного контракта.', scheme: 'Спот ↔ Фьючерс',
    risk: 'Финансирование, маржа и изменение базиса влияют на итог.',
    steps: ['Сравните спотовую цену с ценой контракта на тот же актив.', 'Учтите направление позиций, срок контракта, финансирование, обеспечение и комиссии.', 'Оцените риск изменения базиса и ликвидации фьючерсной позиции.'],
    note: 'Для этой стратегии нужен отдельный расчёт позиций и финансирования. Она не рассчитывается по межбиржевой формуле на этой странице.',
  },
] as const;
export type Strategy = typeof STRATEGIES[number];

export function ArbitrageEducation({ onStrategy }: { onStrategy: (strategy: Strategy) => void }) {
  return <>
    <section className="arb-strategy-section" aria-labelledby="arb-strategies-title">
      <div className="arb-section-heading"><h2 id="arb-strategies-title">Подходы к арбитражу</h2><p>Одна идея — разные механизмы и риски</p></div>
      <div className="arb-strategy-grid">{STRATEGIES.map((strategy) => <article className="arb-strategy-card" key={strategy.id}>
        <div className="arb-strategy-icon"><strategy.icon size={21} aria-hidden="true" /></div>
        <h3>{strategy.title}</h3><p>{strategy.description}</p>
        <div className="arb-strategy-scheme">{strategy.scheme}</div>
        <small>{strategy.risk}</small>
        <button type="button" className="arb-strategy-link" onClick={() => onStrategy(strategy)} aria-label={`Как работает: ${strategy.title}`}>Как работает<ArrowRight size={15} aria-hidden="true" /></button>
      </article>)}</div>
    </section>
    <section className="arb-how" aria-labelledby="arb-how-title">
      <div><h2 id="arb-how-title">Как это работает</h2><ol className="arb-steps">{['Выберите сценарий', 'Укажите параметры', 'Проверьте расходы', 'Оцените результат'].map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></li>)}</ol></div>
      <aside><ShieldCheck size={22} aria-hidden="true" /><div><strong>Внимание к деталям</strong><p>Результат зависит от цены исполнения, ликвидности и времени перевода. Расчётная разница не гарантирует прибыль.</p></div></aside>
    </section>
  </>;
}
