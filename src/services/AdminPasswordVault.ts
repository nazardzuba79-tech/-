import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

const VERSION = 'v1';
const PURPOSE = Buffer.from('voltex-admin-password-vault-v1');

function encryptionKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret || !/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new Error('API_KEY_ENCRYPTION_SECRET is required for password storage');
  }
  // Separate the vault key from the existing API-key encryption key.
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'hex'), PURPOSE, PURPOSE, 32));
}

export function encryptAdminPassword(password: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function decryptAdminPassword(value: string, userId: string): string {
  if (!value.startsWith(`${VERSION}.`)) throw new Error('Unsupported password vault version');
  const bytes = Buffer.from(value.slice(VERSION.length + 1), 'base64');
  if (bytes.length < 29) throw new Error('Invalid password vault record');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
