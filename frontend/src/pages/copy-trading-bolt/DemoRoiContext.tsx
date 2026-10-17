import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEMO_ROI_END, DEMO_ROI_START, demoRoiFor } from '../../lib/copyDemoRoi';
import type { Period } from './traders';
import { useLanguage } from '../../lib/i18n';

const COPY = {
  ru: ['Демо · симуляция', 'Не фактическая доходность. До 22.10.2026 00:00 UTC.'],
  en: ['Demo · simulated', 'Not actual returns. Until 22 Oct 2026 00:00 UTC.'],
  zh: ['演示 · 模拟', '非实际收益。截止：2026年10月22日 00:00 UTC。'],
  es: ['Demo · simulación', 'No es rentabilidad real. Hasta 22 oct 2026 00:00 UTC.'],
  hi: ['डेमो · सिमुलेटेड', 'वास्तविक रिटर्न नहीं। 22 अक्टूबर 2026 00:00 UTC तक।'],
  ja: ['デモ · シミュレーション', '実際の収益ではありません。2026年10月22日 00:00 UTCまで。'],
  ko: ['데모 · 시뮬레이션', '실제 수익이 아닙니다. 2026년 10월 22일 00:00 UTC까지.'],
} as const;

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

/** An adjacent dated scenario, never the value/label of the rolling metric. */
export function DemoRoiNotice({ traderId, period }: { traderId: string; period: Period }) {
  const demo = useDemoRoi(traderId, period);
  const { lang } = useLanguage();
  if (!demo) return null;
  const [label, description] = COPY[lang];
  return <p className="profile-period-range" data-demo-roi={traderId}>
    <span>{label} · {demo.period} (UTC): <strong>+{demo.roi}%</strong></span>
    <br /><small>{description}</small>
  </p>;
}
