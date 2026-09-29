import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifiedTelegramIdentity { telegramUserId: string; authDate: number; queryId: string | null }
export class TelegramValidationError extends Error {}

/** Pure server-side verification. Not mounted as a route; no DB, account creation or token minting. */
export function verifyTelegramInitData(raw: string, botToken: string, nowSeconds = Math.floor(Date.now() / 1000), maxAgeSeconds = 300): VerifiedTelegramIdentity {
  const reject = (): never => { throw new TelegramValidationError('Invalid Telegram launch data'); };
  if (!botToken || !raw || raw.length > 8192 || !Number.isFinite(nowSeconds) || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0 || maxAgeSeconds > 3600) return reject();
  const params = new URLSearchParams(raw);
  const seen = new Set<string>();
  for (const [key] of params) { if (seen.has(key)) return reject(); seen.add(key); }
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return reject();
  const date = params.get('auth_date') || '';
  if (!/^\d+$/.test(date)) return reject();
  const authDate = Number(date);
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds || nowSeconds - authDate > maxAgeSeconds) return reject();
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return reject();
  let user: unknown;
  try { user = JSON.parse(params.get('user') || ''); } catch { return reject(); }
  if (!user || typeof user !== 'object' || !('id' in user) || !Number.isSafeInteger(user.id) || Number(user.id) <= 0) return reject();
  return { telegramUserId: String(user.id), authDate, queryId: params.get('query_id') };
}

/** Integration seam: even a valid Telegram signature cannot link or open an account. */
export function telegramAccountLinkingUnavailable(): never {
  throw new Error('Telegram account linking is not enabled');
}
