import { useEffect, useRef, useState } from 'react';

/**
 * One frame is "the same" as another when every field is the same value or
 * the same empty array. Callers build frames from props like
 * `book.symbol === symbol ? book.bids : []`, so a fresh empty array on every
 * render is ordinary and must not count as a change — a hold that repainted
 * on it would repaint on every render, and with no hold at all it would
 * render forever.
 */
function sameFrame<T extends Record<string, unknown>>(a: T, b: T): boolean {
  for (const k of Object.keys(b)) {
    const x = a[k], y = b[k];
    if (Object.is(x, y)) continue;
    if (Array.isArray(x) && Array.isArray(y) && x.length === 0 && y.length === 0) continue;
    return false;
  }
  return true;
}

/**
 * A value that is allowed to change on screen at most once per `holdMs`.
 *
 * The Futures depth feed already coalesces socket deltas into one publish
 * every 400ms, and at that rate a busy contract's ladder still rewrites
 * two or three times a second. The owner's ask, put beside the reference
 * terminal: the figures should move more slowly, so they pull the eye
 * less. This is a display hold, not a data hold — the feed, the execution
 * path and the order form keep their own streams and see every frame.
 *
 * Leading edge, then trailing: the first change after a quiet spell shows
 * at once, changes inside the window are folded into one repaint at the
 * window's end, and the newest value always wins. `holdMs` of 0 shows
 * every value the moment it arrives, which is what every design other than
 * the archive terminal asks for. A change of `key` (the contract) bypasses
 * the hold: a fresh pair must never open on the previous pair's ladder.
 */
export function useHeldFrame<T extends Record<string, unknown>>(value: T, holdMs: number, key: string): T {
  const [shown, setShown] = useState<{ key: string; value: T }>({ key, value });
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // The first render is itself a paint: the hold counts from it.
  const paintedAt = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    const current = shownRef.current;
    if (current.key === key && sameFrame(current.value, value)) return;
    if (holdMs <= 0 || key !== current.key) {
      if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
      paintedAt.current = Date.now();
      setShown({ key, value });
      return;
    }
    const wait = paintedAt.current + holdMs - Date.now();
    if (wait <= 0) {
      paintedAt.current = Date.now();
      setShown({ key, value });
      return;
    }
    // The pending repaint stays armed across renders and paints whatever is
    // newest when it fires; only unmount clears it.
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      paintedAt.current = Date.now();
      setShown({ key, value: latest.current });
    }, wait);
  }, [value, holdMs, key]);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  return shown.key === key ? shown.value : value;
}
