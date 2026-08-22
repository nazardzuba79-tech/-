import { randomInt } from 'crypto';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';

const BACKUP_CODE_BCRYPT_ROUNDS = 10;
const BACKUP_CODE_COUNT = 8;
// Excludes visually ambiguous characters (0/O, 1/I/L) so codes are easy to
// transcribe by hand from a "print these and put them somewhere safe" screen.
const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateTotpSecret(email: string): { base32: string; otpauthUrl: string } {
  const secret = speakeasy.generateSecret({ name: `VOLTEX (${email})`, length: 20 });
  return { base32: secret.base32, otpauthUrl: secret.otpauth_url! };
}

export function verifyTotpCode(base32Secret: string, code: string): boolean {
  return speakeasy.totp.verify({
    secret: base32Secret,
    encoding: 'base32',
    token: code.trim(),
    window: 1, // tolerate one 30s step of clock drift either side
  });
}

function randomBackupCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export async function generateBackupCodes(): Promise<{ plaintext: string[]; hashed: string[] }> {
  const plaintext = Array.from({ length: BACKUP_CODE_COUNT }, randomBackupCode);
  const hashed = await Promise.all(plaintext.map((code) => bcrypt.hash(code, BACKUP_CODE_BCRYPT_ROUNDS)));
  return { plaintext, hashed };
}

/**
 * Checks a user-supplied code against their live TOTP secret first, then
 * falls back to matching (and consuming) a hashed one-time backup code.
 * Callers must persist `remainingBackupCodes` back to the user record when
 * it's returned — that's the signal a backup code was just spent.
 */
export async function verifyAndConsume2FACode(
  user: { twoFactorSecret: string | null; twoFactorBackupCodes: string[] },
  code: string
): Promise<{ ok: boolean; remainingBackupCodes?: string[] }> {
  if (user.twoFactorSecret && verifyTotpCode(user.twoFactorSecret, code)) {
    return { ok: true };
  }

  const normalized = code.trim().toUpperCase();
  for (const hash of user.twoFactorBackupCodes) {
    if (await bcrypt.compare(normalized, hash)) {
      return { ok: true, remainingBackupCodes: user.twoFactorBackupCodes.filter((h) => h !== hash) };
    }
  }

  return { ok: false };
}
