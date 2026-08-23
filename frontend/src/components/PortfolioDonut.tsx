import { useId, useState } from 'react';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
  /** Present only for a slice whose brand color is itself a gradient (SOL) —
   * renders color -> gradientTo instead of a flat stroke. */
  gradientTo?: string;
}

/** Plain SVG donut — no charting library, same approach as the rest of this
 * app's custom visuals (order-book depth bars, the price chart's drawing
 * tools). Each slice is one stroked circle segment via stroke-dasharray;
 * rotating the whole group -90° starts the first slice at 12 o'clock. */
export function PortfolioDonut({
  slices,
  size = 168,
  thickness = 24,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
}) {
  const gradientBaseId = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  // A visible gap between slices only reads as a gap (not a stray dash) once
  // there's more than one — a single 100%-share slice should still draw as
  // one unbroken ring.
  const visibleCount = slices.filter((s) => s.value > 0).length;
  const gapLen = visibleCount > 1 ? Math.min(4, circumference * 0.015) : 0;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        {slices.map(
          (s, i) =>
            s.gradientTo && (
              <linearGradient key={i} id={`${gradientBaseId}-${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={s.color} />
                <stop offset="100%" stopColor={s.gradientTo} />
              </linearGradient>
            )
        )}
      </defs>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {total <= 0 ? (
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        ) : (
          slices.map((s, i) => {
            const frac = s.value / total;
            const rawDash = frac * circumference;
            const dash = Math.max(rawDash - gapLen, 0);
            const isHovered = hovered === i;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.gradientTo ? `url(#${gradientBaseId}-${i})` : s.color}
                strokeWidth={isHovered ? thickness + 3 : thickness}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                style={{
                  cursor: 'pointer',
                  transition: 'stroke-width 120ms ease, filter 120ms ease',
                  filter: isHovered ? `drop-shadow(0 0 6px ${s.color})` : 'none',
                }}
              />
            );
            // Advance by the untrimmed share so every gap lands in the same
            // relative spot regardless of how much this slice's own dash
            // was shortened.
            offset += rawDash;
            return el;
          })
        )}
      </g>
    </svg>
  );
}
