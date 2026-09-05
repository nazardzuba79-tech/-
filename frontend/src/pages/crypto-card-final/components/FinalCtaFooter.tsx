import { CardApplication } from '../CardApplication';
import { useCardCopy } from '../useCardCopy';
import { CinematicCardScene } from './CinematicCardScene';

export function FinalCtaFooter({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const { c } = useCardCopy();
  return <section id="apply" className="voltex-grid vc-overflow-hidden vc-border-y vc-border-white/[0.08] vc-bg-voltex-black vc-px-5 vc-py-24 vc-text-white sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
    <div className="vc-mx-auto vc-grid vc-max-w-[1344px] vc-items-center vc-gap-16 lg:vc-grid-cols-[1fr_0.75fr]">
      <div><p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-voltex-goldLight">VOLTEX Card</p><h2 className="vc-mt-8 vc-max-w-4xl vc-text-[clamp(2.8rem,6.5vw,7.2rem)] vc-font-medium vc-leading-[0.92] vc-tracking-[-0.07em]">{c.finalTitle}</h2><div className="vc-mt-10"><CardApplication reviewOnly={reviewOnly} /></div></div>
      <div className="vc-relative vc-mx-auto vc-w-full vc-max-w-[560px]"><CinematicCardScene kind="final" label={c.finalAlt} /></div>
    </div>
  </section>;
}
