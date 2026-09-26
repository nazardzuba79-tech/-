import { createPrivateKey, createPublicKey, hkdfSync, sign } from 'crypto';

const ORIGIN = 'https://notify.voltextech.net';
const DOMAIN = 'voltex-notifications-v1';

/** Domain-separated Ed25519 key, derived locally from the existing high-entropy
 * server secret. Never exports that secret or private key. Deployment pins only
 * the PUBLIC half at Cloudflare; event handling never calls Render for a key.
 * Rotating JWT_SECRET requires repinning the notification public key.
 */
function signingKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return null;
  const seed = Buffer.from(hkdfSync('sha256', secret, DOMAIN, 'deposit-event-signing', 32));
  return createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), seed,
  ]) });
}

export function notificationPublicKey(): string | null {
  const key = signingKey();
  return key ? createPublicKey(key).export({ format: 'jwk' }).x ?? null : null;
}

export interface DiscoveredTransfer {
  id: string;
  amount: { toString(): string };
  createdAt: Date;
}

// Both server event types use the existing pinned key. Keep the derivation's
// historical deposit-event-signing label so deployments need no key rotation.
async function sendSignedEvent(path: string, event: () => object, fetchImpl: typeof fetch): Promise<void> {
  try {
    const key = signingKey();
    if (!key) { console.warn('[notifications]', 'NOT_CONFIGURED'); return; }
    const timestamp = String(Date.now());
    const body = JSON.stringify(event());
    const signature = sign(null, Buffer.from(`${DOMAIN}\n${timestamp}\n${path}\n${body}`), key).toString('base64url');
    const response = await fetchImpl(`${ORIGIN}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-voltex-timestamp': timestamp, 'x-voltex-signature': signature },
      body, signal: AbortSignal.timeout(7_000), redirect: 'error',
    });
    // Do not print response bodies, URLs, transfer details or exception messages.
    if (!response.ok) console.warn('[notifications]', 'DELIVERY_UNAVAILABLE');
    await response.body?.cancel();
  } catch { console.warn('[notifications]', 'DELIVERY_UNAVAILABLE'); }
}

export function notifyDeposit(transfer: DiscoveredTransfer, fetchImpl: typeof fetch = fetch): Promise<void> {
  return sendSignedEvent('/v1/deposit', () => ({
    eventId: transfer.id, eventType: 'DEPOSIT_DISCOVERED', timestamp: transfer.createdAt.getTime(),
    amount: transfer.amount.toString(), asset: 'USDT', network: 'TRC20',
    // Discovery has no owner or accumulation aggregate. Do not query or invent them.
  }), fetchImpl);
}

export interface RegisteredUser {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
}

/** Called only by successful self-registration, never by seeds/admin provisioning.
 * Explicit allowlist: never serialize the full User, request, session or JWT.
 */
export async function notifyUserRegistered(user: RegisteredUser, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (user.role !== 'USER') return;
  await sendSignedEvent('/v1/registration', () => ({
    eventId: user.id, eventType: 'NEW_USER_REGISTERED', timestamp: user.createdAt.getTime(),
    userId: user.id, email: user.email, role: 'USER',
  }), fetchImpl);
}
