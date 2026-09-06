import { CheckIcon, ShieldCheckIcon, CrownIcon, WalletCardsIcon } from 'lucide-react';
import { useCardCopy } from '../useCardCopy';

export function HowItWorksSection() {
  const { c } = useCardCopy();
  const steps = [
    { title: c.stepVerify, icon: ShieldCheckIcon },
    { title: c.stepVip, icon: CrownIcon },
    { title: c.stepCard, icon: WalletCardsIcon },
  ];
  return <section id="how-it-works" className="vc-bg-voltex-cream vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
    <div className="vc-mx-auto vc-max-w-[1344px]">
      <h2 className="vc-border-b vc-border-black/15 vc-pb-9 vc-text-[clamp(3.2rem,6vw,6.8rem)] vc-font-medium vc-leading-[0.94] vc-tracking-[-0.065em]">{c.howTitle}</h2>
      <div className="vc-grid lg:vc-grid-cols-3">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return <article key={index} className={'vc-flex vc-min-h-[260px] vc-flex-col vc-justify-between vc-border-black/15 vc-py-9 lg:vc-min-h-[310px] lg:vc-px-9 ' + (index < 2 ? 'vc-border-b lg:vc-border-b-0 lg:vc-border-r ' : '') + (index === 0 ? 'lg:vc-pl-0' : '')}>
            <div className="vc-flex vc-items-center vc-justify-between"><span className="vc-font-display vc-text-4xl vc-text-voltex-gold">0{index + 1}</span><Icon size={21} strokeWidth={1.5} /></div>
            <div><h3 className="vc-text-3xl vc-font-medium vc-tracking-[-0.04em]">{step.title}</h3><CheckIcon size={18} className="vc-mt-6" /></div>
          </article>;
        })}
      </div>
      <div id="eligibility" className="vc-mt-10 vc-grid vc-gap-5 vc-border-t vc-border-black/20 vc-pt-8 lg:vc-grid-cols-[0.65fr_1fr]">
        <h3 className="vc-text-2xl vc-font-semibold vc-tracking-[-0.03em]">{c.eligibilityTitle}</h3>
        <p className="vc-max-w-2xl vc-text-base vc-leading-7 vc-text-voltex-creamMuted">{c.eligibilityLead}</p>
      </div>
    </div>
  </section>;
}
