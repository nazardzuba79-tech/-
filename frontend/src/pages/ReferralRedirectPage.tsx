import { useEffect } from 'react';
import { useParams, Navigate } from 'react-router-dom';

export const REFERRAL_CODE_STORAGE_KEY = 'exchange_referral_code';

/**
 * The clean, shareable link a referral code turns into: /r/:code. Stores
 * the code locally and hands off to the login/register screen — AuthPage
 * reads it back out at registration time and sends it along as `ref` (see
 * auth.ts's registerSchema on the backend). Never itself creates or
 * changes anything; a bad/unknown code just goes nowhere special, same as
 * the backend silently ignoring one it doesn't recognize.
 */
export function ReferralRedirectPage() {
  const { code } = useParams<{ code: string }>();

  useEffect(() => {
    if (!code) return;
    try {
      localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, code);
    } catch {
      // best-effort — worst case the referral just isn't credited
    }
  }, [code]);

  return <Navigate to="/login" replace />;
}
