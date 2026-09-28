import { useEffect, useState } from 'react';

/** Removing active children tears down the existing chart's timers and controllers. */
export function useReviewActivity() {
  const [active, setActive] = useState(!document.hidden);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const visibility = () => setActive(!document.hidden);
    const hide = () => setActive(false);
    const connection = () => setOnline(navigator.onLine);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', visibility);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', visibility);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, []);
  return { active, online };
}
