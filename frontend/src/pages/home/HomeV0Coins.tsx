import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import type { HomeMarket } from './useHomeMarket';
import { HERO_INSTRUMENTS, MOBILE_SCENE_HEIGHT, SCENE_HEIGHT, SCENE_WIDTH, orbitPose, scenePrice, sceneQuote } from './v0MarketScene';
import { createCoinScene } from './v0CoinRenderer';

const ICONS = ['btc', 'apple', 'gold', 'eth', 'nvidia', 'us500', 'oil', 'eurusd'];

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
    <div className="v0-coins-labels" key={compact ? 'compact' : 'desktop'}>
      {HERO_INSTRUMENTS.map((instrument, index) => {
        const pose = orbitPose(index, 0, compact);
        const quote = sceneQuote(instrument, market, lang);
        return <div className={'v0-coin v0-coin-' + ICONS[index]} key={instrument.id} data-instrument={instrument.id} data-market={instrument.market}
          style={{ left: pose.x / SCENE_WIDTH * 100 + '%', top: pose.y / height * 100 + '%', width: pose.radius * 2 / SCENE_WIDTH * 100 + '%' }}>
          <div className="v0-coin-face"><img src={'/images/home-v0/asset-icons/' + ICONS[index] + '.svg'} alt={instrument.ticker} draggable={false} /></div>
          <div className="v0-quote" data-state={quote.state} title={instrument.symbol + ' · ' + instrument.market.toUpperCase() + ' · ' + quote.state}>
            <span>{instrument.ticker}</span><strong>{scenePrice(quote.price, lang)}</strong>
          </div>
        </div>;
      })}
    </div>
  </div>;
}
