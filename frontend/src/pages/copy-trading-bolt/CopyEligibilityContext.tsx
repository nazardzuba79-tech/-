import { createContext, useContext } from 'react';

// The archive hardcoded USER_DEPOSIT = 8450 and derived COPY_ELIGIBLE from
// it. This app has a real account, so both come from real data instead:
// CopyTradingPage.tsx computes depositUsd from the same portfolio-value
// figure the Wallet page already persists (POST /wallet/portfolio-snapshot,
// one snapshot per UTC day, computed client-side from live balances — see
// portfolio.ts's doc comment) and provides it here. Everywhere the archive
// read the two module-level constants, the ported components now call
// useCopyEligibility() instead — same $20,000 threshold, same gating
// behavior, just backed by a real number instead of a fixture.
export const COPY_ELIGIBILITY_THRESHOLD_USD = 20_000;

export type CopyEligibility = {
  depositUsd: number;
  eligible: boolean;
};

const CopyEligibilityContext = createContext<CopyEligibility | null>(null);

export function CopyEligibilityProvider({
  depositUsd,
  isAdmin = false,
  children,
}: {
  depositUsd: number;
  // Admins review this page without necessarily funding the account it
  // runs under, so the $20,000 gate (built for real depositors) shouldn't
  // block them from seeing what a copier would see. depositUsd itself
  // stays the real, possibly-zero figure — only the derived `eligible`
  // flag is overridden.
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  const value: CopyEligibility = { depositUsd, eligible: isAdmin || depositUsd >= COPY_ELIGIBILITY_THRESHOLD_USD };
  return <CopyEligibilityContext.Provider value={value}>{children}</CopyEligibilityContext.Provider>;
}

export function useCopyEligibility(): CopyEligibility {
  const ctx = useContext(CopyEligibilityContext);
  if (!ctx) throw new Error('useCopyEligibility must be used within CopyEligibilityProvider');
  return ctx;
}
