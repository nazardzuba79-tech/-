import { CheckIcon } from 'lucide-react';
import { VoltexCard } from './VoltexCard';
import { cardProducts } from '../data/products';
import { useCardCopy } from '../useCardCopy';


export function CardChoiceSection() {
  const { c } = useCardCopy();
  return (
    <section id="cards" className="vc-bg-voltex-cream vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
      <div className="vc-mx-auto vc-max-w-[1344px]">
        <div className="vc-grid vc-gap-8 vc-border-b vc-border-black/15 vc-pb-10 lg:vc-grid-cols-[1fr_0.4fr] lg:vc-items-end">
          <h2 className="vc-max-w-4xl vc-text-[clamp(3.2rem,6vw,6.8rem)] vc-font-medium vc-leading-[0.94] vc-tracking-[-0.065em]">{c.cardsTitle}</h2>
        </div>
        <div className="vc-grid lg:vc-grid-cols-2">
          {cardProducts.map((card, index) => <article key={card.id} data-card-product={card.id} className={`vc-py-14 lg:vc-px-12 lg:vc-py-20 ${index === 0 ? "vc-border-b vc-border-black/15 lg:vc-border-b-0 lg:vc-border-r lg:vc-pl-0" : "lg:vc-pr-0"}`}>
            <div className="vc-mx-auto vc-max-w-[540px]"><VoltexCard tone={card.tone} /></div>
            <div className="vc-mt-10 vc-flex vc-items-start vc-justify-between vc-gap-5"><div><p className="vc-mb-3 vc-text-[12px] vc-font-semibold vc-uppercase vc-tracking-wide2 vc-text-voltex-creamMuted">{index === 0 ? c.titaniumTier : c.blackTier}</p><h3 className={`vc-text-3xl vc-tracking-[-0.04em] ${index === 1 ? 'vc-font-semibold' : 'vc-font-medium'}`}>{card.name}</h3></div><span className="vc-text-[12px] vc-font-semibold vc-text-black/70">{card.network}</span></div>
            <ul className="vc-mt-8 vc-grid vc-gap-4 vc-border-t vc-border-black/20 vc-pt-6">
              <li className="vc-flex vc-items-center vc-gap-3"><CheckIcon size={16} /><span className="vc-text-sm vc-text-voltex-creamMuted">{c.tierCashback}</span><strong className="vc-ml-auto vc-text-xl">{c.upTo} {card.cashback}</strong></li>
              <li className="vc-flex vc-items-center vc-gap-3"><CheckIcon size={16} /><strong className={index === 1 ? 'vc-text-2xl' : 'vc-text-xl'}>{card.monthlyLimit} <span className="vc-text-sm vc-font-normal">{c.monthly}</span></strong></li>
            </ul>
          </article>)}
        </div>
      </div>
    </section>);

}
