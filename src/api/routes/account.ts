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

// All optional — the profile form lets someone save just the field they
// filled in. Empty string clears a field (matches how the form's own
// "leave blank to clear" inputs behave); undefined leaves it untouched.
const updateProfileSchema = z.object({
  displayName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(32).optional(),
  country: z.string().trim().max(2).optional(),
});

// A profile photo is stored as a self-contained data URL on the User row
// (see schema.prisma) rather than a file, so these bounds are what keep a
// cosmetic field from becoming a way to write megabytes into the database.
// 512KB of decoded image is generous for the 256x256 the client downscales
// to before uploading (~30-60KB in practice), while still rejecting an
// unresized phone photo outright.
const AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_MIME_PREFIX = /^data:image\/(png|jpeg|webp);base64,/;

// The first bytes of each format this accepts. The declared MIME type in a
// data URL is attacker-controlled — it's whatever the client typed — so it
// alone is no guarantee the payload is an image, and this string is handed
// straight to an <img src>. Sniffing the actual signature is what makes
// the declared type meaningful.
const IMAGE_SIGNATURES: [string, number[]][] = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]], // "RIFF"; bytes 8-11 are "WEBP"
];

const avatarSchema = z.object({
  image: z.string().max(AVATAR_MAX_BYTES * 2),
});

/** Decodes and validates an uploaded avatar data URL, returning the error
 * to report or null when it's a real, in-budget image of a declared type. */
function rejectAvatar(dataUrl: string): string | null {
  const match = AVATAR_MIME_PREFIX.exec(dataUrl);
  if (!match) return 'Image must be a base64 data URL of type PNG, JPEG, or WebP';

  const declaredMime = `image/${match[1]}`;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(dataUrl.slice(match[0].length), 'base64');
  } catch {
    return 'Image is not valid base64';
  }
  if (bytes.length === 0) return 'Image is empty';
  if (bytes.length > AVATAR_MAX_BYTES) return 'Image is too large — maximum 512KB';

  const signature = IMAGE_SIGNATURES.find(([mime]) => mime === declaredMime);
  if (!signature || !signature[1].every((byte, i) => bytes[i] === byte)) {
    return `Image content does not look like ${declaredMime}`;
  }
  if (declaredMime === 'image/webp' && bytes.subarray(8, 12).toString('ascii') !== 'WEBP') {
    return 'Image content does not look like image/webp';
  }
  return null;
}

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
  'SESSION_REVOKED',
];
const SECURITY_LOG_LIMIT = 50;

export function accountRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/me', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      phone: user.phone,
      country: user.country,
      avatarUrl: user.avatarUrl,
      role: user.role,
      isAdmin: user.role === 'ADMIN',
      kycStatus: user.kycStatus,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
    });
  });

  // Self-service profile fields — name/phone/country the user enters
  // themselves in Settings. Purely informational, distinct from the
  // identity-document country submitted for KYC review.
  router.patch('/me/profile', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const user = await prisma.user.update({ where: { id: req.userId }, data: parsed.data });
    res.json({ displayName: user.displayName, phone: user.phone, country: user.country });
  });

  // Profile photo. A base64 image can exceed the app-wide 100KB JSON body
  // limit on its own, so index.ts mounts a wider parser for this one path
  // ahead of the global one — see the comment there. Without that mount
  // this endpoint 413s before ever reaching the size check below, so the
  // two limits have to be kept in step.
  router.put('/me/avatar', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const parsed = avatarSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Missing image' });

    const rejection = rejectAvatar(parsed.data.image);
    if (rejection) return res.status(400).json({ error: rejection });

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl: parsed.data.image },
    });
    res.json({ avatarUrl: user.avatarUrl });
  });

  router.delete('/me/avatar', requireAuth(prisma), async (req: AuthedRequest, res) => {
    await prisma.user.update({ where: { id: req.userId }, data: { avatarUrl: null } });
    res.json({ avatarUrl: null });
  });

  router.patch('/me/password', requireAuth(prisma), async (req: AuthedRequest, res) => {
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
  router.get('/account/security-log', requireAuth(prisma), async (req: AuthedRequest, res) => {
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

  // Real devices/browsers with a live (non-revoked) session — see the
  // Session model's doc comment. req.sessionId (set by requireAuth only
  // when the bearer token carries a `sid` claim) marks which row belongs
  // to the request making this very call, so the frontend can label
  // "This device" and the sign-out button can warn before ending it.
  router.get('/me/sessions', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
    res.json(
      sessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === req.sessionId,
      }))
    );
  });

  // "Sign out this device" — sets revokedAt, which requireAuth checks on
  // every subsequent request carrying that session's token, so this has
  // an immediate, real effect instead of just removing a row from a list.
  // Revoking the session making THIS very request is allowed on purpose:
  // it just signs the caller out right now, same as clicking logout.
  router.delete('/me/sessions/:id', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const session = await prisma.session.findUnique({ where: { id: req.params.id } });
    if (!session || session.userId !== req.userId) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (!session.revokedAt) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await prisma.auditLog.create({
        data: {
          userId: req.userId!,
          action: 'SESSION_REVOKED',
          metadata: { sessionId: session.id, self: session.id === req.sessionId },
        },
      });
    }
    res.json({ status: 'ok' });
  });

  // Step 1 of enabling 2FA: mint a new TOTP secret and hand back a QR code
  // (plus the raw base32 key for manual entry). Stored on the user record
  // immediately, but twoFactorEnabled stays false until /2fa/verify proves
  // the user actually has it loaded in an authenticator app — otherwise a
  // dropped request here could silently half-enable 2FA with a secret
  // nobody possesses, locking the account out.
  router.post('/account/2fa/setup', requireAuth(prisma), async (req: AuthedRequest, res) => {
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
  router.post('/account/2fa/verify', requireAuth(prisma), async (req: AuthedRequest, res) => {
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
  router.post('/account/2fa/disable', requireAuth(prisma), async (req: AuthedRequest, res) => {
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
