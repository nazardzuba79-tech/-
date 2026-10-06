import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

export const CONTACT_EMAIL_BLOCKED = 'CONTACT_EMAIL_BLOCKED';
export const CONTACT_EMAIL_UNBLOCKED = 'CONTACT_EMAIL_UNBLOCKED';
export const CONTACT_EMAIL_ACTIONS = [CONTACT_EMAIL_BLOCKED, CONTACT_EMAIL_UNBLOCKED];
export const normalizeContactEmail = (email: string) => email.trim().toLowerCase();
export const contactEmailHash = (email: string) => createHash('sha256').update(normalizeContactEmail(email)).digest('hex');

export async function isBlockedContactEmail(prisma: PrismaClient, email: unknown): Promise<boolean> {
  if (typeof email !== 'string' || email.length > 320) return false;
  const hash = contactEmailHash(email);
  const event = await prisma.auditLog.findFirst({
    where: { action: { in: CONTACT_EMAIL_ACTIONS }, metadata: { path: ['emailHash'], equals: hash } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true },
  });
  // An explicit admin unblock overrides the initial emergency configuration.
  if (event) return event.action === CONTACT_EMAIL_BLOCKED;
  return (process.env.BLOCKED_CONTACT_EMAIL_SHA256 || '').split(',').some(value => value.trim().toLowerCase() === hash);
}

export async function blockedContactEmails(prisma: PrismaClient): Promise<string[]> {
  const states = new Map<string, boolean>();
  const events = await prisma.auditLog.findMany({ where: { action: { in: CONTACT_EMAIL_ACTIONS } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true, metadata: true } });
  for (const event of events) {
    const email = (event.metadata as { email?: unknown })?.email;
    if (typeof email === 'string' && !states.has(email)) states.set(email, event.action === CONTACT_EMAIL_BLOCKED);
  }
  for (const raw of (process.env.BLOCKED_CONTACT_EMAILS || '').split(',')) {
    const email = normalizeContactEmail(raw);
    if (email && !states.has(email)) states.set(email, true);
  }
  return [...states].filter(([, blocked]) => blocked).map(([email]) => email).sort();
}
