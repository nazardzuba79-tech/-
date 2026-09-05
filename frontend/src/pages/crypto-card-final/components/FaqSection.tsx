import { PlusIcon } from 'lucide-react';
import { getCardFaq } from '../data/faq';
import { useCardCopy } from '../useCardCopy';

export function FaqSection() {
  const { c } = useCardCopy();
  const faqItems = getCardFaq(c);
  return (
    <section id="faq" className="vc-bg-voltex-cream vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
      <div className="vc-mx-auto vc-grid vc-max-w-[1344px] vc-gap-14 lg:vc-grid-cols-[0.52fr_1fr]">
        <div><h2 className="vc-text-[clamp(3.2rem,5vw,5.8rem)] vc-font-medium vc-leading-[0.95] vc-tracking-[-0.06em]">{c.faqTitle}</h2></div>
        <div className="vc-border-t vc-border-black/20">{faqItems.map((item) => <details key={item.question} className="vc-group vc-border-b vc-border-black/15"><summary className="vc-flex vc-cursor-pointer vc-list-none vc-items-center vc-justify-between vc-gap-6 vc-py-7 vc-text-lg vc-font-medium sm:vc-text-xl">{item.question}<PlusIcon size={20} className="vc-shrink-0 vc-transition-transform vc-duration-200 vc-ease-out group-open:vc-rotate-45" /></summary><p className="vc-max-w-2xl vc-pb-8 vc-pr-4 vc-text-[15px] vc-leading-7 vc-text-voltex-creamMuted sm:vc-pr-12">{item.answer}</p></details>)}</div>
      </div>
    </section>);

}
