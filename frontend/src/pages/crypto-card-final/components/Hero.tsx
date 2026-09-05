import { ArrowDownRightIcon, ArrowRightIcon } from 'lucide-react';
import { useCardCopy } from '../useCardCopy';
import { CinematicCardScene } from './CinematicCardScene';

export function Hero() {
  const { c } = useCardCopy();
  const benefits = [[c.benefitCashback, c.benefitCashbackNote], [c.benefitFees, c.benefitFeesNote], [c.benefitLimit, c.benefitLimitNote]];
  return <section id="top" className="voltex-grid fine-noise vc-relative vc-overflow-hidden vc-border-b vc-border-white/[0.08] vc-bg-voltex-black">
    <div className="vc-absolute vc-right-[14%] vc-top-[28%] vc-h-72 vc-w-72 vc-rounded-full vc-bg-voltex-gold/10 vc-blur-3xl" />
    <div className="vc-relative vc-z-10 vc-mx-auto vc-grid vc-max-w-[1440px] vc-items-center vc-gap-12 vc-px-5 vc-py-16 sm:vc-px-8 lg:vc-min-h-[840px] lg:vc-grid-cols-[0.82fr_1.18fr] lg:vc-gap-8 lg:vc-px-12 lg:vc-py-20">
      <div className="vc-min-w-0 vc-max-w-[620px]">
        <p className="vc-mb-7 vc-flex vc-items-center vc-gap-3 vc-text-[12px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-voltex-muted"><span className="vc-h-1.5 vc-w-1.5 vc-rounded-full vc-bg-voltex-gold" />VOLTEX Crypto Card</p>
        <h1 className="vc-text-[clamp(2.4rem,5.6vw,5.25rem)] vc-font-semibold vc-leading-[0.98] vc-tracking-[-0.065em] vc-text-white">{c.heroTitle}</h1>
        <p className="vc-mt-8 vc-max-w-md vc-text-base vc-leading-7 vc-text-voltex-muted sm:vc-text-lg">{c.heroLead}</p>
        <div className="vc-mt-9 vc-flex vc-flex-wrap vc-gap-3">
          <a href="#apply" className="vc-inline-flex vc-items-center vc-gap-5 vc-rounded-full vc-bg-white vc-px-7 vc-py-3.5 vc-text-sm vc-font-semibold vc-text-black vc-transition-colors hover:vc-bg-voltex-goldLight">{c.getCard} <ArrowRightIcon size={16} /></a>
          <a href="#possibilities" className="vc-inline-flex vc-items-center vc-gap-5 vc-rounded-full vc-border vc-border-white/20 vc-px-7 vc-py-3.5 vc-text-sm vc-font-medium vc-text-white vc-transition-colors hover:vc-border-white/45">{c.learnMore} <ArrowDownRightIcon size={16} /></a>
        </div>
        <div className="vc-mt-10 vc-flex vc-flex-wrap vc-gap-x-5 vc-gap-y-2 vc-text-[12px] vc-font-medium vc-tracking-wide2 vc-text-voltex-muted">{['USD', 'EUR', 'GBP', 'BTC', 'ETH', 'USDT'].map(item => <span key={item}>{item}</span>)}</div>
      </div>
      <div className="vc-relative vc-mx-auto vc-w-full vc-max-w-[760px]">
        <CinematicCardScene kind="hero" label={c.heroAlt} />
      </div>
      <div className="vc-grid vc-gap-8 vc-border-t vc-border-white/20 vc-pt-8 sm:vc-grid-cols-3 lg:vc-col-span-2">
        {benefits.map(([title, note], index) => <div key={title}><span className="vc-text-[11px] vc-tracking-wide3 vc-text-voltex-goldLight">0{index + 1}</span><p className="vc-mt-3 vc-text-2xl vc-font-medium vc-tracking-[-0.03em] vc-text-white">{title}</p><p className="vc-mt-2 vc-max-w-xs vc-text-sm vc-leading-6 vc-text-voltex-muted">{note}</p></div>)}
      </div>
    </div>
  </section>;
}
