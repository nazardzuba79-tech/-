import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Pause, Play } from 'lucide-react';
import { TerminalPreview } from './TerminalPreview';
import type { HomeMarket } from './useHomeMarket';
import { useLanguage } from '../../lib/i18n';
import { HomeMarketGlobe } from './HomeMarketGlobe';
import { HomeHeroAssets } from './HomeHeroAssets';
import { useHeroStream } from './useHeroStream';
import { globalHeroCopy } from './globalHeroCopy';
import './home-global-hero.css';

export function HomeHero({ market }: { market: HomeMarket }) {
  const { lang, t } = useLanguage();
  const copy = globalHeroCopy[lang];
  const live = useHeroStream(market);
  const [paused, setPaused] = useState(false);
  return <section id="home-global-hero" className="vx-global-hero" data-motion-paused={paused} aria-labelledby="home-global-title">
    <div className="vx-global-atmosphere" aria-hidden="true"/>
    <div className="vx-global-globe"><HomeMarketGlobe/></div>
    <div className="vx-liquidity-field" aria-hidden="true"><i/><i/><i/></div>
    <div className="vx-global-layout">
      <div className="vx-global-copy">
        <p className="vx-global-eyebrow"><span/>{t('home.hero.badge')}</p>
        <h1 id="home-global-title">{t('home.hero.titleTop')}</h1>
        <p className="vx-global-subtitle">{t('home.hero.subtitle')}</p>
        <p className="vx-global-description">{t('home.hero.description')}</p>
        <div className="vx-global-actions">
          <Link to="/trade" className="vx-global-primary">{t('home.cta.openTerminal')}<ArrowRight size={17}/></Link>
          <Link to="/markets" className="vx-global-secondary">{t('home.cta.viewMarkets')}</Link>
        </div>
        <div className="vx-global-footnote"><span/>{copy.field}</div>
      </div>
      <div className="vx-global-product">
        <div className="vx-global-laptop">
          <div className="vx-laptop-screen"><span className="vx-laptop-camera" aria-hidden="true"/><TerminalPreview market={live}/></div>
          <div className="vx-laptop-base" aria-hidden="true"><span/><i/></div>
        </div>
        <HomeHeroAssets market={live}/>
      </div>
    </div>
    <button className="vx-global-motion-toggle" type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? copy.resume : copy.pause} aria-pressed={paused}>
      {paused ? <Play size={13}/> : <Pause size={13}/>}<span>{copy.globe}</span>
    </button>
  </section>;
}
