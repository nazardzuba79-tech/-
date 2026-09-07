import { Link } from 'react-router-dom';
import { StarIcon } from 'lucide-react';
import { CardBenefitIcon, type CardBenefit } from './CardBenefitIcon';
import { WatchCardVisual } from '../crypto-card-final/components/WatchCardVisual';
import { useCardCopy } from '../crypto-card-final/useCardCopy';
import { Key, useLanguage } from '../../lib/i18n';

const BENEFITS: { key: CardBenefit; titleKey: Key; textKey: Key }[] = [
  { key: 'world', titleKey: 'home.card.benefit.world.title', textKey: 'home.card.benefit.world.text' },
  { key: 'apple', titleKey: 'home.card.benefit.apple.title', textKey: 'home.card.benefit.apple.text' },
  { key: 'ai', titleKey: 'home.card.benefit.ai.title', textKey: 'home.card.benefit.ai.text' },
  { key: 'atm', titleKey: 'home.card.benefit.atm.title', textKey: 'home.card.benefit.atm.text' },
  { key: 'privacy', titleKey: 'home.card.benefit.privacy.title', textKey: 'home.card.benefit.privacy.text' },
];

export function HomeCardSection() {
  const { lang, t } = useLanguage();
  const { c } = useCardCopy();
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

        <div className="relative grid grid-cols-1 items-center gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.35fr)_minmax(0,0.75fr)] lg:gap-7 lg:py-9 lg:pl-3 lg:pr-6">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-gold-500/35 bg-gold-500/[0.08] px-3 py-[5px] text-[10px] font-medium uppercase tracking-[0.13em] text-gold-400">
              <StarIcon size={10} fill="#f0c45a" />
              {t('home.card.name')}
            </span>
            <h2 className="mt-5 text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-white lg:text-[34px]">
              {c.heroTitle}
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

          {/* The same owner-approved wrist artwork as the Crypto Card hero. */}
          <div className="relative flex items-center justify-center py-4">
            <div className="vx-home-card-artwork">
              <WatchCardVisual framing="homepage" />
            </div>
          </div>

          <ul className="space-y-5">
            {BENEFITS.map(({ key, titleKey, textKey }) => (
              <li key={key} className="flex gap-3">
                <span
                  className="mt-[1px] flex h-[42px] w-[42px] shrink-0 items-center justify-center"
                >
                  <CardBenefitIcon kind={key} />
                </span>
                <div className="min-w-0 leading-snug">
                  <div className="text-[15px] font-semibold text-white">{t(titleKey)}</div>
                  <p className="mt-1 text-[13px] leading-[1.5] text-[#a7b0bd]">
                    {key === 'atm' && lang === 'ru' ? 'Снятие наличных во всех банкоматах.' : t(textKey)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
