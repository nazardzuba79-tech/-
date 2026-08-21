import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

/**
 * API keys let a user connect a trading bot/script to their own account —
 * same balances and orders as the web UI, authenticated differently (HMAC
 * request signing, see apiKeyAuth.ts) instead of a login/password JWT.
 *
 * The secret is encrypted (not hashed) at rest, because verifying an HMAC
 * signature on each request needs the raw secret back — unlike a login
 * password, which only ever needs a yes/no comparison. AES-256-GCM with a
 * server-side master key (API_KEY_ENCRYPTION_SECRET) is the standard way
 * to do that; for real production scale you'd usually move that master key
 * into a KMS/HSM rather than an env var, same tradeoff as JWT_SECRET.
 */

const ENCRYPTION_KEY_HEX = process.env.API_KEY_ENCRYPTION_SECRET;
if (!ENCRYPTION_KEY_HEX) {
  throw new Error('API_KEY_ENCRYPTION_SECRET env var is required');
}
if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY_HEX)) {
  throw new Error('API_KEY_ENCRYPTION_SECRET must be a 64-character hex string (32 bytes) — e.g. `openssl rand -hex 32`');
}
const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');

export function encryptApiSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptApiSecret(encrypted: string): string {
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export class ApiKeyService {
  constructor(private prisma: PrismaClient) {}

  /** Returns the plaintext secret — this is the ONLY time it's ever available again. */
  async createKey(userId: string, label: string, canTrade: boolean) {
    const apiKey = `ak_${crypto.randomBytes(16).toString('hex')}`;
    const apiSecret = crypto.randomBytes(32).toString('hex');

    const created = await this.prisma.apiKey.create({
      data: { userId, label, apiKey, encryptedSecret: encryptApiSecret(apiSecret), canTrade },
    });

    return { id: created.id, label: created.label, apiKey, apiSecret, canTrade: created.canTrade, createdAt: created.createdAt };
  }

  async listKeys(userId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k: (typeof keys)[number]) => ({
      id: k.id,
      label: k.label,
      apiKey: k.apiKey,
      canTrade: k.canTrade,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));
  }

  async revokeKey(userId: string, keyId: string): Promise<boolean> {
    const key = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key || key.userId !== userId || key.revokedAt) return false;
    await this.prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
    return true;
  }
}
