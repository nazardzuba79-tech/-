import { useId } from 'react';

export function Sparkline({ series, name, large = false, verified = false }: { series: readonly number[]; name: string; large?: boolean; verified?: boolean }) {
  const id = useId().replace(/:/g, '');
  const width = 400, height = large ? 140 : 70, pad = 5;
  const min = Math.min(0, ...series), max = Math.max(1, ...series);
  const path = series.map((value, i) => `${i ? 'L' : 'M'}${pad + i / (series.length - 1) * (width - pad * 2)} ${height - pad - (value - min) / (max - min) * (height - pad * 2)}`).join(' ');
  return <svg className={`vb-spark${large ? ' vb-spark-large' : ''}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${name}: ${verified ? 'доходность по подтверждённым данным' : 'модельная кривая доходности'}`}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".16"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
    <path d={`${path} L ${width - pad} ${height} L ${pad} ${height} Z`} fill={`url(#${id})`}/>
    <path d={path} stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
  </svg>;
}
