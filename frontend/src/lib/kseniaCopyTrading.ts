import { syntheticNazaraTrader, type SyntheticCopyTradingResponse } from './syntheticCopyTrading';
import type { Trader } from '../pages/copy-trading-bolt/traders';
export const KSENIA_TRADER_ID = 'VX-KSENIA';
export interface PublicStrategyIdentity {
  traderId: string; displayName: string; avatarUrl: string | null;
  avatarVersion: string | null; verified: boolean; premium: boolean;
}
export type KseniaResponse = SyntheticCopyTradingResponse & { provenance: 'SYNTHETIC_REVIEW'; traderEarnings365: number };
export function withStrategyIdentityVerification(trader: Trader, identity?: PublicStrategyIdentity): Trader {
  return { ...trader, identityVerified: identity?.traderId === trader.id && identity.verified === true };
}
export function kseniaTrader(data?: KseniaResponse | null, identity?: PublicStrategyIdentity): Trader {
  // Stateless DTO projection only; no Nazar state or engine mutation.
  return withStrategyIdentityVerification({ ...syntheticNazaraTrader(data), id: KSENIA_TRADER_ID, name: 'Ksenia', initials: 'K', tone: 'slate',
    strategy: 'Multi-Asset Strategy', verified: identity?.verified ?? false, ownerAvatarUrl: identity?.avatarUrl ?? null }, identity);
}

/** Synchronous identity only. All inherited dynamic metrics are NaN/dashes. */
export const kseniaTraderShell = kseniaTrader();
