import { createHash } from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';

export const CONTACT_EMAIL_BLOCKED = 'CONTACT_EMAIL_BLOCKED';
export const CONTACT_EMAIL_UNBLOCKED = 'CONTACT_EMAIL_UNBLOCKED';
export const CONTACT_EMAIL_ACTIONS = [CONTACT_EMAIL_BLOCKED, CONTACT_EMAIL_UNBLOCKED];
export const normalizeContactEmail = (email: string) => email.trim().toLowerCase();
export const contactEmailHash = (email: string) => createHash('sha256').update(normalizeContactEmail(email)).digest('hex');

type PolicyDb = PrismaClient | Prisma.TransactionClient;

export async function isBlockedContactEmail(prisma: PolicyDb, email: unknown): Promise<boolean> {
  if (typeof email !== 'string' || email.length > 320) return false;
  const hash = contactEmailHash(email);
  const event = await prisma.auditLog.findFirst({
    where: { action: { in: CONTACT_EMAIL_ACTIONS }, metadata: { path: ['emailHash'], equals: hash } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true },
  });
  return event?.action === CONTACT_EMAIL_BLOCKED;
}

export async function blockedContactEmails(prisma: PolicyDb) {
  const states = new Map<string, { email: string; blocked: boolean; addedAt: Date; addedBy: string }>();
  const events = await prisma.auditLog.findMany({ where: { action: { in: CONTACT_EMAIL_ACTIONS } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true, metadata: true, createdAt: true, userId: true } });
  for (const event of events) {
    const data = event.metadata as { email?: unknown; actorEmail?: unknown };
    if (typeof data?.email !== 'string') continue;
    const email = normalizeContactEmail(data.email);
    if (!states.has(email)) states.set(email, { email, blocked: event.action === CONTACT_EMAIL_BLOCKED, addedAt: event.createdAt, addedBy: typeof data.actorEmail === 'string' ? data.actorEmail : event.userId || 'Системный администратор' });
  }
  return [...states.values()].filter(row => row.blocked).sort((a, b) => a.email.localeCompare(b.email));
}

// Pre-Session-model JWTs have no Session row to revoke. A block event remains
// their revocation boundary even after an admin removes the blacklist entry.
export async function isRevokedContactToken(prisma: PolicyDb, email: unknown, issuedAt: unknown) {
  if (typeof email !== 'string') return false;
  const event = await prisma.auditLog.findFirst({
    where: { action: CONTACT_EMAIL_BLOCKED, metadata: { path: ['emailHash'], equals: contactEmailHash(email) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true },
  });
  return !!event?.createdAt && (typeof issuedAt !== 'number' || issuedAt * 1000 <= event.createdAt.getTime());
}
