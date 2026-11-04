import { useEffect, type RefObject } from 'react';
import { MOBILE_TERMINAL_QUERY } from './useMediaQuery';

/**
 * A horizontal swipe on a phone terminal moves to the neighbouring tab
 * («График | Торговля | Ордера»), the way exchange apps do.
 *
 * It stays out of the way of everything that owns a horizontal gesture: the
 * chart tab (candles pan), inputs and range sliders, sideways-scrolling
 * strips and anything marked `data-no-swipe`. A swipe has to be decisive:
 * at least 72px across, under 48px down, within 600ms.
 */
export function useSwipeTabs<T extends string>(
  ref: RefObject<HTMLElement | null>,
  order: readonly T[],
  current: T,
  select: (next: T) => void,
  options: { skipFrom?: readonly T[] } = {},
) {
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof window === 'undefined') return;
    let start: { x: number; y: number; at: number } | null = null;
    const owned = (target: EventTarget | null): boolean => {
      let node = target instanceof Element ? target : null;
      while (node && node !== element) {
        if (node.matches('input,textarea,select,canvas,svg,[data-no-swipe],[role="slider"]')) return true;
        if (node.scrollWidth > node.clientWidth + 4 && getComputedStyle(node).overflowX !== 'visible') return true;
        node = node.parentElement;
      }
      return false;
    };
    const onStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1 || !window.matchMedia(MOBILE_TERMINAL_QUERY).matches) return;
      if ((options.skipFrom ?? []).includes(current) || owned(event.target)) return;
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    };
    const onEnd = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x, dy = touch.clientY - start.y, took = Date.now() - start.at;
      start = null;
      if (took > 600 || Math.abs(dx) < 72 || Math.abs(dy) > 48 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const index = order.indexOf(current);
      if (index < 0) return;
      const next = order[index + (dx < 0 ? 1 : -1)];
      if (next !== undefined) select(next);
    };
    const onCancel = () => { start = null; };
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchend', onEnd, { passive: true });
    element.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onCancel);
    };
  }, [ref, order, current, select, options.skipFrom]);
}
