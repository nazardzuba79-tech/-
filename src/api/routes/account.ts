import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { generateTotpSecret, verifyAndConsume2FACode, generateBackupCodes } from '../../services/TwoFactorService';

const BCRYPT_ROUNDS = 12;

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(10, 'password must be at least 10 characters'),
});

const twoFactorCodeSchema = z.object({
  code: z.string().min(6).max(64),
});

// Only the account-security-relevant subset of AuditLog actions — not every
// audit event (order placement, deposits, ...) belongs on a "Security Log".
const SECURITY_LOG_ACTIONS = [
  'USER_LOGGED_IN',
  'USER_REGISTERED',
  'PASSWORD_CHANGED',
  'TWO_FACTOR_ENABLED',
  'TWO_FACTOR_DISABLED',
  'TWO_FACTOR_BACKUP_CODE_USED',
];
const SECURITY_LOG_LIMIT = 50;

export function accountRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      isAdmin: user.role === 'ADMIN',
      kycStatus: user.kycStatus,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
    });
  });

  router.patch('/me/password', requireAuth, async (req: AuthedRequest, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { currentPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'PASSWORD_CHANGED', metadata: {} },
    });

    res.json({ status: 'ok' });
  });

  // The account's own login/security event history — real AuditLog rows,
  // scoped to req.userId so no one can read another account's log.
  router.get('/account/security-log', requireAuth, async (req: AuthedRequest, res) => {
    const entries = await prisma.auditLog.findMany({
      where: { userId: req.userId, action: { in: SECURITY_LOG_ACTIONS } },
      orderBy: { createdAt: 'desc' },
      take: SECURITY_LOG_LIMIT,
    });
    res.json(
      entries.map((e) => ({
        id: e.id,
        action: e.action,
        createdAt: e.createdAt,
        metadata: e.metadata,
      }))
    );
  });

  // Step 1 of enabling 2FA: mint a new TOTP secret and hand back a QR code
  // (plus the raw base32 key for manual entry). Stored on the user record
  // immediately, but twoFactorEnabled stays false until /2fa/verify proves
  // the user actually has it loaded in an authenticator app — otherwise a
  // dropped request here could silently half-enable 2FA with a secret
  // nobody possesses, locking the account out.
  router.post('/account/2fa/setup', requireAuth, async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
    }

    const { base32, otpauthUrl } = generateTotpSecret(user.email);
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: base32 } });

    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
    res.json({ secret: base32, otpauthUrl, qrCodeDataUrl });
  });

  // Step 2: prove possession of the secret with a live code. On success,
  // issues a fresh set of backup codes (returned exactly once — only the
  // bcrypt hashes are ever stored) and flips twoFactorEnabled on.
  router.post('/account/2fa/verify', requireAuth, async (req: AuthedRequest, res) => {
    const parsed = twoFactorCodeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
    }
    if (!user.twoFactorSecret) {
      return res.status(400).json({ error: 'Start setup first with /account/2fa/setup' });
    }

    const result = await verifyAndConsume2FACode(
      { twoFactorSecret: user.twoFactorSecret, twoFactorBackupCodes: [] },
      parsed.data.code
    );
    if (!result.ok) return res.status(401).json({ error: 'Invalid authentication code' });

    const { plaintext, hashed } = await generateBackupCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true, twoFactorBackupCodes: hashed },
    });
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'TWO_FACTOR_ENABLED', metadata: {} },
    });

    res.json({ status: 'ok', backupCodes: plaintext });
  });

  // Disabling requires a live code (TOTP or backup) too — otherwise anyone
  // who hijacks an already-open session could strip 2FA protection off the
  // account without ever having to defeat it.
  router.post('/account/2fa/disable', requireAuth, async (req: AuthedRequest, res) => {
    const parsed = twoFactorCodeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.twoFactorEnabled) {
      return res.status(400).json({ error: 'Two-factor authentication is not enabled' });
    }

    const result = await verifyAndConsume2FACode(user, parsed.data.code);
    if (!result.ok) return res.status(401).json({ error: 'Invalid authentication code' });

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
    });
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'TWO_FACTOR_DISABLED', metadata: {} },
    });

    res.json({ status: 'ok' });
  });

  return router;
}
