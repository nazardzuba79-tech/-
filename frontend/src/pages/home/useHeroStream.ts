import { useEffect, useMemo, useState } from 'react';
import { krakenSocket } from '../../lib/krakenSocket';
import type { HomeMarket } from './useHomeMarket';
import { combineHeroFeed, startHeroStream, type HeroStreamSnapshot } from './heroStream';

/** The shared exchange socket only has homepage subscribers while the hero
 * is visible. Stream state belongs to this subtree, not the entire homepage. */
export function useHeroStream(market: HomeMarket): HomeMarket {
  const [live, setLive] = useState<HeroStreamSnapshot | null>(null);
  const pair = market.hero.pair;
  const source = market.tickerSource;
  useEffect(() => {
    setLive(null);
    if (!pair || source.toLowerCase() !== 'kraken') return;
    let visible = false;
    let stop: (() => void) | undefined;
    const sync = () => {
      if (visible && !document.hidden) {
        if (!stop) stop = startHeroStream(krakenSocket, pair, setLive);
      } else if (stop) { stop(); stop = undefined; setLive(null); }
    };
    const target = document.getElementById('home-global-hero');
    const observer = typeof IntersectionObserver !== 'undefined' && target
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }) : null;
    if (observer && target) observer.observe(target);
    else { visible = true; sync(); }
    document.addEventListener('visibilitychange', sync);
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', sync); stop?.(); };
  }, [pair, source]);
  return useMemo(() => ({ ...market, hero: combineHeroFeed(market.hero, source.toLowerCase() === 'kraken' ? live : null) }), [market, live, source]);
}
