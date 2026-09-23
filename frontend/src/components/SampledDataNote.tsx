import { useEffect } from 'react';
import { useLanguage } from '../lib/i18n';
import '../pages/trade-terminal/SampledDisplay.css';

import { sampledDisplayText } from '../lib/sampledDisplayCopy';
export { sampledDisplayText } from '../lib/sampledDisplayCopy';

let motionUsers = 0;
const reflectVisibility = () => { if (typeof document !== 'undefined') document.documentElement.dataset.sampledMotion = document.hidden ? 'paused' : 'running'; };
export function useSampledMotion(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (motionUsers++ === 0) { reflectVisibility(); document.addEventListener('visibilitychange', reflectVisibility); }
    return () => { if (--motionUsers === 0) { document.removeEventListener('visibilitychange', reflectVisibility); delete document.documentElement.dataset.sampledMotion; } };
  }, []);
}
export function SampledDataNote({ asOf, cadenceMs = 60_000 }: { asOf?: number | null; cadenceMs?: number }) {
  const { lang } = useLanguage(); useSampledMotion();
  const copy = sampledDisplayText(lang, asOf, cadenceMs);
  return <span className="sampled-data-note" data-sampled-note="true" data-refresh-ms={cadenceMs}
    data-observed-at={asOf ?? undefined} title={copy.title}>{copy.label}</span>;
}
