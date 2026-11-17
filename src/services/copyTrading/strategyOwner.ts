import { createHash } from 'crypto';
import { publicStrategySocials } from '../../shared/copyStrategySocials';
import type { PrismaClient } from '@prisma/client';

export const KSENIA_EXTERNAL_OWNER_ID = 'a2184cdc-c0fc-4892-9141-e493967245fd';
export const PUBLIC_STRATEGIES = ['VX-001', 'VX-KSENIA'] as const;
export interface PublicStrategyIdentity {
  traderId: string; displayName: string; avatarUrl: string | null;
  avatarVersion: string | null; verified: boolean; premium: boolean;
  xUrl: string | null; telegramUrl: string | null;
}

/** Only the explicitly bound same-environment owner, never an email or viewer.
 * No account mutation; the public response has only allowlisted identity fields. */
export async function resolveStrategyOwner(db: Pick<PrismaClient, 'copyStrategyOwner' | 'user'>, traderId: string): Promise<PublicStrategyIdentity | null> {
  if (!(PUBLIC_STRATEGIES as readonly string[]).includes(traderId)) return null;
  const strategy = await db.copyStrategyOwner.findUnique({ where: { traderId } });
  if (!strategy) return null;
  const owner = strategy.ownerUserId
    ? await db.user.findUnique({ where: { id: strategy.ownerUserId }, select: { avatarUrl: true, kycStatus: true, ...(traderId === 'VX-001' && { displayName: true }) } })
    : null;
  const name = traderId === 'VX-001' && typeof owner?.displayName === 'string' ? owner.displayName.trim() : '';
  const displayName = name && name.length <= 80 && !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(name) ? name : strategy.publicName;
  const stored = owner?.avatarUrl;
  const avatarUrl = stored && stored.length <= 300_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(stored) ? stored : null;
  return { ...publicStrategySocials(traderId, owner && strategy.ownerUserId === strategy.socialOwnerUserId ? strategy : null), traderId, displayName, avatarUrl,
    avatarVersion: avatarUrl ? createHash('sha256').update(avatarUrl).digest('hex').slice(0, 20) : null,
    verified: owner?.kycStatus === 'APPROVED', premium: strategy.premium };
}
