/**
 * The wheel over the Futures order column moves the page first (owner,
 * 2026-10-22, second Bybit recording: «я хочу щоб панель рухалась як на
 * відео»). On Bybit the page scrolls as one piece: with the pointer on the
 * order form or the account card, the chart, the positions and the column go
 * up together. Here the column is its own scroll box — its form, account card
 * and contract data are taller than most screens — and the browser gives the
 * wheel to the innermost box that can still move, so over the column only the
 * form slid while the page and its positions panel stood still.
 *
 * Downwards the page now goes first, as far as it scrolls (the account
 * panel's continuation below the screen's edge, FuturesPanelResize.css), and
 * then the column's own rest as before. Upwards nothing changes: the column
 * returns to its top first and hands the wheel to the page, which the browser
 * already does. A box inside the column that can still scroll (an open list)
 * keeps its wheel; Ctrl + wheel (zoom) and sideways gestures are never taken.
 *
 * Display only: no order, position, balance or form value is read or changed.
 */

/** A line of a line-mode wheel (Firefox's `deltaMode` 1); Chrome and Edge report pixels. */
export const WHEEL_LINE_PX = 40;

export type PageFirstWheelInput = {
  deltaX: number;
  deltaY: number;
  /** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  ctrlKey: boolean;
  /** How far the page can still scroll down, px. */
  pageRoom: number;
  /** The window's height, for page-mode deltas. */
  viewportHeight: number;
  /** A box inside the column, under the pointer, can still scroll down. */
  innerCanScroll: boolean;
};

/** Pixels the page should scroll for this wheel step; 0 leaves the step to the browser. */
export function pageFirstWheelStep(input: PageFirstWheelInput): number {
  const { deltaX, deltaY, deltaMode, ctrlKey, pageRoom, viewportHeight, innerCanScroll } = input;
  if (ctrlKey || innerCanScroll) return 0;
  if (!Number.isFinite(deltaY) || deltaY <= 0 || Math.abs(deltaX) > Math.abs(deltaY)) return 0;
  if (!Number.isFinite(pageRoom) || pageRoom < 1) return 0;
  const unit = deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? Math.max(0, viewportHeight) : 1;
  const px = deltaY * unit;
  return px > 0 ? Math.min(px, Math.floor(pageRoom)) : 0;
}

/** Whether a box between the pointer's target and the column (the column excluded) can still scroll down. */
export function innerBoxCanScrollDown(target: EventTarget | null, column: HTMLElement): boolean {
  const view = column.ownerDocument.defaultView;
  if (!view) return false;
  for (let el = target instanceof view.Element ? target : null; el && el !== column; el = el.parentElement) {
    const overflowY = view.getComputedStyle(el).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight - el.clientHeight - el.scrollTop > 1) return true;
  }
  return false;
}

/** Listens to the wheel on the column; `active` is read on every step (desktop only). Returns the cleanup. */
export function installPageFirstWheel(column: HTMLElement, active: () => boolean): () => void {
  const onWheel = (event: WheelEvent) => {
    if (!active()) return;
    const doc = column.ownerDocument, view = doc.defaultView, page = doc.scrollingElement;
    if (!view || !page) return;
    const step = pageFirstWheelStep({
      deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey,
      pageRoom: page.scrollHeight - page.clientHeight - page.scrollTop,
      viewportHeight: view.innerHeight,
      innerCanScroll: innerBoxCanScrollDown(event.target, column),
    });
    if (step <= 0) return;
    event.preventDefault();
    // A mouse notch glides as the browser's own wheel does; a touchpad's small steps follow the fingers.
    view.scrollBy({ top: step, behavior: step >= WHEEL_LINE_PX ? 'smooth' : 'auto' });
  };
  column.addEventListener('wheel', onWheel, { passive: false });
  return () => column.removeEventListener('wheel', onWheel);
}
