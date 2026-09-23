import { useFuturesReference } from '../lib/useFuturesReference';
import { formatCompact } from '../lib/formatNumber';

/** Public turnover display. Direct Bybit browser data is the fallback; no Render market stream. */
export function FuturesTurnover({ pair, aggregate, stale, fullPrecision = false }: { pair: string; aggregate: number | null; stale: boolean; fullPrecision?: boolean }) {
  const reference = useFuturesReference();
  const direct = reference.get(pair)?.quoteVolume24h ?? null;
  const fallback = typeof direct === 'number' && Number.isFinite(direct) && direct >= 0 ? direct : null;
  const validAggregate = aggregate !== null && Number.isFinite(aggregate) && aggregate >= 0;
  const value = validAggregate && !stale ? aggregate : fallback ?? (validAggregate ? aggregate : null);
  return <span className={`value${value !== null && value === aggregate && stale && fallback === null ? ' is-stale' : ''}`}>
    {value !== null ? fullPrecision ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : formatCompact(value) : '—'}
  </span>;
}
