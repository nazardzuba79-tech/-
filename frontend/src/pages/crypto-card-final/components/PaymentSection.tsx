import { CardScene } from './CardScene';
import { useCardCopy } from '../useCardCopy';

export function PaymentSection() {
  const { c } = useCardCopy();
  return (
    <section id="possibilities" className="vc-bg-voltex-cream vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
      <div className="vc-mx-auto vc-max-w-[1344px]">
        <div className="vc-mb-14 vc-grid vc-gap-8 vc-border-b vc-border-black/20 vc-pb-10 lg:vc-grid-cols-[1fr_0.45fr] lg:vc-items-end">
          <h2 className="vc-max-w-4xl vc-text-[clamp(3rem,6vw,6.8rem)] vc-font-medium vc-leading-[0.94] vc-tracking-[-0.065em]">{c.paymentTitle}</h2>
        </div>
        <div className="vc-relative vc-min-h-[620px] vc-overflow-hidden vc-bg-[#1c1713] sm:vc-min-h-[760px]">
          <CardScene kind="pos" />
          <div className="vc-absolute vc-inset-0 vc-bg-black/25" />
          <div className="vc-absolute vc-inset-y-0 vc-left-0 vc-w-full vc-bg-black/55 sm:vc-w-[52%]" />
          <div className="vc-absolute vc-inset-x-6 vc-top-7 vc-flex vc-items-center vc-justify-between vc-border-t vc-border-white/50 vc-pt-4 vc-text-[11px] vc-font-medium vc-uppercase vc-tracking-wide3 vc-text-white/90 sm:vc-inset-x-10 lg:vc-inset-x-14">
            <span>{c.paymentLabel}</span><span>01 / 07</span>
          </div>
          <div className="vc-absolute vc-bottom-10 vc-left-6 vc-right-6 vc-text-white sm:vc-bottom-14 sm:vc-left-10 sm:vc-right-auto lg:vc-left-14">
            <div className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-voltex-goldLight">{c.cashback}</div>
            <div className="vc-mt-4 vc-font-display vc-text-[clamp(4rem,10vw,9rem)] vc-leading-[0.82] vc-tracking-[-0.05em]">{c.cashbackUpTo}</div>
          </div>
        </div>
      </div>
    </section>);

}
