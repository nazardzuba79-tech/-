import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { MotionStage } from './HomeMotion';
import { HomeInstitutionNetwork } from './HomeInstitutionNetwork';
import './home-ecosystem.css';

// Original brand assets and exact sources: docs/HOMEPAGE_INSTITUTION_SOURCES.md.
const institutions = [
  { id: 'nasdaq', name: 'Nasdaq', logo: 'nasdaq.svg' },
  { id: 'nyse', name: 'NYSE', logo: 'nyse.svg' },
  { id: 'cme', name: 'CME Group', logo: 'cme.svg' },
  { id: 'jpmorgan', name: 'J.P. Morgan', logo: 'jpmorgan.svg' },
  { id: 'goldman', name: 'Goldman Sachs', logo: 'goldman.svg' },
  { id: 'morganstanley', name: 'Morgan Stanley', logo: 'morganstanley.svg' },
] as const;

export function HomeEcosystem() {
  const { t } = useLanguage();
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = section.current;
    if (!element || typeof IntersectionObserver === 'undefined') { setEntered(true); return; }
    // One reveal per mount; MotionStage suspends all decoration when hidden.
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { setEntered(true); observer.disconnect(); }
    }, { threshold: .12 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <MotionStage className="vx-ecosystem-stage">
      <section ref={section} id="ecosystem" className="vx-ecosystem" aria-labelledby="vx-ecosystem-title"
        data-paused={paused} data-entered={entered}>
        <div className="vx-eco-atmosphere" aria-hidden="true" />
        <div className="vx-eco-intro">
          <span className="vx-eco-eyebrow">{t('home.ecosystem.label')}</span>
          <h2 id="vx-ecosystem-title">{t('home.ecosystem.title')}</h2>
          <p>{t('home.ecosystem.subtitle')}</p>
        </div>
        <button type="button" className="vx-eco-motion-control" onClick={() => setPaused(value => !value)}
          aria-pressed={paused} aria-label={t(paused ? 'home.ecosystem.resume' : 'home.ecosystem.pause')}>
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
        <div className="vx-eco-field">
          <HomeInstitutionNetwork />
          <div className="vx-eco-core" aria-hidden="true">
            <span className="vx-eco-core-cross" />
            <span>{t('home.ecosystem.globalMarkets')}</span>
            <span className="vx-eco-core-rule" />
          </div>
          <div className="vx-eco-micro vx-eco-micro-equities" aria-hidden="true">{t('home.ecosystem.equities')}</div>
          <div className="vx-eco-micro vx-eco-micro-derivatives" aria-hidden="true">{t('home.ecosystem.derivatives')}</div>
          <div className="vx-eco-micro vx-eco-micro-capital" aria-hidden="true">{t('home.ecosystem.capitalMarkets')}</div>
          <ul className="vx-eco-institutions">
            {institutions.map((institution, index) => (
              <li key={institution.id} className={`vx-eco-node vx-eco-node-${institution.id}`}
                style={{ '--vx-eco-reveal-delay': `${index * 90}ms` } as CSSProperties}>
                <button type="button" className="vx-eco-institution" aria-label={institution.name}
                  aria-describedby={`vx-eco-${institution.id}`} aria-expanded={selected === institution.id}
                  onClick={() => setSelected(value => value === institution.id ? null : institution.id)}
                  data-selected={selected === institution.id}>
                  <span className="vx-eco-logo-space">
                    <img src={`/institutions/${institution.logo}`} alt="" width="220" height="64" loading="lazy" decoding="async" />
                  </span>
                  <span className="vx-eco-descriptor" id={`vx-eco-${institution.id}`}>{t(`home.ecosystem.${institution.id}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </MotionStage>
  );
}
