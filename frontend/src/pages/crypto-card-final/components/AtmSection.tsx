import { ArrowUpRightIcon, RadioIcon } from 'lucide-react';
import { CardScene } from './CardScene';
import { useCardCopy } from '../useCardCopy';

export function AtmSection() {
  const { c } = useCardCopy();
  return (
    <section className="vc-overflow-hidden vc-border-y vc-border-white/[0.08] vc-bg-voltex-black vc-text-white">
      <div className="vc-mx-auto vc-grid vc-max-w-[1440px] lg:vc-grid-cols-[0.92fr_1.08fr]">
        <div className="vc-flex vc-flex-col vc-justify-between vc-px-5 vc-py-20 sm:vc-px-8 lg:vc-min-h-[820px] lg:vc-px-12 lg:vc-py-24">
          <div className="vc-flex vc-items-center vc-justify-between vc-border-t vc-border-white/25 vc-pt-4 vc-text-[11px] vc-font-medium vc-uppercase vc-tracking-wide3 vc-text-voltex-muted">
            <span>{c.cashLabel}</span><span>02 / 07</span>
          </div>
          <div className="vc-mt-20 lg:vc-mt-0">
            <h2 className="vc-max-w-2xl vc-text-[clamp(3.1rem,5.7vw,6.3rem)] vc-font-medium vc-leading-[0.95] vc-tracking-[-0.06em]">{c.cashTitle}</h2>
            <p className="vc-mt-8 vc-max-w-md vc-text-[17px] vc-leading-8 vc-text-voltex-muted">{c.cashLead}</p>
            <ol className="vc-mt-10 vc-grid vc-max-w-lg vc-gap-px vc-border vc-border-white/12 vc-bg-white/12 sm:vc-grid-cols-3">
              {[
              { step: '01', label: 'VOLTEX Card' },
              { step: '02', label: c.nfcReader },
              { step: '03', label: c.atm }].
              map((item) =>
              <li key={item.step} className="vc-bg-voltex-black vc-p-5">
                  <span className="vc-text-[11px] vc-font-medium vc-tracking-wide2 vc-text-voltex-goldLight">{item.step}</span>
                  <span className="vc-mt-6 vc-block vc-text-[15px] vc-font-medium vc-leading-snug">{item.label}</span>
                </li>
              )}
            </ol>
          </div>
        </div>
        <div className="vc-relative vc-min-h-[620px] vc-overflow-hidden lg:vc-min-h-[820px]">
          <CardScene kind="atm" />
          <div className="vc-absolute vc-bottom-8 vc-right-6 vc-max-w-[280px] vc-border-l-2 vc-border-voltex-gold vc-bg-black/85 vc-px-5 vc-py-4 vc-backdrop-blur-md sm:vc-bottom-10 sm:vc-right-10">
            <div className="vc-flex vc-items-center vc-gap-2 vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide2 vc-text-voltex-goldLight"><RadioIcon size={15} /> {c.contactless}</div>
            <p className="vc-mt-2.5 vc-text-[14px] vc-leading-7 vc-text-white/90">{c.atmAction}</p>
          </div>
        </div>
      </div>
    </section>);

}
