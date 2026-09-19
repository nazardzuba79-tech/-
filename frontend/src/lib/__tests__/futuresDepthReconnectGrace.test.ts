/**
 * COMING BACK TO A TAB IS NOT A FAULT.
 *
 * The bug these pin: `visibilitychange` with `document.hidden` used to call
 * `markStale()`, flipping every live book to `stale` and closing the socket.
 * Nobody saw the label while the tab was hidden — the damage landed on the
 * way back, because the status was still `stale` until the first frame of
 * the new socket arrived, so the panel announced
 * "Данные не обновляются — переподключение" through an entirely ordinary
 * handshake, over levels that were right there and correct the whole time.
 *
 * `RECONNECT_GRACE_MS` already existed in `bookFreshness.ts` and said
 * exactly how long a reconnect may take before it is worth telling anyone.
 * The visibility path simply never consulted it.
 *
 * What is asserted here is the user-visible contract, not the internals:
 * the levels stay, the warning is withheld for the length of the grace, a
 * frame inside the window returns `live` having said nothing — and, in the
 * negative test, a window that closes empty DOES report `stale`, because a
 * grace that never ends is just a hidden failure.
 */
import { RECONNECT_GRACE_MS, BOOK_STALE_AFTER_MS } from '../bookFreshness';
import { subscribeFuturesDepth, closeFuturesDepth, FLUSH_MS } from '../futuresDepth';

const now = 1_800_000_000_000;
const frame = (data: any = {}, type = 'snapshot') => ({
  topic: 'orderbook.200.BTCUSDT', type, ts: now,
  data: { s: 'BTCUSDT', b: [['100', '2']], a: [['101', '3']], u: 2, seq: 2, ...data },
});

describe('a tab coming back does not accuse the feed of being broken', () => {
  let sockets: any[], hidden: boolean, handlers: Map<string, () => void>;
  let oldWs: any, oldDocument: any, oldFetch: any;

  const show = () => { hidden = false; handlers.get('visibilitychange')!(); };
  const hide = () => { hidden = true; handlers.get('visibilitychange')!(); };
  /** The snapshot the panel would render right now. */
  const shown = (listener: jest.Mock) => listener.mock.calls[listener.mock.calls.length - 1][0];

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now); sockets = []; hidden = false; handlers = new Map();
    oldWs = globalThis.WebSocket; oldDocument = globalThis.document; oldFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = undefined; // no REST fallback unless a test wires one
    Object.assign(globalThis, {
      document: { get hidden() { return hidden; },
        addEventListener: (n: string, fn: () => void) => handlers.set(n, fn),
        removeEventListener: (n: string) => handlers.delete(n) },
      WebSocket: class { readyState = 1; onopen: any; onmessage: any; onclose: any; onerror: any;
        send = jest.fn(); close = jest.fn(); constructor(public url: string) { sockets.push(this); } },
    });
  });
  afterEach(() => {
    closeFuturesDepth();
    Object.assign(globalThis, { WebSocket: oldWs, document: oldDocument, fetch: oldFetch });
    jest.useRealTimers();
  });

  /** 1-7 of the required scenario, in order, in one test. */
  test('last-good levels stay, no warning for the whole grace, and a fresh frame restores live', () => {
    const listener = jest.fn();
    const stop = subscribeFuturesDepth('BTC/USDT', listener);

    // 1. A live book.
    const first = sockets[0]; first.onopen();
    first.onmessage({ data: JSON.stringify(frame()) });
    jest.advanceTimersByTime(FLUSH_MS);
    expect(shown(listener).status).toBe('live');
    const liveLevels = { bids: shown(listener).bids, asks: shown(listener).asks };
    expect(liveLevels.bids).toEqual([{ price: '100', quantity: '2' }]);

    // 2. The tab goes away. 3. And comes back.
    hide();
    expect(first.close).toHaveBeenCalled();
    show();

    // 4/5. Across the ENTIRE grace window the levels are still there and the
    // warning has never been rendered. Sampled every second rather than only
    // at the end, so a flicker of `stale` in the middle cannot slip through:
    // the panel shows the banner the instant the status says `stale`, so one
    // emitted frame with that status is a visible false alarm.
    for (let elapsed = 0; elapsed < RECONNECT_GRACE_MS; elapsed += 1_000) {
      jest.advanceTimersByTime(1_000);
      const state = shown(listener);
      expect(state.status).not.toBe('stale');
      expect(state.bids).toEqual(liveLevels.bids);
      expect(state.asks).toEqual(liveLevels.asks);
    }
    expect(listener.mock.calls.every(([snapshot]) => snapshot.status !== 'stale')).toBe(true);

    // 6. A fresh frame lands. The socket reopened during the grace; use it.
    const reopened = sockets[sockets.length - 1];
    if (reopened !== first) reopened.onopen();
    reopened.onmessage({ data: JSON.stringify(frame({ u: 9, seq: 9, b: [['100', '7']], a: [['101', '3']] })) });
    jest.advanceTimersByTime(FLUSH_MS);
    expect(shown(listener).status).toBe('live');
    expect(shown(listener).bids).toEqual([{ price: '100', quantity: '7' }]);

    // 7. And the warning was never shown at any point in the whole story.
    expect(listener.mock.calls.every(([snapshot]) => snapshot.status !== 'stale')).toBe(true);
    stop();
  });

  /**
   * THE NEGATIVE CONTROL. A grace that never expires is not a fix, it is a
   * silenced alarm — so the same journey with nothing arriving must end in a
   * real `stale`, and the levels must still be there when it does.
   */
  test('a grace that closes with no fresh frame does report stale', () => {
    const listener = jest.fn();
    const stop = subscribeFuturesDepth('BTC/USDT', listener);
    const first = sockets[0]; first.onopen();
    first.onmessage({ data: JSON.stringify(frame()) });
    jest.advanceTimersByTime(FLUSH_MS);
    expect(shown(listener).status).toBe('live');
    const liveLevels = { bids: shown(listener).bids, asks: shown(listener).asks };

    hide();
    show();
    // Nothing is fed to the reopened socket. Run past BOTH the grace and the
    // ordinary stale threshold — the grace defers the verdict, the staleness
    // rule still owns it.
    jest.advanceTimersByTime(RECONNECT_GRACE_MS + BOOK_STALE_AFTER_MS + 5_000);

    expect(shown(listener).status).toBe('stale');
    // Deferring the warning must never have cost the trader the book.
    expect(shown(listener).bids).toEqual(liveLevels.bids);
    expect(shown(listener).asks).toEqual(liveLevels.asks);
    stop();
  });
});
