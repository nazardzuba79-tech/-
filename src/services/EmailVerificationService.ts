import crypto from 'crypto';
import { PrismaClient, EmailVerificationChallenge } from '@prisma/client';

/**
 * Six-digit email verification for new registrations.
 *
 * The code is never stored. What goes in the database is
 * HMAC-SHA256(code, secret) — six digits is only a million possibilities, so
 * a plain digest (even bcrypt, at any sane cost) is brute-forceable offline
 * by anyone holding a database dump. The keyed digest is worthless without
 * the secret, and the secret never enters the database.
 *
 * One live challenge per user: issuing a new code deletes the previous rows,
 * so a code stops working the instant a newer one is sent. That is what makes
 * "resend invalidates the old code" true rather than merely intended.
 */

/** Ten minutes: long enough to switch to a mail client and back, short
 *  enough that a code found later in an inbox is already dead. */
export const VERIFICATION_EXPIRY_MS = 10 * 60_000;

/** Wrong guesses allowed against one challenge before it is dead. With a
 *  million codes and five tries, guessing is a 1-in-200,000 shot per
 *  challenge, and issuing a fresh challenge costs a new email. */
export const MAX_VERIFICATION_ATTEMPTS = 5;

/** Minimum wait between emails for the same challenge. */
export const RESEND_COOLDOWN_MS = 60_000;

export type VerifyFailure =
  | 'CHALLENGE_NOT_FOUND'
  | 'CHALLENGE_EXPIRED'
  | 'CHALLENGE_CONSUMED'
  | 'TOO_MANY_ATTEMPTS'
  | 'INVALID_CODE';

export type VerifyResult =
  | { ok: true; userId: string }
  | { ok: false; reason: VerifyFailure; attemptsRemaining?: number };

export type ResendResult =
  | { ok: true; challengeId: string; code: string; email: string }
  | { ok: false; reason: 'CHALLENGE_NOT_FOUND' | 'ALREADY_VERIFIED'; retryAfterSeconds?: number }
  | { ok: false; reason: 'COOLDOWN'; retryAfterSeconds: number };

/**
 * The HMAC key. EMAIL_VERIFICATION_SECRET is the dedicated variable; it falls
 * back to JWT_SECRET (already mandatory at boot, see src/index.ts) so an
 * existing deployment does not fail to start the moment this feature lands.
 * Either way the key lives only in the process environment.
 */
function verificationSecret(): string {
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('EMAIL_VERIFICATION_SECRET or JWT_SECRET is required for email verification');
  return secret;
}

/** Uniform over 000000-999999 from the CSPRNG. `randomInt` with an exclusive
 *  bound rejects-and-retries internally, so there is no modulo bias. */
export function generateVerificationCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashVerificationCode(code: string): string {
  return crypto.createHmac('sha256', verificationSecret()).update(code).digest('hex');
}

/** Constant-time compare so a wrong code cannot be narrowed digit by digit
 *  from response timing. Both sides are fixed-length hex here, but the
 *  length guard keeps timingSafeEqual from throwing on malformed input. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export class EmailVerificationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Replace any outstanding challenge for this user with a fresh one.
   *
   * Returns the plaintext code to exactly one caller — the route that hands
   * it to the mailer. It is never persisted, never logged and never included
   * in an API response.
   */
  async issueChallenge(userId: string): Promise<{ challengeId: string; code: string }> {
    const code = generateVerificationCode();
    const codeHash = hashVerificationCode(code);
    const now = new Date();

    const challenge = await this.prisma.$transaction(async (tx) => {
      // Deleting rather than leaving stale rows is what guarantees an older
      // code cannot verify after a resend.
      await tx.emailVerificationChallenge.deleteMany({ where: { userId } });
      return tx.emailVerificationChallenge.create({
        data: {
          userId,
          codeHash,
          expiresAt: new Date(now.getTime() + VERIFICATION_EXPIRY_MS),
          lastSentAt: now,
        },
      });
    });

    return { challengeId: challenge.id, code };
  }

  /**
   * Check a code and, if it is right, mark the user verified — both inside
   * one transaction, so a crash can never leave a consumed challenge beside
   * an unverified user (or the reverse).
   */
  async verify(challengeId: string, code: string): Promise<VerifyResult> {
    return this.prisma.$transaction(async (tx) => {
      const challenge = await tx.emailVerificationChallenge.findUnique({ where: { id: challengeId } });
      if (!challenge) return { ok: false, reason: 'CHALLENGE_NOT_FOUND' } as const;
      if (challenge.consumedAt) return { ok: false, reason: 'CHALLENGE_CONSUMED' } as const;
      if (challenge.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'CHALLENGE_EXPIRED' } as const;
      if (challenge.attempts >= MAX_VERIFICATION_ATTEMPTS) {
        return { ok: false, reason: 'TOO_MANY_ATTEMPTS' } as const;
      }

      if (!hashesMatch(challenge.codeHash, hashVerificationCode(code))) {
        const updated = await tx.emailVerificationChallenge.update({
          where: { id: challenge.id },
          data: { attempts: { increment: 1 } },
        });
        const attemptsRemaining = Math.max(0, MAX_VERIFICATION_ATTEMPTS - updated.attempts);
        return attemptsRemaining === 0
          ? ({ ok: false, reason: 'TOO_MANY_ATTEMPTS' } as const)
          : ({ ok: false, reason: 'INVALID_CODE', attemptsRemaining } as const);
      }

      const verifiedAt = new Date();
      await tx.emailVerificationChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: verifiedAt },
      });
      await tx.user.update({
        where: { id: challenge.userId },
        data: { emailVerifiedAt: verifiedAt },
      });
      return { ok: true, userId: challenge.userId } as const;
    });
  }

  /**
   * Issue and return a replacement code, subject to the cooldown.
   *
   * Keyed by challenge id rather than by email: the caller already holds the
   * id from registration, so resend never has to accept an address and can
   * never be used to probe which addresses are registered.
   */
  async resend(challengeId: string): Promise<ResendResult> {
    const challenge = await this.prisma.emailVerificationChallenge.findUnique({
      where: { id: challengeId },
      include: { user: { select: { id: true, email: true, emailVerifiedAt: true } } },
    });
    if (!challenge) return { ok: false, reason: 'CHALLENGE_NOT_FOUND' };
    if (challenge.user.emailVerifiedAt) return { ok: false, reason: 'ALREADY_VERIFIED' };

    const waited = Date.now() - challenge.lastSentAt.getTime();
    if (waited < RESEND_COOLDOWN_MS) {
      return { ok: false, reason: 'COOLDOWN', retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - waited) / 1000) };
    }

    const issued = await this.issueChallenge(challenge.userId);
    return { ok: true, challengeId: issued.challengeId, code: issued.code, email: challenge.user.email };
  }

  /** Seconds a client must wait before resend will be accepted, for the UI
   *  countdown. Derived from the stored timestamp, never from a number the
   *  client invented. */
  cooldownRemainingSeconds(challenge: Pick<EmailVerificationChallenge, 'lastSentAt'>): number {
    const waited = Date.now() - challenge.lastSentAt.getTime();
    return Math.max(0, Math.ceil((RESEND_COOLDOWN_MS - waited) / 1000));
  }
}

/** `a***@example.com` — enough for the user to recognise the address they
 *  typed, not enough to be worth harvesting from a shared screen. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  return `${name.slice(0, 1)}***@${domain}`;
}
