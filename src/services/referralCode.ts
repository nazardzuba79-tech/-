import { randomBytes } from 'crypto';

// Excludes visually ambiguous characters (0/O, 1/I/L) so a code read off a
// screen or spoken aloud can be typed back correctly.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateReferralCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}
