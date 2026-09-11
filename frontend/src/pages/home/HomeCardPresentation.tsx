import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HomeCardSection } from './HomeCardSection';
import { HomeCardVariantC } from './HomeCardVariantC';
import { MotionStage } from './HomeMotion';
import './home-card-variants.css';

/** C is the review default; explicit A/B URLs retain their original renderers.
 * All three options remain available without persisting a final product choice.
 * Changing the view does not remount the market hook or persist a product choice.
 */
export function HomeCardPresentation() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('cardVariant');
  const variant = selected === 'A' || selected === 'B' ? selected : 'C';
  const controls = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    // A shared route scroll reset runs on initial navigation. Align the explicit
    // comparison after that paint, keeping A/B aligned; ordinary visits stay put.
    const frame = requestAnimationFrame(() => controls.current?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [selected, variant]);
  const select = (next: 'A' | 'B' | 'C') => {
    const updated = new URLSearchParams(params);
    updated.set('cardVariant', next);
    setParams(updated, { preventScrollReset: true });
  };
  return <MotionStage className={`vx-card-stage vx-card-variant-${variant.toLowerCase()}`} tilt>
    <div ref={controls} className="vx-card-comparison" role="group" aria-label="Crypto Card — A / B / C">
      <span>VOLTEX CRYPTO CARD</span>
      <div>
        <button type="button" aria-pressed={variant === 'A'} onClick={() => select('A')}>Variant A</button>
        <button type="button" aria-pressed={variant === 'B'} onClick={() => select('B')}>Variant B</button>
        <button type="button" aria-pressed={variant === 'C'} onClick={() => select('C')}>Variant C</button>
      </div>
    </div>
    {variant === 'C' ? <HomeCardVariantC /> : <HomeCardSection />}
  </MotionStage>;
}
