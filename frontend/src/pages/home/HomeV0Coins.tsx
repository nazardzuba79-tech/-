import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { Pause, Play } from 'lucide-react';
import { globalHeroCopy } from './globalHeroCopy';
import type { HomeMarket } from './useHomeMarket';
import { MOBILE_SCENE_HEIGHT, MOBILE_SCENE_SPOTS, SCENE_INSTRUMENTS, SCENE_SPOTS, SCENE_WIDTH, SCENE_HEIGHT, scenePrice, sceneQuote } from './v0MarketScene';
import type { SceneController } from './v0CoinRenderer';

export function HomeV0Coins({ market }: { market: HomeMarket }) {
  const { lang } = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<SceneController | null>(null);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 900);
  const [ids, setIds] = useState(SCENE_INSTRUMENTS.slice(0, 8).map(x => x.id));
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const syncRef = useRef(() => {});
  pausedRef.current = paused;
  const spots = compact ? MOBILE_SCENE_SPOTS : SCENE_SPOTS;
  const height = compact ? MOBILE_SCENE_HEIGHT : SCENE_HEIGHT;
  useEffect(() => { syncRef.current(); }, [paused]);

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
    setIds(SCENE_INSTRUMENTS.slice(0, compact ? 4 : 8).map(x => x.id));
    setReady(false);
    let disposed = false, inView = false, starting = false;
    const sync = () => controller.current?.setActive(inView && !document.hidden && !motion.matches && !pausedRef.current);
    syncRef.current = sync;
    const start = async () => {
      if (starting || controller.current || disposed) return;
      starting = true;
      try {
        const { createCoinScene } = await import('./v0CoinRenderer');
        if (disposed) return;
        controller.current = createCoinScene(element, next => setIds(next), () => setReady(false), compact);
        setReady(true);
        sync();
      } catch {
        // Static, readable local medallions remain available when WebGL/import
        // is unsupported. No blank hero and no dependency on a CDN logo service.
        setReady(false);
      }
    };
    const observer = new IntersectionObserver(entries => {
      inView = entries[0]?.isIntersecting ?? false;
      if (inView && !document.hidden) void start();
      sync();
    }, { threshold: 0.03 });
    observer.observe(element);
    const visibility = () => { if (!document.hidden && inView) void start(); sync(); };
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', sync);
    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', sync);
      controller.current?.dispose();
      controller.current = null;
      syncRef.current = () => {};
    };
  }, [compact]);

  return <div className="v0-coins" ref={host} data-ready={ready}>
    <div className="v0-coins-labels">
      {ids.slice(0, spots.length).map((id, slot) => {
        const instrument = SCENE_INSTRUMENTS.find(x => x.id === id)!;
        const spot = spots[slot];
        const quote = sceneQuote(instrument, market, lang);
        return <div className={`v0-coin v0-coin-${slot}`} key={slot} data-instrument={id} data-market={instrument.market}
          style={{ left: `${spot.x / SCENE_WIDTH * 100}%`, top: `${spot.y / height * 100}%`, width: `${spot.r * 2 / SCENE_WIDTH * 100}%` }}>
          <div className={`v0-coin-fallback v0-metal-${instrument.metal}`} aria-hidden="true">{instrument.ticker}</div>
          <div className="v0-quote" data-state={quote.state} title={`${instrument.symbol} · ${instrument.market.toUpperCase()} · ${quote.state}`}>
            <span>{instrument.ticker}</span><strong>{scenePrice(quote.price, lang)}</strong>
          </div>
        </div>;
      })}
    </div>
    <div className="v0-pedestal-fallback" aria-hidden="true" />
    {ready && <button type="button" className="v0-motion-toggle" aria-label={paused ? globalHeroCopy[lang].resume : globalHeroCopy[lang].pause}
      aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? <Play size={13} aria-hidden="true"/> : <Pause size={13} aria-hidden="true"/>}</button>}
  </div>;
}
