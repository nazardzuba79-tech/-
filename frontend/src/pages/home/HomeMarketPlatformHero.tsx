import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Pause, Play } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import type { HomeMarket } from './useHomeMarket';
import { HERO_INSTRUMENTS } from './heroInstruments';
import { initialMarketPose, marketTileFrames, MARKET_CYCLE_MS, MARKET_POSES, MARKET_STEP_MS } from './marketPlatformMotion';
import './home-market-platform.css';

const instruments = HERO_INSTRUMENTS.filter((instrument) => instrument.enabled);

export function HomeMarketPlatformHero(_props: { market: HomeMarket }) {
  const { t } = useLanguage();
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
    const animations: Animation[] = [];

    function sync() {
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
    <section className="vm-hero" data-market-platform-hero aria-labelledby="vm-hero-title">
      <div className="vm-scene-wrap">
        {/* Keep the shared market hook's existing visibility target. Animation
            pause is deliberately independent of its data-refresh lifecycle. */}
        <div id="home-live-terminal" className="vm-scene" ref={scene} data-market-visual data-motion-state="paused" role="img" aria-label={t('home.hero.sceneAria')}>
          <div className="vm-horizon" aria-hidden="true" />
          <div className="vm-platform" aria-hidden="true"><div className="vm-platform-top" /></div>
          <div className="vm-tiles" aria-hidden="true">
            {instruments.map((instrument, index) => (
              <div className="vm-tile" data-market-tile={instrument.symbol} key={instrument.instrumentId} style={MARKET_POSES[initialMarketPose(index)]}>
                <div className="vm-tile-face">
                  <div className={`vm-logo vm-logo-${instrument.symbol.toLowerCase()}`}>
                    <img src={instrument.logoPath} alt="" width="72" height="72" draggable={false} onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />
                  </div>
                  <span className="vm-symbol">{instrument.symbol}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <button type="button" className="vm-motion-toggle" data-motion-toggle onClick={toggleMotion} aria-pressed={paused} aria-label={t(paused ? 'home.hero.resumeMotion' : 'home.hero.pauseMotion')} title={t(paused ? 'home.hero.resumeMotion' : 'home.hero.pauseMotion')}>
          {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
        </button>
      </div>
      <div className="vm-copy">
        <h1 id="vm-hero-title">{t('home.hero.platformTitle')}</h1>
        <p>{t('home.hero.platformDescription')}</p>
        <div className="vm-actions">
          <Link className="vm-primary" to="/trade">{t('home.hero.startTrading')}<ArrowRight size={18} aria-hidden="true" /></Link>
          <Link className="vm-secondary" to="/markets">{t('home.hero.exploreMarkets')}</Link>
        </div>
        <nav className="vm-products" aria-label={t('home.footer.products')}>
          <Link to="/trade">{t('trade.spotTab')}</Link>
          <Link to="/futures">{t('nav.futures')}</Link>
          <Link to="/copy-trading">{t('nav.copyTrading')}</Link>
          <Link to="/card">{t('nav.card')}</Link>
        </nav>
      </div>
    </section>
  );
}
