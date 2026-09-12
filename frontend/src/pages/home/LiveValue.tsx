import { useState } from 'react';
import { formatPriceValue } from './useHomeMarket';

/** Quotes always display the received value. Only their background transitions. */
export function LiveValue({
  value, format = formatPriceValue, className = '', suffix = '',
}: {
  value: number | null | undefined;
  format?: (value: number) => string;
  className?: string;
  suffix?: string;
}) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const [change, setChange] = useState({ value: numeric, direction: 'flat', revision: 0 });
  if (numeric !== change.value) {
    setChange({
      value: numeric,
      direction: numeric === null || change.value === null ? 'flat' : numeric > change.value ? 'up' : 'down',
      revision: change.revision + 1,
    });
  }
  return (
    <span className={`vx-live-value ${className}`}>
      <span key={change.revision} data-direction={change.direction}>
        {numeric === null ? '—' : `${format(numeric)}${suffix}`}
      </span>
    </span>
  );
}
