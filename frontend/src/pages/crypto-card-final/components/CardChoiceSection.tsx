import { CheckIcon } from 'lucide-react';
import { VoltexCard } from './VoltexCard';

const cards = [
{ tone: 'black' as const, name: 'Black Signature', detail: 'Сдержанная классика для ежедневных платежей', features: ['Приоритетная поддержка', 'Расширенные лимиты', 'Программа привилегий'] },
{ tone: 'titanium' as const, name: 'Titanium', detail: 'Тактильный металл и статусный минимализм', features: ['Титановое исполнение', 'Персональный сервис', 'Максимальные лимиты'] }];


export function CardChoiceSection() {
  return (
    <section id="cards" className="vc-bg-voltex-cream vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
      <div className="vc-mx-auto vc-max-w-[1344px]">
        <div className="vc-grid vc-gap-8 vc-border-b vc-border-black/15 vc-pb-10 lg:vc-grid-cols-[1fr_0.4fr] lg:vc-items-end">
          <h2 className="vc-max-w-4xl vc-text-[clamp(3.2rem,6vw,6.8rem)] vc-font-medium vc-leading-[0.94] vc-tracking-[-0.065em]">Выберите свою VOLTEX Card.</h2>
          <p className="vc-text-[17px] vc-leading-8 vc-text-voltex-creamMuted lg:vc-justify-self-end">Два исполнения. Единая инфраструктура и контроль в приложении.</p>
        </div>
        <div className="vc-grid lg:vc-grid-cols-2">
          {cards.map((card, index) => <article key={card.name} className={`vc-py-14 lg:vc-px-12 lg:vc-py-20 ${index === 0 ? "vc-border-b vc-border-black/15 lg:vc-border-b-0 lg:vc-border-r lg:vc-pl-0" : "lg:vc-pr-0"}`}><div className="vc-mx-auto vc-max-w-[540px]"><VoltexCard tone={card.tone} /></div><div className="vc-mt-10 vc-flex vc-items-start vc-justify-between vc-gap-8"><div><h3 className="vc-text-3xl vc-font-medium vc-tracking-[-0.04em]">{card.name}</h3><p className="vc-mt-3 vc-max-w-xs vc-text-[15px] vc-leading-7 vc-text-voltex-creamMuted">{card.detail}</p></div><span className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-black/70">0{index + 1}</span></div><ul className="vc-mt-8 vc-grid vc-gap-3 vc-border-t vc-border-black/20 vc-pt-6 sm:vc-grid-cols-3">{card.features.map((feature) => <li key={feature} className="vc-flex vc-gap-2 vc-text-[13px] vc-leading-6 vc-text-voltex-creamMuted"><CheckIcon size={14} className="vc-mt-0.5 vc-shrink-0" />{feature}</li>)}</ul></article>)}
        </div>
      </div>
    </section>);

}
