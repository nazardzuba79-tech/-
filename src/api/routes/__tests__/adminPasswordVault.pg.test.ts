import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { decryptAdminPassword, encryptAdminPassword } from '../../../services/AdminPasswordVault';

const url = process.env.ADMIN_PASSWORD_TEST_URL;
const localOnly = /^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/voltex_admin_password_test$/.test(url ?? '');
const run = localOnly ? it : it.skip;

run('registration, password change, and deletion keep the encrypted copy in sync in PostgreSQL', async () => {
  process.env.API_KEY_ENCRYPTION_SECRET = '1'.repeat(64);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const email = `vault-${randomUUID()}@example.invalid`;
  const first = encryptAdminPassword('FirstTestPassword123', email);
  try {
    const user = await prisma.user.create({
      data: {
        email, passwordHash: 'fixture-hash', referralCode: randomUUID().slice(0, 8),
        adminPasswordVault: { create: { encryptedPassword: first } },
      },
    });
    const stored = await prisma.adminPasswordVault.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.encryptedPassword).not.toContain('FirstTestPassword123');
    expect(decryptAdminPassword(stored.encryptedPassword, email)).toBe('FirstTestPassword123');

    const second = encryptAdminPassword('SecondTestPassword456', email);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: 'new-fixture-hash', adminPasswordVault: {
        upsert: { create: { encryptedPassword: second }, update: { encryptedPassword: second } },
      } },
    });
    const updated = await prisma.adminPasswordVault.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decryptAdminPassword(updated.encryptedPassword, email)).toBe('SecondTestPassword456');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe('new-fixture-hash');

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.adminPasswordVault.findUnique({ where: { userId: user.id } })).toBeNull();
  } finally {
    await prisma.$disconnect();
  }
}, 30_000);
