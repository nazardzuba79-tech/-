import { useCallback, useRef, useState, type ReactNode } from 'react';

/**
 * The page's three charts.
 *
 * Hand-drawn SVG rather than a charting dependency, for the same reason the
 * compact Wallet sparkline is: these are three small, fixed shapes on a
 * light financial surface, and a library would arrive with its own theme,
 * its own tooltip and 40kB of bundle to fight.
 *
 * All three take the already-derived series and draw it. None of them
 * computes performance, and none holds data of its own.
 */

const POS = '#12a177';
const NEG = '#d94a56';
const AXIS = '#e4e7ec';
const GRID = '#f0f2f5';

/**
 * Where the pointer is, in data-index terms, shared by chart and tooltip.
 *
 * The container's width comes off the same measurement the index does, so
 * the tooltip can keep itself inside the box without a second observer or
 * a resize listener — it is only ever needed while the pointer is inside.
 */
function useHoverIndex(count: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [x, setX] = useState(0);
  const [width, setWidth] = useState(0);

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box || box.width === 0 || count === 0) return;
      const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
      setIndex(Math.min(count - 1, Math.round(ratio * (count - 1))));
      setX(e.clientX - box.left);
      setWidth(box.width);
    },
    [count]
  );

  return { ref, index, x, width, onMove, onLeave: () => setIndex(null) };
}

/**
 * A tooltip that stays inside its chart. Flips to the left of the cursor
 * near the right edge instead of being clipped or widening the page.
 */
function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const flip = x > width - 160;
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 min-w-[132px] rounded-w border border-hair bg-panel px-2.5 py-2 text-[11px] shadow-lift"
      style={flip ? { right: Math.max(4, width - x + 10) } : { left: Math.min(x + 10, width - 150) }}
    >
      {children}
    </div>
  );
}

export function TooltipRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 leading-[1.5]">
      <span className="text-ink-3">{label}</span>
      <span className={`num font-medium ${tone ?? 'text-ink'}`}>{value}</span>
    </div>
  );
}

/** A vertical crosshair at the hovered column. */
function Crosshair({ ratio, height }: { ratio: number; height: number }) {
  return (
    <line
      x1={`${ratio * 100}%`}
      y1="0"
      x2={`${ratio * 100}%`}
      y2={height}
      stroke="#c8ced8"
      strokeWidth="1"
      strokeDasharray="3 3"
      vectorEffect="non-scaling-stroke"
    />
  );
}

export interface EquitySeriesPoint {
  date: string;
  equity: number;
}

/**
 * The main portfolio curve, filled to the window's floor so the shape reads
 * as a level rather than a squiggle. The vertical scale is padded by 6% of
 * the range so the line never touches the frame.
 */
export function EquityChart({
  points,
  height = 260,
  renderTooltip,
}: {
  points: EquitySeriesPoint[];
  height?: number;
  renderTooltip: (i: number) => ReactNode;
}) {
  const hover = useHoverIndex(points.length);

  if (points.length < 2) return null;

  const values = points.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.06 || Math.abs(max) * 0.02 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const y = (v: number) => ((hi - v) / (hi - lo)) * height;
  const x = (i: number) => (i / (points.length - 1)) * 100;

  const line = points.map((p, i) => `${x(i).toFixed(3)},${y(p.equity).toFixed(2)}`).join(' L');
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? POS : NEG;

  return (
    <div
      ref={hover.ref}
      className="relative w-full"
      onMouseMove={hover.onMove}
      onMouseLeave={hover.onLeave}
    >
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img">
        <defs>
          <linearGradient id="vx-perf-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" y1={height * f} x2="100" y2={height * f} stroke={GRID} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`M${line} L100,${height} L0,${height} Z`} fill="url(#vx-perf-fill)" />
        <path d={`M${line}`} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={height} x2="100" y2={height} stroke={AXIS} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {hover.index !== null && (
          <>
            <Crosshair ratio={hover.index / (points.length - 1)} height={height} />
            <circle cx={x(hover.index)} cy={y(points[hover.index].equity)} r="1" fill={stroke} vectorEffect="non-scaling-stroke" style={{ transformBox: 'fill-box' }} />
          </>
        )}
      </svg>
      {hover.index !== null && (
        <Tooltip x={hover.x} width={hover.width}>
          {renderTooltip(hover.index)}
        </Tooltip>
      )}
    </div>
  );
}

