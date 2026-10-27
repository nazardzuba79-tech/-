import { useEffect, useState } from 'react';
import { isReferralRegion, readReferralRegion, REFERRAL_REGION_STORAGE_KEY, type ReferralRegion } from './referralLinks';

const CHANGED = 'voltex:referral-region';

/** One non-sensitive display preference shared by Profile and Banking. */
export function useReferralRegion() {
  const [region, setRegion] = useState(readReferralRegion);
  useEffect(() => {
    const reload = () => setRegion(readReferralRegion());
    const stored = (event: StorageEvent) => { if (event.key === REFERRAL_REGION_STORAGE_KEY || event.key === null) reload(); };
    window.addEventListener('storage', stored);
    window.addEventListener(CHANGED, reload);
    return () => { window.removeEventListener('storage', stored); window.removeEventListener(CHANGED, reload); };
  }, []);
  function chooseRegion(next: ReferralRegion) {
    if (!isReferralRegion(next)) return;
    try {
      localStorage.setItem(REFERRAL_REGION_STORAGE_KEY, next);
      window.dispatchEvent(new Event(CHANGED));
    } catch { /* In-memory switching still works with unavailable storage. */ }
    setRegion(next);
  }
  return [region, chooseRegion] as const;
}
