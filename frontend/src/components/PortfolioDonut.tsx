export interface DonutSlice {
  label: string;
  value: number;
  color: string;
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
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {total <= 0 ? (
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        ) : (
          slices.map((s, i) => {
            const frac = s.value / total;
            const rawDash = frac * circumference;
            const dash = Math.max(rawDash - gapLen, 0);
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
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
