/** Sharing destinations are operator-owned constants, never the current origin,
 * a query parameter, user input, or an arbitrary stored URL. */
export type ReferralRegion = 'world' | 'ru';
export const REFERRAL_REGION_STORAGE_KEY = 'exchange_referral_region';

export function isReferralRegion(value: unknown): value is ReferralRegion {
  return value === 'world' || value === 'ru';
}

export function buildReferralLink(referralCode: unknown, region: ReferralRegion = 'world'): string | null {
  // Keep the exact API code, including case. No guessed/generated code or URL syntax.
  if (typeof referralCode !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(referralCode) || !isReferralRegion(region)) return null;
  const origin = region === 'ru' ? 'https://ru.voltextech.net' : 'https://voltextech.net';
  return `${origin}/${referralCode}`;
}

export function readReferralRegion(): ReferralRegion {
  try {
    const stored = localStorage.getItem(REFERRAL_REGION_STORAGE_KEY);
    return isReferralRegion(stored) ? stored : 'world';
  } catch { return 'world'; }
}
