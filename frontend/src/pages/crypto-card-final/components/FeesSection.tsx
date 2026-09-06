import { cardProducts } from '../data/products';
import { useCardCopy } from '../useCardCopy';

export function FeesSection() {
  const { c } = useCardCopy();
  return <section id="fees" className="vc-bg-[#E4E3DD] vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-32">
    <div className="vc-mx-auto vc-max-w-[1180px]">
      <p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-black/70">{c.feesLabel}</p>
      <h2 className="vc-mt-6 vc-text-[clamp(2.4rem,3.4vw,3.4rem)] vc-font-medium vc-leading-[1.06] vc-tracking-[-0.04em]">{c.feesTitle}</h2>
      <div className="vc-mt-14 vc-border-y vc-border-black/25">
        <div className="vc-grid vc-gap-5 vc-py-9 lg:vc-grid-cols-[1fr_1fr]">
          <div><p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-black/70">{c.noCharge}</p><h3 className="vc-mt-3 vc-text-2xl vc-font-medium">{c.issuanceServicing}</h3></div>
          <p className="vc-self-center vc-text-xl vc-font-medium">{c.freeBoth}</p>
        </div>
        <div className="vc-border-t vc-border-black/20 vc-py-10">
          <h3 className="vc-text-[12px] vc-font-semibold vc-uppercase vc-tracking-wide2 vc-text-black/70">{c.tierCashback}</h3>
          <div className="vc-mt-6 vc-grid vc-gap-7 sm:vc-grid-cols-2">{cardProducts.map((card, index) => <div key={card.id} data-card-terms={card.id}>
            <p className="vc-text-sm vc-font-medium">{card.name}</p>
            <p className={'vc-mt-3 vc-text-[38px] vc-leading-tight vc-tracking-[-0.04em] sm:vc-text-[46px] ' + (index === 1 ? 'vc-font-semibold' : 'vc-font-medium')}>{c.upTo} {card.cashback}</p>
          </div>)}</div>
        </div>
        <div className="vc-grid vc-gap-5 vc-border-t vc-border-black/20 vc-py-9 lg:vc-grid-cols-2">
          <h3 className="vc-text-[12px] vc-font-semibold vc-uppercase vc-tracking-wide2 vc-text-black/70">{c.subscriptionCompensation}</h3>
          <p className="vc-max-w-md vc-text-2xl vc-font-medium vc-leading-snug">{c.subscriptionCompensationValue}</p>
        </div>
        <div className="vc-border-t vc-border-black/20 vc-py-10">
          <h3 className="vc-text-[12px] vc-font-semibold vc-uppercase vc-tracking-wide2 vc-text-black/70">{c.cardLimit}</h3>
          <div className="vc-mt-6 vc-grid vc-gap-7 sm:vc-grid-cols-2">{cardProducts.map((card, index) => <div key={card.id} data-card-limit={card.id}>
            <p className="vc-text-sm vc-font-medium">{card.name}</p>
            <p className={'vc-mt-3 vc-text-[38px] vc-leading-tight vc-tracking-[-0.04em] sm:vc-text-[46px] ' + (index === 1 ? 'vc-font-semibold' : 'vc-font-medium')}>{card.monthlyLimit}</p>
            <p className="vc-mt-2 vc-text-base vc-text-black/75">{c.monthly}</p>
          </div>)}</div>
        </div>
      </div>
      <p className="vc-mt-6 vc-max-w-3xl vc-text-sm vc-leading-6 vc-text-black/80">{c.feesNote}</p>
    </div>
  </section>;
}
