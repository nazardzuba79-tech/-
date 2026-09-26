import { createHmac, createPublicKey, verify, KeyObject } from 'crypto';

/**
 * Trust between Render and the Cloudflare KYC edge (workers/kyc-edge).
 *
 * The edge signs every call it makes here with an Ed25519 private key that
 * exists only as a Worker secret (created inside the deploy workflow, never
 * in git or in this service). Render holds only the PUBLIC half, so no new
 * Render secret is needed and a leak of this process cannot forge an edge.
 *
 * Public key source, in order:
 *   1. KYC_EDGE_PUBLIC_KEY (the JWK `x`, base64url) — pinned by the owner;
 *   2. GET {KYC_EDGE_ORIGIN}/v1/public-key over HTTPS — fetched only when a
 *      signed call arrives, cached for 10 minutes. No polling, no idle work.
 *
 * Signed string: `v1\n<unix-ms>\n<path>\n<raw body>`, ±5 minutes. Replays are
 * harmless by design: authorize writes nothing and confirm is idempotent on
 * the submission id.
 */

export const KYC_EDGE_BODY_TYPE = 'application/vnd.voltex.kyc-edge+json';
const DEFAULT_EDGE_ORIGIN = 'https://kyc.voltextech.net';
const KEY_TTL_MS = 10 * 60_000;
const REFETCH_MIN_MS = 60_000;
const SKEW_MS = 5 * 60_000;

export interface KycEdgeTrustOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class KycEdgeTrust {
  private cached: { key: KeyObject; at: number } | null = null;
  private lastFetchAt = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: KycEdgeTrustOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private pinnedKey(): KeyObject | null {
    const x = process.env.KYC_EDGE_PUBLIC_KEY?.trim();
    if (!x) return null;
    try {
      return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
    } catch {
      return null;
    }
  }

  private async fetchKey(force: boolean): Promise<KeyObject | null> {
    const now = this.now();
    if (!force && this.cached && now - this.cached.at < KEY_TTL_MS) return this.cached.key;
    if (now - this.lastFetchAt < REFETCH_MIN_MS && this.cached) return this.cached.key;
    this.lastFetchAt = now;
    const origin = (process.env.KYC_EDGE_ORIGIN || DEFAULT_EDGE_ORIGIN).replace(/\/$/, '');
    if (!origin.startsWith('https://') && process.env.NODE_ENV === 'production') return null;
    try {
      const res = await this.fetchImpl(`${origin}/v1/public-key`, { signal: AbortSignal.timeout(3_000) });
      if (!res.ok) return this.cached?.key ?? null;
      const body = (await res.json()) as { alg?: string; key?: { kty?: string; crv?: string; x?: string; d?: string } };
      const jwk = body?.key;
      if (body?.alg !== 'Ed25519' || jwk?.kty !== 'OKP' || jwk?.crv !== 'Ed25519' || typeof jwk.x !== 'string' || jwk.d) {
        return this.cached?.key ?? null;
      }
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
      this.cached = { key, at: now };
      return key;
    } catch {
      return this.cached?.key ?? null;
    }
  }

  /** Whether an edge key can currently be resolved — for the admin page only. */
  async configured(): Promise<boolean> {
    return !!(this.pinnedKey() ?? (await this.fetchKey(false)));
  }

  /** 'ok' | 'unconfigured' (no key reachable) | 'invalid' (bad/missing/stale signature). */
  async verify(path: string, rawBody: Buffer, tsHeader: unknown, sigHeader: unknown): Promise<'ok' | 'unconfigured' | 'invalid'> {
    if (typeof tsHeader !== 'string' || typeof sigHeader !== 'string' || !/^\d{10,16}$/.test(tsHeader) || !/^[A-Za-z0-9_-]{80,100}$/.test(sigHeader)) {
      return 'invalid';
    }
    if (Math.abs(this.now() - Number(tsHeader)) > SKEW_MS) return 'invalid';
    const message = Buffer.concat([Buffer.from(`v1\n${tsHeader}\n${path}\n`), rawBody]);
    const signature = Buffer.from(sigHeader, 'base64url');

    const pinned = this.pinnedKey();
    if (pinned) return verify(null, message, pinned, signature) ? 'ok' : 'invalid';

    const key = await this.fetchKey(false);
    if (!key) return 'unconfigured';
    if (verify(null, message, key, signature)) return 'ok';
    // The edge may have rotated its key: one rate-limited refetch.
    const fresh = await this.fetchKey(true);
    if (fresh && fresh !== key && verify(null, message, fresh, signature)) return 'ok';
    return 'invalid';
  }
}

/**
 * One browser attempt = one submission id, decided HERE (never by the
 * browser or the edge): HMAC of the user and the attempt's random requestId.
 * The same attempt retried maps to the same id — which is also the
 * KycSubmission primary key — so a repeated callback cannot create a second
 * row, and confirm can check the edge did not invent an id.
 */
export function kycSubmissionId(userId: string, requestId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is required');
  const hex = createHmac('sha256', secret).update(`voltex-kyc-submission:v1:${userId}:${requestId.toLowerCase()}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
