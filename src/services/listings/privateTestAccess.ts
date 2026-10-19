/**
 * Who may use a History20 private test listing (owner decision 2026-10-19).
 *
 * Default off: unless HISTORY20_PRIVATE_SPOT_ENABLED is exactly `true` on the
 * server, no account trades or is funded on a private listing, whatever the
 * published catalogue holds. While it is on, only the verified owner and the
 * allowlisted testers qualify (isSimulationOnlyUser); an ADMIN role alone
 * never does, and no request field can opt an account in.
 */
import { isSimulationOnlyUser } from '../../private-trading/access';

export function history20PrivateSpotEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HISTORY20_PRIVATE_SPOT_ENABLED === 'true';
}

export function canUsePrivateTestListing(userId: string | null | undefined): boolean {
  return history20PrivateSpotEnabled() && isSimulationOnlyUser(userId);
}
