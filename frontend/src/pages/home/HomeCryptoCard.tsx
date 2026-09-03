/**
 * The approved physical VOLTEX card, presented.
 *
 * Architecture note, because the reference prototype gets this wrong: its
 * component returns a bare <img> as soon as artwork is supplied, which
 * silently drops every decorative layer. Here the artwork is one layer
 * inside a wrapper, and the reflection sits above it as its own
 * pointer-events-none element. The render's pixels are never filtered,
 * recoloured or masked — all presentation (perspective, shadow, glow,
 * sweep) happens outside it.
 *
 * `animated` controls the sweep, `sweepDelay` staggers it. Only the large
 * card section passes `animated`; the small panel beside Markets stays
 * deliberately still so the page has a single restrained reflection.
 */
import { useLanguage } from '../../lib/i18n';

export const VOLTEX_CARD_ARTWORK = '/cards/voltex-card-dark.png';

export function HomeCryptoCard({
  width,
  animated = false,
  sweepDelay = 0,
  hover = false,
  glow = true,
  className = '',
}: {
  /** Rendered width in px; the artwork keeps its own aspect ratio. */
  width: number;
  animated?: boolean;
  /** Seconds, offset so two animated cards never sweep together. */
  sweepDelay?: number;
  /** Desktop lift on hover for the featured card presentation. */
  hover?: boolean;
  glow?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const alt = t('home.card.name');
  return (
    <div className={`group relative ${className}`} style={{ width }}>
      {/* Warm ambient glow, behind the card and outside its box. */}
      {glow && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-8 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,rgba(224,169,63,0.20),transparent_72%)]"
        />
      )}

      <div
        className={[
          'relative',
          hover
            ? 'transition-[transform,filter] duration-[260ms] ease-out lg:group-hover:-translate-y-[3px] lg:group-hover:drop-shadow-[0_26px_44px_rgba(0,0,0,0.75)]'
            : '',
        ].join(' ')}
      >
        {/* The approved artwork, untouched. It is already a 3D render at
            its own angle, so nothing here rotates or skews it. */}
        <img
          src={VOLTEX_CARD_ARTWORK}
          alt={alt}
          width={width}
          loading="lazy"
          decoding="async"
          className="block w-full select-none drop-shadow-[0_22px_44px_rgba(0,0,0,0.7)]"
          draggable={false}
        />

        {/* Reflection overlay. Clipped to the card's own box and masked to
            the artwork's rounded silhouette so the sweep reads as light on
            the surface rather than a bar crossing a rectangle. */}
        {animated && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[14px]"
            style={{ maskImage: 'linear-gradient(#000,#000)' }}
          >
            <div
              className="vx-sweep absolute inset-y-[-30%] left-0 w-[20%] bg-[linear-gradient(90deg,transparent,rgba(240,196,90,0.30),transparent)]"
              style={{ animationDelay: `${sweepDelay}s` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
