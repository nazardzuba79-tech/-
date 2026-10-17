import { useMediaQuery } from '../../lib/useMediaQuery';

/** The admin shell's phone breakpoint (adminConsole.css, adminPracticality.css: 767px). */
export const ADMIN_COMPACT_QUERY = '(max-width: 767px)';

/**
 * Whether the admin console is on a phone-sized viewport.
 *
 * Used where a phone needs a different ARRANGEMENT of the same controls —
 * a disclosure instead of a column of filters, a summary line instead of a
 * grid — so a page renders one arrangement, never both with one hidden.
 * Desktop markup is untouched; without matchMedia (tests) this is false.
 */
export function useAdminCompact(): boolean {
  return useMediaQuery(ADMIN_COMPACT_QUERY);
}
