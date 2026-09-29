import { useEffect, useState } from 'react';
import type { TelegramWebApp } from './telegram';

/** Pause chart work without discarding an in-memory order draft. */
export function useReviewActivity(app?: TelegramWebApp) {
  const [active, setActive] = useState(() => !document.hidden && app?.isActive !== false);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    let pageHidden = false;
    let telegramActive = app?.isActive !== false;
    const sync = () => setActive(!pageHidden && !document.hidden && telegramActive);
    const hide = () => { pageHidden = true; sync(); };
    const show = () => { pageHidden = false; sync(); };
    const activate = () => { telegramActive = true; sync(); };
    const deactivate = () => { telegramActive = false; sync(); };
    const connection = () => setOnline(navigator.onLine);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    app?.onEvent('activated', activate);
    app?.onEvent('deactivated', deactivate);
    sync();
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      app?.offEvent('activated', activate);
      app?.offEvent('deactivated', deactivate);
    };
  }, [app]);
  return { active, online };
}