export interface BarPoint {
  date: string;
  value: number;
}

/**
 * Daily PnL. Bars grow from a real zero line in both directions, and the
 * scale is symmetric around it so a $100 gain and a $100 loss are the same
 * height — otherwise a single big day silently rescales the sign.
 */
export function BarChart({
  bars,
  height = 150,
  renderTooltip,
}: {
  bars: BarPoint[];
  height?: number;
  renderTooltip: (i: number) => ReactNode;
}) {
  const hover = useHoverIndex(bars.length);

  if (bars.length === 0) return null;

  const extent = Math.max(...bars.map((b) => Math.abs(b.value)), Number.EPSILON);
  const zeroY = height / 2;
  const scale = (height / 2 - 6) / extent;
  const slot = 100 / bars.length;
  // Hairline-thin bars on a year of data would disappear; a floor keeps
  // them visible, and the gap shrinks with the slot rather than vanishing.
  const barW = Math.max(slot * 0.62, 0.12);

  return (
    <div
      ref={hover.ref}
      className="relative w-full"
      onMouseMove={hover.onMove}
      onMouseLeave={hover.onLeave}
    >
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img">
        {bars.map((b, i) => {
          const h = Math.abs(b.value) * scale;
          const cx = slot * i + slot / 2 - barW / 2;
          return (
            <rect
              key={b.date}
              x={cx}
              y={b.value >= 0 ? zeroY - h : zeroY}
              width={barW}
              height={Math.max(h, 0.6)}
              fill={b.value > 0 ? POS : b.value < 0 ? NEG : '#c3c9d2'}
              opacity={hover.index === null || hover.index === i ? 1 : 0.45}
            />
          );
        })}
        <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke={AXIS} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {hover.index !== null && <Crosshair ratio={(slot * hover.index + slot / 2) / 100} height={height} />}
      </svg>
      {hover.index !== null && (
        <Tooltip x={hover.x} width={hover.width}>
          {renderTooltip(hover.index)}
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Drawdown, drawn downwards from a zero line at the top — the shape a
 * reader expects, where deeper is worse and the baseline is "at the high".
 */
export function DrawdownChart({
  points,
  height = 130,
  renderTooltip,
}: {
  points: { date: string; drawdownPct: number }[];
  height?: number;
  renderTooltip: (i: number) => ReactNode;
}) {
  const hover = useHoverIndex(points.length);

  if (points.length < 2) return null;

  const worst = Math.min(...points.map((p) => p.drawdownPct));
  // A curve that never fell still needs a scale; without a floor it would
  // divide by zero and draw nothing.
  const span = Math.abs(worst) || 1;
  const y = (v: number) => (Math.abs(v) / span) * (height - 8);
  const x = (i: number) => (i / (points.length - 1)) * 100;
  const line = points.map((p, i) => `${x(i).toFixed(3)},${y(p.drawdownPct).toFixed(2)}`).join(' L');

  return (
    <div
      ref={hover.ref}
      className="relative w-full"
      onMouseMove={hover.onMove}
      onMouseLeave={hover.onLeave}
    >
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img">
        <path d={`M${line} L100,0 L0,0 Z`} fill={NEG} fillOpacity="0.1" />
        <path d={`M${line}`} fill="none" stroke={NEG} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="0.5" x2="100" y2="0.5" stroke={AXIS} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {hover.index !== null && <Crosshair ratio={hover.index / (points.length - 1)} height={height} />}
      </svg>
      {hover.index !== null && (
        <Tooltip x={hover.x} width={hover.width}>
          {renderTooltip(hover.index)}
        </Tooltip>
      )}
    </div>
  );
}
