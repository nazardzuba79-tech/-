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
  // On first paint tickerSource is intentionally still empty while the much
  // heavier all-pairs REST snapshot is loading. The hero pair is already the
  // canonical BTC/USDT, so start the real Kraken socket immediately; if the
  // eventual source is not Kraken this effect tears it down automatically.
  const canStream = source === '' || source.toLowerCase() === 'kraken';
  useEffect(() => {
    setLive(null);
    if (!pair || !canStream) return;
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
  }, [pair, canStream]);
  return useMemo(() => ({ ...market, hero: combineHeroFeed(market.hero, canStream ? live : null) }), [market, live, canStream]);
}
