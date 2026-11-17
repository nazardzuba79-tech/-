import { syntheticNazaraTrader, type SyntheticCopyTradingResponse } from './syntheticCopyTrading';
import type { Trader } from '../pages/copy-trading-bolt/traders';
export const KSENIA_TRADER_ID = 'VX-KSENIA';
export interface PublicStrategyIdentity {
  traderId: string; displayName: string; avatarUrl: string | null;
  avatarVersion: string | null; verified: boolean; premium: boolean;
  xUrl?: string | null; telegramUrl?: string | null;
}
export type KseniaResponse = SyntheticCopyTradingResponse & { provenance: 'SYNTHETIC_REVIEW'; traderEarnings365: number };
export function withStrategyIdentityVerification(trader: Trader, identity?: PublicStrategyIdentity): Trader {
  const bound = identity?.traderId === trader.id ? identity : undefined;
  const identityVerified = bound?.verified === true;
  const name = trader.id === 'VX-001' ? bound?.displayName.trim() : undefined;
  if (!name) return { ...trader, identityVerified };
  const initials = name.split(/\s+/u).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase();
  return { ...trader, name, initials, identityVerified };
}
export function kseniaTrader(data?: KseniaResponse | null, identity?: PublicStrategyIdentity): Trader {
  // Stateless DTO projection only; no Nazar state or engine mutation.
  return withStrategyIdentityVerification({ ...syntheticNazaraTrader(data), id: KSENIA_TRADER_ID, name: 'Ksenia', initials: 'K', tone: 'slate',
    strategy: 'Multi-Asset Strategy', verified: identity?.verified ?? false, ownerAvatarUrl: identity?.avatarUrl ?? null }, identity);
}

/** Synchronous identity only. All inherited dynamic metrics are NaN/dashes. */
export const kseniaTraderShell = kseniaTrader();
