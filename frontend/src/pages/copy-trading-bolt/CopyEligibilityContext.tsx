import { createContext, useContext } from 'react';

// The archive hardcoded USER_DEPOSIT = 8450 and derived COPY_ELIGIBLE from
// it. This app has a real account, so both come from real data instead:
// CopyTradingPage.tsx computes depositUsd from the same portfolio-value
// figure the Wallet page already persists (POST /wallet/portfolio-snapshot,
// one snapshot per UTC day, computed client-side from live balances — see
// portfolio.ts's doc comment) and provides it here. Everywhere the archive
// read the two module-level constants, the ported components now call
// useCopyEligibility() instead — same threshold, same gating
// behavior, just backed by a real number instead of a fixture.
/** The Copy Trading deposit gate, in USD. This is the ONE definition —
 *  every message that quotes a figure to the user is checked against it in
 *  copyDepositUx.test.ts, so the number and the copy cannot drift apart.
 *  Lowered from $20,000 to $10,000 on the owner's instruction. */
export const COPY_ELIGIBILITY_THRESHOLD_USD = 10_000;

export type CopyEligibility = {
  depositUsd: number;
  eligible: boolean;
};

const CopyEligibilityContext = createContext<CopyEligibility | null>(null);

export function CopyEligibilityProvider({
  depositUsd,
  children,
}: {
  depositUsd: number;
  children: React.ReactNode;
}) {
  const value: CopyEligibility = { depositUsd, eligible: Number.isFinite(depositUsd) && depositUsd >= COPY_ELIGIBILITY_THRESHOLD_USD };
  return <CopyEligibilityContext.Provider value={value}>{children}</CopyEligibilityContext.Provider>;
}

export function useCopyEligibility(): CopyEligibility {
  const ctx = useContext(CopyEligibilityContext);
  if (!ctx) throw new Error('useCopyEligibility must be used within CopyEligibilityProvider');
  return ctx;
}
