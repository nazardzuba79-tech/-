/** Minimal 7-day price sparkline — pure SVG polyline, same no-charting-
 * library approach as PortfolioDonut and the order book's depth bars.
 * Green when the period ends higher than it started, red otherwise. */
export function Sparkline({ points, width = 100, height = 32 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) {
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const color = points[points.length - 1] >= points[0] ? 'var(--buy)' : 'var(--sell)';

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
