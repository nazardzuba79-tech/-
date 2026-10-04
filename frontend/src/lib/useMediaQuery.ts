import { useCallback, useSyncExternalStore } from 'react';

/** The terminals' one phone/tablet breakpoint (TerminalMobileParity.css, FuturesMobile.css). */
export const MOBILE_TERMINAL_QUERY = '(max-width: 900px)';

/**
 * Whether a media query matches, kept in step with the viewport.
 *
 * Used where a phone needs a different CONTROL rather than a different look —
 * a native select instead of five tabs — so the component renders one or the
 * other and never both with one hidden by CSS.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const media = window.matchMedia(query);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, read, () => false);
}
