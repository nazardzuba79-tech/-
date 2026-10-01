import { useState } from 'react';
import { Check } from 'lucide-react';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { DepositModal } from '../components/DepositModal';
import { localeOf, useLanguage, type Key } from '../lib/i18n';
import { openSupportWidget } from '../lib/supportWidget';
import { OtcExchangeForm } from './otc/OtcExchangeForm';
import { COUNTRY_CODES, PAIR_COUNT, TIERS, type OtcTier, type TierId } from './otc/otcConfig';
import './otc/otc.css';

/**
 * The OTC page, as the owner's approved design (OTC.zip, 2026-09-30): a
 * hero with the three tiers, then one section per tier.
 *
 * Nothing here is an OTC desk. There is no quote, no matching and no order:
 * the form collects what the client has in mind, says in so many words that
 * the rate, fee and payout are agreed with a manager, and every «Оставить
 * заявку» opens the real deposit window — the one integration point the
 * design names. «Связаться с менеджером» opens the support form, which does
 * reach a person. The figures under the hero are counted from the lists the
 * page actually offers, not typed in.
 */

const COPY: Record<TierId, { subtitle: Key; description: Key; features: [Key, Key, Key] }> = {
  'otc-convert': { subtitle: 'otc.convert.subtitle', description: 'otc.convert.description', features: ['otc.convert.f1', 'otc.convert.f2', 'otc.convert.f3'] },
  'cash-exchange': { subtitle: 'otc.cash.subtitle', description: 'otc.cash.description', features: ['otc.cash.f1', 'otc.cash.f2', 'otc.cash.f3'] },
  'private-otc': { subtitle: 'otc.private.subtitle', description: 'otc.private.description', features: ['otc.private.f1', 'otc.private.f2', 'otc.private.f3'] },
};

interface Point { title: Key; text: Key; items: [Key, Key] }
const CONVERT_POINTS: Point[] = [
  { title: 'otc.convert.p1Title', text: 'otc.convert.p1Text', items: ['otc.convert.p1a', 'otc.convert.p1b'] },
  { title: 'otc.convert.p2Title', text: 'otc.convert.p2Text', items: ['otc.convert.p2a', 'otc.convert.p2b'] },
];
const CASH_POINTS: Point[] = [
  { title: 'otc.cash.p1Title', text: 'otc.cash.p1Text', items: ['otc.cash.p1a', 'otc.cash.p1b'] },
  { title: 'otc.cash.p2Title', text: 'otc.cash.p2Text', items: ['otc.cash.p2a', 'otc.cash.p2b'] },
];
const PRIVATE_POINTS: Key[] = ['otc.private.p1', 'otc.private.p2', 'otc.private.p3', 'otc.private.p4'];

/** «340+», «100+»: the count rounded down to a ten, never up. */
const atLeast = (n: number) => `${Math.floor(n / 10) * 10}+`;

function tierById(id: TierId): OtcTier {
  return TIERS.find((tier) => tier.id === id)!;
}

