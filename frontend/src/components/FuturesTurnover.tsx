import { useEffect, useState } from 'react';
import { useLiveMarket } from '../lib/useLiveMarket';
import { livePerpetualTurnover } from '../lib/terminalPresentation';
import { formatCompact } from '../lib/formatNumber';

/** Separate from financial mark/funding reads; one shared reference stream. */
export function FuturesTurnover({ pair, aggregate, stale, fullPrecision = false, reference = null }: { pair: string; aggregate: number | null; stale: boolean; fullPrecision?: boolean; reference?: number | null }) {
  const live = useLiveMarket();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(timer); }, []);
  const fallback = livePerpetualTurnover(live, pair, now);
  const validAggregate = aggregate !== null && Number.isFinite(aggregate) && aggregate >= 0;
  // Fresh cross-venue figure first; then this pair's Bybit perpetual turnover
  // (the live stream, then the header's own reference row); a stale
  // cross-venue figure only when neither is known.
  const value = validAggregate && !stale ? aggregate : fallback ?? reference ?? (validAggregate ? aggregate : null);
  return <span className={`value${value !== null && value === aggregate && stale && fallback === null && reference === null ? ' is-stale' : ''}`}>
    {value !== null ? fullPrecision ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : formatCompact(value) : '—'}
  </span>;
}
