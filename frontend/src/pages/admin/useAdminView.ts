import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { getToken, onSessionChange } from '../../lib/api';

// Only view preferences in memory. No user records, credentials or financial data.
type Position = { windowX: number; windowY: number; tableX: number; tableY: number };
const scroll = new Map<string, Position>();
onSessionChange(() => scroll.clear());
export function useAdminView({ deferScrollRestore = false } = {}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const key = location.pathname + location.search;
  const session = getToken();
  const current = useRef({ key, session, restored: false });
  if (current.current.key !== key || current.current.session !== session) current.current = { key, session, restored: false };
  const scrollRef = useRef<HTMLDivElement | null>(null), frame = useRef<number>();
  const rememberScroll = useCallback(() => {
    if (!current.current.restored || current.current.key !== key || current.current.session !== getToken()) return;
    const previous = scroll.get(key), table = scrollRef.current;
    scroll.set(key, { windowX: window.scrollX, windowY: window.scrollY,
      tableX: table?.scrollLeft ?? previous?.tableX ?? 0, tableY: table?.scrollTop ?? previous?.tableY ?? 0 });
    if (scroll.size > 50) scroll.delete(scroll.keys().next().value!);
  }, [key, session]);
  const restoreScroll = useCallback(() => {
    if (current.current.restored || current.current.key !== key || current.current.session !== getToken()) return;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (current.current.key !== key || current.current.session !== getToken()) return;
      const position = scroll.get(key), table = scrollRef.current;
      window.scrollTo(position?.windowX ?? 0, position?.windowY ?? 0);
      if (table) { table.scrollLeft = position?.tableX ?? 0; table.scrollTop = position?.tableY ?? 0; }
      current.current.restored = true;
    });
  }, [key, session]);
  useEffect(() => {
    if (!deferScrollRestore) restoreScroll();
    window.addEventListener('scroll', rememberScroll, { passive: true });
    return () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); window.removeEventListener('scroll', rememberScroll); };
  }, [deferScrollRestore, restoreScroll, rememberScroll]);
  const update = (patch: Record<string, string | number>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(patch)) value === '' ? next.delete(name) : next.set(name, String(value));
    setParams(next, { preventScrollReset: true, replace: 'search' in patch || 'userId' in patch });
  };
  return { params, update, returnTo: key, page: Math.max(1, Math.floor(Number(params.get('page'))) || 1), scrollRef, rememberScroll, restoreScroll };
}
