import { createContext, useContext } from 'react';

/**
 * Whether a missing figure is still ON ITS WAY.
 *
 * `true`: the request for it is in flight and nothing confirmed is on screen
 * yet — the one state in which a reserved skeleton is honest. `false`: the
 * attempt is over and the figure did not come — the viewer is owed a plain,
 * visible «—» (unknown), never a skeleton that reads as «still loading»
 * forever. With no provider the original behaviour stands (a dash is drawn
 * as a skeleton), so surfaces outside Copy Trading are untouched.
 */
export const MetricPendingContext = createContext<boolean | undefined>(undefined);

/** Formatting already converts unavailable numbers to a dash. Keep its line
 * box and fill only the reserved metric area while the backend is still
 * supplying it. */
export function LiveMetric({ value }: { value: string }) {
  const pending = useContext(MetricPendingContext);
  const unavailable = value.includes('—');
  const skeleton = unavailable && pending !== false;
  return <span className={`copy-live-metric${skeleton ? ' copy-metric-skeleton' : ''}`}
    data-unavailable={unavailable || undefined} aria-busy={skeleton && pending === true ? true : undefined}
    aria-label={unavailable ? (skeleton && pending === true ? 'Загрузка…' : 'Данные недоступны') : undefined}>
    {unavailable ? <span className="copy-metric-dash">—</span> : value}
  </span>;
}
