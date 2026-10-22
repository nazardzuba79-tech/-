import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEMO_ROI_END, DEMO_ROI_START, demoRoiFor } from '../../lib/copyDemoRoi';
import type { Period } from './traders';


const DemoRoiContext = createContext<{ now: number; nazar: unknown; ksenia: unknown }>({
  now: 0, nazar: null, ksenia: null,
});

export function DemoRoiProvider({ nazar, ksenia, children }: {
  nazar: unknown; ksenia: unknown; children: ReactNode;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: number | undefined;
    const sync = () => {
      window.clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      const boundary = current < DEMO_ROI_START ? DEMO_ROI_START : DEMO_ROI_END;
      // The deadline works without a successful API refresh. Recheck wall time
      // once per minute for clock changes, and immediately on tab resume.
      if (current < boundary) timer = window.setTimeout(sync, Math.min(boundary - current, 60_000));
    };
    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return <DemoRoiContext.Provider value={{ now, nazar, ksenia }}>{children}</DemoRoiContext.Provider>;
}

export function useDemoRoi(traderId: string, period: Period) {
  const { now, nazar, ksenia } = useContext(DemoRoiContext);
  return demoRoiFor(traderId, period, traderId === 'VX-001' ? nazar : ksenia, now);
}
