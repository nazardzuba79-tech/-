import type { ReactNode } from 'react';

/**
 * Secondary filters on a phone: a «Фильтры» disclosure that keeps the count of
 * active conditions and a one-line summary visible while it is closed, so a
 * narrowed list is never mistaken for the whole queue. On a desktop it renders
 * its children in place — the existing toolbar is unchanged.
 *
 * The fields inside keep their own handlers: URL parameters, page resets and
 * server-side filtering are exactly what they were.
 */
export function AdminFilterDisclosure({ compact, active, hint, onReset, apply, children }: {
  compact: boolean;
  /** Number of non-default conditions among the fields inside. */
  active: number;
  /** Short text of the active conditions, shown under the summary while closed. */
  hint?: string;
  onReset?: () => void;
  /** A submit button inside the disclosure for forms that apply on «Найти». */
  apply?: ReactNode;
  children: ReactNode;
}) {
  if (!compact) return <>{children}</>;
  return <details className="admin-filter-disclosure" data-filter-disclosure data-filter-active={active > 0 ? active : undefined}>
    <summary>
      <span className="admin-filter-summary"><span>Фильтры</span>{active > 0 && <span className="admin-filter-count" data-filter-count aria-label={`Активных условий: ${active}`}>{active}</span>}</span>
      {active > 0 && hint && <span className="admin-filter-hint" data-filter-hint>{hint}</span>}
    </summary>
    <div className="admin-filter-fields">{children}</div>
    {(apply || (onReset && active > 0)) && <div className="admin-filter-actions">
      {apply}
      {onReset && active > 0 && <button type="button" className="admin-filter-reset" data-filter-reset onClick={onReset}>Сбросить</button>}
    </div>}
  </details>;
}
