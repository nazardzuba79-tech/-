const COLUMN_GRID = "lg:vc-grid lg:vc-grid-cols-[1fr_0.4fr_0.44fr] lg:vc-gap-12";

export function FeesSection() {
  return (
    <section id="fees" className="vc-bg-[#E4E3DD] vc-px-5 vc-py-24 vc-text-voltex-creamText sm:vc-px-8 lg:vc-px-12 lg:vc-py-32">
      <div className="vc-mx-auto vc-max-w-[1180px]">
        <div className="vc-grid vc-gap-8 lg:vc-grid-cols-[1fr_0.62fr] lg:vc-items-end">
          <div>
            <p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-black/70">Тарифы и условия</p>
            <h2 className="vc-mt-6 vc-max-w-2xl vc-text-[clamp(2.4rem,3.4vw,3.4rem)] vc-font-medium vc-leading-[1.06] vc-tracking-[-0.04em]">Прозрачные условия<br />без мелкого шрифта.</h2>
          </div>
          <p className="vc-max-w-md vc-text-[16px] vc-leading-7 vc-text-black/80">Все ключевые параметры карты видны до оформления. Ниже — сравнение двух уровней VOLTEX Card.</p>
        </div>

        <div className={`vc-mt-16 vc-border-b vc-border-black/25 vc-pb-4 ${COLUMN_GRID}`}>
          <span className="vc-hidden lg:vc-block" />
          <span className="vc-hidden vc-text-[12px] vc-font-semibold vc-uppercase vc-tracking-wide2 vc-text-black/70 lg:vc-block">Titanium</span>
          <span className="vc-hidden vc-items-center vc-gap-2 vc-text-[12px] vc-font-bold vc-uppercase vc-tracking-wide2 vc-text-black lg:vc-flex">
            <i className="vc-h-1.5 vc-w-1.5 vc-rounded-full vc-bg-voltex-gold" aria-hidden="true" />Black Signature
          </span>
        </div>

        <div className={`vc-border-b vc-border-black/20 vc-py-9 ${COLUMN_GRID} lg:vc-items-center`}>
          <div>
            <p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-black/70">Без платы</p>
            <h3 className="vc-mt-3 vc-text-[22px] vc-font-semibold vc-leading-snug vc-tracking-[-0.02em] sm:vc-text-[26px]">Выпуск и обслуживание</h3>
            <p className="vc-mt-2 vc-text-[15px] vc-leading-7 vc-text-black/75">Бесплатно для обеих карт.</p>
          </div>
          <ValueCell tier="Titanium" value="Бесплатно" scale="compact" />
          <ValueCell tier="Black Signature" value="Бесплатно" scale="compact" primary />
        </div>

        <div className={`vc-border-b vc-border-black/20 vc-py-14 ${COLUMN_GRID} lg:vc-items-end`}>
          <div>
            <p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-black/70">Кэшбэк за покупки</p>
            <h3 className="vc-mt-4 vc-max-w-sm vc-text-[28px] vc-font-medium vc-leading-[1.1] vc-tracking-[-0.03em] sm:vc-text-[34px]">Больше от каждой оплаты</h3>
            <p className="vc-mt-4 vc-max-w-md vc-text-[15px] vc-leading-7 vc-text-black/80">Размер зависит от категории покупки и условий программы.</p>
          </div>
          <ValueCell tier="Titanium" value="до 10–15%" scale="hero" />
          <ValueCell tier="Black Signature" value="до 15–20%" scale="hero" primary />
        </div>

        <div className={`vc-border-b vc-border-black/20 vc-py-12 ${COLUMN_GRID} lg:vc-items-end`}>
          <div>
            <p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-black/70">Компенсация подписок</p>
            <h3 className="vc-mt-4 vc-max-w-md vc-text-[20px] vc-font-medium vc-leading-snug vc-tracking-[-0.02em] sm:vc-text-[23px]">До 100% стоимости выбранных подписок</h3>
            <p className="vc-mt-4 vc-max-w-md vc-text-[15px] vc-leading-7 vc-text-black/80">Список сервисов и размер компенсации определяются программой VOLTEX Card.</p>
          </div>
          <ValueCell tier="Titanium" value="до 100%" scale="medium" />
          <ValueCell tier="Black Signature" value="до 100%" scale="medium" primary />
        </div>

        <div className={`vc-py-16 ${COLUMN_GRID} lg:vc-items-end`}>
          <div>
            <p className="vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 vc-text-black/70">Лимит по карте</p>
            <h3 className="vc-mt-4 vc-max-w-sm vc-text-[28px] vc-font-medium vc-leading-[1.1] vc-tracking-[-0.03em] sm:vc-text-[34px]">Разный масштаб операций</h3>
          </div>
          <ValueCell tier="Titanium" value="$50 000" caption="в месяц" scale="hero" />
          <ValueCell tier="Black Signature" value="$1 000 000" caption="в месяц" scale="limit" primary />
        </div>

        <div className="vc-border-t vc-border-black/25 vc-pt-7">
          <p className="vc-max-w-3xl vc-text-[14px] vc-leading-7 vc-text-black/80">Точные тарифы, лимиты, доступность функций и размер вознаграждений зависят от региона, уровня карты и актуальных условий программы VOLTEX Card. Информация отображается до оформления.</p>
        </div>
      </div>
    </section>);

}

interface ValueCellProps {
  tier: string;
  value: string;
  caption?: string;
  scale: 'compact' | 'medium' | 'hero' | 'limit';
  primary?: boolean;
}

const scales: Record<ValueCellProps['scale'], string> = {
  compact: "vc-text-[20px] vc-leading-tight sm:vc-text-[22px]",
  medium: "vc-text-[30px] vc-leading-none sm:vc-text-[34px]",
  hero: "vc-text-[38px] vc-leading-none sm:vc-text-[46px]",
  limit: "vc-text-[42px] vc-leading-none sm:vc-text-[56px]"
};

function ValueCell({ tier, value, caption, scale, primary }: ValueCellProps) {
  return (
    <div className="vc-mt-7 vc-border-t vc-border-black/15 vc-pt-4 lg:vc-mt-0 lg:vc-border-t-0 lg:vc-pt-0">
      <p className={`vc-text-[11px] vc-font-semibold vc-uppercase vc-tracking-wide3 lg:vc-hidden ${primary ? "vc-text-black" : "vc-text-black/70"}`}>{tier}</p>
      <p className={`vc-mt-2 vc-tracking-[-0.03em] lg:vc-mt-0 ${scales[scale]} ${primary ? "vc-font-semibold vc-text-black" : "vc-font-medium vc-text-black/85"}`}>{value}</p>
      {caption && <p className="vc-mt-3 vc-text-[15px] vc-font-medium vc-leading-6 vc-text-black/75">{caption}</p>}
    </div>);

}
