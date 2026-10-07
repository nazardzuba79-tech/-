import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { cfdDisplayState } from '../../lib/cfdPresentation';
import { LiveValue } from './LiveValue';
import { finiteQuote } from './HomeHeroAssets';
import type { HomeMarket } from './useHomeMarket';
import { HERO_INSTRUMENTS } from './heroInstruments';
import { initialMarketPose, marketTileFrames, MARKET_CYCLE_MS, MARKET_POSES, MARKET_STEP_MS } from './marketPlatformMotion';
import './home-market-platform.css';

const instruments = HERO_INSTRUMENTS.filter((instrument) => instrument.enabled);

export function HomeMarketPlatformHero({ market }: { market: HomeMarket }) {
  const { lang, t } = useLanguage();
  const scene = useRef<HTMLDivElement>(null);
  const manualPause = useRef(false);
  const synchronize = useRef<(() => void) | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const element = scene.current;
    if (!element) return;
    const focusRegion = element.parentElement!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let intersecting = false;
    let hovered = false;
    let focused = false;
    let disposed = false;
    const animations: Animation[] = [];

    function sync() {
      if (disposed) return;
      const reasons = [document.hidden && 'hidden', !intersecting && 'offscreen', manualPause.current && 'manual', hovered && 'hover', focused && 'focus', reduced.matches && 'reduced-motion'].filter(Boolean);
      const running = reasons.length === 0;
      element!.dataset.motionState = running ? 'running' : 'paused';
      element!.dataset.motionReason = reasons.join(' ');
      // Reduced motion gets the complete original composition, even when the
      // preference changes halfway through a transition.
      animations.forEach((animation, index) => {
        if (running) animation.play();
        else animation.pause();
        if (reduced.matches) animation.currentTime = initialMarketPose(index) * MARKET_STEP_MS;
      });
    }

    if (typeof element.animate === 'function') {
      element.querySelectorAll<HTMLElement>('[data-market-tile]').forEach((tile, index) => {
        const animation = tile.animate(marketTileFrames(), { duration: MARKET_CYCLE_MS, iterations: Infinity, fill: 'both' });
        animation.pause();
        animation.currentTime = initialMarketPose(index) * MARKET_STEP_MS;
        animations.push(animation);
      });
    }
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; sync(); }, { threshold: 0 });
    const enter = (event: PointerEvent) => { if (event.pointerType !== 'touch') { hovered = true; sync(); } };
    const leave = () => { hovered = false; sync(); };
    const focus = () => { focused = true; sync(); };
    const blur = (event: FocusEvent) => { if (!focusRegion.contains(event.relatedTarget as Node | null)) { focused = false; sync(); } };
    observer.observe(element);
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    focusRegion.addEventListener('focusin', focus);
    focusRegion.addEventListener('focusout', blur);
    synchronize.current = sync;
    sync();
    return () => {
      disposed = true;
      synchronize.current = null;
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', sync);
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      focusRegion.removeEventListener('focusin', focus);
      focusRegion.removeEventListener('focusout', blur);
      animations.forEach((animation) => animation.cancel());
    };
  }, []);

  function toggleMotion() {
    manualPause.current = !manualPause.current;
    setPaused(manualPause.current);
    synchronize.current?.();
  }

  return (
    <div className="vm-orbit" data-market-platform-hero>
      <div id="home-market-column" className="vm-orbit-scene" ref={scene} data-market-visual data-motion-state="paused" role="group" aria-label={t('home.hero.sceneAria')}>
        {instruments.map((instrument, index) => {
          const commoditySymbol = instrument.instrumentId === 'cfd:XAUUSD' ? 'XAUUSD' : 'WTIUSD';
          const commodity = instrument.category === 'commodity' ? market.cfd?.tickers.find(row => row.symbol === commoditySymbol) : undefined;
          const pair = instrument.symbol + '/USDT';
          const ticker = market.tickers.find(row => row.pair === pair);
          const heroPrice = instrument.symbol === 'BTC' && market.hero.pair === pair && !market.hero.stale ? finiteQuote(market.hero.livePrice) : null;
          const price = instrument.category === 'commodity' ? finiteQuote(commodity?.price) : heroPrice != null && heroPrice > 0 ? heroPrice : finiteQuote(ticker?.price);
          const fresh = instrument.category === 'commodity' ? cfdDisplayState(commodity, lang).tone === 'live' : !market.tickersStale;
          const visiblePrice = fresh && price != null && price > 0 ? price : null;
          return (
            <div className="vm-card" data-market-tile={instrument.symbol} key={instrument.instrumentId} style={MARKET_POSES[initialMarketPose(index)]} aria-label={instrument.displayName}>
              <span className="vm-coin"><span className="vm-coin-face">
                <img src={instrument.logoPath} alt="" width="46" height="46" draggable={false} onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />
                <span className="vm-card-symbol">{instrument.symbol}</span>
                {instrument.category === 'crypto' && <span className="vm-coin-pair">{instrument.symbol} / USDT</span>}
              </span></span>
              {visiblePrice != null && <LiveValue className="vm-card-price" value={visiblePrice} format={value => value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} />}
            </div>
          );
        })}
      </div>
      <button type="button" className="vm-motion-toggle" data-motion-toggle onClick={toggleMotion} aria-pressed={paused} aria-label={t(paused ? 'home.hero.resumeMotion' : 'home.hero.pauseMotion')} title={t(paused ? 'home.hero.resumeMotion' : 'home.hero.pauseMotion')}>
        {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
      </button>
    </div>
  );
}
