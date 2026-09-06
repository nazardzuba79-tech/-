import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';

// Owner-confirmed identity. Backend only, never email-based or viewer-based.
export const KSENIA_EXTERNAL_OWNER_ID = 'a2184cdc-c0fc-4892-9141-e493967245fd';
export const PUBLIC_STRATEGIES = ['VX-001', 'VX-KSENIA'] as const;
export interface PublicStrategyIdentity {
  traderId: string; displayName: string; avatarUrl: string | null;
  avatarVersion: string | null; verified: boolean; premium: boolean;
}
export async function resolveStrategyOwner(db: Pick<PrismaClient, 'copyStrategyOwner' | 'user'>, traderId: string): Promise<PublicStrategyIdentity | null> {
  if (!(PUBLIC_STRATEGIES as readonly string[]).includes(traderId)) return null;
  const strategy = await db.copyStrategyOwner.findUnique({ where: { traderId } });
  if (!strategy) return null;
  // In the future approved production environment the confirmed stable ID
  // resolves the *local* User table. Staging has no copied customer row, so
  // absence is a legitimate initials fallback, not a fabricated User.
  const ownerId = strategy.ownerUserId ?? strategy.externalOwnerUserId;
  const owner = ownerId ? await db.user.findUnique({ where: { id: ownerId }, select: { avatarUrl: true, kycStatus: true } }) : null;
  const stored = owner?.avatarUrl;
  const avatarUrl = stored && stored.length <= 300_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(stored) ? stored : null;
  return { traderId, displayName: strategy.publicName, avatarUrl,
    avatarVersion: avatarUrl ? createHash('sha256').update(avatarUrl).digest('hex').slice(0, 20) : null,
    verified: owner?.kycStatus === 'APPROVED', premium: strategy.premium };
}
