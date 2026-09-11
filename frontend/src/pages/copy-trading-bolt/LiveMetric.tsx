/** Formatting already converts unavailable numbers to a dash. Keep its line
 * box and fill only the reserved metric area until the backend supplies it. */
export function LiveMetric({ value }: { value: string }) {
  const unavailable = value.includes('—');
  return <span className={`copy-live-metric${unavailable ? ' copy-metric-skeleton' : ''}`}
    data-unavailable={unavailable || undefined} aria-label={unavailable ? 'Данные недоступны' : undefined}>
    {unavailable ? <span className="copy-metric-dash">—</span> : value}
  </span>;
}
