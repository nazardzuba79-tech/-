import { CardWaitlist } from '../CardWaitlist';

export function FinalCtaFooter({ reviewOnly = false }: { reviewOnly?: boolean }) {
  return <section id="apply" className="voltex-grid vc-overflow-hidden vc-border-y vc-border-white/[0.08] vc-bg-voltex-black vc-px-5 vc-py-24 vc-text-white sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
    <div className="vc-mx-auto vc-grid vc-max-w-[1344px] vc-items-center vc-gap-16 lg:vc-grid-cols-[1fr_0.75fr]">
      <div><p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-voltex-goldLight">VOLTEX Card</p><h2 className="vc-mt-8 vc-max-w-4xl vc-text-[clamp(2.8rem,6.5vw,7.2rem)] vc-font-medium vc-leading-[0.92] vc-tracking-[-0.07em]">Новая точка доступа к вашим деньгам.</h2><p className="vc-mt-8 vc-max-w-md vc-text-[17px] vc-leading-8 vc-text-voltex-muted">Оставьте заявку на VOLTEX Card. После запуска программы оформление будет доступно на условиях вашего региона и уровня верификации.</p><div className="vc-mt-10"><CardWaitlist reviewOnly={reviewOnly} /></div></div>
      <div className="vc-relative vc-mx-auto vc-w-full vc-max-w-[560px]"><img className="crypto-card-art" src="/cards/crypto-card-final/voltex-cards-phone-register.webp" alt="VOLTEX Card и приложение — дизайн программы" loading="lazy" decoding="async" /></div>
    </div>
  </section>;
}
