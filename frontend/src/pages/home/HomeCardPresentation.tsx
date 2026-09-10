import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HomeCardSection } from './HomeCardSection';
import { MotionStage } from './HomeMotion';
import './home-card-variants.css';

/** A remains the default and uses the original renderer/styles unchanged.
 * Explicit preview URLs opt into B and expose a reversible comparison control.
 * Changing the view does not remount the market hook or persist a product choice.
 */
export function HomeCardPresentation() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('cardVariant');
  const variant = selected === 'B' ? 'B' : 'A';
  const comparing = selected === 'A' || selected === 'B';
  const controls = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!comparing) return;
    // A shared route scroll reset runs on initial navigation. Align the explicit
    // comparison after that paint, keeping A/B aligned; ordinary visits stay put.
    const frame = requestAnimationFrame(() => controls.current?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [comparing, variant]);
  const select = (next: 'A' | 'B') => {
    const updated = new URLSearchParams(params);
    updated.set('cardVariant', next);
    setParams(updated, { preventScrollReset: true });
  };
  return <MotionStage className={`vx-card-stage vx-card-variant-${variant.toLowerCase()}`} tilt>
    {comparing && <div ref={controls} className="vx-card-comparison" role="group" aria-label="Crypto Card — A / B">
      <span>VOLTEX CRYPTO CARD</span>
      <div>
        <button type="button" aria-pressed={variant === 'A'} onClick={() => select('A')}>Variant A</button>
        <button type="button" aria-pressed={variant === 'B'} onClick={() => select('B')}>Variant B</button>
      </div>
    </div>}
    <HomeCardSection />
  </MotionStage>;
}
