import { services } from '../data/services';
import { ServiceChip } from './ServiceChip';
import { useCardCopy } from '../useCardCopy';

const WORK_IMAGE = "/cards/crypto-card-final/f944ce76-d7cd-444f-bc2a-3e651c76b609.jpg";
const ENTERTAINMENT_IMAGE = "/cards/crypto-card-final/cef11d73-5081-4f82-879c-1d5ef1391f70.jpg";
const MARKETS_IMAGE = "/cards/crypto-card-final/a71588d4-cbfc-4255-88c2-66a8977c28fe.jpg";

export function SubscriptionsSection() {
  const { c } = useCardCopy();
  const serviceGroup = (group: 'work' | 'entertainment' | 'markets') => services.filter((service) => service.group === group);

  return (
    <section className="vc-bg-[#ECEAE4] vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
      <div className="vc-mx-auto vc-max-w-[1344px]">
        <div className="vc-grid vc-gap-10 lg:vc-grid-cols-[1fr_0.43fr] lg:vc-items-end">
          <h2 className="vc-max-w-5xl vc-text-[clamp(3.1rem,6vw,6.8rem)] vc-font-medium vc-leading-[0.94] vc-tracking-[-0.065em]">{c.subscriptionsTitle}</h2>
          <div className="vc-border-l vc-border-black/25 vc-pl-6">
            <p className="vc-text-[17px] vc-leading-8 vc-text-black/80">{c.subscriptionsExamples}</p>
            <p className="vc-mt-3 vc-text-sm vc-leading-6 vc-text-black/70">{c.subscriptionsDisclaimer}</p>
          </div>
        </div>

        <div className="vc-mt-16 vc-grid vc-gap-3 md:vc-grid-cols-12 md:vc-auto-rows-[180px] lg:vc-auto-rows-[210px]">
          <article className="vc-group vc-relative vc-min-h-[540px] vc-overflow-hidden md:vc-col-span-8 md:vc-row-span-3 md:vc-min-h-0">
            <img src={WORK_IMAGE} alt={c.workAlt} className="vc-absolute vc-inset-0 vc-h-full vc-w-full vc-object-cover vc-transition-transform vc-duration-300 vc-ease-out group-hover:vc-scale-[1.015]" />
            <div className="vc-absolute vc-inset-x-0 vc-bottom-0 vc-h-[48%] vc-bg-black/80" />
            <div className="vc-absolute vc-left-6 vc-top-6 vc-text-[11px] vc-font-medium vc-uppercase vc-tracking-wide3 vc-text-white/85 sm:vc-left-8 sm:vc-top-8">{c.workLabel}</div>
            <div className="vc-absolute vc-bottom-6 vc-left-6 vc-right-6 sm:vc-bottom-8 sm:vc-left-8 sm:vc-right-8">
              <h3 className="vc-max-w-md vc-text-3xl vc-font-medium vc-tracking-[-0.04em] vc-text-white sm:vc-text-5xl">{c.workTitle}</h3>
              <div className="vc-mt-6 vc-flex vc-flex-wrap vc-gap-2.5">{serviceGroup('work').map((service) => <ServiceChip key={service.name} service={service} />)}</div>
            </div>
          </article>

          <article className="vc-group vc-relative vc-min-h-[460px] vc-overflow-hidden md:vc-col-span-4 md:vc-row-span-2 md:vc-min-h-0">
            <img src={ENTERTAINMENT_IMAGE} alt={c.entertainmentAlt} className="vc-absolute vc-inset-0 vc-h-full vc-w-full vc-object-cover vc-transition-transform vc-duration-300 vc-ease-out group-hover:vc-scale-[1.015]" />
            <div className="vc-absolute vc-inset-0 vc-bg-black/45" />
            <div className="vc-absolute vc-inset-x-5 vc-top-5 vc-text-[11px] vc-font-medium vc-uppercase vc-tracking-wide3 vc-text-white/85">{c.entertainmentLabel}</div>
            <div className="vc-absolute vc-bottom-5 vc-left-5 vc-right-5">
              <h3 className="vc-text-2xl vc-font-medium vc-tracking-[-0.04em] vc-text-white sm:vc-text-3xl">{c.entertainmentTitle}</h3>
              <div className="vc-mt-4 vc-flex vc-flex-wrap vc-gap-2">{serviceGroup('entertainment').map((service) => <ServiceChip key={service.name} service={service} size="sm" />)}</div>
            </div>
          </article>

          <article className="vc-group vc-relative vc-min-h-[300px] vc-overflow-hidden md:vc-col-span-4 md:vc-row-span-1 md:vc-min-h-0">
            <img src={MARKETS_IMAGE} alt={c.marketsAlt} className="vc-absolute vc-inset-0 vc-h-full vc-w-full vc-object-cover vc-transition-transform vc-duration-300 vc-ease-out group-hover:vc-scale-[1.015]" />
            <div className="vc-absolute vc-inset-0 vc-bg-black/55" />
            <div className="vc-absolute vc-inset-x-5 vc-top-5 vc-text-[11px] vc-font-medium vc-uppercase vc-tracking-wide3 vc-text-voltex-goldLight">{c.marketsLabel}</div>
            <div className="vc-absolute vc-inset-x-5 vc-bottom-5">
              <h3 className="vc-text-xl vc-font-medium vc-text-white">{c.marketsTitle}</h3>
              <div className="vc-mt-3 vc-flex vc-flex-wrap vc-gap-2">{serviceGroup('markets').map((service) => <ServiceChip key={service.name} service={service} size="sm" />)}</div>
            </div>
          </article>
        </div>
      </div>
    </section>);

}
