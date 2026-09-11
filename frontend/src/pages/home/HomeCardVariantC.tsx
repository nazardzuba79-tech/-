import { Link } from 'react-router-dom';
import { StarIcon } from 'lucide-react';
import { Key, useLanguage } from '../../lib/i18n';
import { useCardCopy } from '../crypto-card-final/useCardCopy';
import { CardBenefitIcon, type CardBenefit } from './CardBenefitIcon';
import { HomeCardSceneC } from './HomeCardSceneC';
import './home-card-variant-c.css';

// Deliberately isolated from HomeCardSection: A and B keep their original DOM.
const BENEFITS: { key: CardBenefit; titleKey: Key; textKey: Key }[] = [
  { key: 'world', titleKey: 'home.card.benefit.world.title', textKey: 'home.card.benefit.world.text' },
  { key: 'apple', titleKey: 'home.card.benefit.apple.title', textKey: 'home.card.benefit.apple.text' },
  { key: 'ai', titleKey: 'home.card.benefit.ai.title', textKey: 'home.card.benefit.ai.text' },
  { key: 'atm', titleKey: 'home.card.benefit.atm.title', textKey: 'home.card.benefit.atm.text' },
  { key: 'privacy', titleKey: 'home.card.benefit.privacy.title', textKey: 'home.card.benefit.privacy.text' },
];

export function HomeCardVariantC() {
  const { lang, t } = useLanguage();
  const { c } = useCardCopy();
  return (
    <section id="card" className="vx-card-c" aria-labelledby="vx-card-c-title">
      <div className="vx-card-c-composition">
        <div className="vx-card-c-copy">
          <div className="vx-card-c-message">
            <span className="vx-card-c-label"><StarIcon size={10} fill="currentColor" aria-hidden="true" />{t('home.card.name')}</span>
            <h2 id="vx-card-c-title">{c.heroTitle}</h2>
            <p>{t('home.card.text')}</p>
          </div>
          <div className="vx-card-c-actions">
            <Link to="/card" className="vx-card-c-primary">{t('home.cta.getCard')}</Link>
            <Link to="/card" className="vx-card-c-secondary">{t('home.card.learnMore')}</Link>
          </div>
        </div>

        <HomeCardSceneC />

        <ul className="vx-card-c-features">
          {BENEFITS.map(({ key, titleKey, textKey }) => (
            <li key={key} className={`vx-card-c-feature vx-card-c-feature-${key}`}>
              <CardBenefitIcon kind={key} />
              <div>
                <h3>{t(titleKey)}</h3>
                <p>{key === 'atm' && lang === 'ru' ? 'Снятие наличных во всех банкоматах.' : t(textKey)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
