import { Link } from 'react-router-dom';
import { StarIcon } from 'lucide-react';
import { TerminalPreview } from './TerminalPreview';
import { PhonePreview } from './PhonePreview';
import { HomeMarket } from './useHomeMarket';
import { useLanguage } from '../../lib/i18n';

/**
 * Hero: copy on the left at ~36%, the product on the right at ~64%. The
 * terminal is the dominant visual and everything else in the composition
 * is arranged around it.
 *
 * The lighting behind it is exactly that — lighting. Layered navy
 * radial washes, one faint directional haze and a soft horizon, all
 * pointer-events-none and all moving only a few pixels (see .vx-atmos in
 * home.css). No blobs, particles, grids or neon.
 */
export function HomeHero({ market }: { market: HomeMarket }) {
  const { t } = useLanguage();
  return (
    <section className="relative">
      {/* --- ambient depth behind the terminal --- */}
      <div
        aria-hidden="true"
        className="vx-atmos pointer-events-none absolute inset-x-0 top-0 h-[760px] bg-[radial-gradient(70%_95%_at_64%_46%,rgba(28,66,128,0.46),transparent_72%)]"
      />
      <div
        aria-hidden="true"
        className="vx-atmos-alt pointer-events-none absolute inset-x-0 top-[24%] h-[560px] bg-[radial-gradient(45%_70%_at_66%_58%,rgba(48,102,182,0.26),transparent_70%)]"
      />
      {/* restrained horizon under the terminal */}
      <div
        aria-hidden="true"
        className="vx-atmos pointer-events-none absolute left-[14%] top-[62%] hidden h-[280px] w-[80%] rounded-[100%] border-t border-[#4d86d6]/40 bg-[radial-gradient(58%_82%_at_50%_0%,rgba(61,118,196,0.22),transparent_74%)] lg:block"
      />
      {/* upper-left ambient illumination — the area that used to read empty */}
      <div
        aria-hidden="true"
        className="vx-atmos-alt pointer-events-none absolute -left-[14%] -top-[18%] h-[620px] w-[720px] bg-[radial-gradient(50%_50%_at_50%_50%,rgba(30,62,116,0.32),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-[420px] w-[46%] bg-[linear-gradient(160deg,rgba(22,44,84,0.30),rgba(5,7,10,0)_62%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[6%] top-0 hidden h-[300px] w-[300px] rotate-[18deg] bg-[linear-gradient(to_bottom,rgba(126,167,224,0.08),transparent_78%)] blur-[26px] lg:block"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(126,167,224,0.20),transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[220px] bg-[linear-gradient(to_bottom,transparent,#05070a)]"
      />

      <div className="relative mx-auto grid w-full max-w-[1460px] grid-cols-1 items-center gap-10 px-6 pb-16 pt-9 lg:grid-cols-[minmax(0,36fr)_minmax(0,64fr)] lg:gap-8 lg:pt-12">
        {/* ---------------- left: copy ---------------- */}
        <div className="vx-enter">
          <span className="inline-flex max-w-full items-center gap-2 rounded-[6px] border border-white/10 bg-white/[0.04] px-3 py-[5px] text-[9.5px] font-medium uppercase tracking-[0.11em] text-white/75">
            <StarIcon size={10} className="shrink-0 text-gold-400" fill="#f0c45a" />
            {/* The full institutional line on desktop; a shorter variant
                only where the long one would wrap awkwardly. */}
            <span className="hidden sm:inline">{t('home.hero.badge')}</span>
            <span className="sm:hidden">{t('home.hero.badgeShort')}</span>
          </span>

          <h1 className="mt-5 text-[32px] font-bold leading-[1.07] tracking-[-0.022em] text-[#f2f5f9] sm:text-[38px] lg:text-[42px] xl:text-[46px] 2xl:text-[50px]">
            {t('home.hero.titleTop')}
            <span className="block text-gold-500">{t('home.hero.titleBottom')}</span>
          </h1>

          <p className="mt-4 max-w-[420px] text-[13.5px] leading-relaxed text-home-muted xl:text-[14.5px]">
            {t('home.hero.subtitle')}
          </p>

          {/* Both CTAs lead into the product itself. The Crypto Card has its
              own dedicated section further down the page; advertising it up
              here only competed with the terminal the hero is built around. */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              to="/trade"
              className="rounded-[6px] bg-gold-500 px-5 py-[10px] text-[13px] font-semibold text-ink-950 transition-colors duration-150 ease-out hover:bg-gold-400 active:translate-y-[1px] active:bg-gold-600"
            >
              {t('home.cta.openTerminal')}
            </Link>
            <Link
              to="/markets"
              className="inline-flex items-center gap-2 rounded-[6px] border border-white/12 bg-white/[0.03] px-5 py-[10px] text-[13px] font-medium text-white transition-colors duration-150 ease-out hover:border-white/25 hover:bg-white/[0.06] active:translate-y-[1px]"
            >
              {t('home.cta.viewMarkets')}
            </Link>
          </div>
        </div>

        {/* ---------------- right: product ---------------- */}
        <div className="relative lg:-mr-6 xl:-mr-10">
          <div className="vx-enter lg:pl-6">
            <TerminalPreview market={market} />
            <div className="mx-auto mt-[6px] h-[7px] w-[86%] rounded-b-[5px] bg-[#1a2029]" />
          </div>

          {/* phone overlay — secondary, clear of the terminal's own data */}
          <div className="vx-enter absolute -bottom-6 left-0 hidden lg:block" style={{ animationDelay: '120ms' }}>
            <PhonePreview market={market} />
          </div>
        </div>
      </div>
    </section>
  );
}
