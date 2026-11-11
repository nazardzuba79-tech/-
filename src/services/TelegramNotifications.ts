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
  /** When this exchange first recorded the transfer. NOT the transaction time. */
  createdAt: Date;
  /** Authoritative on-chain block time. Without it nothing is announced as new. */
  blockTimestamp?: Date | null;
  asset: string;
  chain: string;
  txHash: string;
  confirmations: number;
  requiredConfirmations: number;
  finalized: boolean;
  verifiedAt: Date | null;
  verifyError?: string | null;
}

export type DepositDeliveryStatus = 'SENT' | 'FAILED' | 'UNKNOWN' | 'ATTEMPTED';
/** A digest the Worker refuses as malformed can never be delivered by a retry. */
export type DigestDeliveryStatus = DepositDeliveryStatus | 'REJECTED';

// Both server event types use the existing pinned key. Keep the derivation's
// historical deposit-event-signing label so deployments need no key rotation.
async function sendSignedEvent(path: string, event: () => object, fetchImpl: typeof fetch, receipt = false): Promise<DepositDeliveryStatus | null> {
  return (await sendSigned(path, event, fetchImpl, receipt)).status;
}
async function sendSigned(path: string, event: () => object, fetchImpl: typeof fetch, receipt: boolean): Promise<{ status: DepositDeliveryStatus | null; invalid: boolean }> {
  try {
    const key = signingKey();
    if (!key) { console.warn('[notifications]', 'NOT_CONFIGURED'); return { status: null, invalid: false }; }
    const timestamp = String(Date.now());
    const body = JSON.stringify(event());
    const signature = sign(null, Buffer.from(`${DOMAIN}\n${timestamp}\n${path}\n${body}`), key).toString('base64url');
    const response = await fetchImpl(`${ORIGIN}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-voltex-timestamp': timestamp, 'x-voltex-signature': signature },
      body, signal: AbortSignal.timeout(7_000), redirect: 'error',
    });
    // Do not print response bodies, URLs, transfer details or exception messages.
    if (!response.ok) console.warn('[notifications]', 'DELIVERY_UNAVAILABLE');
    if (receipt) {
      const result = await response.json() as { status?: string; deliveryStatus?: string } | null;
      const status = result?.status === 'DUPLICATE' ? result.deliveryStatus : result?.status;
      if (typeof status === 'string' && ['SENT', 'FAILED', 'UNKNOWN', 'ATTEMPTED'].includes(status)
        && (response.ok || response.status === 502)) return { status: status as DepositDeliveryStatus, invalid: false };
      // The Worker itself (not a proxy, not an older release answering 404)
      // says this exact event is malformed.
      return { status: null, invalid: response.status === 400 && result?.status === 'INVALID_EVENT' };
    }
    await response.body?.cancel();
    return { status: null, invalid: false };
  } catch { console.warn('[notifications]', 'DELIVERY_UNAVAILABLE'); }
  return { status: null, invalid: false };
}

export function notifyDeposit(transfer: DiscoveredTransfer, fetchImpl: typeof fetch = fetch): Promise<DepositDeliveryStatus | null> {
  if (transfer.chain !== 'tron' || !['TRX', 'USDT'].includes(transfer.asset)
    || !transfer.verifiedAt || transfer.verifyError || !transfer.finalized
    || !Number.isSafeInteger(transfer.requiredConfirmations) || transfer.requiredConfirmations < 1
    || !Number.isSafeInteger(transfer.confirmations) || transfer.confirmations < transfer.requiredConfirmations
    || !/^[a-f0-9]{64}$/i.test(transfer.txHash)) return Promise.resolve(null);
  // #699: the event carries two separate times. `timestamp` is the record
  // (observation) time used for signature freshness and retention; `blockTime`
  // is when the transaction happened on chain and is what the owner is shown.
  const blockTime = transfer.blockTimestamp?.getTime();
  if (blockTime === undefined || !Number.isSafeInteger(blockTime) || blockTime <= 0) return Promise.resolve(null);
  return sendSignedEvent('/v1/deposit', () => ({
    eventId: transfer.id, eventType: 'DEPOSIT_DISCOVERED', timestamp: transfer.createdAt.getTime(), blockTime,
    amount: transfer.amount.toString(), asset: transfer.asset, network: transfer.asset === 'TRX' ? 'TRON_NATIVE' : 'TRC20',
    txHash: transfer.txHash.toLowerCase(), confirmations: transfer.confirmations,
    requiredConfirmations: transfer.requiredConfirmations, finalized: true, proofStatus: 'VERIFIED',
    // Discovery has no owner or accumulation aggregate. Do not query or invent them.
  }), fetchImpl, true);
}

export interface DepositDigestGroup {
  kind: 'MICRO' | 'HISTORICAL' | 'TIME_UNKNOWN';
  asset: 'TRX' | 'USDT';
  count: number;
  total: string;
  from?: number;
  to?: number;
  below?: string;
}
export interface DepositDigest {
  /** deposit-digest:<chain>:<Kyiv day>. The Worker deduplicates on it. */
  id: string;
  /** When the digest was first claimed; identical on every replay. */
  createdAt: Date;
  groups: DepositDigestGroup[];
}

/** One summary for transfers that must not look like new deposits: micro
 * transfers (possible dust) and transfers that were already old when first
 * recorded. Counts, sums and chain-time ranges only: no TXID, address, sender,
 * owner or credit. The rows themselves stay in the admin queue. */
export async function notifyDepositDigest(digest: DepositDigest, fetchImpl: typeof fetch = fetch): Promise<DigestDeliveryStatus | null> {
  const decimal = (value: unknown) => typeof value === 'string' && /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/.test(value);
  const time = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
  if (!/^deposit-digest:tron:\d{4}-\d{2}-\d{2}$/.test(digest.id) || !Number.isSafeInteger(digest.createdAt?.getTime?.())
    || !Array.isArray(digest.groups) || digest.groups.length < 1 || digest.groups.length > 6
    || new Set(digest.groups.map(g => `${g.kind}|${g.asset}`)).size !== digest.groups.length
    || digest.groups.some(g => !['MICRO', 'HISTORICAL', 'TIME_UNKNOWN'].includes(g.kind) || !['TRX', 'USDT'].includes(g.asset)
      || !Number.isSafeInteger(g.count) || g.count < 1 || g.count > 100_000 || !decimal(g.total)
      || (g.from === undefined) !== (g.to === undefined) || (g.from !== undefined && (!time(g.from) || !time(g.to) || g.from > g.to!))
      || (g.kind === 'MICRO' ? !decimal(g.below) : g.below !== undefined))) return 'REJECTED';
  const outcome = await sendSigned('/v1/deposit-digest', () => ({
    eventId: digest.id, eventType: 'DEPOSIT_DIGEST', timestamp: digest.createdAt.getTime(),
    groups: digest.groups.map(g => ({
      kind: g.kind, asset: g.asset, network: g.asset === 'TRX' ? 'TRON_NATIVE' : 'TRC20', count: g.count, total: g.total,
      ...(g.from !== undefined ? { from: g.from, to: g.to } : {}), ...(g.below !== undefined ? { below: g.below } : {}),
    })),
  }), fetchImpl, true);
  return outcome.status ?? (outcome.invalid ? 'REJECTED' : null);
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

/** A copy is an operational hint only, never deposit evidence. Only server-recorded,
 * newly inserted copy events may be sent. The account email is read by the server;
 * wallet destinations, amounts and credentials never enter this alert.
 */
export interface CopiedAddressNotice {
  id: string;
  asset: string;
  network: string;
  networkLabel: string;
  email?: string;
  receivedAt: Date;
}
export function notifyDepositAddressCopied(copy: CopiedAddressNotice, fetchImpl: typeof fetch = fetch): Promise<void> {
  return sendSignedEvent('/v1/copy', () => ({
    eventId: copy.id, eventType: 'DEPOSIT_ADDRESS_COPIED', timestamp: copy.receivedAt.getTime(),
    asset: copy.asset, network: copy.network, networkLabel: copy.networkLabel, email: copy.email,
  }), fetchImpl).then(() => undefined);
}
