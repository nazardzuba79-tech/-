import speakeasy from 'speakeasy';
import {
  generateTotpSecret,
  verifyTotpCode,
  generateBackupCodes,
  verifyAndConsume2FACode,
} from '../TwoFactorService';

describe('TwoFactorService', () => {
  describe('generateTotpSecret / verifyTotpCode', () => {
    it('accepts a code generated from the secret it just issued', () => {
      const { base32 } = generateTotpSecret('alice@team.com');
      const code = speakeasy.totp({ secret: base32, encoding: 'base32' });

      expect(verifyTotpCode(base32, code)).toBe(true);
    });

    it('rejects a code that does not match the secret', () => {
      const { base32 } = generateTotpSecret('alice@team.com');
      expect(verifyTotpCode(base32, '000000')).toBe(false);
    });

    it('embeds the account email in the otpauth URL so authenticator apps label it usefully', () => {
      const { otpauthUrl } = generateTotpSecret('alice@team.com');
      expect(otpauthUrl).toContain('VOLTEX');
      expect(otpauthUrl).toContain(encodeURIComponent('alice@team.com'));
    });
  });

  describe('generateBackupCodes', () => {
    it('returns 8 unique plaintext codes and matching bcrypt hashes', async () => {
      const { plaintext, hashed } = await generateBackupCodes();

      expect(plaintext).toHaveLength(8);
      expect(hashed).toHaveLength(8);
      expect(new Set(plaintext).size).toBe(8);
      // bcrypt hashes look like $2b$10$... — never the plaintext itself.
      for (let i = 0; i < 8; i++) {
        expect(hashed[i]).toMatch(/^\$2[aby]\$/);
        expect(hashed[i]).not.toBe(plaintext[i]);
      }
    });
  });

  describe('verifyAndConsume2FACode', () => {
    it('accepts a valid TOTP code without touching backup codes', async () => {
      const { base32 } = generateTotpSecret('alice@team.com');
      const code = speakeasy.totp({ secret: base32, encoding: 'base32' });

      const result = await verifyAndConsume2FACode(
        { twoFactorSecret: base32, twoFactorBackupCodes: ['$2b$10$somehash'] },
        code
      );

      expect(result.ok).toBe(true);
      expect(result.remainingBackupCodes).toBeUndefined();
    });

    it('falls back to a backup code and reports it consumed', async () => {
      const { base32 } = generateTotpSecret('alice@team.com');
      const { plaintext, hashed } = await generateBackupCodes();

      const result = await verifyAndConsume2FACode(
        { twoFactorSecret: base32, twoFactorBackupCodes: hashed },
        plaintext[3]
      );

      expect(result.ok).toBe(true);
      expect(result.remainingBackupCodes).toHaveLength(7);
      expect(result.remainingBackupCodes).not.toContain(hashed[3]);
    });

    it('is case-insensitive and trims whitespace on backup codes', async () => {
      const { base32 } = generateTotpSecret('alice@team.com');
      const { plaintext, hashed } = await generateBackupCodes();

      const result = await verifyAndConsume2FACode(
        { twoFactorSecret: base32, twoFactorBackupCodes: hashed },
        `  ${plaintext[0].toLowerCase()}  `
      );

      expect(result.ok).toBe(true);
    });

    it('rejects a code that is neither a valid TOTP nor a known backup code', async () => {
      const { base32 } = generateTotpSecret('alice@team.com');
      const { hashed } = await generateBackupCodes();

      const result = await verifyAndConsume2FACode(
        { twoFactorSecret: base32, twoFactorBackupCodes: hashed },
        'NOPE-NOPE'
      );

      expect(result.ok).toBe(false);
      expect(result.remainingBackupCodes).toBeUndefined();
    });

    it('does not consume a backup code twice', async () => {
      const { base32 } = generateTotpSecret('alice@team.com');
      const { plaintext, hashed } = await generateBackupCodes();

      const first = await verifyAndConsume2FACode({ twoFactorSecret: base32, twoFactorBackupCodes: hashed }, plaintext[0]);
      expect(first.ok).toBe(true);

      // Caller is expected to persist remainingBackupCodes; simulate that
      // and confirm the spent code no longer works against the new list.
      const second = await verifyAndConsume2FACode(
        { twoFactorSecret: base32, twoFactorBackupCodes: first.remainingBackupCodes! },
        plaintext[0]
      );
      expect(second.ok).toBe(false);
    });
  });
});
