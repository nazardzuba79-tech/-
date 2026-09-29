import { isBrowserInactive, addBrowserActivityListener, removeBrowserActivityListener } from '../lib/browserActivity';
import { useEffect } from 'react';
import '../pages/trade-terminal/SampledDisplay.css';

export { sampledDisplayText } from '../lib/sampledDisplayCopy';

let motionUsers = 0;
const reflectVisibility = () => { if (typeof document !== 'undefined') document.documentElement.dataset.sampledMotion = isBrowserInactive() ? 'paused' : 'running'; };
export function useSampledMotion(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (motionUsers++ === 0) { reflectVisibility(); addBrowserActivityListener(reflectVisibility); }
    return () => { if (--motionUsers === 0) { removeBrowserActivityListener(reflectVisibility); delete document.documentElement.dataset.sampledMotion; } };
  }, []);
}

/** Internal sampled-display lifecycle only. Never render transport/cache details to customers. */
export function SampledDataNote(_props: { asOf?: number | null; cadenceMs?: number }) {
  useSampledMotion();
  return null;
}
