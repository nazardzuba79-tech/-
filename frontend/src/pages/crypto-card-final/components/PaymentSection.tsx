import { CardScene } from './CardScene';

export function PaymentSection() {
  return (
    <section id="possibilities" className="vc-bg-voltex-cream vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
      <div className="vc-mx-auto vc-max-w-[1344px]">
        <div className="vc-mb-14 vc-grid vc-gap-8 vc-border-b vc-border-black/20 vc-pb-10 lg:vc-grid-cols-[1fr_0.45fr] lg:vc-items-end">
          <h2 className="vc-max-w-4xl vc-text-[clamp(3rem,6vw,6.8rem)] vc-font-medium vc-leading-[0.94] vc-tracking-[-0.065em]">Больше от каждой оплаты.</h2>
          <p className="vc-max-w-sm vc-text-[17px] vc-leading-8 vc-text-black/80 lg:vc-justify-self-end">VOLTEX Card становится частью ежедневных платежей — от кофе перед вылетом до ужина в другом городе.</p>
        </div>
        <div className="vc-relative vc-min-h-[620px] vc-overflow-hidden vc-bg-[#1c1713] sm:vc-min-h-[760px]">
          <CardScene kind="pos" />
          <div className="vc-absolute vc-inset-0 vc-bg-black/25" />
          <div className="vc-absolute vc-inset-y-0 vc-left-0 vc-w-full vc-bg-black/55 sm:vc-w-[52%]" />
          <div className="vc-absolute vc-inset-x-6 vc-top-7 vc-flex vc-items-center vc-justify-between vc-border-t vc-border-white/50 vc-pt-4 vc-text-[11px] vc-font-medium vc-uppercase vc-tracking-wide3 vc-text-white/90 sm:vc-inset-x-10 lg:vc-inset-x-14">
            <span>Everyday payments</span><span>01 / 07</span>
          </div>
          <div className="vc-absolute vc-bottom-10 vc-left-6 vc-right-6 vc-text-white sm:vc-bottom-14 sm:vc-left-10 sm:vc-right-auto lg:vc-left-14">
            <div className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-voltex-goldLight">Кэшбэк</div>
            <div className="vc-mt-4 vc-font-display vc-text-[clamp(4rem,10vw,9rem)] vc-leading-[0.82] vc-tracking-[-0.05em]">До 20%</div>
            <p className="vc-mt-6 vc-max-w-md vc-text-[14px] vc-leading-7 vc-text-white/85">Размер кэшбэка зависит от категории покупки, выбранного тарифа и условий программы VOLTEX Card.</p>
          </div>
        </div>
      </div>
    </section>);

}
