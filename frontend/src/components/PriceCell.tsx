import type { CSSProperties } from 'react';
import { usePriceFlash } from '../lib/usePriceFlash';

/** A price value that briefly flashes green/red when it changes between
 * polls — its own component (not inline in a list .map()) so each row's
 * usePriceFlash() call is a proper top-level hook call, isolated per pair. */
export function PriceCell({
  value,
  format,
  className,
  style,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
  style?: CSSProperties;
}) {
  const flash = usePriceFlash(value);
  const flashClass = flash === 'up' ? 'price-flash-up' : flash === 'down' ? 'price-flash-down' : '';
  return (
    <span className={[className, flashClass].filter(Boolean).join(' ')} style={style}>
      {format ? format(value) : value}
    </span>
  );
}
