import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChartNoAxesCombined, Globe2, ShieldCheck, Zap, Pause, Play } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import type { HomeMarket } from './useHomeMarket';
import { useHeroStream } from './useHeroStream';
import { MotionStage } from './HomeMotion';
import { HomeHeroAssets } from './HomeHeroAssets';
import { HomeTicker } from './HomeTicker';
import { HeroReferenceScene } from './HeroReferenceScene';
import { globalHeroCopy } from './globalHeroCopy';

export function HomeHero({ market }: { market: HomeMarket }) {
  const { lang, t } = useLanguage();
  const live = useHeroStream(market);
  const [paused, setPaused] = useState(false);
  const copy = globalHeroCopy[lang];
  const badges = [
    { Icon: ChartNoAxesCombined, title: t('nav.markets') },
    { Icon: ShieldCheck, title: t('trade.marketInfo') },
    { Icon: Globe2, title: t('nav.futures') },
    { Icon: Zap, title: t('nav.trade') },
  ];
  return <MotionStage className="vx-reference-motion vx-hero-stage" tilt>
    <section id="home-global-hero" className="vx-reference-stage" data-motion-paused={paused} aria-labelledby="vx-reference-title">
      <HeroReferenceScene market={live}/>
      <div className="vx-reference-copy">
        <p className="vx-reference-eyebrow">GLOBAL MARKETS. REAL OPPORTUNITIES.<span/></p>
        <h1 id="vx-reference-title"><span>OWN YOUR</span>{' '}<span>FUTURE<span className="vx-reference-period">.</span></span></h1>
        <p className="vx-reference-subtitle">{t('home.hero.subtitle')}</p>
        <p className="vx-reference-description">{t('home.hero.description')}</p>
        <div className="vx-reference-actions">
          <Link to="/trade" className="vx-reference-primary">{t('home.cta.openTerminal')}<ArrowRight size={19}/></Link>
          <Link to="/markets" className="vx-reference-secondary">{t('home.cta.viewMarkets')}</Link>
        </div>
        <div className="vx-reference-badges">{badges.map(({ Icon, title }, index) => <div key={index}>
          <span><Icon size={20} strokeWidth={1.4}/></span><small>{title}</small>
        </div>)}</div>
      </div>
      <HomeHeroAssets market={live}/>
      <button className="vx-reference-pause" type="button" aria-label={paused ? copy.resume : copy.pause} aria-pressed={paused} onClick={() => setPaused(value => !value)}>
        {paused ? <Play size={12}/> : <Pause size={12}/>}<span>{copy.globe}</span>
      </button>
      <div className="vx-reference-tape"><HomeTicker market={market}/></div>
    </section>
  </MotionStage>;
}
