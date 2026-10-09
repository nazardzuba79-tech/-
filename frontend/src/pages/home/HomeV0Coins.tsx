import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import type { HomeMarket } from './useHomeMarket';
import { MOBILE_SCENE_HEIGHT, SCENE_INSTRUMENTS, SCENE_WIDTH, SCENE_HEIGHT, scenePose, scenePrice, sceneQuote } from './v0MarketScene';
import type { SceneController } from './v0CoinRenderer';
import { MEDALLION_URLS } from './v0MedallionArtwork';

export function HomeV0Coins({ market }: { market: HomeMarket }) {
  const { lang } = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<SceneController | null>(null);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 900);
  const [ready, setReady] = useState(false);
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
    setReady(false);
    let disposed = false, inView = false, starting = false;
    const sync = () => controller.current?.setActive(inView && !document.hidden && !motion.matches);
    const start = async () => {
      if (starting || controller.current || disposed) return;
      starting = true;
      try {
        const { createCoinScene } = await import('./v0CoinRenderer');
        if (disposed) return;
        const scene = await createCoinScene(element, available => { if (!disposed) setReady(available); }, compact, () => disposed);
        if (disposed || !scene) { scene?.dispose(); return; }
        controller.current = scene;
        setReady(true);
        sync();
      } catch {
        // Static, readable local medallions remain available when WebGL/import
        // is unsupported. No blank hero and no dependency on a CDN logo service.
        if (!disposed) setReady(false);
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
    };
  }, [compact]);

  return <div className="v0-coins" ref={host} data-ready={ready}>
    <div className="v0-coins-labels" key={compact ? 'compact' : 'desktop'}>
      {SCENE_INSTRUMENTS.map((instrument, slot) => {
        const id = instrument.id;
        const spot = scenePose(slot, 0, compact);
        const quote = sceneQuote(instrument, market, lang);
        return <div className={`v0-coin v0-coin-${slot}`} key={id} data-instrument={id} data-market={instrument.market} aria-hidden={spot.opacity === 0}
          style={{ opacity: spot.opacity, visibility: spot.opacity === 0 ? 'hidden' : 'visible', left: `${spot.x / SCENE_WIDTH * 100}%`, top: `${spot.y / height * 100}%`, width: `${spot.r * 2 / SCENE_WIDTH * 100}%` }}>
          <img className="v0-coin-fallback" src={MEDALLION_URLS.get(instrument.id)} alt="" aria-hidden="true" />
          <div className="v0-quote" data-state={quote.state} title={`${instrument.symbol} · ${instrument.market.toUpperCase()} · ${quote.state}`}>
            <span>{instrument.ticker}</span><strong>{scenePrice(quote.price, lang)}</strong>
          </div>
        </div>;
      })}
    </div>

  </div>;
}
