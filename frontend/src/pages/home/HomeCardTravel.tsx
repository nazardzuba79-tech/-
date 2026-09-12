import { useId, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage, type Key } from '../../lib/i18n';
import { useCardCopy } from '../crypto-card-final/useCardCopy';
import { CardBenefitIcon, type CardBenefit } from './CardBenefitIcon';
import './home-card-travel.css';

const BENEFITS: { kind: CardBenefit; title: Key; text: Key; color: string }[] = [
  { kind: 'world', title: 'home.card.benefit.world.title', text: 'home.card.benefit.world.text', color: '#edbd69' },
  { kind: 'apple', title: 'home.card.benefit.apple.title', text: 'home.card.benefit.apple.text', color: '#dfebf4' },
  { kind: 'ai', title: 'home.card.benefit.ai.title', text: 'home.card.benefit.ai.text', color: '#54d9c1' },
  { kind: 'atm', title: 'home.card.benefit.atm.title', text: 'home.card.benefit.atm.text', color: '#61b4ff' },
  { kind: 'privacy', title: 'home.card.benefit.privacy.title', text: 'home.card.benefit.privacy.text', color: '#56d59d' },
];
const LABELS = {
  ru: ['стран', 'валют', 'и Google Pay'], en: ['countries', 'currencies', 'and Google Pay'],
  es: ['países', 'monedas', 'y Google Pay'], hi: ['देश', 'मुद्राएँ', 'और Google Pay'],
  ja: ['か国以上', '通貨以上', 'と Google Pay'], ko: ['개국', '개 통화', '및 Google Pay'],
  zh: ['个国家', '种货币', '与 Google Pay'],
};
const CITIES = [
  { name: 'London', x: '51.32%', y: '33%', delay: '-3s' },
  { name: 'New York', x: '40.6%', y: '47%', delay: '-7s' },
  { name: 'Dubai', x: '50.66%', y: '58.3%', delay: '-1s' },
  { name: 'Singapore', x: '38.9%', y: '73%', delay: '-5s' },
  { name: 'Tokyo', x: '50.55%', y: '82.5%', delay: '-9s' },
];

/** The selected hand-retouch A is part of the image layer. Text and CTAs
 * remain real localized UI; the archived homepage A/B/C renderers are separate. */
export function HomeCardTravel() {
  const { lang, t } = useLanguage();
  const { c } = useCardCopy();
  const id = useId().replace(/:/g, '');
  const labels = LABELS[lang];
  return <section id="card" className="vx-travel-card" aria-labelledby={`${id}-title`} data-hand-variant="A">
    <div className="vx-travel-main">
      <div className="vx-travel-visual">
        <img className="vx-travel-image" src="/cards/travel/scene-A.png" width={1672} height={664} loading="lazy" decoding="async" alt="VOLTEX Crypto Card" />
        <svg className="vx-travel-routes" aria-hidden="true" viewBox="0 0 1672 664">
          <defs>
            <mask id={`${id}-mask`}><image href="/cards/travel/center-mask.png" width="1672" height="664" /></mask>
            <linearGradient id={`${id}-gold`} x1="590" y1="550" x2="1100" y2="330" gradientUnits="userSpaceOnUse">
              <stop stopColor="#efc078" stopOpacity="0" /><stop offset=".4" stopColor="#efc078" stopOpacity=".65" /><stop offset=".8" stopColor="#ffe4b4" stopOpacity=".8" /><stop offset="1" stopColor="#efc078" stopOpacity="0" />
            </linearGradient>
            <path id={`${id}-warm`} pathLength="1000" d="M587 509 C728 654 965 597 1101 409" />
            <path id={`${id}-cool`} pathLength="1000" d="M671 345 C681 160 935 148 1111 240" />
          </defs>
          <g mask={`url(#${id}-mask)`} fill="none">
            <use href={`#${id}-warm`} stroke={`url(#${id}-gold)`} strokeWidth="1.5" />
            <use href={`#${id}-cool`} stroke="#b0cfdb" strokeWidth="1" opacity=".25" />
            <path d="M596 484 C789 530 862 415 1070 310" stroke={`url(#${id}-gold)`} strokeWidth=".8" opacity=".45" />
            <use className="vx-travel-moving-light" href={`#${id}-warm`} stroke="#ffe1a9" strokeWidth="2" strokeDasharray="14 986" strokeLinecap="round" />
            <use className="vx-travel-moving-light vx-travel-cool-light" href={`#${id}-cool`} stroke="#c8e7ee" strokeWidth="1.4" strokeDasharray="10 990" strokeLinecap="round" />
          </g>
        </svg>
        <div className="vx-travel-destinations" aria-hidden="true">
          {CITIES.map(city => <span className="vx-travel-city" key={city.name} style={{ '--city-x': city.x, '--city-y': city.y, '--city-delay': city.delay } as CSSProperties}><i />{city.name}</span>)}
        </div>
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
