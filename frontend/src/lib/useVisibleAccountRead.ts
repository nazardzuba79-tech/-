import { useCallback, useEffect, useRef } from 'react';
import { getToken, onSessionChange } from './api';
import { createVisibleRead } from './visibleRead';

/** Lifetime/session guard shared by low-frequency authenticated display reads. */
export function useVisibleAccountRead<T>(options: {
  load: () => Promise<T>; accept: (value: T) => void; reset: () => void;
  fail?: () => void; staleMs: number; poll?: boolean;
}) {
  const latest = useRef(options); latest.current = options;
  const reader = useRef<ReturnType<typeof createVisibleRead> | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    let generation = 0;
    const start = () => {
      const epoch = ++generation;
      reader.current?.stop();
      const token = getToken();
      if (!token) { reader.current = null; return; }
      reader.current = createVisibleRead(async () => {
        if (!token) return;
        const version = revision.current;
        try {
          const next = await latest.current.load();
          if (generation === epoch && getToken() === token && version === revision.current) latest.current.accept(next);
        } catch (error) {
          if (generation === epoch && getToken() === token && version === revision.current) latest.current.fail?.();
          throw error;
        }
      }, options.staleMs, options.poll);
    };
    start();
    const off = onSessionChange(() => { latest.current.reset(); start(); });
    return () => { generation++; off(); reader.current?.stop(); reader.current = null; };
  }, [options.staleMs, options.poll]);
  return useCallback(() => { revision.current++; return reader.current?.refresh() ?? Promise.resolve(); }, []);
}