export function OtcPage() {
  const { t, lang } = useLanguage();
  const [depositOpen, setDepositOpen] = useState(false);
  const minLabel = (tier: OtcTier) => t('otc.minFrom', { amount: `$${tier.minUsd.toLocaleString(localeOf(lang))}` });
  const openDeposit = () => setDepositOpen(true);

  const stats = [
    { value: atLeast(PAIR_COUNT), label: t('otc.statPairs') },
    { value: '24/7', label: t('otc.statSupport') },
    { value: 'T+0', label: t('otc.statSettlement') },
    { value: atLeast(COUNTRY_CODES.length), label: t('otc.statCountries') },
  ];

  const convert = tierById('otc-convert');
  const cash = tierById('cash-exchange');
  const privateTier = tierById('private-otc');

  return (
    <div className="vx-otc">
      <Nav active="/otc" />
      <main>
        <section className="otc-hero">
          <div className="otc-hero-bg" aria-hidden="true">
            <img src="/media/otc/hero-skyline.webp" alt="" width="1408" height="768" decoding="async" fetchPriority="high" />
          </div>
          <div className="otc-wrap otc-hero-inner">
            <div className="otc-hero-head">
              <h1>{t('otc.heroTitle')}</h1>
              <p className="otc-hero-lead">{t('otc.heroLead')}</p>
            </div>

            <div className="otc-tiers">
              {TIERS.map((tier) => (
                <div key={tier.id} className={`otc-tier${tier.accent ? ' is-accent' : ''}`}>
                  {tier.accent && <span className="otc-tier-badge">{t('otc.popular')}</span>}
                  <div className="otc-tier-head">
                    <h3>{tier.name}</h3>
                    <p className="otc-tier-sub">{t(COPY[tier.id].subtitle)}</p>
                  </div>
                  <ul>
                    {[...COPY[tier.id].features.map((key) => t(key)), minLabel(tier)].map((line) => (
                      <li key={line}><Check className="otc-check" size={16} aria-hidden="true" /><span>{line}</span></li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className={`otc-btn ${tier.accent ? 'otc-btn-orange' : 'otc-btn-ghost'}`}
                    onClick={() => document.getElementById(tier.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    {t('otc.tierCta')} →
                  </button>
                </div>
              ))}
            </div>

            <dl className="otc-stats">
              {stats.map((stat) => (
                <div key={stat.label} className="otc-stat">
                  <dt className="otc-sr">{stat.label}</dt>
                  <dd className="otc-stat-value">{stat.value}</dd>
                  <dd className="otc-stat-label" aria-hidden="true">{stat.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="otc-convert" className="otc-section">
          <div className="otc-wrap otc-grid">
            <div>
              <SectionTitle name={convert.name} subtitle={t(COPY['otc-convert'].subtitle)} />
              <p className="otc-desc">{t(COPY['otc-convert'].description)}</p>
              <Points points={CONVERT_POINTS} />
              <div className="otc-figure">
                <img src="/media/otc/convert-orbit.webp" alt={t('otc.convert.imageAlt')} width="1000" height="545" loading="lazy" decoding="async" />
              </div>
            </div>
            <div className="otc-form-right">
              <OtcExchangeForm tier="otc-convert" minLabel={minLabel(convert)} onRequest={openDeposit} />
            </div>
          </div>
        </section>

        <section id="cash-exchange" className="otc-section is-soft">
          <div className="otc-wrap otc-grid">
            <div className="otc-form-left">
              <OtcExchangeForm tier="cash-exchange" showCountry minLabel={minLabel(cash)} onRequest={openDeposit} />
            </div>
            <div className="otc-copy-right">
              <SectionTitle name={cash.name} subtitle={t(COPY['cash-exchange'].subtitle)} orange />
              <p className="otc-desc">{t(COPY['cash-exchange'].description)}</p>
              <Points points={CASH_POINTS} />
              <div className="otc-figure">
                <img src="/media/otc/currency-globe.webp" alt={t('otc.cash.imageAlt')} width="1000" height="545" loading="lazy" decoding="async" />
              </div>
            </div>
          </div>
        </section>

        <section id="private-otc" className="otc-section">
          <div className="otc-wrap otc-grid">
            <div className="otc-figure is-wide">
              <img src="/media/otc/private-network.webp" alt={t('otc.private.imageAlt')} width="1200" height="655" loading="lazy" decoding="async" />
            </div>
            <div>
              <SectionTitle name={privateTier.name} subtitle={t(COPY['private-otc'].subtitle)} />
              <p className="otc-desc">{t(COPY['private-otc'].description)}</p>
              <ul className="otc-list">
                {PRIVATE_POINTS.map((key) => (
                  <li key={key}><Check className="otc-check" size={16} aria-hidden="true" />{t(key)}</li>
                ))}
              </ul>
              <p className="otc-min">{t('otc.private.perDeal', { min: minLabel(privateTier) })}</p>
              <button type="button" className="otc-btn otc-btn-orange otc-private-cta" onClick={openSupportWidget}>
                {t('otc.private.cta')} →
              </button>
            </div>
          </div>
        </section>
      </main>
      <div className="otc-wrap otc-footer"><Footer /></div>
      {depositOpen && <DepositModal onClose={() => setDepositOpen(false)} source="otc" />}
    </div>
  );
}

function SectionTitle({ name, subtitle, orange = false }: { name: string; subtitle: string; orange?: boolean }) {
  return (
    <div className="otc-title-row">
      <h2>{name}</h2>
      <span className={`otc-chip${orange ? ' is-orange' : ''}`}>{subtitle}</span>
    </div>
  );
}

function Points({ points }: { points: Point[] }) {
  const { t } = useLanguage();
  return (
    <div className="otc-points">
      {points.map((point) => (
        <div key={point.title} className="otc-point">
          <h3>{t(point.title)}</h3>
          <p>{t(point.text)}</p>
          <ul>
            {point.items.map((key) => (
              <li key={key}><Check className="otc-check" size={14} aria-hidden="true" />{t(key)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
