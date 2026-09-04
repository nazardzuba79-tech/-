import { HOME_INSTITUTION_NAMES } from './homeContent';
import { useLanguage } from '../../lib/i18n';

export function HomeInstitutional() {
  const { t } = useLanguage();

  return (
    <section className="mx-auto w-full max-w-[1460px] px-6" aria-labelledby="home-institutional-title">
      <div className="vx-institutional rounded-[10px] border border-black/[0.07] bg-[#f1f3f6] px-5 py-8 text-[#111722] shadow-[0_20px_55px_rgba(0,0,0,0.16)] sm:px-8 sm:py-10 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.28fr)] lg:items-center">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9a6e1e]">{t('home.institutional.eyebrow')}</span>
            <h2 id="home-institutional-title" className="mt-3 max-w-[520px] text-[27px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[34px]">
              {t('home.institutional.title')}
            </h2>
            <p className="mt-4 max-w-[560px] text-[13px] leading-relaxed text-[#5f6876] sm:text-[14px]">{t('home.institutional.subtitle')}</p>
          </div>

          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" aria-label={t('home.institutional.listAria')}>
            {HOME_INSTITUTION_NAMES.map((name) => (
              <li key={name} className="vx-institution-mark flex min-h-[72px] items-center justify-center rounded-[7px] border border-black/[0.075] bg-white/75 px-3 text-center text-[13px] font-semibold tracking-[-0.01em] text-[#222a36] sm:min-h-[80px] sm:text-[14px]">
                {name}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-7 border-t border-black/[0.07] pt-4 text-[10.5px] leading-relaxed text-[#7a8390]">{t('home.institutional.disclaimer')}</p>
      </div>
    </section>
  );
}

