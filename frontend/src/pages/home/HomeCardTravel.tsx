import { useId, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage, type Key } from '../../lib/i18n';
import { useCardCopy } from '../crypto-card-final/useCardCopy';
import { CardBenefitIcon, type CardBenefit } from './CardBenefitIcon';
import './home-card-travel.css';

const BENEFITS: { kind: CardBenefit; title: Key; text: Key; color: string }[] = [
  { kind: 'world', title: 'home.card.benefit.world.title', text: 'home.card.benefit.world.text', color: '#d9a0b5' },
  { kind: 'apple', title: 'home.card.benefit.apple.title', text: 'home.card.benefit.apple.text', color: '#ffffff' },
  { kind: 'ai', title: 'home.card.benefit.ai.title', text: 'home.card.benefit.ai.text', color: '#ffffff' },
  { kind: 'atm', title: 'home.card.benefit.atm.title', text: 'home.card.benefit.atm.text', color: '#91b6d5' },
  { kind: 'privacy', title: 'home.card.benefit.privacy.title', text: 'home.card.benefit.privacy.text', color: '#91bea6' },
];
const LABELS = {
  ru: ['стран', 'валют', 'и Google Pay'], en: ['countries', 'currencies', 'and Google Pay'],
  es: ['países', 'monedas', 'y Google Pay'], hi: ['देश', 'मुद्राएँ', 'और Google Pay'],
  ja: ['か国以上', '通貨以上', 'と Google Pay'], ko: ['개국', '개 통화', '및 Google Pay'],
  zh: ['个国家', '种货币', '与 Google Pay'],
};

/** Approved Titanium artwork; localized copy and card navigation remain native UI. */
export function HomeCardTravel() {
  const { lang, t } = useLanguage();
  const { c } = useCardCopy();
  const id = useId().replace(/:/g, '');
  const labels = LABELS[lang];
  return <section id="card" className="vx-travel-card" aria-labelledby={`${id}-title`} data-hand-variant="titanium-soft">
    <div className="vx-travel-main">
      <div className="vx-travel-visual">
        <img className="vx-travel-image" src="/cards/travel/voltex-titanium-soft.png" width={1448} height={1086} loading="lazy" decoding="async" alt="VOLTEX Crypto Card" />
      </div>
      <div className="vx-travel-copy">
        <div className="vx-travel-label">{t('home.card.name')}</div>
        <h2 id={`${id}-title`}>{lang === 'ru' && c.heroTitle === 'Трать крипту по всему миру' ? <>Трать крипту<br /><span>по всему миру</span></> : c.heroTitle}</h2>
        <p>{t('home.card.text')}</p>
        <div className="vx-travel-actions">
          <Link to="/card" className="vx-travel-primary">{t('home.cta.getCard')}<ArrowRight size={17} aria-hidden="true" /></Link>
          <Link to="/card" className="vx-travel-secondary">{t('home.card.learnMore')}</Link>
        </div>
        <div className="vx-travel-stats">
          <div><strong>180+</strong><span>{labels[0]}</span></div>
          <div><strong>50+</strong><span>{labels[1]}</span></div>
          <div><strong>Apple Pay</strong><span>{labels[2]}</span></div>
        </div>
      </div>
    </div>
    <ul className="vx-travel-benefits">
      {BENEFITS.map(benefit => <li key={benefit.kind} style={{ '--benefit-color': benefit.color } as CSSProperties}>
        <CardBenefitIcon kind={benefit.kind} />
        <div><h3>{t(benefit.title)}</h3><p>{benefit.kind === 'atm' && lang === 'ru' ? 'Снятие наличных во всех банкоматах.' : t(benefit.text)}</p></div>
      </li>)}
    </ul>
  </section>;
}
