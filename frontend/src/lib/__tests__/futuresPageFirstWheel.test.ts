import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pageFirstWheelStep, innerBoxCanScrollDown, installPageFirstWheel, WHEEL_LINE_PX, type PageFirstWheelInput } from '../futuresPageFirstWheel';

/** The wheel over the Futures order column moves the page first (owner's Bybit recording, 2026-10-22). */
const step = (over: Partial<PageFirstWheelInput>) => pageFirstWheelStep({
  deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, pageRoom: 140, viewportHeight: 944, innerCanScroll: false, ...over,
});

describe('pageFirstWheelStep', () => {
  test('a downward notch goes to the page while the page can still scroll, never past its end', () => {
    expect(step({})).toBe(100);
    expect(step({ pageRoom: 40 })).toBe(40);
    expect(step({ pageRoom: 40.7 })).toBe(40);
    expect(step({ deltaY: 3 })).toBe(3);
  });

  test('the page at its end, or the wheel going up, is left to the browser (the column, then the page)', () => {
    expect(step({ pageRoom: 0 })).toBe(0);
    expect(step({ pageRoom: 0.6 })).toBe(0);
    expect(step({ deltaY: -100 })).toBe(0);
    expect(step({ deltaY: 0 })).toBe(0);
  });

  test('zoom, sideways gestures and an inner list that can still scroll keep their wheel', () => {
    expect(step({ ctrlKey: true })).toBe(0);
    expect(step({ deltaX: 120, deltaY: 30 })).toBe(0);
    expect(step({ innerCanScroll: true })).toBe(0);
  });

  test('line and page wheels are converted to pixels; nonsense is refused', () => {
    expect(step({ deltaMode: 1, deltaY: 3, pageRoom: 500 })).toBe(3 * WHEEL_LINE_PX);
    expect(step({ deltaMode: 2, deltaY: 1, pageRoom: 5000 })).toBe(944);
    expect(step({ deltaMode: 2, deltaY: 1, pageRoom: 140 })).toBe(140);
    expect(step({ deltaY: NaN })).toBe(0);
    expect(step({ pageRoom: NaN })).toBe(0);
  });
});

/* A node-side stand-in for the few DOM members the module reads. */
class FakeElement {
  parentElement: FakeElement | null = null;
  constructor(public overflowY = 'visible', public scrollHeight = 0, public clientHeight = 0, public scrollTop = 0) {}
}
const makeView = () => {
  const scrolls: ScrollToOptions[] = [];
  const view = {
    Element: FakeElement,
    innerHeight: 944,
    getComputedStyle: (el: FakeElement) => ({ overflowY: el.overflowY }),
    scrollBy: (options: ScrollToOptions) => { scrolls.push(options); },
  };
  return { view, scrolls };
};
const makeColumn = (page: { scrollHeight: number; clientHeight: number; scrollTop: number }) => {
  const { view, scrolls } = makeView();
  const listeners: Array<{ type: string; fn: (e: unknown) => void; options: unknown }> = [];
  const column = Object.assign(new FakeElement('auto', 1244, 1000, 0), {
    ownerDocument: { defaultView: view, scrollingElement: page },
    addEventListener: (type: string, fn: (e: unknown) => void, options: unknown) => { listeners.push({ type, fn, options }); },
    removeEventListener: (type: string, fn: (e: unknown) => void) => { const i = listeners.findIndex(l => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
  });
  return { column, listeners, scrolls };
};
const wheel = (target: unknown, over: Partial<WheelEvent> = {}) => {
  let prevented = false;
  const event = { deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, target, preventDefault: () => { prevented = true; }, ...over };
  return { event, prevented: () => prevented };
};

describe('innerBoxCanScrollDown', () => {
  test('a scrollable box between the pointer and the column keeps the wheel until its own end; the column itself does not count', () => {
    const { column } = makeColumn({ scrollHeight: 1084, clientHeight: 944, scrollTop: 0 });
    const list = new FakeElement('auto', 400, 200, 0);
    const item = new FakeElement();
    item.parentElement = list; list.parentElement = column as unknown as FakeElement;
    expect(innerBoxCanScrollDown(item as unknown as EventTarget, column as unknown as HTMLElement)).toBe(true);
    list.scrollTop = 200;
    expect(innerBoxCanScrollDown(item as unknown as EventTarget, column as unknown as HTMLElement)).toBe(false);
    const hidden = new FakeElement('hidden', 900, 300, 0);
    hidden.parentElement = column as unknown as FakeElement;
    expect(innerBoxCanScrollDown(hidden as unknown as EventTarget, column as unknown as HTMLElement)).toBe(false);
    expect(innerBoxCanScrollDown(column as unknown as EventTarget, column as unknown as HTMLElement)).toBe(false);
    expect(innerBoxCanScrollDown(null, column as unknown as HTMLElement)).toBe(false);
  });
});

describe('installPageFirstWheel', () => {
  test('over the column, a downward notch scrolls the page and not the column; at the page end the browser takes over', () => {
    const page = { scrollHeight: 1084, clientHeight: 944, scrollTop: 0 };
    const { column, listeners, scrolls } = makeColumn(page);
    const cleanup = installPageFirstWheel(column as unknown as HTMLElement, () => true);
    expect(listeners).toHaveLength(1);
    expect(listeners[0].type).toBe('wheel');
    expect(listeners[0].options).toEqual({ passive: false });

    const first = wheel(column);
    listeners[0].fn(first.event);
    expect(first.prevented()).toBe(true);
    expect(scrolls).toEqual([{ top: 100, behavior: 'smooth' }]);

    page.scrollTop = 100;
    const second = wheel(column);
    listeners[0].fn(second.event);
    expect(second.prevented()).toBe(true);
    expect(scrolls.at(-1)).toEqual({ top: 40, behavior: 'smooth' });

    page.scrollTop = 140;
    const third = wheel(column);
    listeners[0].fn(third.event);
    expect(third.prevented()).toBe(false);
    expect(scrolls).toHaveLength(2);

    const touchpad = wheel(column, { deltaY: 6 });
    page.scrollTop = 0;
    listeners[0].fn(touchpad.event);
    expect(scrolls.at(-1)).toEqual({ top: 6, behavior: 'auto' });

    cleanup();
    expect(listeners).toHaveLength(0);
  });

  test('upwards, with Ctrl, or off desktop the wheel is never taken', () => {
    const page = { scrollHeight: 1084, clientHeight: 944, scrollTop: 60 };
    let desktop = true;
    const { column, listeners, scrolls } = makeColumn(page);
    installPageFirstWheel(column as unknown as HTMLElement, () => desktop);
    for (const over of [{ deltaY: -100 }, { ctrlKey: true }]) {
      const e = wheel(column, over);
      listeners[0].fn(e.event);
      expect(e.prevented()).toBe(false);
    }
    desktop = false;
    const e = wheel(column);
    listeners[0].fn(e.event);
    expect(e.prevented()).toBe(false);
    expect(scrolls).toHaveLength(0);
  });
});

describe('the page wires it', () => {
  const src = readFileSync(resolve(__dirname, '../../pages/FuturesPage.tsx'), 'utf8');
  test('the order column carries the ref and the desktop wheel is installed on it once', () => {
    expect(src).toContain("import { installPageFirstWheel } from '../lib/futuresPageFirstWheel';");
    expect(src).toContain('<div id="mobile-futures-panel-trade" className="order-form-area" ref={orderColumnRef}>');
    expect(src).toMatch(/const desktop = window\.matchMedia\('\(min-width: 901px\)'\);\s*return installPageFirstWheel\(column, \(\) => desktop\.matches\);/);
  });
});
