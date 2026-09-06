import { ArrowUpRightIcon } from 'lucide-react';
import { useCardCopy } from '../useCardCopy';
const EARTH_IMAGE = "/cards/crypto-card-final/5165f22b-08e6-4b9b-83eb-d4b778cc9aad.jpg";

export function GlobalUseSection() {
  const { c } = useCardCopy();
  return <section className="vc-overflow-hidden vc-bg-[#D9D8D2] vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-32">
    <div className="vc-mx-auto vc-max-w-[1344px]">
      <div className="vc-grid vc-gap-10 vc-border-b vc-border-black/25 vc-pb-12 lg:vc-grid-cols-[1fr_0.52fr] lg:vc-items-end">
        <h2 className="vc-max-w-3xl vc-text-[clamp(3rem,5.2vw,5.6rem)] vc-font-medium vc-leading-[0.96] vc-tracking-[-0.06em]">{c.globalTitle}</h2>
        <div className="lg:vc-justify-self-end"><p className="vc-max-w-md vc-text-[17px] vc-leading-8 vc-text-black/80">{c.globalLead}</p><a href="#fees" className="vc-mt-6 vc-inline-flex vc-items-center vc-gap-4 vc-border-b vc-border-black vc-pb-2 vc-text-[15px] vc-font-semibold">{c.termsLink}<ArrowUpRightIcon size={16} /></a></div>
      </div>
      <figure className="vc-relative vc-mt-12 vc-min-h-[460px] vc-overflow-hidden vc-bg-[#05070C] sm:vc-min-h-[600px] lg:vc-min-h-[720px]">
        <img src={EARTH_IMAGE} alt={c.globalAlt} className="vc-absolute vc-inset-0 vc-h-full vc-w-full vc-object-cover" loading="lazy" />
        <div className="vc-absolute vc-inset-x-0 vc-bottom-0 vc-h-[35%] vc-bg-[#05070C]/80" />
        <figcaption className="vc-absolute vc-inset-x-6 vc-bottom-6 vc-grid vc-gap-px vc-border vc-border-white/20 vc-bg-white/20 sm:vc-inset-x-10 sm:vc-bottom-10 sm:vc-grid-cols-3">
          {[c.globalInStore, c.globalOnline, c.globalTravel].map(label => <div key={label} className="vc-bg-[#05070C]/85 vc-p-5 vc-text-sm vc-font-medium vc-text-white">{label}</div>)}
        </figcaption>
      </figure>
    </div>
  </section>;
}
