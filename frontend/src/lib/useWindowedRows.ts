import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface WindowedRows {
  /** Index of the first row to render. */
  start: number;
  /** Index one past the last row to render. */
  end: number;
  /** Pixel height of the rows skipped above / below, rendered as spacers
   *  so the scrollbar and the scroll position stay exactly what they would
   *  be if every row were in the DOM. */
  padTop: number;
  padBottom: number;
  /** Attach to the scrolling container. */
  ref: (node: HTMLElement | null) => void;
}

/**
 * Renders only the rows a scroll container can actually show.
 *
 * The market lists used to be capped at a few dozen entries, and the cap
 * was doing double duty: it was written as a listing rule but the reason
 * it existed was that 500 live-updating rows in the DOM made the panel
 * unusable. Removing the cap without this would have moved that problem
 * rather than solved it, so the ceiling is gone from the listing rules
 * (where it never belonged) and the rendering limit lives here (where it
 * does).
 *
 * Deliberately measurement-based rather than a hardcoded row height: the
 * row is styled with `min-height`, so a hardcoded constant would drift the
 * moment the design changed. The first real row is measured and the window
 * follows it.
 *
 * `overscan` rows are kept beyond each edge so a fast scroll does not
 * expose blank space before the next paint.
 */
export function useWindowedRows(total: number, estimatedRowHeight = 35, overscan = 8): WindowedRows {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const rowHeight = useRef(estimatedRowHeight);

  const ref = useCallback((next: HTMLElement | null) => setNode(next), []);

  useLayoutEffect(() => {
    if (!node) return;
    // Measure a real row once it exists; fall back to the estimate while
    // the list is still empty.
    const first = node.querySelector<HTMLElement>('[data-row]');
    if (first) {
      const measured = first.getBoundingClientRect().height;
      if (measured > 0) rowHeight.current = measured;
    }
    setViewport(node.clientHeight);
  });

  useEffect(() => {
    if (!node) return;
    const onScroll = () => setScrollTop(node.scrollTop);
    node.addEventListener('scroll', onScroll, { passive: true });
    setScrollTop(node.scrollTop);
    setViewport(node.clientHeight);

    // A panel that resizes (the terminal's layout does) must re-window
    // rather than keep a stale viewport height.
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => setViewport(node.clientHeight)) : null;
    observer?.observe(node);

    return () => {
      node.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [node]);

  const height = rowHeight.current || estimatedRowHeight;
  // Before the container is measured, render a screenful rather than
  // nothing: a first paint with zero rows is a visible flash.
  const visible = viewport > 0 ? Math.ceil(viewport / height) : 24;
  const span = visible + overscan * 2;
  // Clamped against the CURRENT row count, not just against zero.
  //
  // Without this, filtering a long list down to a few rows while scrolled
  // renders nothing at all: `scrollTop` is still the old offset, so the
  // window starts past the end of the shortened list. The container's own
  // scrollTop is clamped by the browser a frame later, but the render
  // that happens first would already be blank — which is exactly what a
  // search box does on every keystroke.
  const maxStart = Math.max(0, total - span);
  const start = Math.min(maxStart, Math.max(0, Math.floor(scrollTop / height) - overscan));
  const end = Math.min(total, start + span);

  return {
    start,
    end,
    padTop: start * height,
    padBottom: Math.max(0, (total - end) * height),
    ref,
  };
}
