import { BellIcon, EyeOffIcon, FingerprintIcon, LockKeyholeIcon, ShieldCheckIcon, SlidersHorizontalIcon } from 'lucide-react';

const controls = [
{ title: 'Мгновенная заморозка', text: 'Остановите операции одним касанием.', icon: LockKeyholeIcon },
{ title: 'Гибкие лимиты', text: 'Настраивайте покупки и снятие наличных.', icon: SlidersHorizontalIcon },
{ title: 'Уведомления', text: 'Получайте подтверждение каждой операции.', icon: BellIcon }];


export function ControlSecuritySection() {
  return (
    <section className="vc-bg-voltex-black vc-text-white">
      <div className="vc-mx-auto vc-max-w-[1440px] vc-border-x vc-border-white/[0.07]">
        <div className="vc-grid vc-border-b vc-border-white/[0.08] lg:vc-grid-cols-2">
          <div className="vc-px-5 vc-py-24 sm:vc-px-8 lg:vc-px-12 lg:vc-py-32">
            <p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-voltex-goldLight">Privacy by design</p>
            <h2 className="vc-mt-8 vc-max-w-xl vc-text-[clamp(3.1rem,5vw,5.7rem)] vc-font-medium vc-leading-[0.95] vc-tracking-[-0.06em]">Приватность — часть продукта.</h2>
            <p className="vc-mt-8 vc-max-w-lg vc-text-[17px] vc-leading-8 vc-text-voltex-muted">Данные карты скрыты в интерфейсе по умолчанию. Чувствительные действия требуют отдельного подтверждения.</p>
          </div>
          <div className="vc-relative vc-grid vc-min-h-[580px] vc-place-items-center vc-overflow-hidden vc-border-t vc-border-white/[0.08] vc-bg-voltex-panel lg:vc-border-l lg:vc-border-t-0">
            <div className="vc-absolute vc-h-[400px] vc-w-[400px] vc-rounded-full vc-border vc-border-white/[0.07] sm:vc-h-[470px] sm:vc-w-[470px]" />
            <div className="vc-absolute vc-h-[270px] vc-w-[270px] vc-rounded-full vc-border vc-border-voltex-gold/25 sm:vc-h-[320px] sm:vc-w-[320px]" />
            <div className="vc-relative vc-flex vc-flex-col vc-items-center"><EyeOffIcon size={44} strokeWidth={1.1} className="vc-text-voltex-goldLight" /><span className="vc-mt-5 vc-text-[11px] vc-font-medium vc-uppercase vc-tracking-wide3 vc-text-voltex-muted">Protected view</span></div>
          </div>
        </div>

        <div className="vc-grid lg:vc-grid-cols-[0.75fr_1.25fr]">
          <div className="vc-flex vc-flex-col vc-justify-between vc-border-b vc-border-white/[0.08] vc-px-5 vc-py-20 sm:vc-px-8 lg:vc-min-h-[680px] lg:vc-border-b-0 lg:vc-border-r lg:vc-px-12 lg:vc-py-24">
            <div><p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-voltex-goldLight">Card control</p><h2 className="vc-mt-8 vc-text-[clamp(3rem,4vw,4.7rem)] vc-font-medium vc-leading-[0.97] vc-tracking-[-0.055em]">Карта под вашим контролем.</h2></div>
            <div className="vc-mt-16 vc-space-y-8">{controls.map((item) => {const Icon = item.icon;return <div key={item.title} className="vc-grid vc-grid-cols-[42px_1fr] vc-gap-4 vc-border-t vc-border-white/20 vc-pt-5"><Icon size={20} className="vc-text-voltex-gold" /><div><h3 className="vc-text-[16px] vc-font-medium">{item.title}</h3><p className="vc-mt-2 vc-text-[14px] vc-leading-6 vc-text-voltex-muted">{item.text}</p></div></div>;})}</div>
          </div>
          <div className="vc-flex vc-min-h-[680px] vc-flex-col vc-justify-between vc-bg-[#EEECE6] vc-px-5 vc-py-20 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-24">
            <div className="vc-flex vc-items-center vc-justify-between"><p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-black/75">Security infrastructure</p><ShieldCheckIcon size={28} strokeWidth={1.3} /></div>
            <div className="vc-my-16 vc-flex vc-justify-center"><div className="vc-relative vc-grid vc-h-60 vc-w-60 vc-place-items-center vc-rounded-full vc-border vc-border-black/20 sm:vc-h-80 sm:vc-w-80"><div className="vc-grid vc-h-36 vc-w-36 vc-place-items-center vc-rounded-full vc-bg-voltex-creamText vc-text-voltex-cream sm:vc-h-44 sm:vc-w-44"><FingerprintIcon size={64} strokeWidth={1} /></div></div></div>
            <div><h2 className="vc-max-w-2xl vc-text-[clamp(3rem,4.5vw,5.2rem)] vc-font-medium vc-leading-[0.95] vc-tracking-[-0.06em]">Безопасность на каждом уровне.</h2><p className="vc-mt-7 vc-max-w-xl vc-text-[16px] vc-leading-7 vc-text-voltex-creamMuted">Многоуровневое подтверждение, мониторинг операций и оперативный контроль доступа помогают защищать средства и данные.</p></div>
          </div>
        </div>
      </div>
    </section>);

}
