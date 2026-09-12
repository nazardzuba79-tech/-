import { useEffect, useState } from 'react';
import { useLiveMarket } from '../lib/useLiveMarket';
import { livePerpetualTurnover } from '../lib/terminalPresentation';
import { formatCompact } from '../lib/formatNumber';

/** Separate from financial mark/funding reads; one shared reference stream. */
export function FuturesTurnover({ pair, aggregate, stale }: { pair: string; aggregate: number | null; stale: boolean }) {
  const live = useLiveMarket();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(timer); }, []);
  const fallback = livePerpetualTurnover(live, pair, now);
  const validAggregate = aggregate !== null && Number.isFinite(aggregate) && aggregate >= 0;
  const value = validAggregate && !stale ? aggregate : fallback ?? (validAggregate ? aggregate : null);
  return <span className={`value${value !== null && value === aggregate && stale && fallback === null ? ' is-stale' : ''}`}>
    {value !== null ? formatCompact(value) : '—'}
  </span>;
}
