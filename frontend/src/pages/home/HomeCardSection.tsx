import { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { BrainCircuitIcon, FingerprintIcon, GlobeIcon, LandmarkIcon, StarIcon } from 'lucide-react';
import { HomeCryptoCard } from './HomeCryptoCard';
import { Key, useLanguage } from '../../lib/i18n';

/** Apple's mark is a brand asset, not a UI glyph — Lucide's generic apple
 *  outline reads as fruit, so the wordmark silhouette is drawn here as a
 *  plain path in currentColor. Nothing is downloaded and no logo is
 *  reconstructed beyond the familiar monochrome silhouette. */
function AppleMark({ size = 18 }: { size?: number | string; strokeWidth?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.36 12.78c.02-2.16 1.77-3.2 1.85-3.25-1.01-1.48-2.58-1.68-3.14-1.7-1.34-.13-2.61.79-3.29.79-.68 0-1.72-.77-2.83-.75-1.46.02-2.8.85-3.55 2.15-1.51 2.63-.39 6.52 1.09 8.65.72 1.04 1.58 2.21 2.71 2.17 1.09-.04 1.5-.7 2.82-.7 1.31 0 1.69.7 2.84.68 1.17-.02 1.91-1.06 2.63-2.11.83-1.21 1.17-2.38 1.19-2.44-.03-.01-2.28-.88-2.3-3.49zM14.2 6.3c.6-.73 1-1.74.89-2.75-.86.03-1.9.57-2.52 1.29-.55.64-1.03 1.67-.9 2.65.96.08 1.93-.49 2.53-1.19z" />
    </svg>
  );
}

/**
 * Five benefits, five genuinely different symbols and five different
 * accent tones — the prototype's generic set (a sparkle for AI, a
 * hand-of-coins for ATM) is replaced with marks that actually read as
 * what they label. All from Lucide, the package already installed, at one
 * consistent 18px / 1.75 stroke inside a 34px container; the only
 * non-Lucide mark is the Apple silhouette above.
 *
 * Copy stays deliberately unspecific: no ATM counts, no country lists, no
 * guarantees the product cannot back.
 */
const BENEFITS: {
  key: string;
  Icon: ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  titleKey: Key;
  textKey: Key;
  shape: string;
  frame: string;
  tint: string;
}[] = [
  {
    key: 'world',
    Icon: GlobeIcon,
    titleKey: 'home.card.benefit.world.title',
    textKey: 'home.card.benefit.world.text',
    shape: 'rounded-full',
    frame: 'border-gold-500/40 bg-gold-500/[0.08]',
    tint: 'text-gold-400',
  },
  {
    key: 'apple',
    Icon: AppleMark,
    titleKey: 'home.card.benefit.apple.title',
    textKey: 'home.card.benefit.apple.text',
    shape: 'rounded-[8px]',
    frame: 'border-white/20 bg-white/[0.07]',
    tint: 'text-white',
  },
  {
    key: 'ai',
    Icon: BrainCircuitIcon,
    titleKey: 'home.card.benefit.ai.title',
    textKey: 'home.card.benefit.ai.text',
    shape: 'rounded-[8px]',
    frame: 'border-[#4f97b8]/40 bg-[#3d8fb5]/[0.12]',
    tint: 'text-[#8fc9dd]',
  },
  {
    key: 'atm',
    Icon: LandmarkIcon,
    titleKey: 'home.card.benefit.atm.title',
    textKey: 'home.card.benefit.atm.text',
    shape: 'rounded-[4px]',
    frame: 'border-[#5f7794]/40 bg-[#3f556f]/[0.18]',
    tint: 'text-[#9fb2c9]',
  },
  {
    key: 'privacy',
    Icon: FingerprintIcon,
    titleKey: 'home.card.benefit.privacy.title',
    textKey: 'home.card.benefit.privacy.text',
    shape: 'rounded-full',
    frame: 'border-up/35 bg-up/[0.08]',
    tint: 'text-up',
  },
];

export function HomeCardSection() {
  const { t } = useLanguage();
  return (
    <section id="card" className="mx-auto w-full max-w-[1460px] px-6">
      <div className="relative overflow-hidden rounded-[10px] border border-white/6 bg-[#07090d]">
        {/* Warm depth under the card. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(42%_78%_at_50%_50%,rgba(224,169,63,0.18),transparent_70%)]"
        />
        {/* Asymmetric sweeping arcs — off-centre, rotated, each showing only
            one edge, so they read as directional light rather than the
            concentric target rings the prototype drew behind the card. */}
        <div
          aria-hidden="true"
          className="vx-arc pointer-events-none absolute left-[46%] top-[54%] h-[300px] w-[620px] -translate-x-1/2 -translate-y-1/2 rotate-[-14deg] rounded-[100%] border-t border-gold-500/25"
        />
        <div
          aria-hidden="true"
          className="vx-arc-slow pointer-events-none absolute left-[54%] top-[44%] h-[420px] w-[760px] -translate-x-1/2 -translate-y-1/2 rotate-[8deg] rounded-[100%] border-b border-gold-500/[0.14]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-[50%] top-[66%] h-[160px] w-[440px] -translate-x-1/2 rotate-[-6deg] rounded-[100%] bg-[radial-gradient(50%_60%_at_50%_0%,rgba(224,169,63,0.20),transparent_72%)] blur-[2px]"
        />

        <div className="relative grid grid-cols-1 items-center gap-8 p-7 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,300px)] lg:gap-6 lg:p-9">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-gold-500/35 bg-gold-500/[0.08] px-3 py-[5px] text-[10px] font-medium uppercase tracking-[0.13em] text-gold-400">
              <StarIcon size={10} fill="#f0c45a" />
              {t('home.card.name')}
            </span>
            <h2 className="mt-5 text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-white lg:text-[34px]">
              {t('home.card.titleTop')}
              <span className="block">{t('home.card.titleBottom')}</span>
            </h2>
            <p className="mt-4 max-w-[320px] text-[13px] leading-relaxed text-home-muted">
              {t('home.card.text')}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to="/card"
                className="rounded-md bg-gold-500 px-5 py-[10px] text-[13px] font-semibold text-ink-950 transition-colors duration-150 hover:bg-gold-400 active:translate-y-[1px]"
              >
                {t('home.cta.getCard')}
              </Link>
              <Link
                to="/card"
                className="rounded-md border border-white/12 bg-white/[0.03] px-5 py-[10px] text-[13px] font-medium text-white transition-colors duration-150 hover:border-white/25"
              >
                {t('home.card.learnMore')}
              </Link>
            </div>
          </div>

          {/* Main card — sweep offset from the hero's so the two never
              travel together. */}
          <div className="relative flex items-center justify-center py-4">
            <HomeCryptoCard width={320} animated sweepDelay={3.5} hover className="max-w-full" />
          </div>

          <ul className="space-y-4">
            {BENEFITS.map(({ key, Icon, titleKey, textKey, shape, frame, tint }) => (
              <li key={key} className="flex gap-3">
                <span
                  className={`mt-[1px] flex h-[34px] w-[34px] shrink-0 items-center justify-center border ${shape} ${frame} ${tint}`}
                >
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <div className="leading-snug">
                  <div className="text-[13px] font-semibold text-white">{t(titleKey)}</div>
                  <p className="mt-[3px] text-[11.5px] text-home-muted">{t(textKey)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
