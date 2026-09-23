import { useEffect } from 'react';
import '../pages/trade-terminal/SampledDisplay.css';

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

/** Internal sampled-display lifecycle only. Never render transport/cache details to customers. */
export function SampledDataNote(_props: { asOf?: number | null; cadenceMs?: number }) {
  useSampledMotion();
  return null;
}
