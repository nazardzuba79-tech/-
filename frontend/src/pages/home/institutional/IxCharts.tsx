import { useId } from 'react';
import type { HomeCandle } from '../useHomeMarket';
import { formatPriceValue } from '../useHomeMarket';

/** A price path at a fixed size, green or red by its own direction. */
export function IxSpark({ points, width = 88, height = 28 }: { points: number[] | null | undefined; width?: number; height?: number }) {
  if (!points || points.length < 2) return <span className="ix-spark-empty" aria-hidden="true" style={{ width, height }} />;
  const min = Math.min(...points), max = Math.max(...points), range = max - min || 1, step = width / (points.length - 1);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(2 + (height - 4) * (1 - (p - min) / range)).toFixed(1)}`).join('');
  const up = points[points.length - 1] >= points[0];
  return <svg className="ix-spark" data-dir={up ? 'up' : 'down'} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <path d={d} fill="none" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
  </svg>;
}

/**
 * The hero pair's recent closes as a quiet area chart: four price rules on
 * the right, no axes chrome. Drawn in a fixed viewBox and stretched, with a
 * non-scaling stroke so the line stays 1.5px at any width.
 */
export function IxAreaChart({ candles, label }: { candles: HomeCandle[]; label: string }) {
  const id = useId().replace(/:/g, '');
  const closes = candles.map(c => Number(c.close)).filter(Number.isFinite);
  if (closes.length < 2) return <div className="ix-area ix-area-empty">{label}</div>;
  const W = 600, H = 200, lo = Math.min(...closes), hi = Math.max(...closes), pad = (hi - lo) * 0.12 || hi * 0.001;
  const min = lo - pad, max = hi + pad, y = (v: number) => H * (1 - (v - min) / (max - min)), step = W / (closes.length - 1);
  const line = closes.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join('');
  const up = closes[closes.length - 1] >= closes[0];
  const rules = [0.2, 0.4, 0.6, 0.8].map(f => max - (max - min) * f);
  return <div className="ix-area" data-dir={up ? 'up' : 'down'}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="ix-area-stop-a" /><stop offset="1" className="ix-area-stop-b" /></linearGradient></defs>
      {rules.map(r => <line key={r} x1="0" x2={W} y1={y(r)} y2={y(r)} className="ix-area-rule" vectorEffect="non-scaling-stroke" />)}
      <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#g${id})`} />
      <path d={line} className="ix-area-line" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="ix-area-scale" aria-hidden="true">{rules.map(r => <span key={r} style={{ top: `${(y(r) / H) * 100}%` }}>{formatPriceValue(r)}</span>)}</div>
  </div>;
}
