import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { HERO_INSTRUMENTS } from './heroInstruments';
import { initialMarketPose, marketTileFrames, MARKET_CYCLE_MS, MARKET_STEP_MS, orbitTransform, restingPose, type OrbitProfile } from './marketPlatformMotion';
import './home-market-platform.css';

const instruments = HERO_INSTRUMENTS.filter((instrument) => instrument.enabled);
const MOBILE_QUERY_PX = 900;

export function HomeMarketPlatformHero() {
  const { t } = useLanguage();
  const scene = useRef<HTMLDivElement>(null);
  const manualPause = useRef(false);
  const synchronize = useRef<(() => void) | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const element = scene.current;
    if (!element) return;
    const host = element.closest<HTMLElement>('[data-market-platform-hero]') ?? element.parentElement!;
    const view = element.ownerDocument.defaultView ?? window;
    const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
    let intersecting = false;
    let hovered = false;
    let focused = false;
    let disposed = false;
    let profile: OrbitProfile = view.innerWidth <= MOBILE_QUERY_PX ? 'mobile' : 'desktop';
    const animations: Animation[] = [];

    function sync() {
      if (disposed) return;
      const reasons = [document.hidden && 'hidden', !intersecting && 'offscreen', manualPause.current && 'manual', hovered && 'hover', focused && 'focus', reduced.matches && 'reduced-motion'].filter(Boolean);
      const running = reasons.length === 0;
      host.dataset.motionState = element!.dataset.motionState = running ? 'running' : 'paused';
      element!.dataset.motionReason = reasons.join(' ');
      // Reduced motion gets the complete resting composition, even when the
      // preference changes halfway through a swap.
      animations.forEach((animation, index) => {
        if (running) animation.play();
        else animation.pause();
        if (reduced.matches) animation.currentTime = initialMarketPose(index) * MARKET_STEP_MS;
      });
    }

    function build(offset: number) {
      animations.splice(0).forEach((animation) => animation.cancel());
      if (typeof element!.animate !== 'function') return;
      const frames = marketTileFrames(profile);
      element!.querySelectorAll<HTMLElement>('[data-market-tile]').forEach((coin, index) => {
        const animation = coin.animate(frames, { duration: MARKET_CYCLE_MS, iterations: Infinity, fill: 'both' });
        animation.pause();
        animation.currentTime = initialMarketPose(index) * MARKET_STEP_MS + offset;
        animations.push(animation);
      });
    }
    build(0);
    // Phones show only the front of the orbit; rebuild once if a resize
    // crosses that breakpoint, keeping the current phase.
    const resize = () => {
      const next: OrbitProfile = view.innerWidth <= MOBILE_QUERY_PX ? 'mobile' : 'desktop';
      if (next === profile || disposed) return;
      const offset = animations.length ? Number(animations[0].currentTime) - initialMarketPose(0) * MARKET_STEP_MS : 0;
      profile = next;
      build(offset);
      sync();
    };
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; sync(); }, { threshold: 0 });
    const enter = (event: PointerEvent) => { if (event.pointerType !== 'touch') { hovered = true; sync(); } };
    const leave = () => { hovered = false; sync(); };
    const focus = () => { focused = true; sync(); };
    const blur = (event: FocusEvent) => { if (!host.contains(event.relatedTarget as Node | null)) { focused = false; sync(); } };
    observer.observe(element);
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    view.addEventListener('resize', resize);
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    host.addEventListener('focusin', focus);
    host.addEventListener('focusout', blur);
    synchronize.current = sync;
    sync();
    return () => {
      disposed = true;
      synchronize.current = null;
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', sync);
      view.removeEventListener('resize', resize);
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      host.removeEventListener('focusin', focus);
      host.removeEventListener('focusout', blur);
      animations.forEach((animation) => animation.cancel());
    };
  }, []);

  function toggleMotion() {
    manualPause.current = !manualPause.current;
    setPaused(manualPause.current);
    synchronize.current?.();
  }

  return (
    <div className="vm-orbit" data-market-platform-hero data-motion-state="paused">
      <div className="vm-orbit-stage">
        <div className="vm-orbit-aura" aria-hidden="true" />
        <div className="vm-orbit-rings" aria-hidden="true">
          <span className="vm-ring vm-ring-main" /><span className="vm-ring vm-ring-wide" /><span className="vm-ring vm-ring-steep" />
          <span className="vm-spark-track vm-spark-a"><i /></span><span className="vm-spark-track vm-spark-b"><i /></span>
        </div>
        <div className="vm-orbit-beam" aria-hidden="true" />
        <div className="vm-orbit-pedestal" aria-hidden="true">
          <span className="vm-tier vm-tier-base" /><span className="vm-tier vm-tier-mid" /><span className="vm-tier vm-tier-top" /><span className="vm-tier-glow" />
        </div>
        <div id="home-market-column" className="vm-orbit-scene" ref={scene} data-market-visual data-motion-state="paused" role="group" aria-label={t('home.hero.sceneAria')}>
          {instruments.map((instrument, index) => {
            const rest = restingPose(index);
            return (
              <div className="vm-asset" key={instrument.instrumentId} data-market-tile={instrument.symbol} data-face={instrument.face} data-category={instrument.category}
                role="img" aria-label={instrument.displayName} style={{ transform: orbitTransform(rest), opacity: rest.opacity, translate: `0px 0px ${rest.z}px` }}>
                <span className="vm-medal"><span className="vm-medal-face">
                  {instrument.logoPath
                    ? <img src={instrument.logoPath} alt="" width="64" height="64" draggable={false} onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />
                    : <span className="vm-index-mark">S&amp;P 500</span>}
                  <span className="vm-card-symbol">{instrument.label}</span>
                </span></span>
                {instrument.badge && <span className="vm-asset-badge">{instrument.badge}</span>}
              </div>
            );
          })}
        </div>
      </div>
      <button type="button" className="vm-motion-toggle" data-motion-toggle onClick={toggleMotion} aria-pressed={paused} aria-label={t(paused ? 'home.hero.resumeMotion' : 'home.hero.pauseMotion')} title={t(paused ? 'home.hero.resumeMotion' : 'home.hero.pauseMotion')}>
        {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
      </button>
    </div>
  );
}
