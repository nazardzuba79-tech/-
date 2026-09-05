import { ArrowDownIcon, CheckIcon, SmartphoneIcon, WalletCardsIcon } from 'lucide-react';

const steps = [
{ number: '01', title: 'Оформите карту', text: 'Пройдите верификацию и выберите подходящий уровень VOLTEX Card.', icon: WalletCardsIcon },
{ number: '02', title: 'Пополните баланс', text: 'Добавьте поддерживаемую криптовалюту или фиат в приложении.', icon: ArrowDownIcon },
{ number: '03', title: 'Платите и управляйте', text: 'Используйте карту, отслеживайте операции и контролируйте лимиты.', icon: SmartphoneIcon }];


export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="vc-bg-voltex-cream vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
      <div className="vc-mx-auto vc-max-w-[1344px]">
        <div className="vc-flex vc-items-end vc-justify-between vc-gap-8 vc-border-b vc-border-black/15 vc-pb-9">
          <h2 className="vc-text-[clamp(3.2rem,6vw,6.8rem)] vc-font-medium vc-leading-[0.94] vc-tracking-[-0.065em]">Начать просто.</h2>
          <span className="vc-hidden vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-black/75 sm:vc-block">How it works</span>
        </div>
        <div className="vc-grid lg:vc-grid-cols-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <article key={step.number} className={`vc-flex vc-min-h-[350px] vc-flex-col vc-justify-between vc-border-black/15 vc-py-9 lg:vc-min-h-[450px] lg:vc-px-9 ${index < steps.length - 1 ? "vc-border-b lg:vc-border-b-0 lg:vc-border-r" : ""} ${index === 0 ? "lg:vc-pl-0" : ""}`}>
                <div className="vc-flex vc-items-center vc-justify-between"><span className="vc-font-display vc-text-4xl vc-text-voltex-gold">{step.number}</span><Icon size={21} strokeWidth={1.5} /></div>
                <div><h3 className="vc-text-3xl vc-font-medium vc-tracking-[-0.04em]">{step.title}</h3><p className="vc-mt-5 vc-max-w-sm vc-text-[15px] vc-leading-7 vc-text-voltex-creamMuted">{step.text}</p><div className="vc-mt-8 vc-flex vc-h-8 vc-w-8 vc-items-center vc-justify-center vc-rounded-full vc-border vc-border-black/20"><CheckIcon size={14} /></div></div>
              </article>);

          })}
        </div>
      </div>
    </section>);

}
