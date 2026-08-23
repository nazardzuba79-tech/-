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
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {total <= 0 ? (
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        ) : (
          slices.map((s, i) => {
            const frac = s.value / total;
            const dash = frac * circumference;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return el;
          })
        )}
      </g>
    </svg>
  );
}
