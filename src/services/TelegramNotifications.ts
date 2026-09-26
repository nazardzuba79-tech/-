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

export async function notifyDeposit(transfer: DiscoveredTransfer, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const key = signingKey();
    if (!key) { console.warn('[notifications]', 'NOT_CONFIGURED'); return; }
    const path = '/v1/deposit';
    const timestamp = String(Date.now());
    const body = JSON.stringify({
      eventId: transfer.id, eventType: 'DEPOSIT_DISCOVERED', timestamp: transfer.createdAt.getTime(),
      amount: transfer.amount.toString(), asset: 'USDT', network: 'TRC20',
      // Discovery has no owner or accumulation aggregate. Do not query or invent them.
    });
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
