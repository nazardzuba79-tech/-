import type { PrismaClient, Prisma } from '@prisma/client';

export const ADMIN_USER_HIDDEN = 'ADMIN_USER_HIDDEN';
export const ADMIN_USER_UNHIDDEN = 'ADMIN_USER_UNHIDDEN';
const VISIBILITY_ACTIONS = [ADMIN_USER_HIDDEN, ADMIN_USER_UNHIDDEN] as const;

type Db = PrismaClient | Prisma.TransactionClient;
type VisibilityEvent = { userId: string | null; action: string; createdAt: Date; id: string };

export function hiddenAdminUserMapFromEvents(events: VisibilityEvent[]): Map<string, Date> {
  const hidden = new Map<string, Date>();
  const seen = new Set<string>();
  for (const row of events) {
    if (!row.userId || seen.has(row.userId)) continue;
    seen.add(row.userId);
    if (row.action === ADMIN_USER_HIDDEN) hidden.set(row.userId, row.createdAt);
  }
  return hidden;
}

export async function hiddenAdminUserMap(db: Db): Promise<Map<string, Date>> {
  const audit = (db as any).auditLog;
  if (!audit || typeof audit.findMany !== 'function') return new Map();
  const rows = await audit.findMany({
    where: { action: { in: [...VISIBILITY_ACTIONS] }, userId: { not: null } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { userId: true, action: true, createdAt: true, id: true },
  });
  return hiddenAdminUserMapFromEvents(rows);
}

export async function isAdminUserHidden(db: Db, userId: string): Promise<boolean> {
  const audit = (db as any).auditLog;
  if (!audit || typeof audit.findFirst !== 'function') return false;
  const row = await audit.findFirst({
    where: { userId, action: { in: [...VISIBILITY_ACTIONS] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { action: true },
  });
  return row?.action === ADMIN_USER_HIDDEN;
}
