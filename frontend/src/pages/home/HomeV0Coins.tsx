import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import type { HomeMarket } from './useHomeMarket';
import { HERO_ICONS, heroInstruments, MOBILE_SCENE_HEIGHT, ORBITS, SCENE_HEIGHT, SCENE_WIDTH, orbitPose, orbitRing, scenePrice, sceneQuote } from './v0MarketScene';
import { createCoinScene } from './v0CoinRenderer';

export function HomeV0Coins({ market }: { market: HomeMarket }) {
  const { lang } = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 900);
  const height = compact ? MOBILE_SCENE_HEIGHT : SCENE_HEIGHT;
  useEffect(() => {
    const media = matchMedia('(max-width: 900px)');
    const change = () => setCompact(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const scene = createCoinScene(element, compact);
    let inView = false;
    const sync = () => scene.setActive(inView && !document.hidden && !motion.matches);
    const observer = new IntersectionObserver(entries => {
      inView = entries[0]?.isIntersecting ?? false;
      sync();
    }, { threshold: .03 });
    observer.observe(element);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', sync);
      scene.dispose();
    };
  }, [compact]);

  return <div className="v0-coins" ref={host}>
    <svg className="v0-orbit-guides" viewBox={'0 0 ' + SCENE_WIDTH + ' ' + height} aria-hidden="true">
      {ORBITS.map((orbit, index) => <ellipse key={index} className="v0-orbit-ring" data-ring={index + 1}
        cx={205} cy={compact ? 214 : 280} rx={orbit.rx} ry={compact ? orbit.mobileRy : orbit.ry} />)}
    </svg>
    <div className="v0-coins-labels" key={compact ? 'compact' : 'desktop'}>
      {heroInstruments(compact).map((instrument, index) => {
        const pose = orbitPose(index, 0, compact);
        const quote = sceneQuote(instrument, market, lang);
        const icon = HERO_ICONS[instrument.id];
        return <div className={'v0-coin v0-coin-' + icon} key={instrument.id} data-instrument={instrument.id} data-market={instrument.market} data-ring={orbitRing(index, compact)}
          title={instrument.symbol + ' · ' + scenePrice(quote.price, lang) + ' · ' + quote.state}
          style={{ left: pose.x / SCENE_WIDTH * 100 + '%', top: pose.y / height * 100 + '%', width: pose.radius * 2 / SCENE_WIDTH * 100 + '%' }}>
          <div className="v0-coin-face"><img src={'/images/home-v0/asset-icons/' + icon + '.svg'} alt={instrument.ticker} draggable={false} />
            {index > 0 && <span className="v0-coin-symbol">{instrument.ticker}</span>}
          </div>
          {index === 0 && <div className="v0-quote" data-state={quote.state} title={instrument.symbol + ' · ' + instrument.market.toUpperCase() + ' · ' + quote.state}>
            <span>{instrument.ticker}</span><strong>{scenePrice(quote.price, lang)}</strong>
          </div>}
        </div>;
      })}
    </div>
  </div>;
}
