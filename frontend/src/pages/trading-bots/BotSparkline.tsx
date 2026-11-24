import { useId, useState } from 'react';
import { monthlyPercent } from '../../lib/monthlyCopyPerformance';

interface SparklineProps {
  series: readonly number[];
  name: string;
  large?: boolean;
  verified?: boolean;
  unit?: string;
  firstPoint?: number;
}

export function Sparkline({ series, name, large = false, verified = false, unit = 'День', firstPoint = 0 }: SparklineProps) {
  const id = useId();
  const [cursor, setCursor] = useState<number | null>(null);
  if (!series.length) return null;
  const width = 400, height = large ? 140 : 70, pad = 5;
  const last = series.length - 1;
  const index = Math.min(cursor ?? last, last);
  const min = Math.min(0, ...series), max = Math.max(1, ...series);
  const x = (i: number) => pad + i / Math.max(1, last) * (width - 2 * pad);
  const y = (v: number) => height - pad - (v - min) / (max - min) * (height - 2 * pad);
  const path = series.map((v, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(v)).join(' ');
  const label = (i: number) => unit + ' ' + (firstPoint + i);
  const reading = label(index) + ' · ' + monthlyPercent(series[index]).text;
  const chart = <svg className={'vb-spark' + (large ? ' vb-spark-large' : '')}
    viewBox={'0 0 ' + width + ' ' + height} preserveAspectRatio="none" role="img"
    aria-label={name + ': ' + (verified ? 'доходность по подтверждённым данным' : 'модельная кривая доходности')}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".19"/><stop offset="1" stopColor="currentColor" stopOpacity=".01"/></linearGradient></defs>
    {large && [0, .5, 1].map(fraction => <line key={fraction} x1={pad} x2={width - pad}
      y1={y(min + fraction * (max - min))} y2={y(min + fraction * (max - min))}
      stroke="currentColor" opacity=".18" strokeDasharray="2 4" vectorEffect="non-scaling-stroke"/>)}
    <path d={path + ' L' + x(last) + ' ' + height + ' L' + pad + ' ' + height + ' Z'} fill={'url(#' + id + ')'}/>
    <path d={path} stroke="currentColor" strokeWidth={large ? 2 : 1.7} fill="none" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
    {large && <g><line x1={x(index)} x2={x(index)} y1={pad} y2={height - pad} stroke="currentColor" opacity=".35" vectorEffect="non-scaling-stroke"/>
      <circle cx={x(index)} cy={y(series[index])} r="3" fill="currentColor"/></g>}
  </svg>;
  if (!large) return chart;
  return <div className="vb-trend">
    <div className="vb-trend-reading">{reading}</div>
    <div className="vb-trend-plot">{chart}
      {last > 0 && <input className="vb-trend-cursor" type="range" min="0" max={last} value={index}
        aria-label="Точка графика" aria-valuetext={reading}
        onChange={e => setCursor(e.currentTarget.valueAsNumber)}
        onPointerMove={e => {
          if (e.pointerType !== 'mouse') return;
          const rect = e.currentTarget.getBoundingClientRect();
          setCursor(Math.max(0, Math.min(last, Math.round((e.clientX - rect.left) / rect.width * last))));
        }}/>}
    </div>
    <div className="vb-trend-axis"><span>{label(0)}</span><span>{label(last)}</span></div>
  </div>;
}
